"""Super Admin recharge queue (Part 5). Confirms/rejects Admin self-recharge
requests. Kept under its own /superadmin prefix per the API design.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from .. import recharge_service
from ..audit import log_action
from ..deps import get_current_user, require_roles
from ..models import ConfirmDepositRequest, RejectDepositRequest, Role

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


@router.get("/recharges", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_recharges(limit: int = 100):
    return await recharge_service.list_recharges(limit=min(max(limit, 1), 200))


@router.post("/recharges/{recharge_id}/confirm",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def confirm_recharge(recharge_id: str, payload: ConfirmDepositRequest,
                           caller: dict = Depends(get_current_user)):
    try:
        r = await recharge_service.confirm_recharge(recharge_id, caller["id"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "ADMIN_RECHARGE_CONFIRMED", target_type="admin_recharge",
                     target_id=recharge_id, metadata={"coins": r["coins_credited"], "note": payload.note})
    return r


@router.post("/recharges/{recharge_id}/reject",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def reject_recharge(recharge_id: str, payload: RejectDepositRequest,
                          caller: dict = Depends(get_current_user)):
    try:
        r = await recharge_service.reject_recharge(recharge_id, caller["id"], payload.reason)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "ADMIN_RECHARGE_REJECTED", target_type="admin_recharge",
                     target_id=recharge_id, metadata={"reason": payload.reason})
    return r
