import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, wallet_service
from ..audit import log_action
from ..db import db
from ..deps import get_current_user, require_roles
from ..models import (
    AllocateToAdminRequest,
    AssignPlayerRequest,
    CreateAdminRequest,
    CreateManagerRequest,
    FundManagerRequest,
    GrantToPlayerRequest,
    ReverseTransactionRequest,
    Role,
    TransactionOut,
    TxnType,
    UpdateManagerQuotaRequest,
    UserPublic,
    UserStatus,
)
from ..security import hash_password
from ..wallet_service import InsufficientFunds

router = APIRouter(prefix="/admin", tags=["admin"])


async def _create_user(*, email: str, password: str, display_name: str, role: Role,
                       created_by: str) -> dict:
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(password),
        "display_name": display_name,
        "role": role.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    await wallet_service.get_or_create_wallet(user["id"])
    return user


# ---------------------------------------------------------------------------
# Super Admin: create/manage Managers
# ---------------------------------------------------------------------------
@router.post("/managers", response_model=UserPublic,
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def create_manager(payload: CreateManagerRequest, caller: dict = Depends(get_current_user)):
    user = await _create_user(email=payload.email, password=payload.password,
                              display_name=payload.display_name, role=Role.MANAGER,
                              created_by=caller["id"])
    await db.manager_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "authorized_quota": payload.authorized_quota,
        "allocated_out": 0,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await log_action(caller["id"], "MANAGER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"authorized_quota": payload.authorized_quota})
    return UserPublic(**user)


@router.patch("/managers/{manager_id}/quota",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def update_manager_quota(manager_id: str, payload: UpdateManagerQuotaRequest,
                               caller: dict = Depends(get_current_user)):
    alloc = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0})
    if not alloc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")
    if payload.authorized_quota < alloc["allocated_out"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"New quota ({payload.authorized_quota}) is below what's already allocated out "
            f"({alloc['allocated_out']}) — raise it instead of shrinking below committed amounts.",
        )
    await db.manager_allocations.update_one(
        {"user_id": manager_id},
        {"$set": {"authorized_quota": payload.authorized_quota,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    await log_action(caller["id"], "MANAGER_QUOTA_UPDATED", target_type="user", target_id=manager_id,
                     metadata={"authorized_quota": payload.authorized_quota})
    return {"manager_id": manager_id, "authorized_quota": payload.authorized_quota}


@router.post("/managers/{manager_id}/fund",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def fund_manager(manager_id: str, payload: FundManagerRequest,
                       caller: dict = Depends(get_current_user)):
    """Credits real, spendable coins into a Manager's wallet. This is separate
    from authorized_quota (which only caps how much the Manager may push OUT to
    Admins) — a Manager can't actually allocate anything until Super Admin funds
    their wallet with real coins to move."""
    alloc = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0})
    if not alloc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")
    txn = await wallet_service.credit(
        manager_id, TxnType.SUPER_ADMIN_TO_MANAGER, payload.amount,
        actor_id=caller["id"], reason=payload.reason or "Super Admin funding",
        request_id=payload.request_id,
    )
    await log_action(caller["id"], "MANAGER_FUNDED", target_type="user", target_id=manager_id,
                     metadata={"amount": payload.amount})
    return TransactionOut(**txn)


# ---------------------------------------------------------------------------
# Super Admin or Manager: create Admins
# ---------------------------------------------------------------------------
@router.post("/admins", response_model=UserPublic,
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER))])
async def create_admin(payload: CreateAdminRequest, caller: dict = Depends(get_current_user)):
    if caller["role"] == Role.MANAGER.value:
        manager_id = caller["id"]
    else:
        if not payload.manager_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "manager_id is required when a Super Admin creates an Admin")
        manager = await db.manager_allocations.find_one({"user_id": payload.manager_id})
        if not manager:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")
        manager_id = payload.manager_id

    user = await _create_user(email=payload.email, password=payload.password,
                              display_name=payload.display_name, role=Role.ADMIN,
                              created_by=caller["id"])
    await db.admin_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "manager_id": manager_id,
        "player_capacity": payload.player_capacity,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await log_action(caller["id"], "ADMIN_CREATED", target_type="user", target_id=user["id"],
                     metadata={"manager_id": manager_id, "player_capacity": payload.player_capacity})
    return UserPublic(**user)


