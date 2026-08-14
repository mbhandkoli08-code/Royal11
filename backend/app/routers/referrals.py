"""Referral program API — player dashboard + Super Admin config."""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import referral_service
from ..deps import get_current_user, require_roles
from ..models import Role

router = APIRouter(prefix="/referrals", tags=["referrals"])


class ReferralConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    referrer_amount: Optional[int] = Field(default=None, ge=0)
    referee_amount: Optional[int] = Field(default=None, ge=0)
    qualify_event: Optional[str] = Field(default=None, pattern="^(SIGNUP|FIRST_RECHARGE|FIRST_WAGER)$")
    qualify_min_amount: Optional[int] = Field(default=None, ge=0)
    multiple: Optional[int] = Field(default=None, ge=1)
    expiry_days: Optional[int] = Field(default=None, ge=1)
    max_referrals_per_user: Optional[int] = Field(default=None, ge=0)


@router.get("/me", dependencies=[Depends(require_roles(Role.PLAYER))])
async def my_referrals(user: dict = Depends(get_current_user)):
    return await referral_service.me(user)


@router.get("/admin/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_config():
    return await referral_service.get_config()


@router.put("/admin/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_config(payload: ReferralConfigPatch):
    patch = {k: v for k, v in payload.model_dump().items() if v is not None}
    return await referral_service.set_config(patch)
