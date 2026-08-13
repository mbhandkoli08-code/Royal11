"""ROYAL11 Points Rummy — turn/round engine (Phase 1).

Server-authoritative 13-card Points Rummy over the existing coin wallet, on the
SAME provably-fair shoe (commit–reveal + /verify). Layers a draw/discard/declare/
drop turn machine on top of the Phase 0 table lobby (create/join/leave reuse
`engine`). Money model: each seat escrows the max loss (80 pts × point value) at
deal; at settle every loser pays points × point value to the winner, the rest of
their escrow is refunded, and the house rake flows into the existing revenue
split. Practice mode uses chips, skips rake/revenue/XP.

Disconnect ≠ drop: a missed poll never drops a player — only turn-timer expiry
auto-plays, and only after N consecutive timeouts do we auto-drop them.
"""
import uuid
from datetime import datetime, timezone, timedelta

from ..db import db
from ..models import TxnType
from .. import wallet_service, revenue_service
from . import rng, rummy, practice_service, progression_service
from .cards import fresh_deck
from .engine import DomainError, _get, _table_public

HAND_SIZE = 13
DECKS = 2
PRINTED_JOKERS = 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _base_shoe() -> list[str]:
    shoe: list[str] = []
    for _ in range(DECKS):
        shoe += fresh_deck()
    shoe += ["JK"] * PRINTED_JOKERS
    return shoe


def _mk_card(idx: int, code: str) -> dict:
    if code == "JK":
        return {"id": f"c{idx}", "code": "JK", "rank": None, "suit": None, "printed_joker": True}
    return {"id": f"c{idx}", "code": code, "rank": code[0], "suit": code[1], "printed_joker": False}


# ---------------------------------------------------------------------------
# Persistence helpers (optimistic concurrency via a `rev` counter).
# ---------------------------------------------------------------------------
async def _load(round_id: str) -> dict | None:
    return await db.casino_rounds.find_one({"id": round_id}, {"_id": 0})


async def _save(doc: dict) -> bool:
    rev = doc["rev"]
    doc["rev"] = rev + 1
    res = await db.casino_rounds.replace_one({"id": doc["id"], "rev": rev}, doc)
    return res.modified_count == 1


async def _active_round(table: dict) -> dict | None:
    rid = table.get("current_round_id")
    if not rid:
        return None
    r = await _load(rid)
    if r and r.get("game_type", "").startswith("rummy"):
        return r
    return None


