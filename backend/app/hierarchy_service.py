"""Zonal Manager tier + Admin-creation approval workflow + per-Manager admin cap.

Hierarchy: SUPER_ADMIN -> ZONAL_MANAGER -> MANAGER -> ADMIN -> PLAYER.
A Manager's `zonal_manager_id` is nullable: null = reports straight to the Super
Admin (fully backward-compatible with pre-existing Managers).

Funding chain (mirrors the proven Manager->Admin mechanics):
  - Super Admin MINTS coins into a Zonal Manager's wallet (SUPER_ADMIN_TO_ZONAL)
    and sets the ZM's authorized_quota.
  - A Zonal Manager TRANSFERS coins to a Manager in their zone (ZONAL_TO_MANAGER),
    reserving atomically against the ZM's own quota.
  - Managers with no zone keep being funded directly by the Super Admin (unchanged).

Admins are no longer created directly by Managers — a Manager submits an
`admin_creation_requests` (PENDING) that their Zonal Manager (or the Super Admin
if the Manager has no zone) approves. The Admin account is created only on
approval, idempotently.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo import ReturnDocument

from . import wallet_service
from .constants import DEFAULT_SUPER_ADMIN_PCT
from .db import db
from .models import Role, TxnType, UserStatus
from .security import hash_password
from .wallet_service import InsufficientFunds


async def ensure_hierarchy_indexes() -> None:
    await db.zonal_manager_allocations.create_index("user_id", unique=True)
    await db.manager_allocations.create_index("zonal_manager_id")
    await db.admin_creation_requests.create_index("manager_id")
    await db.admin_creation_requests.create_index("zonal_manager_id")
    await db.admin_creation_requests.create_index("status")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _wallet_balance(user_id: str) -> int:
    w = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    return w["balance"] if w else 0


async def _insert_user(*, email: str, password: str, display_name: str, role: Role,
                       created_by: str) -> dict:
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise ValueError("Email already registered")
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(password),
        "display_name": display_name,
        "role": role.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": created_by,
        "created_at": _now(),
    }
    await db.users.insert_one(user)
    await wallet_service.get_or_create_wallet(user["id"])
    return user


# ---------------------------------------------------------------------------
# Zonal Manager CRUD + funding (Super Admin)
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Manager creation (shared by Super Admin and Zonal Manager paths)
# ---------------------------------------------------------------------------
async def create_manager(created_by: str, email: str, password: str, display_name: str,
                         authorized_quota: int, zonal_manager_id: Optional[str] = None) -> dict:
    if zonal_manager_id:
        if not await db.zonal_manager_allocations.find_one({"user_id": zonal_manager_id}, {"_id": 0, "id": 1}):
            raise ValueError("Zonal Manager not found")
    user = await _insert_user(email=email, password=password, display_name=display_name,
                              role=Role.MANAGER, created_by=created_by)
    await db.manager_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "authorized_quota": authorized_quota,
        "allocated_out": 0,
        "zonal_manager_id": zonal_manager_id,
        "max_admins_allowed": None,
        "updated_at": _now(),
    })
    return user


async def create_zonal_manager(caller_id: str, email: str, password: str,
                               display_name: str, authorized_quota: int) -> dict:
    user = await _insert_user(email=email, password=password, display_name=display_name,
                              role=Role.ZONAL_MANAGER, created_by=caller_id)
    await db.zonal_manager_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "authorized_quota": authorized_quota,
        "allocated_out": 0,
        "updated_at": _now(),
    })
    return user


async def list_zonal_managers() -> list[dict]:
    out = []
    async for alloc in db.zonal_manager_allocations.find({}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        quota = alloc.get("authorized_quota", 0)
        allocated = alloc.get("allocated_out", 0)
        manager_count = await db.manager_allocations.count_documents({"zonal_manager_id": alloc["user_id"]})
        out.append({
            "user": u,
            "authorized_quota": quota,
            "allocated_out": allocated,
            "remaining": quota - allocated,
            "usage_pct": round((allocated / quota) * 100) if quota else 0,
            "manager_count": manager_count,
            "wallet_balance": await _wallet_balance(alloc["user_id"]),
            "weekly_salary_inr": alloc.get("weekly_salary_inr", 0),
            "incentive_target_inr": alloc.get("incentive_target_inr", 0),
            "incentive_pct": alloc.get("incentive_pct", 0),
        })
    out.sort(key=lambda z: z["user"].get("created_at", ""), reverse=True)
    return out


async def set_zonal_quota(zm_id: str, authorized_quota: int) -> dict:
    alloc = await db.zonal_manager_allocations.find_one({"user_id": zm_id}, {"_id": 0})
    if not alloc:
        raise ValueError("Zonal Manager not found")
    if authorized_quota < alloc["allocated_out"]:
        raise ValueError(
            f"New quota ({authorized_quota}) is below what's already allocated out "
            f"({alloc['allocated_out']}).")
    await db.zonal_manager_allocations.update_one(
        {"user_id": zm_id},
        {"$set": {"authorized_quota": authorized_quota, "updated_at": _now()}},
    )
    return {"zonal_manager_id": zm_id, "authorized_quota": authorized_quota}


async def fund_zonal(zm_id: str, amount: int, actor_id: str, reason: Optional[str],
                     request_id: Optional[str]) -> dict:
    if not await db.zonal_manager_allocations.find_one({"user_id": zm_id}, {"_id": 0, "id": 1}):
        raise ValueError("Zonal Manager not found")
    return await wallet_service.credit(
        zm_id, TxnType.SUPER_ADMIN_TO_ZONAL, amount,
        actor_id=actor_id, reason=reason or "Super Admin funding (zonal)", request_id=request_id,
    )


# ---------------------------------------------------------------------------
# Zonal Manager: view + fund their own Managers
# ---------------------------------------------------------------------------
async def zonal_my_allocation(zm_id: str) -> dict:
    alloc = await db.zonal_manager_allocations.find_one({"user_id": zm_id}, {"_id": 0}) or {}
    return {
        "authorized_quota": alloc.get("authorized_quota", 0),
        "allocated_out": alloc.get("allocated_out", 0),
        "available_quota": alloc.get("authorized_quota", 0) - alloc.get("allocated_out", 0),
        "wallet_balance": await _wallet_balance(zm_id),
    }


async def _enrich_manager(alloc: dict) -> Optional[dict]:
    u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
    if not u:
        return None
    quota = alloc.get("authorized_quota", 0)
    allocated = alloc.get("allocated_out", 0)
    admin_count = await db.admin_allocations.count_documents({"manager_id": alloc["user_id"]})
    pending = await db.admin_creation_requests.count_documents(
        {"manager_id": alloc["user_id"], "status": "PENDING"})
    return {
        "user": u,
        "zonal_manager_id": alloc.get("zonal_manager_id"),
        "authorized_quota": quota,
        "allocated_out": allocated,
        "remaining": quota - allocated,
        "usage_pct": round((allocated / quota) * 100) if quota else 0,
        "admin_count": admin_count,
        "pending_admin_requests": pending,
        "max_admins_allowed": alloc.get("max_admins_allowed"),
        "wallet_balance": await _wallet_balance(alloc["user_id"]),
        "weekly_salary_inr": alloc.get("weekly_salary_inr", 0),
        "incentive_target_inr": alloc.get("incentive_target_inr", 0),
        "incentive_pct": alloc.get("incentive_pct", 0),
    }


async def zonal_my_managers(zm_id: str) -> list[dict]:
    out = []
    async for alloc in db.manager_allocations.find({"zonal_manager_id": zm_id}, {"_id": 0}):
        row = await _enrich_manager(alloc)
        if row:
            out.append(row)
    out.sort(key=lambda m: m["user"].get("created_at", ""), reverse=True)
    return out


async def zonal_fund_manager(zm_id: str, manager_id: str, amount: int,
                             request_id: Optional[str]) -> dict:
    """ZM -> Manager transfer, reserving atomically against the ZM's quota
    (same pattern as Manager -> Admin allocation)."""
    mgr = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0})
    if not mgr or mgr.get("zonal_manager_id") != zm_id:
        raise PermissionError("That Manager is not in your zone")

    zonal = await db.zonal_manager_allocations.find_one_and_update(
        {"user_id": zm_id, "authorized_quota": {"$gte": amount}},
        [{"$set": {
            "allocated_out": {"$add": ["$allocated_out", amount]},
            "updated_at": _now(),
        }}],
        return_document=ReturnDocument.AFTER,
    )
    if zonal is None or zonal["allocated_out"] > zonal["authorized_quota"]:
        if zonal is not None:
            await db.zonal_manager_allocations.update_one(
                {"user_id": zm_id}, {"$inc": {"allocated_out": -amount}})
        raise ValueError("Allocation exceeds your authorized quota")

    try:
        debit_txn, credit_txn = await wallet_service.transfer(
            zm_id, manager_id, TxnType.ZONAL_TO_MANAGER, amount,
            actor_id=zm_id, reason=f"Zonal funding to manager {manager_id}",
            request_id=request_id,
        )
    except InsufficientFunds:
        await db.zonal_manager_allocations.update_one(
            {"user_id": zm_id}, {"$inc": {"allocated_out": -amount}})
        raise ValueError("Your wallet balance is behind your authorized quota — "
                         "ask the Super Admin to fund your wallet first.")
    return {"debit": debit_txn, "credit": credit_txn}


# ---------------------------------------------------------------------------
# Admin-creation approval workflow + per-Manager cap
# ---------------------------------------------------------------------------
async def admin_cap_state(manager_id: str) -> dict:
    alloc = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0}) or {}
    cap = alloc.get("max_admins_allowed")
    existing = await db.admin_allocations.count_documents({"manager_id": manager_id})
    pending = await db.admin_creation_requests.count_documents(
        {"manager_id": manager_id, "status": "PENDING"})
    return {"cap": cap, "existing": existing, "pending": pending}


async def set_max_admins(caller: dict, manager_id: str, max_admins_allowed: Optional[int]) -> dict:
    alloc = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0})
    if not alloc:
        raise ValueError("Manager not found")
    # A Zonal Manager may only set caps on Managers in their own zone.
    if caller["role"] == Role.ZONAL_MANAGER.value and alloc.get("zonal_manager_id") != caller["id"]:
        raise PermissionError("That Manager is not in your zone")
    if max_admins_allowed is not None:
        state = await admin_cap_state(manager_id)
        floor = state["existing"] + state["pending"]
        if max_admins_allowed < floor:
            raise ValueError(
                f"Cap ({max_admins_allowed}) is below current admins + pending requests ({floor}).")
    await db.manager_allocations.update_one(
        {"user_id": manager_id},
        {"$set": {"max_admins_allowed": max_admins_allowed, "updated_at": _now()}},
    )
    return {"manager_id": manager_id, "max_admins_allowed": max_admins_allowed}


async def submit_admin_request(manager_id: str, email: str, password: str,
                               display_name: str, player_capacity: int) -> dict:
    if await db.users.find_one({"email": email}, {"_id": 0, "id": 1}):
        raise ValueError("Email already registered")
    mgr = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0})
    if not mgr:
        raise ValueError("Manager allocation not found")

    state = await admin_cap_state(manager_id)
    if state["cap"] is not None and (state["existing"] + state["pending"]) >= state["cap"]:
        raise ValueError(
            f"Admin cap reached ({state['cap']}). You have {state['existing']} admin(s) and "
            f"{state['pending']} pending request(s). Ask your Zonal Manager / Super Admin to raise the cap.")

    doc = {
        "id": str(uuid.uuid4()),
        "manager_id": manager_id,
        "zonal_manager_id": mgr.get("zonal_manager_id"),  # snapshot of approval authority
        "email": email,
        "password_hash": hash_password(password),  # never store plaintext
        "display_name": display_name,
        "player_capacity": player_capacity,
        "status": "PENDING",
        "created_at": _now(),
        "decided_by": None,
        "decided_at": None,
        "reject_reason": None,
        "created_admin_id": None,
    }
    await db.admin_creation_requests.insert_one(doc)
    return {k: v for k, v in doc.items() if k not in ("password_hash", "_id")}


def _scope_requests_query(caller: dict) -> dict:
    role = caller["role"]
    if role == Role.SUPER_ADMIN.value:
        return {}
    if role == Role.ZONAL_MANAGER.value:
        return {"zonal_manager_id": caller["id"]}
    return {"manager_id": caller["id"]}  # MANAGER sees own


async def list_admin_requests(caller: dict, limit: int = 100) -> list[dict]:
    q = _scope_requests_query(caller)
    rows = [r async for r in db.admin_creation_requests.find(q, {"_id": 0, "password_hash": 0})
            .sort("created_at", -1).limit(limit)]
    cache: dict[str, dict] = {}

    async def name_of(uid: Optional[str]) -> Optional[str]:
        if not uid:
            return None
        if uid not in cache:
            cache[uid] = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
        return cache[uid].get("display_name")

    for r in rows:
        r["manager_name"] = await name_of(r.get("manager_id"))
        r["zonal_manager_name"] = await name_of(r.get("zonal_manager_id"))
    return rows


async def _can_decide(caller: dict, req: dict) -> bool:
    if caller["role"] == Role.SUPER_ADMIN.value:
        return True
    if caller["role"] == Role.ZONAL_MANAGER.value:
        return req.get("zonal_manager_id") == caller["id"]
    return False


async def approve_admin_request(request_id: str, caller: dict) -> dict:
    req = await db.admin_creation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    if not await _can_decide(caller, req):
        raise PermissionError("You are not the approver for this request")
    if req["status"] != "PENDING":
        raise ValueError(f"Request already {req['status'].lower()}")

    # Re-check the cap at approval time (it may have been lowered since submission).
    state = await admin_cap_state(req["manager_id"])
    if state["cap"] is not None and state["existing"] >= state["cap"]:
        raise ValueError(
            f"Cannot approve: the Manager is already at the admin cap ({state['cap']}).")

    if await db.users.find_one({"email": req["email"]}, {"_id": 0, "id": 1}):
        raise ValueError("A user with this email already exists")

    # Idempotent create: build the Admin account + allocation.
    admin = {
        "id": str(uuid.uuid4()),
        "email": req["email"],
        "password_hash": req["password_hash"],  # reuse the hash captured at submission
        "display_name": req["display_name"],
        "role": Role.ADMIN.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": caller["id"],
        "created_at": _now(),
    }
    await db.users.insert_one(admin)
    await wallet_service.get_or_create_wallet(admin["id"])
    await db.admin_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": admin["id"],
        "manager_id": req["manager_id"],
        "player_capacity": req["player_capacity"],
        "revenue_split_super_admin_pct": DEFAULT_SUPER_ADMIN_PCT,
        "created_at": _now(),
        "updated_at": _now(),
    })
    await db.admin_creation_requests.update_one({"id": request_id}, {"$set": {
        "status": "APPROVED", "decided_by": caller["id"], "decided_at": _now(),
        "created_admin_id": admin["id"],
    }})
    return {"request_id": request_id, "status": "APPROVED", "admin_id": admin["id"]}


async def reject_admin_request(request_id: str, caller: dict, reason: Optional[str]) -> dict:
    req = await db.admin_creation_requests.find_one({"id": request_id}, {"_id": 0})
    if not req:
        raise ValueError("Request not found")
    if not await _can_decide(caller, req):
        raise PermissionError("You are not the approver for this request")
    if req["status"] != "PENDING":
        raise ValueError(f"Request already {req['status'].lower()}")
    await db.admin_creation_requests.update_one({"id": request_id}, {"$set": {
        "status": "REJECTED", "decided_by": caller["id"], "decided_at": _now(),
        "reject_reason": reason,
    }})
    return {"request_id": request_id, "status": "REJECTED"}
