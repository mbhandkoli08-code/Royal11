"""Daily Bonus — one free bonus-coin claim per player per calendar day (IST).

Server-authoritative: the claimable state and next-claim time are computed
server-side from the last claim's IST date — the client never supplies the
amount or whether a claim is allowed. Coins go to the non-withdrawable bonus
rail (playthrough applies), idempotent per (user, IST-date), same ledger/
idempotency pattern as promo/referral/surprise-box.
"""
from datetime import datetime, timedelta, timezone, time

from . import bonus_service
from .audit import log_action
from .db import db

IST = timezone(timedelta(hours=5, minutes=30))
CONFIG_ID = "daily_bonus"
DEFAULTS = {"enabled": True, "amount": 50}


class DailyBonusError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ist_date(dt_utc: datetime) -> str:
    return dt_utc.astimezone(IST).date().isoformat()


def _next_ist_midnight_utc(dt_utc: datetime) -> str:
    ist_now = dt_utc.astimezone(IST)
    next_mid_ist = datetime.combine(ist_now.date() + timedelta(days=1), time.min, tzinfo=IST)
    return next_mid_ist.astimezone(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.daily_bonus_claims.create_index("id", unique=True)
    await db.daily_bonus_claims.create_index("user_id")


async def get_config() -> dict:
    doc = await db.daily_bonus_config.find_one({"_id": CONFIG_ID}, {"_id": 0})
    return {**DEFAULTS, **(doc or {})}


async def set_config(patch: dict) -> dict:
    upd = {}
    if "enabled" in patch:
        upd["enabled"] = bool(patch["enabled"])
    if patch.get("amount") is not None:
        amt = int(patch["amount"])
        if amt < 0:
            raise DailyBonusError("Amount must be 0 or more")
        upd["amount"] = amt
    if upd:
        await db.daily_bonus_config.update_one({"_id": CONFIG_ID}, {"$set": upd}, upsert=True)
    return await get_config()


async def status(user_id: str) -> dict:
    cfg = await get_config()
    now = _now()
    today = _ist_date(now)
    last = await db.daily_bonus_claims.find_one(
        {"user_id": user_id}, {"_id": 0, "ist_date": 1, "created_at": 1},
        sort=[("created_at", -1)])
    claimed_today = bool(last and last.get("ist_date") == today)
    return {
        "enabled": cfg["enabled"],
        "amount": cfg["amount"],
        "claimable": cfg["enabled"] and not claimed_today,
        "claimed_today": claimed_today,
        "last_claim_at": last.get("created_at") if last else None,
        "next_claim_at": _next_ist_midnight_utc(now),  # next IST midnight
        "server_time": now.isoformat(),
    }


async def claim(user_id: str) -> dict:
    cfg = await get_config()
    if not cfg["enabled"]:
        raise DailyBonusError("Daily bonus is currently unavailable")
    now = _now()
    today = _ist_date(now)
    claim_id = f"daily_bonus:{user_id}:{today}"
    # Idempotent guard — one claim per player per IST day.
    if await db.daily_bonus_claims.find_one({"id": claim_id}, {"_id": 0, "id": 1}):
        raise DailyBonusError("You've already claimed today's bonus")
    amount = int(cfg["amount"])
    if amount > 0:
        await bonus_service.grant_bonus(
            user_id, "daily_bonus", amount, request_id=claim_id, source_ref=today)
    await db.daily_bonus_claims.insert_one({
        "id": claim_id, "user_id": user_id, "ist_date": today,
        "amount": amount, "created_at": now.isoformat(),
    })
    await log_action(user_id, "DAILY_BONUS_CLAIMED", target_type="daily_bonus",
                     target_id=claim_id, metadata={"amount": amount, "ist_date": today})
    return await status(user_id)
