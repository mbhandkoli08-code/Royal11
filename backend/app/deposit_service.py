"""Coin top-up / deposit flow (Part 1) + collection bank accounts (Part 1b).

Deposits are fully manual: a player transfers INR offline, submits an amount +
reference (UTR), and their assigned Admin explicitly CONFIRMS in-app — only then
are coins credited (idempotently, via wallet_service.credit). Coins are never
credited automatically.
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from . import ocr_service, storage_service, wallet_service
from .constants import INR_TO_COIN_RATIO
from .db import db
from .models import Role, TxnType

logger = logging.getLogger(__name__)


async def ensure_deposit_indexes() -> None:
    await db.deposits.create_index("player_id")
    await db.deposits.create_index("target_admin_id")
    await db.deposits.create_index("status")
    await db.deposits.create_index("reference_note")
    await db.deposits.create_index("account_id")
    # Multi-bank: an Admin/Manager may now hold several accounts (one active).
    # Drop the legacy unique(admin_id) index if it lingers from Part 1b.
    try:
        await db.admin_bank_accounts.drop_index("admin_id_1")
    except Exception:
        pass
    await db.admin_bank_accounts.create_index("admin_id")
    # Backfill: give legacy single-account docs a stable id + is_active flag.
    async for acc in db.admin_bank_accounts.find({"id": {"$exists": False}}, {"_id": 1}):
        await db.admin_bank_accounts.update_one(
            {"_id": acc["_id"]},
            {"$set": {"id": str(uuid.uuid4())}, "$setOnInsert": {}},
        )
    await db.admin_bank_accounts.update_many(
        {"is_active": {"$exists": False}}, {"$set": {"is_active": True}})
    await db.users.create_index("referral_code", unique=True, sparse=True)
    await db.settlements.create_index([("admin_id", 1), ("week_start", 1)], unique=True)
    await db.daily_summaries.create_index("date", unique=True)


async def _assigned_admin_id(player_id: str) -> Optional[str]:
    a = await db.player_assignments.find_one({"player_id": player_id}, {"_id": 0})
    return a["admin_id"] if a else None


async def get_profile_contact(user_id: str) -> dict:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "whatsapp_number": 1})
    return {"whatsapp_number": (u or {}).get("whatsapp_number")}


async def set_whatsapp_number(user_id: str, whatsapp_number: Optional[str]) -> dict:
    value = (whatsapp_number or "").strip() or None
    await db.users.update_one({"id": user_id}, {"$set": {"whatsapp_number": value}})
    return {"whatsapp_number": value}


async def get_active_bank_account(admin_id: Optional[str]) -> Optional[dict]:
    if not admin_id:
        return None
    return await db.admin_bank_accounts.find_one(
        {"admin_id": admin_id, "is_active": True}, {"_id": 0}
    )


async def deposit_info(player_id: str) -> dict:
    """What a player needs to make a top-up: their collection Admin + that
    Admin's active bank account (if entered) + the current INR→coin ratio."""
    admin_id = await _assigned_admin_id(player_id)
    admin = await db.users.find_one({"id": admin_id}, {"_id": 0}) if admin_id else None
    bank = await get_active_bank_account(admin_id)
    return {
        "admin_id": admin_id,
        "admin_name": admin["display_name"] if admin else None,
        "admin_whatsapp": admin.get("whatsapp_number") if admin else None,
        "bank_account": bank,
        "ratio": INR_TO_COIN_RATIO,
    }


async def my_agent(player_id: str) -> dict:
    """The player's assigned collection Admin + contact — used at signup and for
    payment help. Returns nulls gracefully when no agent/contact is set."""
    admin_id = await _assigned_admin_id(player_id)
    admin = await db.users.find_one({"id": admin_id}, {"_id": 0}) if admin_id else None
    return {
        "admin_id": admin_id,
        "admin_name": admin["display_name"] if admin else None,
        "admin_whatsapp": admin.get("whatsapp_number") if admin else None,
    }


