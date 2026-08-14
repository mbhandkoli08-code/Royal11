"""Admin Credit Line — overdraft-style working-capital credit for Admins/Vendors.

Model: an Admin's upline Manager reviews the Admin's recharge track record and
sets a pre-approved credit_limit. When the Admin's float can't cover a player
recharge, the platform AUTO tops up the shortfall into the Admin's float (up to
their remaining credit) with no per-instance approval, recording debt. Requests
beyond the remaining limit need explicit Manager approval. Debt is repaid from
future top-ups and settlement/commission deductions.

Ledger (`admin_credit_ledger`) is separate from the bonus ledger for clean audit.
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, status

from . import wallet_service
from .audit import log_action
from .db import db
from .models import Role, TxnType


class CreditLineExceeded(Exception):
    """Raised when float + remaining credit can't cover a recharge."""
    def __init__(self, shortfall: int, remaining_credit: int):
        self.shortfall = shortfall
        self.remaining_credit = remaining_credit
        super().__init__("Credit limit exceeded")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.admin_credit_lines.create_index("admin_id", unique=True)
    await db.admin_credit_ledger.create_index("admin_id")
    await db.admin_credit_requests.create_index("admin_id")
    await db.admin_credit_requests.create_index("status")


async def _get_line(admin_id: str) -> dict:
    doc = await db.admin_credit_lines.find_one({"admin_id": admin_id}, {"_id": 0})
    return doc or {"admin_id": admin_id, "credit_limit": 0, "outstanding_debt": 0,
                   "status": "ACTIVE", "set_by": None, "updated_at": None}


async def _ledger(admin_id: str, entry_type: str, amount: int, *, actor_id=None,
                  reason=None, related_id=None) -> None:
    line = await _get_line(admin_id)
    await db.admin_credit_ledger.insert_one({
        "id": str(uuid.uuid4()),
        "admin_id": admin_id,
        "type": entry_type,               # AUTO_TOPUP | OVERLIMIT_APPROVED | REPAYMENT | LIMIT_SET
        "amount": amount,
        "outstanding_after": line["outstanding_debt"],
        "actor_id": actor_id,
        "reason": reason,
        "related_id": related_id,
        "created_at": _now(),
    })


# ---------------------------------------------------------------------------
# Float servicing — called from confirm_deposit BEFORE crediting the player.
# ---------------------------------------------------------------------------
async def ensure_admin_float(admin_id: str, amount: int, *, related_id=None) -> dict:
    """Guarantee the Admin's float can cover `amount`. Auto-tops-up the shortfall
    from the credit line when possible; raises CreditLineExceeded otherwise."""
    wallet = await wallet_service.get_or_create_wallet(admin_id)
    balance = wallet["balance"]
    if balance >= amount:
        return {"topped_up": 0}

    shortfall = amount - balance
    line = await _get_line(admin_id)
    remaining = max(0, line["credit_limit"] - line["outstanding_debt"]) if line["status"] == "ACTIVE" else 0
    if remaining < shortfall:
        raise CreditLineExceeded(shortfall, remaining)

    # Auto top-up exactly the shortfall into the Admin's real float.
    await wallet_service.credit(
        admin_id, TxnType.ADMIN_CREDIT_TOPUP, shortfall,
        reason="Auto credit-line top-up", request_id=f"credit_topup:{related_id or uuid.uuid4().hex}",
    )
    await db.admin_credit_lines.update_one(
        {"admin_id": admin_id}, {"$inc": {"outstanding_debt": shortfall},
                                 "$set": {"updated_at": _now()}}, upsert=True)
    await _ledger(admin_id, "AUTO_TOPUP", shortfall, related_id=related_id,
                  reason="Automatic float top-up within credit limit")
    await log_action(admin_id, "CREDIT_AUTO_TOPUP", target_type="admin", target_id=admin_id,
                     metadata={"amount": shortfall, "related_id": related_id})
    return {"topped_up": shortfall}


