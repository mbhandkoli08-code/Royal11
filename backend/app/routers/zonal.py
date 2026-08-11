"""Zonal Manager tier + Admin-creation approval workflow endpoints.

Shares the /admin prefix with admin.py (paths never collide). Service functions
raise ValueError (-> 400) / PermissionError (-> 403); this router maps them.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from .. import hierarchy_service, payroll_service
from ..audit import log_action
from ..db import db
from ..deps import get_current_user, require_not_suspended, require_roles
from ..models import (
    AdminCreationRequestCreate,
    ApproveRejectRequest,
    CreateManagerRequest,
    CreateZonalManagerRequest,
    FundManagerRequest,
    PayrollRequest,
    Role,
    SetMaxAdminsRequest,
    TransactionOut,
    UpdateManagerQuotaRequest,
    UserPublic,
    ZonalFundManagerRequest,
)

router = APIRouter(prefix="/admin", tags=["zonal"])


def _map(exc: Exception):
    if isinstance(exc, PermissionError):
        return HTTPException(status.HTTP_403_FORBIDDEN, str(exc))
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))


# ---------------------------------------------------------------------------
# Super Admin: Zonal Manager CRUD + funding
# ---------------------------------------------------------------------------
@router.post("/zonal-managers", response_model=UserPublic,
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def create_zonal_manager(payload: CreateZonalManagerRequest, caller: dict = Depends(get_current_user)):
    try:
        user = await hierarchy_service.create_zonal_manager(
            caller["id"], payload.email, payload.password, payload.display_name, payload.authorized_quota)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "ZONAL_MANAGER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"authorized_quota": payload.authorized_quota})
    return UserPublic(**user)


@router.get("/zonal-managers", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_zonal_managers():
    rows = await hierarchy_service.list_zonal_managers()
    for r in rows:
        r["user"] = UserPublic(**r["user"])
    return rows


@router.patch("/zonal-managers/{zm_id}/quota",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_zonal_quota(zm_id: str, payload: UpdateManagerQuotaRequest,
                          caller: dict = Depends(get_current_user)):
    try:
        res = await hierarchy_service.set_zonal_quota(zm_id, payload.authorized_quota)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "ZONAL_QUOTA_UPDATED", target_type="user", target_id=zm_id,
                     metadata={"authorized_quota": payload.authorized_quota})
    return res


@router.post("/zonal-managers/{zm_id}/fund",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def fund_zonal(zm_id: str, payload: FundManagerRequest, caller: dict = Depends(get_current_user)):
    try:
        txn = await hierarchy_service.fund_zonal(
            zm_id, payload.amount, caller["id"], payload.reason, payload.request_id)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "ZONAL_FUNDED", target_type="user", target_id=zm_id,
                     metadata={"amount": payload.amount})
    return TransactionOut(**txn)


# ---------------------------------------------------------------------------
# Zonal Manager: own zone view + create/fund Managers
# ---------------------------------------------------------------------------
@router.get("/zonal/my-allocation", dependencies=[Depends(require_roles(Role.ZONAL_MANAGER))])
async def zonal_my_allocation(caller: dict = Depends(get_current_user)):
    return await hierarchy_service.zonal_my_allocation(caller["id"])


@router.get("/zonal/my-managers", dependencies=[Depends(require_roles(Role.ZONAL_MANAGER))])
async def zonal_my_managers(caller: dict = Depends(get_current_user)):
    rows = await hierarchy_service.zonal_my_managers(caller["id"])
    for r in rows:
        r["user"] = UserPublic(**r["user"])
    return rows


@router.post("/zonal/managers", response_model=UserPublic,
             dependencies=[Depends(require_roles(Role.ZONAL_MANAGER)), Depends(require_not_suspended)])
async def zonal_create_manager(payload: CreateManagerRequest, caller: dict = Depends(get_current_user)):
    try:
        user = await hierarchy_service.create_manager(
            caller["id"], payload.email, payload.password, payload.display_name,
            payload.authorized_quota, zonal_manager_id=caller["id"])
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "MANAGER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"zonal_manager_id": caller["id"]})
    return UserPublic(**user)


@router.post("/zonal/fund-manager",
             dependencies=[Depends(require_roles(Role.ZONAL_MANAGER)), Depends(require_not_suspended)])
async def zonal_fund_manager(payload: ZonalFundManagerRequest, caller: dict = Depends(get_current_user)):
    try:
        res = await hierarchy_service.zonal_fund_manager(
            caller["id"], payload.manager_id, payload.amount, payload.request_id)
    except (ValueError, PermissionError) as e:
        raise _map(e)
    await log_action(caller["id"], "ZONAL_FUNDED_MANAGER", target_type="user", target_id=payload.manager_id,
                     metadata={"amount": payload.amount})
    return {"debit": TransactionOut(**res["debit"]), "credit": TransactionOut(**res["credit"])}


# ---------------------------------------------------------------------------
# Per-Manager admin cap (Super Admin, or the Manager's Zonal Manager)
# ---------------------------------------------------------------------------
@router.patch("/managers/{manager_id}/max-admins",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ZONAL_MANAGER))])
async def set_max_admins(manager_id: str, payload: SetMaxAdminsRequest,
                         caller: dict = Depends(get_current_user)):
    try:
        res = await hierarchy_service.set_max_admins(caller, manager_id, payload.max_admins_allowed)
    except (ValueError, PermissionError) as e:
        raise _map(e)
    await log_action(caller["id"], "MAX_ADMINS_UPDATED", target_type="user", target_id=manager_id,
                     metadata={"max_admins_allowed": payload.max_admins_allowed})
    return res


# ---------------------------------------------------------------------------
# Salary + Incentive payroll
# ---------------------------------------------------------------------------
@router.patch("/managers/{manager_id}/payroll",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_manager_payroll(manager_id: str, payload: PayrollRequest, caller: dict = Depends(get_current_user)):
    try:
        res = await payroll_service.set_payroll("manager", manager_id, payload.weekly_salary_inr,
                                                payload.incentive_target_inr, payload.incentive_pct)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "PAYROLL_SET", target_type="user", target_id=manager_id, metadata=res)
    return res


@router.patch("/zonal-managers/{zm_id}/payroll",
              dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_zonal_payroll(zm_id: str, payload: PayrollRequest, caller: dict = Depends(get_current_user)):
    try:
        res = await payroll_service.set_payroll("zonal", zm_id, payload.weekly_salary_inr,
                                                payload.incentive_target_inr, payload.incentive_pct)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "PAYROLL_SET", target_type="user", target_id=zm_id, metadata=res)
    return res


@router.get("/my-payroll", dependencies=[Depends(require_roles(Role.MANAGER))])
async def my_manager_payroll(caller: dict = Depends(get_current_user)):
    alloc = await db.manager_allocations.find_one({"user_id": caller["id"]}, {"_id": 0}) or {}
    return await payroll_service.payroll_view(caller["id"], Role.MANAGER.value, alloc)


@router.get("/zonal/my-payroll", dependencies=[Depends(require_roles(Role.ZONAL_MANAGER))])
async def my_zonal_payroll(caller: dict = Depends(get_current_user)):
    alloc = await db.zonal_manager_allocations.find_one({"user_id": caller["id"]}, {"_id": 0}) or {}
    return await payroll_service.payroll_view(caller["id"], Role.ZONAL_MANAGER.value, alloc)
@router.post("/admin-requests",
             dependencies=[Depends(require_roles(Role.MANAGER)), Depends(require_not_suspended)])
async def submit_admin_request(payload: AdminCreationRequestCreate, caller: dict = Depends(get_current_user)):
    try:
        doc = await hierarchy_service.submit_admin_request(
            caller["id"], payload.email, payload.password, payload.display_name, payload.player_capacity)
    except ValueError as e:
        raise _map(e)
    await log_action(caller["id"], "ADMIN_REQUEST_SUBMITTED", target_type="admin_creation_request",
                     target_id=doc["id"], metadata={"email": payload.email})
    return doc


@router.get("/admin-requests",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ZONAL_MANAGER, Role.MANAGER))])
async def list_admin_requests(caller: dict = Depends(get_current_user), limit: int = 100):
    return await hierarchy_service.list_admin_requests(caller, limit=min(max(limit, 1), 200))


@router.post("/admin-requests/{request_id}/approve",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ZONAL_MANAGER)), Depends(require_not_suspended)])
async def approve_admin_request(request_id: str, caller: dict = Depends(get_current_user)):
    try:
        res = await hierarchy_service.approve_admin_request(request_id, caller)
    except (ValueError, PermissionError) as e:
        raise _map(e)
    await log_action(caller["id"], "ADMIN_REQUEST_APPROVED", target_type="admin_creation_request",
                     target_id=request_id, metadata={"admin_id": res["admin_id"]})
    return res


@router.post("/admin-requests/{request_id}/reject",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ZONAL_MANAGER))])
async def reject_admin_request(request_id: str, payload: ApproveRejectRequest,
                               caller: dict = Depends(get_current_user)):
    try:
        res = await hierarchy_service.reject_admin_request(request_id, caller, payload.reason)
    except (ValueError, PermissionError) as e:
        raise _map(e)
    await log_action(caller["id"], "ADMIN_REQUEST_REJECTED", target_type="admin_creation_request",
                     target_id=request_id, metadata={"reason": payload.reason})
    return res
