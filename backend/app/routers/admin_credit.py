"""Admin Credit Line API.

Admin (self): view credit status, request over-limit top-up.
Upline (Manager / Zonal / Super Admin): report dashboard, set/adjust/revoke
limits, approve/reject over-limit requests, record settlement repayments, ledger.
"""
from fastapi import APIRouter, Depends

from .. import admin_credit_service
from ..deps import get_current_user, require_not_suspended, require_roles
from ..models import (
    CreditDecisionRequest,
    CreditRequestCreate,
    RecordRepaymentRequest,
    Role,
    SetCreditLimitRequest,
)

router = APIRouter(prefix="/admin-credit", tags=["admin-credit"])

UPLINE = (Role.SUPER_ADMIN, Role.ZONAL_MANAGER, Role.MANAGER)


# --- Admin self ------------------------------------------------------------
@router.get("/me", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_credit(user: dict = Depends(get_current_user)):
    return await admin_credit_service.get_admin_status(user["id"])


@router.post("/request", dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def request_more(payload: CreditRequestCreate, user: dict = Depends(get_current_user)):
    return await admin_credit_service.create_request(user, payload.amount, payload.reason)


# --- Upline ----------------------------------------------------------------
@router.get("/report", dependencies=[Depends(require_roles(*UPLINE))])
async def report(user: dict = Depends(get_current_user)):
    return await admin_credit_service.report(user)


@router.put("/admin/{admin_id}/limit", dependencies=[Depends(require_roles(*UPLINE)), Depends(require_not_suspended)])
async def set_limit(admin_id: str, payload: SetCreditLimitRequest, user: dict = Depends(get_current_user)):
    return await admin_credit_service.set_limit(user, admin_id, payload.credit_limit, payload.note)


@router.post("/admin/{admin_id}/revoke", dependencies=[Depends(require_roles(*UPLINE)), Depends(require_not_suspended)])
async def revoke_limit(admin_id: str, user: dict = Depends(get_current_user)):
    return await admin_credit_service.revoke_limit(user, admin_id)


@router.post("/admin/{admin_id}/repay", dependencies=[Depends(require_roles(*UPLINE)), Depends(require_not_suspended)])
async def record_repayment(admin_id: str, payload: RecordRepaymentRequest, user: dict = Depends(get_current_user)):
    return await admin_credit_service.record_repayment(user, admin_id, payload.amount, payload.note)


@router.get("/admin/{admin_id}/ledger", dependencies=[Depends(require_roles(*UPLINE))])
async def ledger(admin_id: str, user: dict = Depends(get_current_user)):
    return await admin_credit_service.list_ledger(user, admin_id)


@router.post("/requests/{request_id}/approve", dependencies=[Depends(require_roles(*UPLINE)), Depends(require_not_suspended)])
async def approve_request(request_id: str, payload: CreditDecisionRequest, user: dict = Depends(get_current_user)):
    return await admin_credit_service.decide_request(user, request_id, True, payload.reason)


@router.post("/requests/{request_id}/reject", dependencies=[Depends(require_roles(*UPLINE)), Depends(require_not_suspended)])
async def reject_request(request_id: str, payload: CreditDecisionRequest, user: dict = Depends(get_current_user)):
    return await admin_credit_service.decide_request(user, request_id, False, payload.reason)
