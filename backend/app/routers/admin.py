import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, deposit_service, hierarchy_service, recharge_service, revenue_service, storage_service, wallet_service
from ..audit import log_action
from ..constants import ADMIN_RECHARGE_BONUS_RATE, DEFAULT_SUPER_ADMIN_PCT
from ..db import db
from ..deps import get_current_user, require_not_suspended, require_roles
from ..models import (
    AdminRechargeCreate,
    AllocateToAdminRequest,
    AssignPlayerRequest,
    BankAccountInput,
    WhatsappRequest,
    ConfirmDepositRequest,
    CreateAdminRequest,
    CreateManagerRequest,
    FundManagerRequest,
    GrantToPlayerRequest,
    RejectDepositRequest,
    ReverseTransactionRequest,
    RevenueSplitRequest,
    Role,
    SettleRequest,
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
    try:
        user = await hierarchy_service.create_manager(
            caller["id"], payload.email, payload.password, payload.display_name,
            payload.authorized_quota, zonal_manager_id=payload.zonal_manager_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "MANAGER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"authorized_quota": payload.authorized_quota,
                               "zonal_manager_id": payload.zonal_manager_id})
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
# Super Admin: create Admins directly (Managers now use the approval workflow
# in routers/zonal.py: POST /admin/admin-requests -> approve).
# ---------------------------------------------------------------------------
@router.post("/admins", response_model=UserPublic,
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def create_admin(payload: CreateAdminRequest, caller: dict = Depends(get_current_user)):
    if not payload.manager_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "manager_id is required when a Super Admin creates an Admin")
    manager = await db.manager_allocations.find_one({"user_id": payload.manager_id})
    if not manager:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Manager not found")

    # Respect the Manager's admin cap even for a direct Super Admin create.
    state = await hierarchy_service.admin_cap_state(payload.manager_id)
    if state["cap"] is not None and state["existing"] >= state["cap"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Manager is at the admin cap ({state['cap']}).")

    user = await _create_user(email=payload.email, password=payload.password,
                              display_name=payload.display_name, role=Role.ADMIN,
                              created_by=caller["id"])
    await db.admin_allocations.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "manager_id": payload.manager_id,
        "player_capacity": payload.player_capacity,
        "revenue_split_super_admin_pct": DEFAULT_SUPER_ADMIN_PCT,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    await log_action(caller["id"], "ADMIN_CREATED", target_type="user", target_id=user["id"],
                     metadata={"manager_id": payload.manager_id, "player_capacity": payload.player_capacity})
    return UserPublic(**user)


# ---------------------------------------------------------------------------
# Manager -> Admin coin allocation
# ---------------------------------------------------------------------------
@router.post("/allocate", dependencies=[Depends(require_roles(Role.MANAGER)), Depends(require_not_suspended)])
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
    # Fresh coins may lift a coins-exhausted suspension on the target Admin.
    await revenue_service.sync_admin_usage_suspension(payload.admin_id)
    return {"debit": TransactionOut(**debit_txn), "credit": TransactionOut(**credit_txn)}


# ---------------------------------------------------------------------------
# Admin -> Player coin grant
# ---------------------------------------------------------------------------
@router.post("/grant", dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
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
    # If this grant exhausted the Admin's allocation, auto-suspend until re-funded.
    await revenue_service.sync_admin_usage_suspension(caller["id"])
    return {"debit": TransactionOut(**debit_txn), "credit": TransactionOut(**credit_txn)}


# ---------------------------------------------------------------------------
# Player assignment
# ---------------------------------------------------------------------------
@router.post("/players/assign", dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER)), Depends(require_not_suspended)])
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
    zm_cache: dict[str, dict] = {}
    async for alloc in db.manager_allocations.find({}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        admin_count = await db.admin_allocations.count_documents({"manager_id": alloc["user_id"]})
        pending = await db.admin_creation_requests.count_documents(
            {"manager_id": alloc["user_id"], "status": "PENDING"})
        quota = alloc.get("authorized_quota", 0)
        allocated = alloc.get("allocated_out", 0)
        zm_id = alloc.get("zonal_manager_id")
        zm_name = None
        if zm_id:
            if zm_id not in zm_cache:
                zm_cache[zm_id] = await db.users.find_one({"id": zm_id}, {"_id": 0}) or {}
            zm_name = zm_cache[zm_id].get("display_name")
        out.append({
            "user": UserPublic(**u),
            "authorized_quota": quota,
            "allocated_out": allocated,
            "remaining": quota - allocated,
            "usage_pct": round((allocated / quota) * 100) if quota else 0,
            "admin_count": admin_count,
            "pending_admin_requests": pending,
            "max_admins_allowed": alloc.get("max_admins_allowed"),
            "zonal_manager_id": zm_id,
            "zonal_manager_name": zm_name,
            "wallet_balance": await _wallet_balance(alloc["user_id"]),
            "weekly_salary_inr": alloc.get("weekly_salary_inr", 0),
            "incentive_target_inr": alloc.get("incentive_target_inr", 0),
            "incentive_pct": alloc.get("incentive_pct", 0),
        })
    out.sort(key=lambda m: m["user"].created_at, reverse=True)
    return out


@router.get("/admins", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_admins():
    out = []
    async for alloc in db.admin_allocations.find({}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        mgr = await db.users.find_one({"id": alloc.get("manager_id")}, {"_id": 0})
        allocated, used = await revenue_service.admin_flows(alloc["user_id"])
        player_count = await db.player_assignments.count_documents({"admin_id": alloc["user_id"]})
        usage_pct = round((used / allocated) * 100) if allocated else 0
        out.append({
            "user": UserPublic(**u),
            "manager_id": alloc.get("manager_id"),
            "manager_name": mgr["display_name"] if mgr else "—",
            "player_capacity": alloc.get("player_capacity", 0),
            "player_count": player_count,
            "allocated": allocated,
            "used": used,
            "remaining": allocated - used,
            "usage_pct": usage_pct,
            "usage_level": revenue_service.usage_level(usage_pct),
            "revenue_split_super_admin_pct": alloc.get("revenue_split_super_admin_pct", DEFAULT_SUPER_ADMIN_PCT),
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
    cap_state = await hierarchy_service.admin_cap_state(caller["id"])
    return {
        "authorized_quota": alloc.get("authorized_quota", 0),
        "allocated_out": alloc.get("allocated_out", 0),
        "available_quota": alloc.get("authorized_quota", 0) - alloc.get("allocated_out", 0),
        "wallet_balance": await _wallet_balance(caller["id"]),
        "zonal_manager_id": alloc.get("zonal_manager_id"),
        "max_admins_allowed": cap_state["cap"],
        "admin_count": cap_state["existing"],
        "pending_admin_requests": cap_state["pending"],
    }


@router.get("/my-admins", dependencies=[Depends(require_roles(Role.MANAGER))])
async def my_admins(caller: dict = Depends(get_current_user)):
    out = []
    async for alloc in db.admin_allocations.find({"manager_id": caller["id"]}, {"_id": 0}):
        u = await db.users.find_one({"id": alloc["user_id"]}, {"_id": 0})
        if not u:
            continue
        allocated, used = await revenue_service.admin_flows(alloc["user_id"])
        player_count = await db.player_assignments.count_documents({"admin_id": alloc["user_id"]})
        usage_pct = round((used / allocated) * 100) if allocated else 0
        out.append({
            "user": UserPublic(**u),
            "player_capacity": alloc.get("player_capacity", 0),
            "player_count": player_count,
            "allocated": allocated,
            "used": used,
            "usage_pct": usage_pct,
            "usage_level": revenue_service.usage_level(usage_pct),
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



# ---------------------------------------------------------------------------
# Coin top-up / deposits (Part 1) — admin side
# ---------------------------------------------------------------------------
@router.get("/deposits",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER, Role.ADMIN))])
async def list_deposits(caller: dict = Depends(get_current_user), limit: int = 100):
    """Deposit requests scoped to the caller: Admin sees their own players',
    Manager sees their whole chain's, Super Admin sees everything."""
    return await deposit_service.list_deposits(caller, limit=min(max(limit, 1), 200))


@router.get("/deposits/{deposit_id}/screenshot",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.MANAGER, Role.ADMIN))])
async def deposit_screenshot(deposit_id: str, caller: dict = Depends(get_current_user)):
    """Streams the player's payment screenshot for a deposit within the caller's
    scope. Served through the backend (no direct storage URLs to the frontend)."""
    dep = await deposit_service.get_deposit_scoped(caller, deposit_id)
    if not dep:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Deposit not found")
    if not dep.get("screenshot_path"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No screenshot for this deposit")
    try:
        data, content_type = await storage_service.get_object(dep["screenshot_path"])
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Screenshot unavailable")
    return Response(content=data, media_type=content_type)


@router.post("/deposits/{deposit_id}/confirm",
             dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def confirm_deposit(deposit_id: str, payload: ConfirmDepositRequest,
                          caller: dict = Depends(get_current_user)):
    try:
        dep = await deposit_service.confirm_deposit(deposit_id, caller["id"], payload.note)
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "DEPOSIT_CONFIRMED", target_type="deposit", target_id=deposit_id,
                     metadata={"coins": dep["coins_to_credit"], "amount_inr": dep["amount_inr"]})
    return dep


@router.post("/deposits/{deposit_id}/reject",
             dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def reject_deposit(deposit_id: str, payload: RejectDepositRequest,
                         caller: dict = Depends(get_current_user)):
    try:
        dep = await deposit_service.reject_deposit(deposit_id, caller["id"], payload.reason)
    except PermissionError as e:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(e))
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "DEPOSIT_REJECTED", target_type="deposit", target_id=deposit_id,
                     metadata={"reason": payload.reason})
    return dep


# ---------------------------------------------------------------------------
# Contact profile — Admin/Manager WhatsApp number shown to players (wa.me)
# ---------------------------------------------------------------------------
@router.get("/profile", dependencies=[Depends(require_roles(Role.ADMIN, Role.MANAGER))])
async def get_profile(caller: dict = Depends(get_current_user)):
    return await deposit_service.get_profile_contact(caller["id"])


@router.put("/profile/whatsapp",
            dependencies=[Depends(require_roles(Role.ADMIN, Role.MANAGER)), Depends(require_not_suspended)])
async def set_whatsapp(payload: WhatsappRequest, caller: dict = Depends(get_current_user)):
    res = await deposit_service.set_whatsapp_number(caller["id"], payload.whatsapp_number)
    await log_action(caller["id"], "WHATSAPP_UPDATED", target_type="user", target_id=caller["id"])
    return res


# ---------------------------------------------------------------------------
# Collection bank accounts (Part 1b + multi-bank) — Admin/Manager manage own
# ---------------------------------------------------------------------------
@router.get("/bank-accounts",
            dependencies=[Depends(require_roles(Role.ADMIN, Role.MANAGER))])
async def list_bank_accounts(caller: dict = Depends(get_current_user)):
    """All of the caller's collection accounts, each with its CONFIRMED-deposit
    running totals (this week + all-time). Active account is listed first."""
    return await deposit_service.list_bank_accounts(caller["id"])


@router.post("/bank-accounts",
             dependencies=[Depends(require_roles(Role.ADMIN, Role.MANAGER)), Depends(require_not_suspended)])
async def create_bank_account(payload: BankAccountInput, caller: dict = Depends(get_current_user)):
    doc = await deposit_service.create_bank_account(caller["id"], payload.model_dump())
    await log_action(caller["id"], "BANK_ACCOUNT_ADDED", target_type="bank_account",
                     target_id=doc["id"], metadata={"bank_name": payload.bank_name})
    return doc


@router.patch("/bank-accounts/{account_id}/activate",
              dependencies=[Depends(require_roles(Role.ADMIN, Role.MANAGER)), Depends(require_not_suspended)])
async def activate_bank_account(account_id: str, caller: dict = Depends(get_current_user)):
    try:
        res = await deposit_service.activate_bank_account(caller["id"], account_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    await log_action(caller["id"], "BANK_ACCOUNT_ACTIVATED", target_type="bank_account",
                     target_id=account_id)
    return res



# ---------------------------------------------------------------------------
# Revenue split + settlements (Part 2) — Super Admin
# ---------------------------------------------------------------------------
@router.patch("/admins/{admin_id}/revenue-split",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_revenue_split(admin_id: str, payload: RevenueSplitRequest,
                            caller: dict = Depends(get_current_user)):
    res = await db.admin_allocations.update_one(
        {"user_id": admin_id},
        {"$set": {"revenue_split_super_admin_pct": payload.revenue_split_super_admin_pct,
                  "updated_at": datetime.now(timezone.utc).isoformat()}},
    )
    if res.matched_count == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Admin not found")
    await log_action(caller["id"], "REVENUE_SPLIT_UPDATED", target_type="user", target_id=admin_id,
                     metadata={"pct": payload.revenue_split_super_admin_pct})
    return {"admin_id": admin_id, "revenue_split_super_admin_pct": payload.revenue_split_super_admin_pct}


@router.get("/settlements", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_settlements(limit: int = 200):
    return await revenue_service.list_settlements(limit=min(max(limit, 1), 500))


@router.post("/settlements/{settlement_id}/settle",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def settle_settlement(settlement_id: str, payload: SettleRequest,
                            caller: dict = Depends(get_current_user)):
    try:
        s = await revenue_service.settle(settlement_id, caller["id"])
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))
    await log_action(caller["id"], "SETTLEMENT_SETTLED", target_type="settlement",
                     target_id=settlement_id, metadata={"note": payload.note})
    return s


# ---------------------------------------------------------------------------
# Daily transaction summary (Super Admin) — buildable now from real ledger
# ---------------------------------------------------------------------------
@router.get("/daily-summary", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def daily_summary(days: int = 14):
    return await revenue_service.get_daily_summaries(days=min(max(days, 1), 90))


@router.get("/daily-summary/export", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def daily_summary_export(days: int = 30):
    rows = await revenue_service.get_daily_summaries(days=min(max(days, 1), 365))
    lines = ["date,total_deposits_inr,total_allocations_coins,total_transactions"]
    for r in rows:
        lines.append(f"{r['date']},{r['total_deposits_inr']},{r['total_allocations_coins']},{r['total_transactions']}")
    csv = "\n".join(lines) + "\n"
    return Response(
        content=csv, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=daily_summary.csv"},
    )


# ---------------------------------------------------------------------------
# Admin self-recharge (Part 5) — Admin submits; suspension does NOT block this
# (a coins-exhausted Admin needs to be able to top up to recover).
# ---------------------------------------------------------------------------
@router.post("/recharge-request", dependencies=[Depends(require_roles(Role.ADMIN))])
async def create_recharge_request(payload: AdminRechargeCreate, caller: dict = Depends(get_current_user)):
    doc = await recharge_service.create_recharge_request(
        caller["id"], payload.amount_inr, payload.reference_note
    )
    await log_action(caller["id"], "ADMIN_RECHARGE_REQUESTED", target_type="admin_recharge",
                     target_id=doc["id"], metadata={"amount_inr": payload.amount_inr})
    return doc


@router.get("/my-recharges", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_recharges(caller: dict = Depends(get_current_user), limit: int = 50):
    cursor = db.admin_recharges.find({"admin_id": caller["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return [r async for r in cursor]


@router.get("/recharge-info", dependencies=[Depends(require_roles(Role.ADMIN))])
async def recharge_info():
    return {"bonus_rate": ADMIN_RECHARGE_BONUS_RATE}

