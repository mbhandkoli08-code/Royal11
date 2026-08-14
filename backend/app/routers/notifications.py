"""In-app notification (bell) API — per-user feed."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import notification_service
from ..deps import get_current_user

router = APIRouter(prefix="/notifications", tags=["notifications"])


class ReadRequest(BaseModel):
    ids: list[str] | None = None


@router.get("")
async def list_notifications(user: dict = Depends(get_current_user)):
    return await notification_service.list_for(user["id"])


@router.post("/read")
async def read_notifications(payload: ReadRequest, user: dict = Depends(get_current_user)):
    return await notification_service.mark_read(user["id"], payload.ids)