# ---------------------------------------------------------------------------
# Start a deal.
# ---------------------------------------------------------------------------
async def start_round(table_id: str, actor_id: str) -> dict:
    t = await _get(table_id)
    if not t["game_type"].startswith("rummy"):
        raise DomainError("Not a Rummy table")
    existing = await _active_round(t)
    if existing and existing["phase"] != "SETTLED":
        raise DomainError("A deal is already in progress")
    seats = t["seats"]
    if len(seats) < 2:
        raise DomainError("Need at least 2 players to deal")

    cfg = t["config"]
    point_value = int(cfg.get("point_value", 1))
    reserve = rummy.MAX_POINTS * point_value
    practice = t.get("is_practice", False)

    round_id = str(uuid.uuid4())
    # Escrow the maximum possible loss from each seat (idempotent).
    funded: list[dict] = []
    for s in seats:
        try:
            if practice:
                await practice_service.debit(s["user_id"], reserve)
            else:
                await wallet_service.debit(
                    s["user_id"], TxnType.GAME_ENTRY, reserve, reason="Rummy table stake",
                    request_id=f"rummy_reserve:{round_id}:{s['user_id']}")
            funded.append(s)
        except (wallet_service.InsufficientFunds, practice_service.InsufficientChips):
            continue
    if len(funded) < 2:
        for s in funded:  # refund + abort
            if practice:
                await practice_service.credit(s["user_id"], reserve)
            else:
                await wallet_service.credit(
                    s["user_id"], TxnType.GAME_REWARD, reserve, reason="Rummy deal cancelled",
                    request_id=f"rummy_reserve_refund:{round_id}:{s['user_id']}")
        raise DomainError("Not enough players had funds to deal")

    n = len(funded)
    server_seed, nonce = rng.new_seed(), rng.new_nonce()
    base = _base_shoe()
    shoe = rng.shuffled_list(base, server_seed, nonce)  # LOCKED before any deal
    commit = rng.commit_hash(server_seed, shoe)
    cards = {f"c{i}": _mk_card(i, code) for i, code in enumerate(shoe)}

    hands: dict[str, list[str]] = {}
    for k, s in enumerate(funded):
        hands[s["user_id"]] = [f"c{i}" for i in range(k * HAND_SIZE, (k + 1) * HAND_SIZE)]

    wild_id = f"c{len(shoe) - 1}"  # last card = wild indicator (set aside)
    wild_card = cards[wild_id]
    wild_rank = "A" if wild_card["printed_joker"] else wild_card["rank"]

    rest = [f"c{i}" for i in range(n * HAND_SIZE, len(shoe) - 1)]
    open_pile = [rest[0]]
    closed_pile = rest[1:]

    turn_order = [s["user_id"] for s in funded]
    players = [{
        "user_id": s["user_id"], "display_name": s.get("display_name", "Player"), "seat": k,
        "status": "active", "has_ever_drawn": False, "timeouts": 0,
        "drop_points": None, "points": None, "delta": None,
        "last_seen": _iso(_now()),
    } for k, s in enumerate(funded)]

    round_doc = {
        "id": round_id, "table_id": table_id, "game_type": t["game_type"],
        "round_no": t["round_no"] + 1, "phase": "PLAYING", "is_practice": practice, "rev": 0,
        "config": {"point_value": point_value, "rake_pct": int(cfg.get("rake_pct", 70)),
                   "rake_cap": int(cfg.get("rake_cap", 10_000_000)),
                   "turn_seconds": int(cfg.get("turn_seconds", 30)),
                   "max_timeouts": int(cfg.get("max_timeouts", 3)), "reserve": reserve},
        "rng": {"commit_hash": commit, "nonce": nonce, "server_seed": server_seed,
                "revealed": False},
        "wild": {"card_id": wild_id, "code": wild_card["code"], "rank": wild_rank},
        "cards": cards, "hands": hands, "open_pile": open_pile, "closed_pile": closed_pile,
        "players": players, "turn_order": turn_order,
        "turn": {"user_id": turn_order[0], "draw_done": False, "seq": 1,
                 "deadline": _iso(_now() + timedelta(seconds=int(cfg.get("turn_seconds", 30))))},
        "result": None, "created_at": _iso(_now()),
    }
    await db.casino_rounds.insert_one(round_doc)
    await db.casino_tables.update_one(
        {"id": table_id},
        {"$set": {"round_no": round_doc["round_no"], "current_round_id": round_id, "status": "RUNNING"}})
    return await get_state(table_id, actor_id)


# ---------------------------------------------------------------------------
# Turn helpers.
# ---------------------------------------------------------------------------
def _player(r: dict, uid: str) -> dict | None:
    return next((p for p in r["players"] if p["user_id"] == uid), None)


def _actives(r: dict) -> list[dict]:
    return [p for p in r["players"] if p["status"] == "active"]


def _resolve(r: dict, ids: list[str]) -> list[dict]:
    return [r["cards"][i] for i in ids]


def _recycle_if_needed(r: dict) -> None:
    if not r["closed_pile"] and len(r["open_pile"]) > 1:
        top = r["open_pile"][-1]
        rest = r["open_pile"][:-1]
        r["closed_pile"] = rest  # order irrelevant; draw from front
        r["open_pile"] = [top]


def _advance(r: dict) -> None:
    """Move the turn to the next active player (cyclic)."""
    order = r["turn_order"]
    cur = r["turn"]["user_id"]
    i = order.index(cur)
    for step in range(1, len(order) + 1):
        cand = order[(i + step) % len(order)]
        if (_player(r, cand) or {}).get("status") == "active":
            r["turn"] = {"user_id": cand, "draw_done": False, "seq": r["turn"]["seq"] + 1,
                         "deadline": _iso(_now() + timedelta(seconds=r["config"]["turn_seconds"]))}
            return
    # no other active player — turn stays (settle will be triggered by caller)


def _drop_player(r: dict, uid: str, first: bool) -> None:
    p = _player(r, uid)
    p["status"] = "dropped"
    p["drop_points"] = 20 if first else 40


def _highest_card_id(r: dict, uid: str) -> str:
    wild = r["wild"]["rank"]
    hand = r["hands"][uid]
    return max(hand, key=lambda cid: rummy.card_points(r["cards"][cid], wild))


