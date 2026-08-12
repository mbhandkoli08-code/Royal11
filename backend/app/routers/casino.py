"""Card-games REST API (Phase 0). Authoritative engine over REST; the frontend
polls GET /state (~1-1.5s). WebSocket push is a later-phase upgrade.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..deps import get_current_user, require_roles
from ..games import engine
from ..models import Role

router = APIRouter(prefix="/casino", tags=["casino"])


def _err(e: engine.DomainError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


class CreateTableRequest(BaseModel):
    game_type: str
    name: str | None = Field(default=None, max_length=60)
    config: dict | None = None


@router.get("/catalog")
async def catalog(_user: dict = Depends(get_current_user)):
    return engine.list_catalog()


@router.get("/tables")
async def tables(game_type: str | None = None, _user: dict = Depends(get_current_user)):
    return await engine.list_tables(game_type)


# Players may open a table; Admin/Super Admin can also create configured tables.
@router.post("/tables")
async def create_table(payload: CreateTableRequest, user: dict = Depends(get_current_user)):
    try:
        return await engine.create_table(payload.game_type, user["id"], payload.name, payload.config)
    except engine.DomainError as e:
        raise _err(e)


@router.get("/tables/{table_id}/state")
async def state(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await engine.get_state(table_id, user["id"])
    except engine.DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/join")
async def join(table_id: str, user: dict = Depends(get_current_user)):
    try:
        await engine.join_table(table_id, user)
        return await engine.get_state(table_id, user["id"])
    except engine.DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/leave")
async def leave(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await engine.leave_table(table_id, user["id"])
    except engine.DomainError as e:
        raise _err(e)


@router.post("/tables/{table_id}/start")
async def start(table_id: str, user: dict = Depends(get_current_user)):
    try:
        return await engine.start_round(table_id, user["id"])
    except engine.DomainError as e:
        raise _err(e)


@router.get("/rounds/{round_id}/verify")
async def verify(round_id: str, _user: dict = Depends(get_current_user)):
    """Provably-fair check — recomputes the shuffle from the revealed seed."""
    try:
        return await engine.verify_round(round_id)
    except engine.DomainError as e:
        raise _err(e)


# Super Admin: rake/commission taken by the house across games.
@router.get("/admin/rake", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def rake_ledger():
    from ..db import db
    rows = await db.casino_rake_ledger.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    total = sum(r["rake"] for r in rows)
    return {"total_rake": total, "entries": rows}
