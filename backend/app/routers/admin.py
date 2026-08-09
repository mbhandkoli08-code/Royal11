import uuid
from datetime import datetime, timezone

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