async def _maybe_autoplay(r: dict) -> dict:
    """Apply turn-timer expiry: auto-play once, or auto-drop after N timeouts.
    Guarded by the optimistic `rev` — if another request already advanced, we
    just return the freshly-loaded doc."""
    if r["phase"] == "SETTLED":
        return r
    deadline = datetime.fromisoformat(r["turn"]["deadline"])
    if _now() <= deadline:
        return r

    uid = r["turn"]["user_id"]
    p = _player(r, uid)
    p["timeouts"] = p.get("timeouts", 0) + 1
    if p["timeouts"] >= r["config"]["max_timeouts"]:
        _drop_player(r, uid, first=not p["has_ever_drawn"])
        if len(_actives(r)) <= 1:
            return await _settle(r, winner_id=_actives(r)[0]["user_id"] if _actives(r) else None,
                                 reason="Last player standing")
        _advance(r)
    else:
        # auto-play a full turn so the game keeps moving
        if not r["turn"]["draw_done"]:
            _recycle_if_needed(r)
            if r["closed_pile"]:
                drawn = r["closed_pile"].pop(0)
                r["hands"][uid].append(drawn)
                p["has_ever_drawn"] = True
        discard_id = _highest_card_id(r, uid)
        r["hands"][uid].remove(discard_id)
        r["open_pile"].append(discard_id)
        _advance(r)

    saved = await _save(r)
    if not saved:
        return await _load(r["id"])
    return r


# ---------------------------------------------------------------------------
# Player actions.
# ---------------------------------------------------------------------------
async def _require_turn(table_id: str, uid: str) -> dict:
    t = await _get(table_id)
    r = await _active_round(t)
    if not r or r["phase"] == "SETTLED":
        raise DomainError("No active deal")
    r = await _maybe_autoplay(r)
    if r["phase"] == "SETTLED":
        raise DomainError("The deal has ended")
    if r["turn"]["user_id"] != uid:
        raise DomainError("It's not your turn")
    return r


async def draw(table_id: str, uid: str, source: str) -> dict:
    r = await _require_turn(table_id, uid)
    if r["turn"]["draw_done"]:
        raise DomainError("You've already drawn — discard or declare")
    if source == "open":
        if not r["open_pile"]:
            raise DomainError("The discard pile is empty")
        card = r["open_pile"].pop()
    else:
        _recycle_if_needed(r)
        if not r["closed_pile"]:
            raise DomainError("The deck is empty")
        card = r["closed_pile"].pop(0)
    r["hands"][uid].append(card)
    p = _player(r, uid)
    p["has_ever_drawn"] = True
    p["timeouts"] = 0
    p["last_seen"] = _iso(_now())
    r["turn"]["draw_done"] = True
    if not await _save(r):
        raise DomainError("Table changed — please retry")
    return await get_state(table_id, uid)


async def discard(table_id: str, uid: str, card_id: str) -> dict:
    r = await _require_turn(table_id, uid)
    if not r["turn"]["draw_done"]:
        raise DomainError("Draw a card before discarding")
    if card_id not in r["hands"][uid]:
        raise DomainError("That card isn't in your hand")
    r["hands"][uid].remove(card_id)
    r["open_pile"].append(card_id)
    _player(r, uid)["timeouts"] = 0
    _advance(r)
    if not await _save(r):
        raise DomainError("Table changed — please retry")
    return await get_state(table_id, uid)


async def drop(table_id: str, uid: str) -> dict:
    r = await _require_turn(table_id, uid)
    if r["turn"]["draw_done"]:
        raise DomainError("You can't drop after drawing this turn")
    p = _player(r, uid)
    _drop_player(r, uid, first=not p["has_ever_drawn"])
    if len(_actives(r)) <= 1:
        await _settle(r, winner_id=_actives(r)[0]["user_id"] if _actives(r) else None,
                      reason="Opponent dropped")
        return await get_state(table_id, uid)
    _advance(r)
    if not await _save(r):
        raise DomainError("Table changed — please retry")
    return await get_state(table_id, uid)


