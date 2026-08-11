"""Revenue split + weekly settlement (Part 2), balance-usage auto-suspend
(Part 3), and the daily transaction summary. All generation is idempotent so it
can be triggered both lazily (on read) and by the scheduler without duplicating.
"""
from datetime import date, datetime, timedelta, timezone
from typing import Optional
import uuid

from .constants import (
    DEFAULT_SUPER_ADMIN_PCT,
    SETTLEMENT_DUE_WEEKDAY,
    USAGE_CRITICAL_PCT,
    SuspendReason,
)
from .db import db
from .models import Role, TxnType


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Suspension helpers (shared by Part 2 settlement + Part 3 usage)
# ---------------------------------------------------------------------------
async def suspend_user(user_id: str, reason: str) -> None:
    await db.users.update_one(
        {"id": user_id, "status": {"$ne": "DISABLED"}},
        {"$set": {"status": "SUSPENDED", "suspension_reason": reason, "suspended_at": _now_iso()}},
    )


async def reinstate_user(user_id: str, only_if_reason: Optional[str] = None) -> None:
    q = {"id": user_id, "status": "SUSPENDED"}
    if only_if_reason:
        q["suspension_reason"] = only_if_reason
    await db.users.update_one(
        q, {"$set": {"status": "ACTIVE", "suspension_reason": None, "suspended_at": None}}
    )


# ---------------------------------------------------------------------------
# Admin coin flows (shared source of truth for usage %)
# ---------------------------------------------------------------------------
async def admin_flows(user_id: str) -> tuple[int, int]:
    """(allocated, used) for an Admin, straight from the ledger."""
    allocated = used = 0
    async for t in db.ledger_transactions.find(
        {"user_id": user_id, "status": "COMPLETED"}, {"_id": 0, "type": 1, "amount": 1}
    ):
        if t["type"] in (TxnType.MANAGER_TO_ADMIN.value, TxnType.ADMIN_RECHARGE.value) and t["amount"] > 0:
            allocated += t["amount"]
        elif t["type"] == TxnType.ADMIN_GRANT.value and t["amount"] < 0:
            used += -t["amount"]
    return allocated, used


async def sync_admin_usage_suspension(admin_id: str) -> None:
    """Part 3: fully-used allocation → auto-suspend; fresh headroom → reinstate
    (only if the suspension was for coin exhaustion)."""
    allocated, used = await admin_flows(admin_id)
    if allocated > 0 and used >= allocated:
        await suspend_user(admin_id, SuspendReason.COINS_EXHAUSTED)
    else:
        await reinstate_user(admin_id, only_if_reason=SuspendReason.COINS_EXHAUSTED)


def usage_level(pct: int) -> Optional[str]:
    from .constants import USAGE_DANGER_PCT, USAGE_WARN_PCT
    if pct >= USAGE_CRITICAL_PCT:
        return "critical"
    if pct >= USAGE_DANGER_PCT:
        return "danger"
    if pct >= USAGE_WARN_PCT:
        return "warn"
    return None


# ---------------------------------------------------------------------------
# Week math
# ---------------------------------------------------------------------------
def week_bounds(d: date) -> tuple[date, date]:
    """Sunday → Saturday week containing date d."""
    days_since_sunday = (d.weekday() + 1) % 7  # Mon=0..Sun=6 → Sun-based offset
    start = d - timedelta(days=days_since_sunday)
    return start, start + timedelta(days=6)


def due_date(week_end: date) -> date:
    """The configured weekday (default Wednesday) after the week ends."""
    days = (SETTLEMENT_DUE_WEEKDAY - week_end.weekday()) % 7 or 7
    return week_end + timedelta(days=days)


async def _admin_split_pct(admin_id: str) -> int:
    alloc = await db.admin_allocations.find_one({"user_id": admin_id}, {"_id": 0})
    return (alloc or {}).get("revenue_split_super_admin_pct", DEFAULT_SUPER_ADMIN_PCT)


# ---------------------------------------------------------------------------
# Settlements
# ---------------------------------------------------------------------------
async def generate_settlements_for_week(week_start: date, week_end: date) -> int:
    start_iso = datetime(week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc).isoformat()
    end_dt = datetime(week_end.year, week_end.month, week_end.day, tzinfo=timezone.utc) + timedelta(days=1)
    end_iso = end_dt.isoformat()

    totals: dict[str, int] = {}
    async for d in db.deposits.find(
        {"status": "CONFIRMED", "created_at": {"$gte": start_iso, "$lt": end_iso}},
        {"_id": 0, "target_admin_id": 1, "amount_inr": 1},
    ):
        aid = d.get("target_admin_id")
        if aid:
            totals[aid] = totals.get(aid, 0) + d.get("amount_inr", 0)

    ws, we = week_start.isoformat(), week_end.isoformat()
    made = 0
    for admin_id, total in totals.items():
        existing = await db.settlements.find_one({"admin_id": admin_id, "week_start": ws}, {"_id": 0})
        if existing and existing["status"] == "SETTLED":
            continue  # never rewrite a settled record
        pct = await _admin_split_pct(admin_id)
        sa_share = round(total * pct / 100)
        doc = {
            "admin_id": admin_id,
            "week_start": ws,
            "week_end": we,
            "due_date": due_date(week_end).isoformat(),
            "total_deposits_inr": total,
            "split_pct_used": pct,
            "super_admin_share_inr": sa_share,
            "admin_share_inr": total - sa_share,
            "status": "PENDING",
            "settled_at": None,
            "settled_by": None,
            "generated_at": _now_iso(),
        }
        if existing:
            await db.settlements.update_one({"admin_id": admin_id, "week_start": ws}, {"$set": doc})
        else:
            doc["id"] = uuid.uuid4().hex
            await db.settlements.insert_one(doc)
        made += 1
    return made