# ---------------------------------------------------------------------------
# Manager -> Admin coin allocation
# ---------------------------------------------------------------------------
@router.post("/allocate", dependencies=[Depends(require_roles(Role.MANAGER))])
async def allocate_to_admin(payload: AllocateToAdminRequest, caller: dict = Depends(get_current_user)):
    admin_alloc = await db.admin_allocations.find_one({"user_id": payload.admin_id}, {"_id": 0})
    if not admin_alloc or admin_alloc["manager_id"] != caller["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin not found under your management")

    # Atomically reserve the quota: only succeeds if allocated_out + amount
    # would still fit inside authorized_quota. This is the same
    # single-document-atomicity pattern as wallet_service — no separate
    # lock needed because it's one document being conditionally updated.
    manager_alloc = await db.manager_allocations.find_one_and_update(
        {"user_id": caller["id"], "authorized_quota": {"$gte": payload.amount}},
        [{"$set": {
            "allocated_out": {"$add": ["$allocated_out", payload.amount]},
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}],
        return_document=ReturnDocument.AFTER,
    )
    # The filter above only checks authorized_quota >= amount, not the
    # running total — re-check allocated_out <= authorized_quota after,
    # and roll back if this allocation pushed it over.
    if manager_alloc is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Allocation exceeds authorized quota")
    if manager_alloc["allocated_out"] > manager_alloc["authorized_quota"]:
        await db.manager_allocations.update_one(
            {"user_id": caller["id"]},
            {"$inc": {"allocated_out": -payload.amount}},
        )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Allocation exceeds authorized quota")

    try:
        debit_txn, credit_txn = await wallet_service.transfer(
            caller["id"], payload.admin_id, TxnType.MANAGER_TO_ADMIN, payload.amount,
            actor_id=caller["id"], reason=f"Allocation to admin {payload.admin_id}",
            request_id=payload.request_id,
        )
    except InsufficientFunds:
        await db.manager_allocations.update_one(
            {"user_id": caller["id"]}, {"$inc": {"allocated_out": -payload.amount}}
        )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Manager wallet balance is behind the authorized quota — Super Admin needs to credit "
            "the manager's wallet before it can be allocated out.",
        )

    await log_action(caller["id"], "COIN_ALLOCATED", target_type="user", target_id=payload.admin_id,
                     metadata={"amount": payload.amount})
    return {"debit": TransactionOut(**debit_txn), "credit": TransactionOut(**credit_txn)}


# ---------------------------------------------------------------------------
# Admin -> Player coin grant
# ---------------------------------------------------------------------------
@router.post("/grant", dependencies=[Depends(require_roles(Role.ADMIN))])
async def grant_to_player(payload: GrantToPlayerRequest, caller: dict = Depends(get_current_user)):
    assignment = await db.player_assignments.find_one({"player_id": payload.player_id}, {"_id": 0})
    if not assignment or assignment["admin_id"] != caller["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player is not assigned to you")

    try:
        debit_txn, credit_txn = await wallet_service.transfer(
            caller["id"], payload.player_id, TxnType.ADMIN_GRANT, payload.amount,
            actor_id=caller["id"], reason=payload.reason or "Admin grant", request_id=payload.request_id,
        )
    except InsufficientFunds:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "Your available balance is less than the grant amount")

    await log_action(caller["id"], "COIN_GRANTED", target_type="user", target_id=payload.player_id,
                     metadata={"amount": payload.amount, "reason": payload.reason})
    return {"debit": TransactionOut(**debit_txn), "credit": TransactionOut(**credit_txn)}


