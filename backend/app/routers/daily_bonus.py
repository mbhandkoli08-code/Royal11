"""Daily Bonus — player claim + Super Admin config."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import daily_bonus_service
from ..deps import get_current_user, require_roles
from ..models import Role

router = APIRouter(prefix="/daily-bonus", tags=["daily-bonus"])


@router.get("/status")
async def get_status(user: dict = Depends(get_current_user)):
    return await daily_bonus_service.status(user["id"])


@router.post("/claim")
async def claim(user: dict = Depends(get_current_user)):
    try:
        return await daily_bonus_service.claim(user["id"])
    except daily_bonus_service.DailyBonusError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


class DailyBonusConfigInput(BaseModel):
    enabled: bool | None = None
    amount: int | None = Field(default=None, ge=0)


@router.get("/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_config():
    return await daily_bonus_service.get_config()


@router.put("/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_config(payload: DailyBonusConfigInput):
    try:
        return await daily_bonus_service.set_config(payload.model_dump(exclude_none=True))
    except daily_bonus_service.DailyBonusError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