async def apply_overdue_suspensions() -> None:
    """Suspend Admins with a PENDING settlement past its due date; reinstate
    those who no longer have any overdue PENDING settlement."""
    today = datetime.now(timezone.utc).date().isoformat()
    overdue_admins = set()
    async for s in db.settlements.find({"status": "PENDING"}, {"_id": 0, "admin_id": 1, "due_date": 1}):
        if s["due_date"] < today:
            overdue_admins.add(s["admin_id"])

    async for a in db.admin_allocations.find({}, {"_id": 0, "user_id": 1}):
        aid = a["user_id"]
        if aid in overdue_admins:
            await suspend_user(aid, SuspendReason.SETTLEMENT_OVERDUE)
        else:
            await reinstate_user(aid, only_if_reason=SuspendReason.SETTLEMENT_OVERDUE)


async def ensure_recent_settlements() -> None:
    """Lazily generate settlements for the most recently completed week."""
    last_week_day = datetime.now(timezone.utc).date() - timedelta(days=7)
    ws, we = week_bounds(last_week_day)
    await generate_settlements_for_week(ws, we)
    await apply_overdue_suspensions()


async def list_settlements(limit: int = 200) -> list[dict]:
    await ensure_recent_settlements()
    rows = [s async for s in db.settlements.find({}, {"_id": 0}).sort("week_start", -1).limit(limit)]
    cache: dict[str, str] = {}
    for s in rows:
        aid = s["admin_id"]
        if aid not in cache:
            u = await db.users.find_one({"id": aid}, {"_id": 0, "display_name": 1})
            cache[aid] = (u or {}).get("display_name", "—")
        s["admin_name"] = cache[aid]
    return rows


async def settle(settlement_id: str, settled_by: str) -> dict:
    s = await db.settlements.find_one({"id": settlement_id}, {"_id": 0})
    if not s:
        raise ValueError("Settlement not found")
    if s["status"] == "SETTLED":
        return s
    await db.settlements.update_one({"id": settlement_id}, {"$set": {
        "status": "SETTLED", "settled_at": _now_iso(), "settled_by": settled_by,
    }})
    # Clearing this may lift a settlement-overdue suspension.
    await apply_overdue_suspensions()
    return await db.settlements.find_one({"id": settlement_id}, {"_id": 0})


# ---------------------------------------------------------------------------
# Daily transaction summary
# ---------------------------------------------------------------------------
async def generate_daily_summary(day: date) -> dict:
    start = datetime(day.year, day.month, day.day, tzinfo=timezone.utc)
    end = start + timedelta(days=1)
    s_iso, e_iso = start.isoformat(), end.isoformat()

    total_deposits = 0
    async for d in db.deposits.find(
        {"status": "CONFIRMED", "created_at": {"$gte": s_iso, "$lt": e_iso}},
        {"_id": 0, "amount_inr": 1},
    ):
        total_deposits += d.get("amount_inr", 0)

    txn_count = await db.ledger_transactions.count_documents(
        {"status": "COMPLETED", "created_at": {"$gte": s_iso, "$lt": e_iso}}
    )
    total_allocations = 0
    async for t in db.ledger_transactions.find(
        {"status": "COMPLETED", "created_at": {"$gte": s_iso, "$lt": e_iso},
         "type": {"$in": [TxnType.MANAGER_TO_ADMIN.value, TxnType.SUPER_ADMIN_TO_MANAGER.value]},
         "amount": {"$gt": 0}},
        {"_id": 0, "amount": 1},
    ):
        total_allocations += t["amount"]

    doc = {
        "date": day.isoformat(),
        "total_deposits_inr": total_deposits,
        "total_allocations_coins": total_allocations,
        "total_transactions": txn_count,
        "generated_at": _now_iso(),
    }
    await db.daily_summaries.update_one({"date": day.isoformat()}, {"$set": doc}, upsert=True)
    return doc


async def get_daily_summaries(days: int = 14) -> list[dict]:
    today = datetime.now(timezone.utc).date()
    # (Re)generate today + yesterday so the latest figures are always fresh.
    await generate_daily_summary(today)
    await generate_daily_summary(today - timedelta(days=1))
    rows = [s async for s in db.daily_summaries.find({}, {"_id": 0}).sort("date", -1).limit(days)]
    return rows