# ---------------------------------------------------------------------------
# Player assignment
# ---------------------------------------------------------------------------
@router.post("/players/assign", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER))])
async def assign_player(payload: AssignPlayerRequest, caller: dict = Depends(get_current_user)):
    admin_alloc = await db.admin_allocations.find_one({"user_id": payload.admin_id}, {"_id": 0})
    if not admin_alloc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin not found")
    if caller["role"] == Role.MANAGER.value and admin_alloc["manager_id"] != caller["id"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "That Admin is not under your management")

    current_count = await db.player_assignments.count_documents({"admin_id": payload.admin_id})
    existing = await db.player_assignments.find_one({"player_id": payload.player_id}, {"_id": 0})
    already_this_admin = existing and existing["admin_id"] == payload.admin_id
    if not already_this_admin and current_count >= admin_alloc["player_capacity"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Admin is at player capacity")

    doc = await assignment_service.assign_player(payload.player_id, payload.admin_id,
                                                 changed_by_id=caller["id"], reason=payload.reason)
    await log_action(caller["id"], "PLAYER_REASSIGNED", target_type="user", target_id=payload.player_id,
                     metadata={"admin_id": payload.admin_id, "reason": payload.reason})
    return doc


@router.get("/my-players", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_players(caller: dict = Depends(get_current_user)):
    cursor = db.player_assignments.find({"admin_id": caller["id"]}, {"_id": 0})
    assignments = [a async for a in cursor]
    players = []
    for a in assignments:
        user = await db.users.find_one({"id": a["player_id"]}, {"_id": 0})
        wallet = await db.wallets.find_one({"user_id": a["player_id"]}, {"_id": 0})
        if user:
            players.append({
                "player": UserPublic(**user),
                "balance": wallet["balance"] if wallet else 0,
                "assigned_at": a["assigned_at"],
            })
    return players


# ---------------------------------------------------------------------------
# Reversal — corrections never delete history
# ---------------------------------------------------------------------------
@router.post("/transactions/{transaction_id}/reverse",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER, Role.ADMIN))])
async def reverse_transaction(transaction_id: str, payload: ReverseTransactionRequest,
                              caller: dict = Depends(get_current_user)):
    try:
        txn = await wallet_service.reverse(transaction_id, actor_id=caller["id"], reason=payload.reason)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    except InsufficientFunds:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot reverse: the account no longer has enough balance to claw back the credit.",
        )
    await log_action(caller["id"], "COIN_REVERSED", target_type="ledger_transaction",
                     target_id=transaction_id, metadata={"reason": payload.reason})
    return TransactionOut(**txn)


# ---------------------------------------------------------------------------
# Read-only console endpoints (additive; no coin logic changed)
# ---------------------------------------------------------------------------
async def _wallet_balance(user_id: str) -> int:
    w = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    return w["balance"] if w else 0


