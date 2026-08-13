"""Shared bonus-balance + wagering-requirement (playthrough) system.

Security foundation for ALL bonus/gift features (VIP recharge, Weekly Surprise
Box, Festival Gift, …). No bonus is ever instantly withdrawable: bonus coins go
into a SEPARATE `bonus_balance` on the wallet — playable but not cashable — and
convert to the real (withdrawable) `balance` only as the player wagers a
configurable multiple of the bonus in real gameplay.

Rules (as approved):
1. Two balances: real `balance` (withdrawable) + `bonus_balance` (playable only).
2. `debit_playable` spends REAL first, then bonus — so the bonus principal can
   never be directly withdrawn.
3. Every real-money wager calls `record_wager`, which advances the active grant's
   `wagered` and INCREMENTALLY releases bonus → real, proportional to progress.
4. One active grant is cleared before the next (FIFO). Unused bonus expires +
   forfeits remaining bonus_balance.

All movements are idempotent ledger rows; balances are only ever mutated here or
via wallet_service. No raw client-supplied amounts.
"""
import uuid
from datetime import datetime, timezone, timedelta

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .db import db
from .models import TxnType
from . import wallet_service

# Per-bonus-type defaults (Super-Admin-tunable via bonus_config).
DEFAULTS = {
    "multiple": 3,          # wagering requirement = amount x multiple
    "release_mode": "incremental",  # or "on_complete"
    "expiry_days": 7,
    "max_bet_while_bonus": None,     # optional guard (not enforced on debit yet)
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def ensure_indexes() -> None:
    await db.bonus_grants.create_index("request_id", unique=True)
    await db.bonus_grants.create_index([("user_id", 1), ("status", 1), ("created_at", 1)])
    await db.bonus_debits.create_index("id", unique=True)


async def get_config() -> dict:
    doc = await db.bonus_config.find_one({"_id": "bonus"}, {"_id": 0})
    return {**DEFAULTS, **(doc or {})}


async def set_config(patch: dict) -> dict:
    allowed = {k: patch[k] for k in ("multiple", "release_mode", "expiry_days", "max_bet_while_bonus") if k in patch}
    await db.bonus_config.update_one({"_id": "bonus"}, {"$set": allowed}, upsert=True)
    return await get_config()


async def _ledger(user_id: str, type_: TxnType, signed_amount: int, reason: str, request_id: str) -> None:
    """Audit-only bonus ledger row (bonus_balance moves are done separately)."""
    try:
        await db.ledger_transactions.insert_one({
            "id": str(uuid.uuid4()), "user_id": user_id, "wallet_id": None,
            "type": type_.value, "amount": signed_amount, "balance_after": None,
            "actor_id": None, "reason": reason, "request_id": request_id,
            "reversal_of_id": None, "status": "COMPLETED", "created_at": _iso(_now()),
        })
    except DuplicateKeyError:
        pass  # idempotent


async def grant_bonus(user_id: str, bonus_type: str, amount: int, *, request_id: str,
                      multiple: int | None = None, expiry_days: int | None = None,
                      source_ref: str | None = None) -> dict | None:
    """Grant a non-withdrawable bonus into bonus_balance with a playthrough
    requirement. Idempotent via request_id (call safely on retries)."""
    if amount <= 0:
        return None
    existing = await db.bonus_grants.find_one({"request_id": request_id}, {"_id": 0})
    if existing:
        return existing
    cfg = await get_config()
    mult = int(multiple if multiple is not None else cfg["multiple"])
    exp_days = int(expiry_days if expiry_days is not None else cfg["expiry_days"])
    grant = {
        "id": str(uuid.uuid4()), "user_id": user_id, "type": bonus_type,
        "amount": amount, "multiple": mult, "wagering_required": amount * mult,
        "wagered": 0, "released": 0, "status": "active",
        "request_id": request_id, "source_ref": source_ref,
        "created_at": _iso(_now()), "expires_at": _iso(_now() + timedelta(days=exp_days)),
    }
    try:
        await db.bonus_grants.insert_one(grant)
    except DuplicateKeyError:
        return await db.bonus_grants.find_one({"request_id": request_id}, {"_id": 0})
    await wallet_service.get_or_create_wallet(user_id)
    await db.wallets.update_one({"user_id": user_id}, {"$inc": {"bonus_balance": amount}})
    await _ledger(user_id, TxnType.BONUS_GRANT, amount, f"{bonus_type} bonus granted", f"bonus_grant:{grant['id']}")
    grant.pop("_id", None)
    return grant


async def _release(user_id: str, grant: dict, target_released: int) -> None:
    """Move (target_released − already_released) coins bonus_balance → real."""
    delta = min(target_released, grant["amount"]) - grant["released"]
    if delta <= 0:
        return
    moved = await db.wallets.find_one_and_update(
        {"user_id": user_id, "bonus_balance": {"$gte": delta}},
        {"$inc": {"bonus_balance": -delta, "balance": delta},
         "$set": {"updated_at": _iso(_now())}},
        return_document=ReturnDocument.AFTER)
    if moved is None:
        return  # not enough bonus_balance (shouldn't happen); skip
    grant["released"] += delta
    await db.bonus_grants.update_one({"id": grant["id"]}, {"$set": {"released": grant["released"]}})
    await _ledger(user_id, TxnType.BONUS_RELEASE, delta, "Bonus converted to real (wagering met)",
                  f"bonus_release:{grant['id']}:{grant['released']}")


async def record_wager(user_id: str, amount: int) -> None:
    """Advance playthrough on the active grant(s) and incrementally release.
    Call once per settled real-money wager. Never counts practice play."""
    if amount <= 0:
        return
    cfg = await get_config()
    remaining = amount
    while remaining > 0:
        grant = await db.bonus_grants.find_one(
            {"user_id": user_id, "status": "active"}, sort=[("created_at", 1)])
        if not grant:
            return
        need = grant["wagering_required"] - grant["wagered"]
        applied = min(remaining, need)
        grant["wagered"] += applied
        remaining -= applied
        if cfg["release_mode"] == "incremental":
            target = round(grant["amount"] * grant["wagered"] / max(1, grant["wagering_required"]))
        else:
            target = grant["amount"] if grant["wagered"] >= grant["wagering_required"] else grant["released"]
        cleared = grant["wagered"] >= grant["wagering_required"]
        if cleared:
            target = grant["amount"]
        await db.bonus_grants.update_one(
            {"id": grant["id"]},
            {"$set": {"wagered": grant["wagered"], "status": "cleared" if cleared else "active"}})
        await _release(user_id, grant, target)
        if not cleared:
            return  # this grant still needs more wagering; stop


async def debit_playable(user_id: str, type_: TxnType, amount: int, *,
                         reason: str | None = None, request_id: str) -> dict:
    """Spend `amount` from REAL balance first, then bonus_balance. Idempotent.
    Raises wallet_service.InsufficientFunds if combined playable is too low."""
    # Idempotency FIRST — a replay must return the original split without
    # re-evaluating the (now-reduced) balance.
    existing = await db.bonus_debits.find_one({"id": request_id}, {"_id": 0})
    if existing:
        return existing

    wallet = await wallet_service.get_or_create_wallet(user_id)
    real = wallet["balance"]
    bonus = wallet.get("bonus_balance", 0)
    if real + bonus < amount:
        raise wallet_service.InsufficientFunds(f"Insufficient playable balance for {amount}")

    real_part = min(real, amount)
    bonus_part = amount - real_part
    guard = {"id": request_id, "user_id": user_id, "real_part": real_part,
             "bonus_part": bonus_part, "created_at": _iso(_now())}
    try:
        await db.bonus_debits.insert_one(dict(guard))
    except DuplicateKeyError:
        return await db.bonus_debits.find_one({"id": request_id}, {"_id": 0})

    if real_part > 0:
        await wallet_service.debit(user_id, type_, real_part, reason=reason,
                                   request_id=f"{request_id}:real")
    if bonus_part > 0:
        await db.wallets.update_one(
            {"user_id": user_id, "bonus_balance": {"$gte": bonus_part}},
            {"$inc": {"bonus_balance": -bonus_part}, "$set": {"updated_at": _iso(_now())}})
        await _ledger(user_id, TxnType.BONUS_SPEND, -bonus_part, reason or "Bonus wager",
                      f"{request_id}:bonus")
    return guard


async def expire_bonuses() -> None:
    """Scheduler sweep: expire active grants past their expiry, forfeiting the
    unreleased remainder from bonus_balance."""
    now = _iso(_now())
    async for g in db.bonus_grants.find({"status": "active", "expires_at": {"$lt": now}}, {"_id": 0}):
        remaining = g["amount"] - g["released"]
        await db.bonus_grants.update_one({"id": g["id"]}, {"$set": {"status": "expired"}})
        if remaining > 0:
            await db.wallets.update_one(
                {"user_id": g["user_id"], "bonus_balance": {"$gte": remaining}},
                {"$inc": {"bonus_balance": -remaining}})
            await _ledger(g["user_id"], TxnType.BONUS_FORFEIT, -remaining,
                          f"{g['type']} bonus expired", f"bonus_forfeit:{g['id']}")


async def get_status(user_id: str) -> dict:
    wallet = await wallet_service.get_or_create_wallet(user_id)
    grants = await db.bonus_grants.find(
        {"user_id": user_id, "status": "active"}, {"_id": 0}).sort("created_at", 1).to_list(50)
    active = [{
        "type": g["type"], "amount": g["amount"], "wagering_required": g["wagering_required"],
        "wagered": g["wagered"], "released": g["released"],
        "remaining_to_unlock": max(0, g["wagering_required"] - g["wagered"]),
        "progress_pct": round(min(100, g["wagered"] / max(1, g["wagering_required"]) * 100)),
        "expires_at": g["expires_at"],
    } for g in grants]
    return {
        "real_balance": wallet["balance"],
        "bonus_balance": wallet.get("bonus_balance", 0),
        "locked_bonus": sum(g["amount"] - g["released"] for g in grants),
        "active_grants": active,
    }