async def create_deposit_request(
    player_id: str,
    amount_inr: int,
    reference_note: str,
    image_bytes: Optional[bytes] = None,
    content_type: Optional[str] = None,
    filename: Optional[str] = None,
) -> dict:
    admin_id = await _assigned_admin_id(player_id)
    if not admin_id:
        raise ValueError("No collection agent is assigned to your account yet. Please contact support.")

    created_at = datetime.now(timezone.utc).isoformat()

    # Record which bank account was active/shown at this moment (auto, not
    # picked at confirm time) so per-account reporting is exact.
    active_account = await get_active_bank_account(admin_id)

    # Fraud check: has this exact UTR/reference already been CONFIRMED before?
    dup = await db.deposits.find_one(
        {"reference_note": reference_note, "status": "CONFIRMED"}, {"_id": 0, "id": 1}
    )

    doc = {
        "id": str(uuid.uuid4()),
        "player_id": player_id,
        "target_admin_id": admin_id,
        "amount_inr": amount_inr,
        "reference_note": reference_note,
        "coins_to_credit": amount_inr * INR_TO_COIN_RATIO,
        "status": "PENDING",
        "confirmed_by": None,
        "confirmed_at": None,
        "confirm_note": None,
        "rejected_reason": None,
        "duplicate_utr": bool(dup),
        "account_id": active_account["id"] if active_account else None,
        "screenshot_path": None,
        "has_screenshot": False,
        "ocr": None,
        "created_at": created_at,
    }

    # Screenshot upload + OCR verification. Never let storage/OCR failures block
    # the request — the Admin can always review manually.
    if image_bytes:
        ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "png"
        path = f"{storage_service.APP_NAME}/deposits/{player_id}/{uuid.uuid4()}.{ext}"
        try:
            result = await storage_service.put_object(path, image_bytes, content_type or "image/png")
            doc["screenshot_path"] = result["path"]
            doc["has_screenshot"] = True
        except Exception as e:  # noqa: BLE001 — storage is best-effort here
            logger.error(f"Deposit screenshot upload failed: {type(e).__name__}")
        try:
            doc["ocr"] = await ocr_service.run_ocr_verification(
                image_bytes, amount_inr, reference_note, created_at
            )
        except Exception as e:  # noqa: BLE001
            logger.error(f"Deposit OCR failed: {type(e).__name__}")

    await db.deposits.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def confirm_deposit(deposit_id: str, admin_id: str, note: Optional[str]) -> dict:
    dep = await db.deposits.find_one({"id": deposit_id}, {"_id": 0})
    if not dep:
        raise ValueError("Deposit not found")
    if dep["target_admin_id"] != admin_id:
        raise PermissionError("This deposit is not addressed to you")
    if dep["status"] != "PENDING":
        raise ValueError(f"Deposit already {dep['status'].lower()}")

    # The single, explicit crediting step — idempotent on the deposit id so a
    # double-click / retry can never double-credit.
    await wallet_service.credit(
        dep["player_id"], TxnType.DEPOSIT_TOPUP, dep["coins_to_credit"],
        actor_id=admin_id, reason=f"Coin top-up (deposit {deposit_id})",
        request_id=f"deposit:{deposit_id}",
    )
    await db.deposits.update_one({"id": deposit_id}, {"$set": {
        "status": "CONFIRMED",
        "confirmed_by": admin_id,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "confirm_note": note,
    }})

    # Standing VIP recharge bonus — tier-based (never win-triggered). Granted as a
    # separate, non-withdrawable bonus (playthrough applies), idempotent per deposit.
    try:
        from . import bonus_service
        from .games import progression_service
        offer = await progression_service.get_recharge_offer(dep["player_id"])
        bonus_coins = progression_service.recharge_bonus_amount(dep["coins_to_credit"], offer)
        if bonus_coins > 0:
            await bonus_service.grant_bonus(
                dep["player_id"], "vip_recharge", bonus_coins,
                request_id=f"deposit_bonus:{deposit_id}", source_ref=deposit_id)
            await db.deposits.update_one({"id": deposit_id}, {"$set": {
                "vip_bonus_coins": bonus_coins, "vip_bonus_tier": offer["tier"]}})
    except Exception:
        pass  # bonus is best-effort; never blocks the core credit

    return await db.deposits.find_one({"id": deposit_id}, {"_id": 0})


async def reject_deposit(deposit_id: str, admin_id: str, reason: str) -> dict:
    dep = await db.deposits.find_one({"id": deposit_id}, {"_id": 0})
    if not dep:
        raise ValueError("Deposit not found")
    if dep["target_admin_id"] != admin_id:
        raise PermissionError("This deposit is not addressed to you")
    if dep["status"] != "PENDING":
        raise ValueError(f"Deposit already {dep['status'].lower()}")
    await db.deposits.update_one({"id": deposit_id}, {"$set": {
        "status": "REJECTED",
        "confirmed_by": admin_id,
        "confirmed_at": datetime.now(timezone.utc).isoformat(),
        "rejected_reason": reason,
    }})
    return await db.deposits.find_one({"id": deposit_id}, {"_id": 0})


