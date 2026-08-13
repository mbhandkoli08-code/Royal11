"""Bonus balance + wagering status API. Player reads their own status; Super
Admin can grant a bonus (used operationally + by future bonus features, which
call bonus_service.grant_bonus directly)."""
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import get_current_user, require_roles
from ..models import Role
from .. import bonus_service, surprise_box_service

router = APIRouter(prefix="/bonus", tags=["bonus"])


class GrantRequest(BaseModel):
    user_id: str
    amount: int = Field(gt=0)
    bonus_type: str = "manual"
    multiple: int | None = Field(default=None, ge=1, le=20)
    expiry_days: int | None = Field(default=None, ge=1, le=90)


class ConfigPatch(BaseModel):
    multiple: int | None = Field(default=None, ge=1, le=20)
    release_mode: str | None = Field(default=None, pattern="^(incremental|on_complete)$")
    expiry_days: int | None = Field(default=None, ge=1, le=90)
    max_bet_while_bonus: int | None = None


@router.get("/me")
async def my_bonus(user: dict = Depends(get_current_user)):
    return await bonus_service.get_status(user["id"])


@router.get("/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_config():
    return await bonus_service.get_config()


@router.put("/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def update_config(patch: ConfigPatch):
    return await bonus_service.set_config(patch.model_dump(exclude_none=True))


@router.post("/grant", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def grant(payload: GrantRequest):
    grant_doc = await bonus_service.grant_bonus(
        payload.user_id, payload.bonus_type, payload.amount,
        request_id=f"manual_grant:{uuid.uuid4()}",
        multiple=payload.multiple, expiry_days=payload.expiry_days)
    return {"granted": grant_doc, "status": await bonus_service.get_status(payload.user_id)}


@router.get("/surprise-box-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def surprise_box_config():
    return await surprise_box_service.get_config()


@router.put("/surprise-box-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def update_surprise_box_config(patch: dict):
    return await surprise_box_service.set_config(patch)
