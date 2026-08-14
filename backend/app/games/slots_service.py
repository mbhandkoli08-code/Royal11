"""777 Slots service — seed-pair provably-fair spins over the real coin wallet.

Flow (single player vs house):
- Each player has ONE active seed row (`player_game_seeds`): a secret
  `server_seed`, its published `server_seed_hash` (commitment), a player-chosen
  `client_seed`, and an incrementing `nonce`. The hash is shown BEFORE any spin.
- A spin derives its reel stops from HMAC(server_seed, client_seed:nonce) with
  the nonce that will be recorded, then increments the nonce. On rotation the old
  server_seed is revealed so every past spin can be recomputed and verified.
- Coin movement: idempotent debit of the stake (real-first via bonus_service,
  then payout credit). House margin (stake − payout) per spin is recorded into
  `casino_rake_ledger` (game_type="slots_777") and nets positive over time via
  the existing Admin/Super-Admin revenue split + weekly commission report.
- Practice mode uses the free practice-chip wallet (no rake / no XP / no payout
  to the ledger) but the SAME provably-fair RNG so it feels identical.
"""
import secrets
import uuid
from datetime import datetime, timezone

from pymongo.errors import DuplicateKeyError

from ..db import db
from ..models import TxnType
from .. import wallet_service, revenue_service, bonus_service
from . import rng, slots, practice_service, progression_service


