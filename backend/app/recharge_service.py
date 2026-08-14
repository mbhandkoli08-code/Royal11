"""Admin self-recharge (Part 5). An Admin pays the Super Admin directly (real
money, manual bank transfer) to top up their OWN coin quota — separate from the
Manager→Admin allocation flow. On confirm, coins are credited at a 1.5x bonus
rate via the same idempotent wallet_service.credit pattern, and any
coins-exhausted suspension is lifted (recharge counts as allocation).
"""
import uuid
from datetime import datetime, timezone

from . import revenue_service, wallet_service
from .constants import ADMIN_RECHARGE_BONUS_RATE
from .db import db
from .models import TxnType


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_recharge_request(admin_id: str, amount_inr: int, reference_note: str) -> dict:
    doc = {
        "id": str(uuid.uuid4()),
        "admin_id": admin_id,
        "amount_inr": amount_inr,
        "reference_note": reference_note,
        "coins_credited": int(round(amount_inr * ADMIN_RECHARGE_BONUS_RATE)),
        "bonus_rate": ADMIN_RECHARGE_BONUS_RATE,
        "status": "PENDING",
        "confirmed_by": None,
        "confirmed_at": None,
        "rejected_reason": None,
        "created_at": _now_iso(),
    }
    await db.admin_recharges.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_recharges(limit: int = 100) -> list[dict]:
    rows = [r async for r in db.admin_recharges.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)]
    cache: dict[str, str] = {}
    for r in rows:
        aid = r["admin_id"]
        if aid not in cache:
            u = await db.users.find_one({"id": aid}, {"_id": 0, "display_name": 1})
            cache[aid] = (u or {}).get("display_name", "—")
        r["admin_name"] = cache[aid]
    return rows


async def confirm_recharge(recharge_id: str, super_admin_id: str) -> dict:
    r = await db.admin_recharges.find_one({"id": recharge_id}, {"_id": 0})
    if not r:
        raise ValueError("Recharge not found")
    if r["status"] != "PENDING":
        raise ValueError(f"Recharge already {r['status'].lower()}")

    await wallet_service.credit(
        r["admin_id"], TxnType.ADMIN_RECHARGE, r["coins_credited"],
        actor_id=super_admin_id, reason=f"Admin self-recharge (₹{r['amount_inr']} @ {r['bonus_rate']}x)",
        request_id=f"admin_recharge:{recharge_id}",
    )
    await db.admin_recharges.update_one({"id": recharge_id}, {"$set": {
        "status": "CONFIRMED", "confirmed_by": super_admin_id, "confirmed_at": _now_iso(),
    }})
    # Settle outstanding credit-line debt FIRST from this self-recharge top-up.
    try:
        from . import admin_credit_service
        await admin_credit_service.repay_from_topup(r["admin_id"], r["coins_credited"])
    except Exception:
        pass
    # Fresh quota may lift a coins-exhausted suspension.
    await revenue_service.sync_admin_usage_suspension(r["admin_id"])
    return await db.admin_recharges.find_one({"id": recharge_id}, {"_id": 0})


async def reject_recharge(recharge_id: str, super_admin_id: str, reason: str) -> dict:
    r = await db.admin_recharges.find_one({"id": recharge_id}, {"_id": 0})
    if not r:
        raise ValueError("Recharge not found")
    if r["status"] != "PENDING":
        raise ValueError(f"Recharge already {r['status'].lower()}")
    await db.admin_recharges.update_one({"id": recharge_id}, {"$set": {
        "status": "REJECTED", "confirmed_by": super_admin_id,
        "confirmed_at": _now_iso(), "rejected_reason": reason,
    }})
    return await db.admin_recharges.find_one({"id": recharge_id}, {"_id": 0})