async def declare(table_id: str, uid: str, groups: list[list[str]]) -> dict:
    r = await _require_turn(table_id, uid)
    if not r["turn"]["draw_done"]:
        raise DomainError("Draw a card before declaring")
    hand = set(r["hands"][uid])
    flat = [cid for g in groups for cid in g]
    if len(flat) != len(set(flat)):
        raise DomainError("A card can't be in two groups")
    if not set(flat).issubset(hand):
        raise DomainError("Groups contain cards not in your hand")
    if len(flat) != HAND_SIZE:
        raise DomainError(f"Group exactly {HAND_SIZE} cards (leave 1 as the finishing discard)")

    wild = r["wild"]["rank"]
    grouped = [[r["cards"][cid] for cid in g] for g in groups]
    check = rummy.validate_declaration(grouped, wild, expected_cards=HAND_SIZE)
    p = _player(r, uid)
    p["timeouts"] = 0

    # The 14th card (not grouped) becomes the finishing discard.
    finish = next((cid for cid in r["hands"][uid] if cid not in set(flat)), None)
    if finish:
        r["hands"][uid].remove(finish)
        r["open_pile"].append(finish)

    if check["valid"]:
        p["declaration"] = check["breakdown"]
        await _settle(r, winner_id=uid, reason="Valid declaration")
        return await get_state(table_id, uid)

    # Wrong declaration → 80-point penalty, player is out.
    p["status"] = "eliminated"
    p["points"] = rummy.MAX_POINTS
    p["declaration_error"] = check["reason"]
    p["declaration"] = check["breakdown"]
    if len(_actives(r)) <= 1:
        await _settle(r, winner_id=_actives(r)[0]["user_id"] if _actives(r) else None,
                      reason="Only player remaining")
        return await get_state(table_id, uid)
    _advance(r)
    if not await _save(r):
        raise DomainError("Table changed — please retry")
    raise DomainError(check["reason"])  # surfaced to the declarer as a toast


