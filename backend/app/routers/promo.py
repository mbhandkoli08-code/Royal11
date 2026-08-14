"""Promo code redemption endpoint."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import promo_service
from ..audit import log_action
from ..deps import get_current_user

router = APIRouter(prefix="/promo", tags=["promo"])


class ApplyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=40)


@router.post("/apply")
async def apply_promo(payload: ApplyRequest, user: dict = Depends(get_current_user)):
    try:
        res = await promo_service.apply_code(user["id"], payload.code)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(user["id"], "PROMO_APPLIED", target_type="promo_code", target_id=res["code"])
    return {"ok": True, **res}