async def repay_from_topup(admin_id: str, available: int) -> int:
    """On any incoming float top-up, settle outstanding debt FIRST. Returns the
    amount repaid (debited back from the Admin's float)."""
    line = await _get_line(admin_id)
    debt = line["outstanding_debt"]
    if debt <= 0 or available <= 0:
        return 0
    repay = min(debt, available)
    await wallet_service.debit(
        admin_id, TxnType.ADMIN_CREDIT_REPAYMENT, repay,
        reason="Credit-line repayment from top-up", request_id=f"credit_repay:{uuid.uuid4().hex}",
    )
    await db.admin_credit_lines.update_one(
        {"admin_id": admin_id}, {"$inc": {"outstanding_debt": -repay}, "$set": {"updated_at": _now()}})
    await _ledger(admin_id, "REPAYMENT", repay, reason="Auto-repaid from top-up")
    return repay


async def record_repayment(actor: dict, admin_id: str, amount: int, note=None) -> dict:
    """Manual/settlement repayment (e.g. deducted from the Admin's commission at
    the settlement cycle). Debits the Admin's float and reduces debt."""
    line = await _get_line(admin_id)
    repay = min(line["outstanding_debt"], amount)
    if repay <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No outstanding debt to repay")
    await wallet_service.debit(
        admin_id, TxnType.ADMIN_CREDIT_REPAYMENT, repay,
        actor_id=actor["id"], reason=note or "Credit-line repayment (settlement)",
        request_id=f"credit_repay_manual:{uuid.uuid4().hex}")
    await db.admin_credit_lines.update_one(
        {"admin_id": admin_id}, {"$inc": {"outstanding_debt": -repay}, "$set": {"updated_at": _now()}})
    await _ledger(admin_id, "REPAYMENT", repay, actor_id=actor["id"], reason=note or "Settlement repayment")
    await log_action(actor["id"], "CREDIT_REPAYMENT", target_type="admin", target_id=admin_id,
                     metadata={"amount": repay})
    return await get_admin_status(admin_id)


# ---------------------------------------------------------------------------
# Manager: set/adjust/revoke limit + approve over-limit requests
# ---------------------------------------------------------------------------
async def _assert_upline(caller: dict, admin_id: str) -> None:
    """Caller must be SUPER_ADMIN, the admin's Manager, or that Manager's Zonal."""
    if caller["role"] == Role.SUPER_ADMIN.value:
        return
    alloc = await db.admin_allocations.find_one({"user_id": admin_id}, {"_id": 0, "manager_id": 1})
    manager_id = alloc.get("manager_id") if alloc else None
    if caller["role"] == Role.MANAGER.value and manager_id == caller["id"]:
        return
    if caller["role"] == Role.ZONAL_MANAGER.value and manager_id:
        m = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0, "zonal_manager_id": 1})
        if m and m.get("zonal_manager_id") == caller["id"]:
            return
    raise HTTPException(status.HTTP_403_FORBIDDEN, "This admin is not in your downline")


async def set_limit(caller: dict, admin_id: str, credit_limit: int, note=None) -> dict:
    await _assert_upline(caller, admin_id)
    admin = await db.users.find_one({"id": admin_id, "role": Role.ADMIN.value}, {"_id": 0, "id": 1})
    if not admin:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin not found")
    await db.admin_credit_lines.update_one(
        {"admin_id": admin_id},
        {"$set": {"credit_limit": credit_limit, "status": "ACTIVE", "set_by": caller["id"], "updated_at": _now()},
         "$setOnInsert": {"outstanding_debt": 0}}, upsert=True)
    await _ledger(admin_id, "LIMIT_SET", credit_limit, actor_id=caller["id"], reason=note or "Credit limit set")
    await log_action(caller["id"], "CREDIT_LIMIT_SET", target_type="admin", target_id=admin_id,
                     metadata={"credit_limit": credit_limit})
    return await get_admin_status(admin_id)


