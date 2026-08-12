"""Player game-economy endpoints — server-authoritative coin actions."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import game_service
from ..deps import get_current_user

router = APIRouter(prefix="/games", tags=["games"])


class BuyRequest(BaseModel):
    item_id: str


class EquipRequest(BaseModel):
    item_id: str


class JoinContestRequest(BaseModel):
    contest_id: str


@router.get("/inventory")
async def inventory(user: dict = Depends(get_current_user)):
    return await game_service.get_inventory(user["id"])


@router.post("/spin")
async def spin(user: dict = Depends(get_current_user)):
    try:
        return await game_service.spin(user["id"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/store/buy")
async def buy(payload: BuyRequest, user: dict = Depends(get_current_user)):
    try:
        return await game_service.buy_item(user["id"], payload.item_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/store/equip")
async def equip(payload: EquipRequest, user: dict = Depends(get_current_user)):
    try:
        return await game_service.equip_avatar(user["id"], payload.item_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/contest/join")
async def join_contest(payload: JoinContestRequest, user: dict = Depends(get_current_user)):
    try:
        return await game_service.join_contest(user["id"], payload.contest_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