# ---------------------------------------------------------------------------
# Settlement.
# ---------------------------------------------------------------------------
async def _settle(r: dict, winner_id: str | None, reason: str) -> dict:
    cfg = r["config"]
    pv = cfg["point_value"]
    reserve = cfg["reserve"]
    practice = r["is_practice"]
    wild = r["wild"]["rank"]

    # Score every non-winner.
    for p in r["players"]:
        if p["user_id"] == winner_id:
            p["points"] = 0
            continue
        if p["status"] == "dropped":
            p["points"] = p["drop_points"]
        elif p["status"] == "eliminated":
            p["points"] = rummy.MAX_POINTS
        else:  # still active but didn't win
            p["points"] = rummy.best_deadwood(_resolve(r, r["hands"][p["user_id"]]), wild)

    collected = 0
    for p in r["players"]:
        loss = min(p["points"], rummy.MAX_POINTS) * pv if p["user_id"] != winner_id else 0
        p["loss_coins"] = loss
        collected += loss

    rake = 0 if practice else min(collected * cfg["rake_pct"] // 100, cfg["rake_cap"])
    winnings = collected - rake

    # Money movements (idempotent). Everyone gets escrow − loss back; winner also
    # receives the winnings.
    for p in r["players"]:
        uid = p["user_id"]
        refund = reserve - p["loss_coins"]
        credit = refund + (winnings if uid == winner_id else 0)
        p["delta"] = credit - reserve  # net change vs. the escrow they posted
        if credit <= 0:
            continue
        if practice:
            await practice_service.credit(uid, credit)
        else:
            await wallet_service.credit(
                uid, TxnType.GAME_REWARD, credit, reason="Rummy settlement",
                request_id=f"rummy_settle:{r['id']}:{uid}")

    if not practice:
        if rake > 0 and winner_id:
            await _record_rake(r, winner_id, collected, rake)
        for p in r["players"]:  # loyalty XP on the amount each player risked
            await progression_service.add_wager_xp(
                p["user_id"], reserve, source="rummy",
                request_id=f"xp:rummy:{r['id']}:{p['user_id']}")

    r["phase"] = "SETTLED"
    r["rng"]["revealed"] = True
    winner = _player(r, winner_id) if winner_id else None
    r["result"] = {
        "winner_user_id": winner_id,
        "winner_display_name": winner["display_name"] if winner else None,
        "reason": reason, "pot": collected, "rake": rake, "payout": winnings,
        "point_value": pv,
        "players": [{
            "user_id": p["user_id"], "display_name": p["display_name"],
            "status": p["status"] if p["user_id"] != winner_id else "won",
            "points": p["points"], "delta": p["delta"],
            "declaration": p.get("declaration"), "error": p.get("declaration_error"),
        } for p in r["players"]],
    }
    await _save(r)
    await db.casino_tables.update_one({"id": r["table_id"]}, {"$set": {"status": "WAITING"}})
    return r


async def _record_rake(r: dict, winner_id: str, pot: int, rake: int) -> None:
    admin = await db.player_assignments.find_one({"player_id": winner_id}, {"_id": 0, "admin_id": 1})
    admin_id = (admin or {}).get("admin_id")
    pct = await revenue_service._admin_split_pct(admin_id) if admin_id else 0
    sa_share = int(round(rake * pct / 100))
    doc = {
        "round_id": r["id"], "table_id": r["table_id"], "game_type": r["game_type"],
        "winner_user_id": winner_id, "admin_id": admin_id, "pot": pot, "rake": rake,
        "split_pct_super_admin": pct, "super_admin_share": sa_share,
        "admin_share": rake - sa_share, "created_at": _iso(_now()),
    }
    try:
        await db.casino_rake_ledger.insert_one(doc)
    except Exception:
        pass  # idempotent (unique round_id)


# ---------------------------------------------------------------------------
# State view (per-viewer; hides opponents' cards).
# ---------------------------------------------------------------------------
def _pub_card(c: dict) -> dict:
    return {"id": c["id"], "code": c["code"], "rank": c["rank"], "suit": c["suit"],
            "joker": c["printed_joker"]}


async def get_state(table_id: str, user_id: str) -> dict:
    t = await _get(table_id)
    base = _table_public(t)
    r = await _active_round(t)
    if r and r["phase"] != "SETTLED":
        r = await _maybe_autoplay(r)

    if not r:
        base["round"] = None
        return base

    settled = r["phase"] == "SETTLED"
    wild = r["wild"]
    your_hand = [_pub_card(r["cards"][cid]) for cid in r["hands"].get(user_id, [])]
    open_top = r["open_pile"][-1] if r["open_pile"] else None

    players_view = []
    for p in r["players"]:
        players_view.append({
            "user_id": p["user_id"], "display_name": p["display_name"], "seat": p["seat"],
            "status": p["status"], "card_count": len(r["hands"].get(p["user_id"], [])),
            "is_you": p["user_id"] == user_id,
            "points": p.get("points") if settled else None,
        })

    round_view = {
        "id": r["id"], "phase": r["phase"], "round_no": r["round_no"],
        "is_practice": r["is_practice"], "commit_hash": r["rng"]["commit_hash"],
        "config": {"point_value": r["config"]["point_value"], "rake_pct": r["config"]["rake_pct"],
                   "turn_seconds": r["config"]["turn_seconds"]},
        "wild": {"code": wild["code"], "rank": wild["rank"]},
        "your_hand": your_hand,
        "open_top": _pub_card(r["cards"][open_top]) if open_top else None,
        "closed_count": len(r["closed_pile"]),
        "players": players_view,
        "turn": {"user_id": r["turn"]["user_id"], "draw_done": r["turn"]["draw_done"],
                 "deadline": r["turn"]["deadline"],
                 "is_you": r["turn"]["user_id"] == user_id},
    }
    if settled:
        round_view["result"] = r["result"]
        round_view["reveal"] = {"server_seed": r["rng"]["server_seed"], "nonce": r["rng"]["nonce"]}
    base["round"] = round_view
    return base


async def heartbeat(table_id: str, user_id: str) -> dict:
    t = await _get(table_id)
    r = await _active_round(t)
    if r and r["phase"] != "SETTLED":
        await db.casino_rounds.update_one(
            {"id": r["id"], "players.user_id": user_id},
            {"$set": {"players.$.last_seen": _iso(_now())}})
    return await get_state(table_id, user_id)


async def verify_round(round_id: str) -> dict:
    r = await _load(round_id)
    if not r or not r.get("game_type", "").startswith("rummy"):
        raise DomainError("Round not found")
    rr = r["rng"]
    base = _base_shoe()
    ok, shoe = rng.verify_list(rr["server_seed"], rr["nonce"], base, rr["commit_hash"])
    return {
        "round_id": round_id, "commit_hash": rr["commit_hash"], "server_seed": rr["server_seed"],
        "nonce": rr["nonce"], "shoe_order": shoe, "recomputed_matches": bool(ok),
        "explanation": "SHA256(server_seed + '|' + shoe) must equal commit_hash, and the shoe "
                       "must reproduce from an HMAC-Fisher–Yates shuffle of a 2-deck+jokers base.",
    }


# ---------------------------------------------------------------------------
# Quick match — join the first open table matching mode+stake, else create one.
# ---------------------------------------------------------------------------
async def quick_match(user: dict, point_value: int, is_practice: bool) -> dict:
    from . import engine
    rows = await db.casino_tables.find(
        {"game_type": "rummy_points", "status": "WAITING", "is_practice": is_practice},
        {"_id": 0}).sort("created_at", -1).to_list(100)
    from .catalog import GAMES
    cap = GAMES["rummy_points"]["max_players"]
    for row in rows:
        if row["config"].get("point_value") == point_value and len(row["seats"]) < cap:
            await engine.join_table(row["id"], user)
            return await get_state(row["id"], user["id"])
    created = await engine.create_table("rummy_points", user["id"], name=None,
                                        config={"point_value": point_value}, is_practice=is_practice)
    await engine.join_table(created["id"], user)
    return await get_state(created["id"], user["id"])
