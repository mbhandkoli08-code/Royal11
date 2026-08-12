"""ROYAL11 card-games engine (Phase 0 foundation).

Game-agnostic table/round lifecycle over the existing coin wallet, with a
provably-fair server RNG and a rake that flows into the existing Admin/Super-Admin
revenue split. Phase 0 supports instant-showdown games (no player turns); the
turn/action machinery for Rummy & betting games layers on in later phases.

All coin movements are idempotent via wallet_service request_ids.
"""
import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from ..db import db
from ..models import TxnType
from .. import wallet_service, revenue_service
from . import rng
from .catalog import GAMES


class DomainError(Exception):
    """Friendly, user-facing rule violation → mapped to HTTP 400 by the router."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.casino_tables.create_index("id", unique=True)
    await db.casino_rounds.create_index("id", unique=True)
    await db.casino_rounds.create_index([("table_id", 1), ("round_no", -1)])
    await db.casino_rake_ledger.create_index("round_id", unique=True)


def _game(game_type: str) -> dict:
    g = GAMES.get(game_type)
    if not g:
        raise DomainError("Unknown game")
    return g


async def _get(table_id: str) -> dict:
    t = await db.casino_tables.find_one({"id": table_id}, {"_id": 0})
    if not t:
        raise DomainError("Table not found")
    return t


def list_catalog() -> list[dict]:
    return [{"game_type": k, "label": g["label"], "category": g["category"],
             "min_players": g["min_players"], "max_players": g["max_players"],
             "playable": not g["has_turns"], "default_config": g["default_config"]}
            for k, g in GAMES.items()]


def _table_public(t: dict) -> dict:
    g = GAMES[t["game_type"]]
    return {
        "id": t["id"], "game_type": t["game_type"], "label": g["label"],
        "name": t["name"], "config": t["config"], "status": t["status"],
        "seats": [{"user_id": s["user_id"], "display_name": s["display_name"]} for s in t["seats"]],
        "seat_count": len(t["seats"]),
        "min_players": g["min_players"], "max_players": g["max_players"],
        "round_no": t["round_no"], "current_round_id": t.get("current_round_id"),
    }


async def create_table(game_type: str, creator_id: str, name: str | None = None,
                       config: dict | None = None) -> dict:
    g = _game(game_type)
    cfg = {**g["default_config"], **(config or {})}
    doc = {
        "id": str(uuid.uuid4()), "game_type": game_type,
        "name": (name or f"{g['label']} Table").strip()[:60], "config": cfg,
        "status": "WAITING", "seats": [], "round_no": 0, "current_round_id": None,
        "created_by": creator_id, "created_at": _now(),
    }
    await db.casino_tables.insert_one(doc)
    return _table_public(doc)


async def list_tables(game_type: str | None = None) -> list[dict]:
    q: dict = {"status": {"$in": ["WAITING", "RUNNING"]}}
    if game_type:
        q["game_type"] = game_type
    rows = await db.casino_tables.find(q, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [_table_public(r) for r in rows]


async def join_table(table_id: str, user: dict) -> dict:
    t = await _get(table_id)
    g = GAMES[t["game_type"]]
    if any(s["user_id"] == user["id"] for s in t["seats"]):
        return _table_public(t)
    if t["status"] == "RUNNING":
        raise DomainError("A round is in progress — try again in a moment")
    if len(t["seats"]) >= g["max_players"]:
        raise DomainError("This table is full")
    seat = {"user_id": user["id"], "display_name": user.get("display_name", "Player"),
            "joined_at": _now()}
    await db.casino_tables.update_one({"id": table_id}, {"$push": {"seats": seat}})
    t["seats"].append(seat)
    return _table_public(t)


async def leave_table(table_id: str, user_id: str) -> dict:
    t = await _get(table_id)
    if t["status"] == "RUNNING":
        raise DomainError("You can't leave in the middle of a round")
    await db.casino_tables.update_one({"id": table_id}, {"$pull": {"seats": {"user_id": user_id}}})
    return {"ok": True}


async def _record_rake(round_id: str, table: dict, winner_id: str, pot: int, rake: int) -> None:
    """Attribute the rake to the winner's owning Admin and record the
    Admin/Super-Admin split — same pattern as deposit revenue."""
    admin = await db.player_assignments.find_one({"player_id": winner_id}, {"_id": 0, "admin_id": 1})
    admin_id = (admin or {}).get("admin_id")
    pct = await revenue_service._admin_split_pct(admin_id) if admin_id else 0
    sa_share = int(round(rake * pct / 100))
    doc = {
        "round_id": round_id, "table_id": table["id"], "game_type": table["game_type"],
        "winner_user_id": winner_id, "admin_id": admin_id, "pot": pot, "rake": rake,
        "split_pct_super_admin": pct, "super_admin_share": sa_share,
        "admin_share": rake - sa_share, "created_at": _now(),
    }
    try:
        await db.casino_rake_ledger.insert_one(doc)
    except DuplicateKeyError:
        pass  # idempotent


async def start_round(table_id: str, actor_id: str) -> dict:
    t = await _get(table_id)
    g = GAMES[t["game_type"]]
    if t["status"] == "RUNNING":
        raise DomainError("A round is already running")
    if g["has_turns"]:
        raise DomainError("This game isn't available yet")  # Rummy/betting = later phases
    if len(t["seats"]) < g["min_players"]:
        raise DomainError(f"Need at least {g['min_players']} players to start")

    round_no = t["round_no"] + 1
    round_id = str(uuid.uuid4())
    server_seed, nonce = rng.new_seed(), rng.new_nonce()
    deck = rng.shuffled_deck(server_seed, nonce)  # LOCKED before any deal
    commit = rng.commit_hash(server_seed, deck)
    stake = int(t["config"]["stake"])

    # Collect only the players who can actually fund the entry (idempotent debit).
    funded: list[tuple[int, dict]] = []
    for idx, s in enumerate(t["seats"]):
        try:
            await wallet_service.debit(
                s["user_id"], TxnType.GAME_ENTRY, stake, reason=f"{g['label']} entry",
                request_id=f"casino_entry:{round_id}:{s['user_id']}")
            funded.append((idx, s))
        except wallet_service.InsufficientFunds:
            continue
    if len(funded) < g["min_players"]:
        for idx, s in funded:  # refund and abort
            await wallet_service.credit(
                s["user_id"], TxnType.GAME_REWARD, stake, reason="Round cancelled — refund",
                request_id=f"casino_refund:{round_id}:{s['user_id']}")
        raise DomainError("Not enough players had coins to start the round")

    # Deal from the committed deck, then settle (instant showdown for Phase 0).
    hands: dict[int, list[str]] = {}
    pos = 0
    for idx, _s in funded:
        hands[idx] = deck[pos:pos + g["cards_per_player"]]
        pos += g["cards_per_player"]

    ranked = g["settle"](hands)  # seat indices, best first
    winner_idx = ranked[0]
    winner = t["seats"][winner_idx]
    pot = stake * len(funded)
    rake = min(int(round(pot * t["config"]["rake_pct"] / 100)), int(t["config"]["rake_cap"]))
    payout = pot - rake
    await wallet_service.credit(
        winner["user_id"], TxnType.GAME_REWARD, payout, reason=f"{g['label']} winnings",
        request_id=f"casino_payout:{round_id}:{winner['user_id']}")
    await _record_rake(round_id, t, winner["user_id"], pot, rake)

    round_doc = {
        "id": round_id, "table_id": table_id, "game_type": t["game_type"], "round_no": round_no,
        "phase": "SETTLED",
        "rng": {"commit_hash": commit, "nonce": nonce, "server_seed": server_seed,
                "deck_order": deck, "revealed": True},
        "seats": [{"seat": idx, "user_id": s["user_id"], "display_name": s["display_name"],
                   "cards": hands[idx]} for idx, s in funded],
        "pot": pot, "rake": rake, "payout": payout,
        "winner_user_id": winner["user_id"], "winner_display_name": winner["display_name"],
        "ranking": [t["seats"][i]["user_id"] for i in ranked], "created_at": _now(),
    }
    await db.casino_rounds.insert_one(round_doc)
    await db.casino_tables.update_one(
        {"id": table_id},
        {"$set": {"round_no": round_no, "current_round_id": round_id, "status": "WAITING"}})
    return await get_state(table_id, actor_id)


def _round_view(r: dict, user_id: str) -> dict:
    settled = r["phase"] == "SETTLED"
    seats = []
    for s in r["seats"]:
        show = settled or s["user_id"] == user_id
        seats.append({"seat": s["seat"], "user_id": s["user_id"],
                      "display_name": s["display_name"],
                      "cards": s["cards"] if show else [None] * len(s["cards"])})
    view = {"id": r["id"], "phase": r["phase"], "round_no": r["round_no"], "pot": r["pot"],
            "seats": seats, "commit_hash": r["rng"]["commit_hash"]}
    if settled:
        view.update({
            "rake": r["rake"], "payout": r["payout"],
            "winner_user_id": r["winner_user_id"], "winner_display_name": r["winner_display_name"],
            "ranking": r["ranking"],
            "reveal": {"server_seed": r["rng"]["server_seed"], "nonce": r["rng"]["nonce"]},
        })
    return view


async def get_state(table_id: str, user_id: str) -> dict:
    t = await _get(table_id)
    state = _table_public(t)
    rid = t.get("current_round_id")
    state["round"] = None
    if rid:
        r = await db.casino_rounds.find_one({"id": rid}, {"_id": 0})
        if r:
            state["round"] = _round_view(r, user_id)
    return state


async def verify_round(round_id: str) -> dict:
    r = await db.casino_rounds.find_one({"id": round_id}, {"_id": 0})
    if not r:
        raise DomainError("Round not found")
    rr = r["rng"]
    ok, deck = rng.verify(rr["server_seed"], rr["nonce"], rr["commit_hash"])
    return {
        "round_id": round_id, "commit_hash": rr["commit_hash"], "server_seed": rr["server_seed"],
        "nonce": rr["nonce"], "deck_order": rr["deck_order"],
        "recomputed_matches": bool(ok and deck == rr["deck_order"]),
        "explanation": "SHA256(server_seed + '|' + deck) must equal commit_hash, and the deck "
                       "must reproduce from an HMAC-Fisher–Yates shuffle of server_seed:nonce.",
    }