async def revoke_limit(caller: dict, admin_id: str) -> dict:
    await _assert_upline(caller, admin_id)
    await db.admin_credit_lines.update_one(
        {"admin_id": admin_id}, {"$set": {"status": "REVOKED", "credit_limit": 0, "updated_at": _now()}}, upsert=True)
    await _ledger(admin_id, "LIMIT_SET", 0, actor_id=caller["id"], reason="Credit line revoked")
    await log_action(caller["id"], "CREDIT_LIMIT_REVOKED", target_type="admin", target_id=admin_id)
    return await get_admin_status(admin_id)


async def create_request(admin: dict, amount: int, reason=None) -> dict:
    req = {
        "id": str(uuid.uuid4()), "admin_id": admin["id"], "amount": amount,
        "reason": reason, "status": "PENDING", "created_at": _now(),
        "decided_by": None, "decided_at": None,
    }
    await db.admin_credit_requests.insert_one(req)
    await log_action(admin["id"], "CREDIT_REQUEST_CREATED", target_type="admin", target_id=admin["id"],
                     metadata={"amount": amount})
    req.pop("_id", None)
    return req


async def decide_request(caller: dict, request_id: str, approve: bool, reason=None) -> dict:
    req = await db.admin_credit_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Request not found")
    if req["status"] != "PENDING":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Already {req['status'].lower()}")
    await _assert_upline(caller, req["admin_id"])
    if approve:
        # Approving raises the Admin's credit limit by the requested amount so the
        # (previously over-limit) top-up can now proceed automatically.
        await db.admin_credit_lines.update_one(
            {"admin_id": req["admin_id"]},
            {"$inc": {"credit_limit": req["amount"]}, "$set": {"status": "ACTIVE", "updated_at": _now()},
             "$setOnInsert": {"outstanding_debt": 0}}, upsert=True)
        await _ledger(req["admin_id"], "OVERLIMIT_APPROVED", req["amount"], actor_id=caller["id"],
                      reason=reason or "Over-limit request approved", related_id=request_id)
    await db.admin_credit_requests.update_one({"id": request_id}, {"$set": {
        "status": "APPROVED" if approve else "REJECTED", "decided_by": caller["id"],
        "decided_at": _now(), "decision_reason": reason,
    }})
    await log_action(caller["id"], "CREDIT_REQUEST_DECISION", target_type="admin",
                     target_id=req["admin_id"], metadata={"approve": approve, "amount": req["amount"]})
    return {**req, "status": "APPROVED" if approve else "REJECTED"}


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
async def _weekly_avg_recharge(admin_id: str) -> dict:
    """Average weekly confirmed player-recharge volume serviced by this Admin —
    the Admin's 'credit report'."""
    rows = await db.deposits.find(
        {"target_admin_id": admin_id, "status": "CONFIRMED"},
        {"_id": 0, "coins_to_credit": 1, "confirmed_at": 1}).to_list(5000)
    if not rows:
        return {"weekly_avg": 0, "total_confirmed": 0, "count": 0, "last_recharge_at": None}
    weeks: dict = {}
    last = None
    for r in rows:
        ts = r.get("confirmed_at")
        if not ts:
            continue
        wk = ts[:4] + "-W" + str(datetime.fromisoformat(ts).isocalendar().week)
        weeks[wk] = weeks.get(wk, 0) + r.get("coins_to_credit", 0)
        if last is None or ts > last:
            last = ts
    total = sum(weeks.values())
    weekly_avg = round(total / max(1, len(weeks)))
    return {"weekly_avg": weekly_avg, "total_confirmed": total, "count": len(rows), "last_recharge_at": last}


