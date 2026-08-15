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
STREAK_LEN = 7
DEFAULTS = {"enabled": True, "amount": 50, "day7_amount": 250}


class DailyBonusError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ist_date(dt_utc: datetime) -> str:
    return dt_utc.astimezone(IST).date().isoformat()


def _ist_today_yesterday(dt_utc: datetime) -> tuple[str, str]:
    d = dt_utc.astimezone(IST).date()
    return d.isoformat(), (d - timedelta(days=1)).isoformat()


def _ladder(cfg: dict) -> list[int]:
    """7-day escalating ladder: base amount on days 1–6, day7_amount on day 7."""
    base = int(cfg["amount"])
    return [base] * (STREAK_LEN - 1) + [int(cfg["day7_amount"])]


def _next_streak_day(last: dict | None, yesterday: str) -> int:
    """The streak day (1..7) the NEXT claim will land on. Continues from an
    unbroken run (yesterday's claim), loops 7→1, and resets to 1 on any miss."""
    if last and last.get("ist_date") == yesterday:
        prev = int(last.get("streak_day") or 1)
        return (prev % STREAK_LEN) + 1
    return 1


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
    if patch.get("day7_amount") is not None:
        d7 = int(patch["day7_amount"])
        if d7 < 0:
            raise DailyBonusError("Day 7 amount must be 0 or more")
        upd["day7_amount"] = d7
    if upd:
        await db.daily_bonus_config.update_one({"_id": CONFIG_ID}, {"$set": upd}, upsert=True)
    return await get_config()


async def status(user_id: str) -> dict:
    cfg = await get_config()
    now = _now()
    today, yesterday = _ist_today_yesterday(now)
    ladder = _ladder(cfg)
    last = await db.daily_bonus_claims.find_one(
        {"user_id": user_id}, {"_id": 0, "ist_date": 1, "streak_day": 1, "created_at": 1},
        sort=[("created_at", -1)])
    claimed_today = bool(last and last.get("ist_date") == today)
    if claimed_today:
        # The day they just completed today.
        streak_day = int(last.get("streak_day") or 1)
    else:
        # The day the next claim will land on.
        streak_day = _next_streak_day(last, yesterday)
    claim_amount = ladder[streak_day - 1]
    return {
        "enabled": cfg["enabled"],
        "amount": claim_amount,          # coins for the day shown (kept key for UI back-compat)
        "base_amount": int(cfg["amount"]),
        "day7_amount": int(cfg["day7_amount"]),
        "ladder": ladder,
        "streak_day": streak_day,        # 1..7 (today's completed day if claimed, else the claimable day)
        "streak_len": STREAK_LEN,
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
    today, yesterday = _ist_today_yesterday(now)
    claim_id = f"daily_bonus:{user_id}:{today}"
    # Idempotent guard — one claim per player per IST day.
    if await db.daily_bonus_claims.find_one({"id": claim_id}, {"_id": 0, "id": 1}):
        raise DailyBonusError("You've already claimed today's bonus")
    # Streak day for this claim (continues an unbroken run, resets on a miss).
    last = await db.daily_bonus_claims.find_one(
        {"user_id": user_id}, {"_id": 0, "ist_date": 1, "streak_day": 1},
        sort=[("created_at", -1)])
    streak_day = _next_streak_day(last, yesterday)
    amount = _ladder(cfg)[streak_day - 1]
    if amount > 0:
        await bonus_service.grant_bonus(
            user_id, "daily_bonus", amount, request_id=claim_id, source_ref=today)
    await db.daily_bonus_claims.insert_one({
        "id": claim_id, "user_id": user_id, "ist_date": today,
        "streak_day": streak_day, "amount": amount, "created_at": now.isoformat(),
    })
    await log_action(user_id, "DAILY_BONUS_CLAIMED", target_type="daily_bonus",
                     target_id=claim_id, metadata={"amount": amount, "ist_date": today,
                                                    "streak_day": streak_day})
    return await status(user_id)
