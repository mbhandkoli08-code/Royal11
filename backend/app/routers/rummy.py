"""Points Rummy REST API (Phase 1). Authoritative turn engine over REST; the
frontend polls GET /state (~1.5s). Draw/discard/declare/drop are turn-gated and
idempotent-safe via the engine's optimistic revision guard.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..deps import get_current_user
from ..games import rummy_engine as re
from ..games.engine import DomainError

router = APIRouter(prefix="/casino/rummy", tags=["rummy"])


def _err(e: DomainError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


class DrawRequest(BaseModel):
    source: str = Field(default="closed", pattern="^(closed|open)$")


class DiscardRequest(BaseModel):
    card_id: str


class DeclareRequest(BaseModel):
    groups: list[list[str]]


class QuickMatchRequest(BaseModel):
    point_value: int = 1
    is_practice: bool = False


@router.get("/tables/{table_id}/state")
async def state(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await re.get_state(table_id, user["id"])
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/start")
async def start(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await re.start_round(table_id, user["id"])
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/draw")
async def draw(table_id: str, payload: DrawRequest, user: dict = Depends(get_current_user)):
    try:
        return await re.draw(table_id, user["id"], payload.source)
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/discard")
async def discard(table_id: str, payload: DiscardRequest, user: dict = Depends(get_current_user)):
    try:
        return await re.discard(table_id, user["id"], payload.card_id)
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/declare")
async def declare(table_id: str, payload: DeclareRequest, user: dict = Depends(get_current_user)):
    try:
        return await re.declare(table_id, user["id"], payload.groups)
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/drop")
async def drop(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await re.drop(table_id, user["id"])
    except DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/heartbeat")
async def heartbeat(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await re.heartbeat(table_id, user["id"])
    except DomainError as e:
        raise _err(e)


@router.get("/rounds/{round_id}/verify")
async def verify(round_id: str, _user: dict = Depends(get_current_user)):
    try:
        return await re.verify_round(round_id)
    except DomainError as e:
        raise _err(e)


@router.post("/quick-match")
async def quick_match(payload: QuickMatchRequest, user: dict = Depends(get_current_user)):
    try:
        return await re.quick_match(user, payload.point_value, payload.is_practice)
    except DomainError as e:
        raise _err(e)