async def _scope_query(caller: dict) -> dict:
    role = caller["role"]
    if role == Role.SUPER_ADMIN.value:
        return {}
    if role == Role.MANAGER.value:
        admin_ids = [a["user_id"] async for a in
                     db.admin_allocations.find({"manager_id": caller["id"]}, {"_id": 0, "user_id": 1})]
        return {"target_admin_id": {"$in": admin_ids}}
    return {"target_admin_id": caller["id"]}  # ADMIN


async def list_deposits(caller: dict, limit: int = 100) -> list[dict]:
    q = await _scope_query(caller)
    rows = [d async for d in db.deposits.find(q, {"_id": 0}).sort("created_at", -1).limit(limit)]
    cache: dict[str, dict] = {}

    async def name_of(uid: Optional[str]) -> Optional[str]:
        if not uid:
            return None
        if uid not in cache:
            cache[uid] = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
        return cache[uid].get("display_name")

    out = []
    for d in rows:
        out.append({
            **d,
            "player_name": await name_of(d.get("player_id")),
            "admin_name": await name_of(d.get("target_admin_id")),
        })
    return out


async def get_deposit_scoped(caller: dict, deposit_id: str) -> Optional[dict]:
    """Fetch a single deposit only if it's within the caller's scope."""
    q = await _scope_query(caller)
    q["id"] = deposit_id
    return await db.deposits.find_one(q, {"_id": 0})


def _week_start_iso() -> str:
    """Start of the current settlement week (Sunday 00:00 UTC)."""
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=(now.weekday() + 1) % 7)).replace(
        hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat()


async def _account_totals(account_ids: list[str]) -> dict[str, dict]:
    """Per-account CONFIRMED deposit totals: all-time + current week."""
    if not account_ids:
        return {}
    week_start = _week_start_iso()
    pipeline = [
        {"$match": {"account_id": {"$in": account_ids}, "status": "CONFIRMED"}},
        {"$group": {
            "_id": "$account_id",
            "all_time": {"$sum": "$amount_inr"},
            "week": {"$sum": {"$cond": [
                {"$gte": [{"$ifNull": ["$confirmed_at", ""]}, week_start]}, "$amount_inr", 0]}},
        }},
    ]
    out: dict[str, dict] = {}
    async for row in db.deposits.aggregate(pipeline):
        out[row["_id"]] = {"all_time": row["all_time"], "week": row["week"]}
    return out


async def list_bank_accounts(user_id: str) -> list[dict]:
    accounts = [a async for a in db.admin_bank_accounts.find({"admin_id": user_id}, {"_id": 0})]
    totals = await _account_totals([a["id"] for a in accounts if a.get("id")])
    for a in accounts:
        t = totals.get(a.get("id"), {"all_time": 0, "week": 0})
        a["confirmed_total_all_time"] = t["all_time"]
        a["confirmed_total_week"] = t["week"]
        a.setdefault("upi_id", None)
        a.setdefault("label", None)
    accounts.sort(key=lambda a: (not a.get("is_active"), a.get("created_at", "")))
    return accounts


async def create_bank_account(user_id: str, data: dict) -> dict:
    """First account for a user becomes active automatically; others start inactive."""
    has_any = await db.admin_bank_accounts.find_one({"admin_id": user_id}, {"_id": 0, "id": 1})
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()),
        "admin_id": user_id,
        "account_holder_name": data["account_holder_name"],
        "account_number": data["account_number"],
        "ifsc": data["ifsc"],
        "bank_name": data["bank_name"],
        "label": data.get("label") or None,
        "upi_id": data.get("upi_id") or None,
        "is_active": not has_any,
        "created_at": now,
        "updated_at": now,
    }
    await db.admin_bank_accounts.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def activate_bank_account(user_id: str, account_id: str) -> dict:
    acc = await db.admin_bank_accounts.find_one({"admin_id": user_id, "id": account_id}, {"_id": 0})
    if not acc:
        raise ValueError("Bank account not found")
    await db.admin_bank_accounts.update_many({"admin_id": user_id}, {"$set": {"is_active": False}})
    await db.admin_bank_accounts.update_one(
        {"admin_id": user_id, "id": account_id},
        {"$set": {"is_active": True, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"account_id": account_id, "is_active": True}