@router.get("/managers", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_managers():
    out = []
    async for alloc in db.manager_allocations.find({}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        admin_count = await db.admin_allocations.count_documents({"manager_id": alloc["user_id"]})
        quota = alloc.get("authorized_quota", 0)
        allocated = alloc.get("allocated_out", 0)
        out.append({
            "user": UserPublic(**u),
            "authorized_quota": quota,
            "allocated_out": allocated,
            "remaining": quota - allocated,
            "usage_pct": round((allocated / quota) * 100) if quota else 0,
            "admin_count": admin_count,
            "wallet_balance": await _wallet_balance(alloc["user_id"]),
        })
    out.sort(key=lambda m: m["user"].created_at, reverse=True)
    return out


async def _admin_flows(user_id: str) -> tuple[int, int]:
    """Real coin flows for an Admin from the ledger: total received from their
    Manager, and total granted out to players."""
    allocated = 0
    used = 0
    async for t in db.ledger_transactions.find(
        {"user_id": user_id, "status": "COMPLETED"}, {"_id": 0, "type": 1, "amount": 1}
    ):
        if t["type"] == TxnType.MANAGER_TO_ADMIN.value and t["amount"] > 0:
            allocated += t["amount"]
        elif t["type"] == TxnType.ADMIN_GRANT.value and t["amount"] < 0:
            used += -t["amount"]
    return allocated, used


@router.get("/admins", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_admins():
    out = []
    async for alloc in db.admin_allocations.find({}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        mgr = await db.users.find_one({"id": alloc.get("manager_id")}, {"_id": 0})
        allocated, used = await _admin_flows(alloc["user_id"])
        player_count = await db.player_assignments.count_documents({"admin_id": alloc["user_id"]})
        out.append({
            "user": UserPublic(**u),
            "manager_id": alloc.get("manager_id"),
            "manager_name": mgr["display_name"] if mgr else "—",
            "player_capacity": alloc.get("player_capacity", 0),
            "player_count": player_count,
            "allocated": allocated,
            "used": used,
            "remaining": await _wallet_balance(alloc["user_id"]),
            "usage_pct": round((used / allocated) * 100) if allocated else 0,
            "wallet_balance": await _wallet_balance(alloc["user_id"]),
        })
    out.sort(key=lambda a: a["user"].created_at, reverse=True)
    return out


@router.get("/overview", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def overview():
    """Super Admin dashboard — every number computed from real DB state. No
    fabricated charts/metrics (usage graphs, DAU, alerts) are returned here;
    the frontend shows honest 'coming soon' placeholders for those instead."""
    managers = [m async for m in db.manager_allocations.find({}, {"_id": 0})]
    admins = [a async for a in db.admin_allocations.find({}, {"_id": 0})]
    player_count = await db.users.count_documents({"role": Role.PLAYER.value})

    coins_in_circulation = 0
    async for w in db.wallets.find({}, {"_id": 0, "balance": 1}):
        coins_in_circulation += w.get("balance", 0)

    coins_allocated = sum(m.get("allocated_out", 0) for m in managers)
    total_quota = sum(m.get("authorized_quota", 0) for m in managers)
    coins_remaining = total_quota - coins_allocated

    admins_by_manager: dict[str, list] = {}
    for a in admins:
        admins_by_manager.setdefault(a.get("manager_id"), []).append(a["user_id"])

    players_per_admin: dict[str, int] = {}
    async for pa in db.player_assignments.find({}, {"_id": 0, "admin_id": 1}):
        players_per_admin[pa["admin_id"]] = players_per_admin.get(pa["admin_id"], 0) + 1

    manager_rows = []
    for m in managers:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0})
        if not u:
            continue
        admin_ids = admins_by_manager.get(m["user_id"], [])
        player_total = sum(players_per_admin.get(aid, 0) for aid in admin_ids)
        quota = m.get("authorized_quota", 0)
        allocated = m.get("allocated_out", 0)
        manager_rows.append({
            "id": m["user_id"],
            "name": u["display_name"],
            "status": u.get("status", UserStatus.ACTIVE.value),
            "authorized_quota": quota,
            "allocated_out": allocated,
            "usage_pct": round((allocated / quota) * 100) if quota else 0,
            "admin_count": len(admin_ids),
            "player_count": player_total,
            "wallet_balance": await _wallet_balance(m["user_id"]),
        })
    manager_rows.sort(key=lambda r: r["allocated_out"], reverse=True)

    return {
        "totals": {
            "managers": len(managers),
            "admins": len(admins),
            "players": player_count,
            "coins_in_circulation": coins_in_circulation,
            "coins_allocated": coins_allocated,
            "coins_remaining": coins_remaining,
        },
        "managers": manager_rows,
    }


@router.get("/transactions", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_transactions(limit: int = 50, skip: int = 0, type: Optional[str] = None):
    """Paginated ledger feed with the player -> admin -> manager chain resolved
    per row (honestly — '—' where a link doesn't exist)."""
    limit = max(1, min(limit, 200))
    skip = max(0, skip)
    query: dict = {}
    if type:
        query["type"] = type
    total = await db.ledger_transactions.count_documents(query)
    cursor = db.ledger_transactions.find(query, {"_id": 0}).sort("created_at", -1).skip(skip).limit(limit)
    rows = [t async for t in cursor]

    user_cache: dict[str, dict] = {}

    async def get_user(uid: Optional[str]) -> dict:
        if not uid:
            return {}
        if uid not in user_cache:
            user_cache[uid] = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
        return user_cache[uid]

    items = []
    for t in rows:
        uid = t.get("user_id")
        u = await get_user(uid)
        role = u.get("role")
        player_name = admin_name = manager_name = None
        if role == Role.PLAYER.value:
            player_name = u.get("display_name")
            pa = await db.player_assignments.find_one({"player_id": uid}, {"_id": 0})
            if pa:
                admin_name = (await get_user(pa["admin_id"])).get("display_name")
                aa = await db.admin_allocations.find_one({"user_id": pa["admin_id"]}, {"_id": 0})
                if aa:
                    manager_name = (await get_user(aa.get("manager_id"))).get("display_name")
        elif role == Role.ADMIN.value:
            admin_name = u.get("display_name")
            aa = await db.admin_allocations.find_one({"user_id": uid}, {"_id": 0})
            if aa:
                manager_name = (await get_user(aa.get("manager_id"))).get("display_name")
        elif role == Role.MANAGER.value:
            manager_name = u.get("display_name")

        items.append({
            "id": t["id"],
            "type": t.get("type"),
            "amount": t.get("amount"),
            "balance_after": t.get("balance_after"),
            "status": t.get("status"),
            "reason": t.get("reason"),
            "created_at": t.get("created_at"),
            "user_id": uid,
            "user_name": u.get("display_name", "—"),
            "user_role": role or "—",
            "player_name": player_name,
            "admin_name": admin_name,
            "manager_name": manager_name,
        })
    return {"items": items, "total": total, "skip": skip, "limit": limit}


@router.get("/my-allocation", dependencies=[Depends(require_roles(Role.MANAGER))])
async def my_allocation(caller: dict = Depends(get_current_user)):
    alloc = await db.manager_allocations.find_one({"user_id": caller["id"]}, {"_id": 0}) or {}
    return {
        "authorized_quota": alloc.get("authorized_quota", 0),
        "allocated_out": alloc.get("allocated_out", 0),
        "available_quota": alloc.get("authorized_quota", 0) - alloc.get("allocated_out", 0),
        "wallet_balance": await _wallet_balance(caller["id"]),
    }


@router.get("/my-admins", dependencies=[Depends(require_roles(Role.MANAGER))])
async def my_admins(caller: dict = Depends(get_current_user)):
    out = []
    async for alloc in db.admin_allocations.find({"manager_id": caller["id"]}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        allocated, used = await _admin_flows(alloc["user_id"])
        player_count = await db.player_assignments.count_documents({"admin_id": alloc["user_id"]})
        out.append({
            "user": UserPublic(**u),
            "player_capacity": alloc.get("player_capacity", 0),
            "player_count": player_count,
            "allocated": allocated,
            "used": used,
            "usage_pct": round((used / allocated) * 100) if allocated else 0,
            "wallet_balance": await _wallet_balance(alloc["user_id"]),
        })
    out.sort(key=lambda a: a["user"].created_at, reverse=True)
    return out


@router.get("/players", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER))])
async def list_players():
    """Players + their current admin assignment (for the assignment UI)."""
    out = []
    async for u in db.users.find({"role": Role.PLAYER.value}, {"_id": 0}):
        assign = await db.player_assignments.find_one({"player_id": u["id"]}, {"_id": 0})
        out.append({
            "user": UserPublic(**u),
            "assigned_admin_id": assign["admin_id"] if assign else None,
            "wallet_balance": await _wallet_balance(u["id"]),
        })
    out.sort(key=lambda p: p["user"].created_at, reverse=True)
    return out