class DomainError(Exception):
    """Friendly, user-facing rule violation → HTTP 400."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.player_game_seeds.create_index([("user_id", 1), ("game", 1)], unique=True)
    await db.casino_spins.create_index("id", unique=True)
    await db.casino_spins.create_index([("user_id", 1), ("created_at", -1)])


async def get_config() -> dict:
    doc = await db.slots_config.find_one({"_id": "slots_777"}, {"_id": 0})
    cfg = {**slots.DEFAULT_CONFIG, **(doc or {})}
    cfg["rtp"] = round(slots.rtp(cfg["symbols"], cfg["strip_len"]), 4)
    return cfg


async def set_config(patch: dict) -> dict:
    allowed = {k: patch[k] for k in
               ("symbols", "min_stake", "max_stake", "max_payout_cap", "rake_pct")
               if k in patch}
    await db.slots_config.update_one({"_id": "slots_777"}, {"$set": allowed}, upsert=True)
    return await get_config()


# ---------------- seed management (seed-pair commit–reveal) ----------------
async def _active_seed(user_id: str) -> dict:
    row = await db.player_game_seeds.find_one({"user_id": user_id, "game": "slots_777"}, {"_id": 0})
    if row:
        return row
    server_seed = rng.new_seed()
    row = {
        "user_id": user_id, "game": "slots_777",
        "server_seed": server_seed, "server_seed_hash": rng.seed_commit(server_seed),
        "client_seed": secrets.token_hex(8), "nonce": 0,
        "created_at": _now(),
    }
    try:
        await db.player_game_seeds.insert_one(dict(row))
    except DuplicateKeyError:
        return await db.player_game_seeds.find_one({"user_id": user_id, "game": "slots_777"}, {"_id": 0})
    return row


def _seed_public(row: dict) -> dict:
    return {
        "server_seed_hash": row["server_seed_hash"],
        "client_seed": row["client_seed"],
        "nonce": row["nonce"],
    }


async def get_seed(user_id: str) -> dict:
    return _seed_public(await _active_seed(user_id))


async def set_client_seed(user_id: str, client_seed: str) -> dict:
    client_seed = (client_seed or "").strip()[:64] or secrets.token_hex(8)
    await _active_seed(user_id)
    await db.player_game_seeds.update_one(
        {"user_id": user_id, "game": "slots_777"},
        {"$set": {"client_seed": client_seed, "nonce": 0}})
    return await get_seed(user_id)


async def rotate_seed(user_id: str) -> dict:
    """Reveal the current server_seed and issue a fresh one (so past spins stay
    verifiable). The revealed seed is stored by its hash so `verify` can
    recompute every spin made under it."""
    old = await _active_seed(user_id)
    await db.revealed_game_seeds.update_one(
        {"server_seed_hash": old["server_seed_hash"]},
        {"$set": {"server_seed": old["server_seed"], "server_seed_hash": old["server_seed_hash"],
                  "client_seed": old["client_seed"], "revealed_at": _now()}},
        upsert=True)
    new_seed = rng.new_seed()
    await db.player_game_seeds.update_one(
        {"user_id": user_id, "game": "slots_777"},
        {"$set": {"server_seed": new_seed, "server_seed_hash": rng.seed_commit(new_seed),
                  "nonce": 0, "created_at": _now()}})
    return {
        "revealed_server_seed": old["server_seed"],
        "revealed_server_seed_hash": old["server_seed_hash"],
        "revealed_client_seed": old["client_seed"],
        **(await get_seed(user_id)),
    }


async def _record_house_margin(spin_id: str, user_id: str, stake: int, payout: int) -> None:
    """House P&L (stake − payout) per spin into the shared casino rake ledger so
    it flows into the Admin/Super-Admin split + weekly commission report."""
    margin = stake - payout
    admin = await db.player_assignments.find_one({"player_id": user_id}, {"_id": 0, "admin_id": 1})
    admin_id = (admin or {}).get("admin_id")
    pct = await revenue_service._admin_split_pct(admin_id) if admin_id else 0
    sa_share = int(round(margin * pct / 100))
    doc = {
        "round_id": spin_id, "table_id": None, "game_type": "slots_777", "bet_type": "spin",
        "winner_user_id": user_id, "admin_id": admin_id, "pot": stake,
        "rake": margin, "split_pct_super_admin": pct, "super_admin_share": sa_share,
        "admin_share": margin - sa_share, "created_at": _now(),
    }
    try:
        await db.casino_rake_ledger.insert_one(doc)
    except DuplicateKeyError:
        pass


async def spin(user_id: str, display_name: str, stake: int, is_practice: bool) -> dict:
    cfg = await get_config()
    stake = int(stake)
    if stake < cfg["min_stake"] or stake > cfg["max_stake"]:
        raise DomainError(f"Stake must be between {cfg['min_stake']} and {cfg['max_stake']} coins")

    strip = slots.build_strip(cfg["symbols"], cfg["strip_len"])
    seed = await _active_seed(user_id)
    nonce = seed["nonce"]
    spin_id = str(uuid.uuid4())

    # 1) Debit the stake (idempotent). Real-first via bonus rail, else practice.
    if is_practice:
        await practice_service.debit(user_id, stake)
    else:
        try:
            await bonus_service.debit_playable(
                user_id, TxnType.GAME_ENTRY, stake, reason="777 Slots spin",
                request_id=f"slots_stake:{spin_id}")
        except wallet_service.InsufficientFunds:
            raise DomainError("Not enough coins for this spin")

    # 2) Compute the locked outcome from the committed seed-pair + nonce.
    stops = rng.spin_indices(seed["server_seed"], seed["client_seed"], nonce, cfg["reels"], cfg["strip_len"])
    outcome = slots.evaluate(stops, strip, cfg["symbols"], stake, cfg["max_payout_cap"])

    # 3) Advance the nonce so the next spin is a fresh point in the stream.
    await db.player_game_seeds.update_one(
        {"user_id": user_id, "game": "slots_777"}, {"$inc": {"nonce": 1}})

    # 4) Credit the payout + record house P&L / XP / bonus playthrough.
    if outcome["payout"] > 0:
        if is_practice:
            await practice_service.credit(user_id, outcome["payout"])
        else:
            await wallet_service.credit(
                user_id, TxnType.GAME_REWARD, outcome["payout"], reason="777 Slots win",
                request_id=f"slots_payout:{spin_id}")
    if not is_practice:
        await _record_house_margin(spin_id, user_id, stake, outcome["payout"])
        await progression_service.add_wager_xp(user_id, stake, source="slots", request_id=f"xp:slots:{spin_id}")
        await bonus_service.record_wager(user_id, stake)

    doc = {
        "id": spin_id, "user_id": user_id, "display_name": display_name,
        "is_practice": is_practice, "stake": stake,
        "stops": outcome["stops"], "symbols": outcome["symbols"],
        "is_win": outcome["is_win"], "win_symbol": outcome["win_symbol"],
        "is_jackpot": outcome["is_jackpot"], "multiplier": outcome["multiplier"],
        "payout": outcome["payout"],
        "server_seed_hash": seed["server_seed_hash"], "client_seed": seed["client_seed"],
        "nonce": nonce, "created_at": _now(),
    }
    await db.casino_spins.insert_one(dict(doc))

    balance = None
    if is_practice:
        balance = await practice_service.get_balance(user_id)
    else:
        w = await wallet_service.get_or_create_wallet(user_id)
        balance = w["balance"]
    doc.pop("_id", None)
    return {**doc, "balance": balance, "server_seed_hash": seed["server_seed_hash"]}


async def history(user_id: str, limit: int = 20) -> list[dict]:
    rows = await db.casino_spins.find(
        {"user_id": user_id}, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows


async def verify(user_id: str, spin_id: str) -> dict:
    row = await db.casino_spins.find_one({"id": spin_id, "user_id": user_id}, {"_id": 0})
    if not row:
        raise DomainError("Spin not found")
    cfg = await get_config()
    strip = slots.build_strip(cfg["symbols"], cfg["strip_len"])
    # The server_seed is revealed only after the player rotates their seed.
    revealed = await db.revealed_game_seeds.find_one(
        {"server_seed_hash": row["server_seed_hash"]}, {"_id": 0})
    server_seed = None
    recomputed_matches = None
    recomputed_symbols = None
    if revealed:
        server_seed = revealed["server_seed"]
        stops = rng.spin_indices(server_seed, row["client_seed"], row["nonce"],
                                 cfg["reels"], cfg["strip_len"])
        recomputed_symbols = [strip[s % len(strip)] for s in stops]
        recomputed_matches = bool(stops == row["stops"] and recomputed_symbols == row["symbols"]
                                  and rng.seed_commit(server_seed) == row["server_seed_hash"])
    return {
        "spin_id": spin_id,
        "server_seed_hash": row["server_seed_hash"],
        "client_seed": row["client_seed"],
        "nonce": row["nonce"],
        "symbols": row["symbols"],
        "stops": row["stops"],
        "revealed": bool(revealed),
        "server_seed": server_seed,
        "recomputed_symbols": recomputed_symbols,
        "recomputed_matches": recomputed_matches,
        "rtp": cfg["rtp"],
        "explanation": "Reel stops = HMAC-SHA256 stream of 'server_seed:client_seed:nonce' "
                       "(rejection-sampled to 0..strip_len). SHA256(server_seed) equals the "
                       "pre-published commitment. Rotate your seed to reveal server_seed and "
                       "recompute every past spin.",
    }
