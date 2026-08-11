"""Salary + Incentive payroll for Managers & Zonal Managers.

Each settlement week (Sun-Sat, same cycle as revenue settlements):
  - SALARY: a fixed guaranteed weekly amount (default 0), paid every week
    regardless of performance.
  - INCENTIVE: an EXTRA bonus, only when downline CONFIRMED deposit revenue for
    the week meets the per-person target: bonus = revenue * incentive_pct.

Both are funded from the Super Admin's share (the Super Admin is the coin mint;
Admins' 30% cut is untouched). Amounts are ₹, credited 1:1 as coins into the
person's wallet. Credits are idempotent (`salary:{uid}:{ws}`, `incentive:{uid}:{ws}`)
so the daily scheduler can re-run safely.
"""
from datetime import date, datetime, timedelta, timezone

from . import wallet_service
from .db import db
from .models import Role, TxnType
from .revenue_service import week_bounds


def _window_iso(week_start: date, week_end: date) -> tuple[str, str]:
    start = datetime(week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc).isoformat()
    end = (datetime(week_end.year, week_end.month, week_end.day, tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
    return start, end


async def _admin_ids_for_manager(manager_id: str) -> list[str]:
    return [a["user_id"] async for a in db.admin_allocations.find(
        {"manager_id": manager_id}, {"_id": 0, "user_id": 1})]


async def _downline_admin_ids(person_id: str, role: str) -> list[str]:
    if role == Role.MANAGER.value:
        return await _admin_ids_for_manager(person_id)
    # Zonal Manager: every Admin under every Manager in the zone.
    ids: list[str] = []
    async for m in db.manager_allocations.find({"zonal_manager_id": person_id}, {"_id": 0, "user_id": 1}):
        ids += await _admin_ids_for_manager(m["user_id"])
    return ids


async def _revenue(admin_ids: list[str], start_iso: str, end_iso: str) -> int:
    if not admin_ids:
        return 0
    total = 0
    async for d in db.deposits.find(
        {"status": "CONFIRMED", "target_admin_id": {"$in": admin_ids},
         "created_at": {"$gte": start_iso, "$lt": end_iso}},
        {"_id": 0, "amount_inr": 1},
    ):
        total += d.get("amount_inr", 0)
    return total


def _compute(alloc: dict, revenue: int) -> tuple[int, int]:
    """Returns (salary, incentive) in ₹ for the given allocation + week revenue."""
    salary = int(alloc.get("weekly_salary_inr") or 0)
    target = int(alloc.get("incentive_target_inr") or 0)
    pct = float(alloc.get("incentive_pct") or 0)
    incentive = round(revenue * pct / 100) if (target > 0 and pct > 0 and revenue >= target) else 0
    return salary, incentive


# ---------------------------------------------------------------------------
# Super Admin: set/edit a person's salary + incentive terms
# ---------------------------------------------------------------------------
async def set_payroll(collection, person_id: str, weekly_salary_inr: int,
                      incentive_target_inr: int, incentive_pct: float) -> dict:
    coll = db.manager_allocations if collection == "manager" else db.zonal_manager_allocations
    res = await coll.update_one({"user_id": person_id}, {"$set": {
        "weekly_salary_inr": weekly_salary_inr,
        "incentive_target_inr": incentive_target_inr,
        "incentive_pct": incentive_pct,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    if res.matched_count == 0:
        raise ValueError("Person not found")
    return {"person_id": person_id, "weekly_salary_inr": weekly_salary_inr,
            "incentive_target_inr": incentive_target_inr, "incentive_pct": incentive_pct}


# ---------------------------------------------------------------------------
# Weekly payout run (idempotent) — called from the scheduler
# ---------------------------------------------------------------------------
async def _pay_one(person_id: str, role: str, alloc: dict, week_start: date, week_end: date) -> None:
    start_iso, end_iso = _window_iso(week_start, week_end)
    revenue = await _revenue(await _downline_admin_ids(person_id, role), start_iso, end_iso)
    salary, incentive = _compute(alloc, revenue)
    ws = week_start.isoformat()
    if salary > 0:
        await wallet_service.credit(
            person_id, TxnType.SALARY, salary, actor_id="system",
            reason=f"Weekly salary ({ws})", request_id=f"salary:{person_id}:{ws}")
    if incentive > 0:
        await wallet_service.credit(
            person_id, TxnType.INCENTIVE, incentive, actor_id="system",
            reason=f"Weekly incentive ({ws}) — {revenue} downline revenue", request_id=f"incentive:{person_id}:{ws}")


async def run_payroll_for_week(week_start: date, week_end: date) -> int:
    paid = 0
    async for alloc in db.manager_allocations.find({}, {"_id": 0}):
        await _pay_one(alloc["user_id"], Role.MANAGER.value, alloc, week_start, week_end)
        paid += 1
    async for alloc in db.zonal_manager_allocations.find({}, {"_id": 0}):
        await _pay_one(alloc["user_id"], Role.ZONAL_MANAGER.value, alloc, week_start, week_end)
        paid += 1
    return paid


async def run_recent_payroll() -> int:
    """Pay out the most recently COMPLETED week (idempotent)."""
    last_week_day = datetime.now(timezone.utc).date() - timedelta(days=7)
    ws, we = week_bounds(last_week_day)
    return await run_payroll_for_week(ws, we)


# ---------------------------------------------------------------------------
# Live view for a Manager / Zonal Manager Console
# ---------------------------------------------------------------------------
async def payroll_view(person_id: str, role: str, alloc: dict) -> dict:
    today = datetime.now(timezone.utc).date()
    ws, we = week_bounds(today)
    start_iso, end_iso = _window_iso(ws, we)
    revenue = await _revenue(await _downline_admin_ids(person_id, role), start_iso, end_iso)
    salary, projected_incentive = _compute(alloc, revenue)
    target = int(alloc.get("incentive_target_inr") or 0)
    history = [t async for t in db.ledger_transactions.find(
        {"user_id": person_id, "type": {"$in": [TxnType.SALARY.value, TxnType.INCENTIVE.value]}},
        {"_id": 0, "type": 1, "amount": 1, "reason": 1, "created_at": 1},
    ).sort("created_at", -1).limit(12)]
    return {
        "week_start": ws.isoformat(),
        "week_end": we.isoformat(),
        "weekly_salary_inr": salary,
        "incentive_target_inr": target,
        "incentive_pct": float(alloc.get("incentive_pct") or 0),
        "current_week_revenue_inr": revenue,
        "target_met": bool(target > 0 and revenue >= target),
        "projected_incentive_inr": projected_incentive,
        "projected_total_inr": salary + projected_incentive,
        "history": history,
    }