async def get_admin_status(admin_id: str) -> dict:
    line = await _get_line(admin_id)
    wallet = await wallet_service.get_or_create_wallet(admin_id)
    remaining = max(0, line["credit_limit"] - line["outstanding_debt"]) if line["status"] == "ACTIVE" else 0
    stats = await _weekly_avg_recharge(admin_id)
    return {
        "admin_id": admin_id,
        "float_balance": wallet["balance"],
        "credit_limit": line["credit_limit"],
        "outstanding_debt": line["outstanding_debt"],
        "available_credit": remaining,
        "status": line["status"],
        "can_service": wallet["balance"] > 0 or remaining > 0,
        "low_float_warning": wallet["balance"] <= 0 and remaining > 0,
        "weekly_avg_recharge": stats["weekly_avg"],
        "last_recharge_at": stats["last_recharge_at"],
    }


async def _downline_admin_ids(caller: dict):
    if caller["role"] == Role.SUPER_ADMIN.value:
        rows = await db.users.find({"role": Role.ADMIN.value}, {"_id": 0, "id": 1}).to_list(5000)
        return [r["id"] for r in rows]
    if caller["role"] == Role.MANAGER.value:
        rows = await db.admin_allocations.find({"manager_id": caller["id"]}, {"_id": 0, "user_id": 1}).to_list(5000)
        return [r["user_id"] for r in rows]
    if caller["role"] == Role.ZONAL_MANAGER.value:
        mgrs = await db.manager_allocations.find({"zonal_manager_id": caller["id"]}, {"_id": 0, "user_id": 1}).to_list(2000)
        mgr_ids = [m["user_id"] for m in mgrs]
        rows = await db.admin_allocations.find({"manager_id": {"$in": mgr_ids}}, {"_id": 0, "user_id": 1}).to_list(5000)
        return [r["user_id"] for r in rows]
    return []


async def report(caller: dict) -> dict:
    admin_ids = await _downline_admin_ids(caller)
    names = {}
    if admin_ids:
        urows = await db.users.find({"id": {"$in": admin_ids}}, {"_id": 0, "id": 1, "display_name": 1, "email": 1}).to_list(len(admin_ids))
        names = {u["id"]: u for u in urows}
    out = []
    now = datetime.now(timezone.utc)
    for aid in admin_ids:
        st = await get_admin_status(aid)
        # Flag: carrying debt but no recharge in 14+ days, or debt near/over limit.
        stale = False
        if st["last_recharge_at"]:
            days = (now - datetime.fromisoformat(st["last_recharge_at"])).days
            stale = days >= 14
        flag = st["outstanding_debt"] > 0 and (stale or st["available_credit"] <= 0)
        u = names.get(aid, {})
        recent = await db.admin_credit_ledger.find(
            {"admin_id": aid, "type": {"$in": ["AUTO_TOPUP", "OVERLIMIT_APPROVED"]}},
            {"_id": 0}).sort("created_at", -1).to_list(3)
        out.append({**st, "admin_name": u.get("display_name"), "admin_email": u.get("email"),
                    "flagged": flag, "recent_topups": recent})
    out.sort(key=lambda x: (not x["flagged"], -x["outstanding_debt"]))
    totals = {
        "admins": len(out),
        "total_debt": sum(x["outstanding_debt"] for x in out),
        "total_limit": sum(x["credit_limit"] for x in out),
        "flagged": sum(1 for x in out if x["flagged"]),
    }
    pending = await db.admin_credit_requests.find(
        {"admin_id": {"$in": admin_ids}, "status": "PENDING"}, {"_id": 0}).sort("created_at", -1).to_list(200)
    for p in pending:
        p["admin_name"] = names.get(p["admin_id"], {}).get("display_name")
    return {"admins": out, "totals": totals, "pending_requests": pending}


async def list_ledger(caller: dict, admin_id: str) -> list:
    await _assert_upline(caller, admin_id)
    return await db.admin_credit_ledger.find({"admin_id": admin_id}, {"_id": 0}).sort("created_at", -1).to_list(200)
