"""Fantasy Cricket endpoints — player lobby + Super Admin/Admin management."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import cricket_service, fantasy_service
from ..audit import log_action
from ..deps import get_current_user, require_roles
from ..models import Role

router = APIRouter(prefix="/fantasy", tags=["fantasy"])
admin_router = APIRouter(prefix="/admin/fantasy", tags=["fantasy-admin"])


def _err(e: Exception):
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


# ------------------------------- Player -------------------------------
@router.get("/matches")
async def matches(_: dict = Depends(get_current_user)):
    return await cricket_service.get_upcoming_fixtures()


@router.get("/fixtures/{fixture_id}/players")
async def fixture_players(fixture_id: str, _: dict = Depends(get_current_user)):
    await fantasy_service.refresh_player_pool(fixture_id)  # keep team affiliation current
    return {"players": await fantasy_service.get_player_pool(fixture_id),
            "budget": fantasy_service.BUDGET, "role_ranges": fantasy_service.ROLE_RANGES,
            "max_per_team": fantasy_service.MAX_PER_TEAM}


@router.get("/contests")
async def contests(fixture_id: str = None, _: dict = Depends(get_current_user)):
    return await fantasy_service.list_contests(fixture_id=fixture_id, only_open=True)


@router.get("/contests/{contest_id}")
async def contest_detail(contest_id: str, user: dict = Depends(get_current_user)):
    try:
        return await fantasy_service.contest_detail(contest_id, user["id"])
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


class JoinRequest(BaseModel):
    selections: list[str] = Field(min_length=11, max_length=11)
    captain_id: str
    vice_captain_id: str


@router.post("/contests/{contest_id}/join")
async def join(contest_id: str, payload: JoinRequest, user: dict = Depends(get_current_user)):
    try:
        res = await fantasy_service.join_contest(
            user["id"], contest_id, payload.selections, payload.captain_id, payload.vice_captain_id)
    except ValueError as e:
        raise _err(e)
    await log_action(user["id"], "FANTASY_JOINED", target_type="fantasy_contest", target_id=contest_id)
    return res


@router.get("/my-contests")
async def my_contests(user: dict = Depends(get_current_user)):
    return await fantasy_service.my_contests(user["id"])


# ------------------------------- Admin -------------------------------
class CreateContestRequest(BaseModel):
    fixture_id: str
    name: str = ""
    entry_fee: int = Field(ge=0)
    max_participants: int = Field(gt=0)
    prize_pool: int = Field(ge=0)
    prize_distribution: list[dict] | None = None


@admin_router.post("/contests",
                   dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN))])
async def create_contest(payload: CreateContestRequest, caller: dict = Depends(get_current_user)):
    try:
        c = await fantasy_service.create_contest(
            caller["id"], payload.fixture_id, payload.entry_fee, payload.max_participants,
            payload.prize_pool, payload.prize_distribution, payload.name)
    except ValueError as e:
        raise _err(e)
    await log_action(caller["id"], "FANTASY_CONTEST_CREATED", target_type="fantasy_contest", target_id=c["id"])
    return c


@admin_router.get("/contests",
                  dependencies=[Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN))])
async def list_all_contests(fixture_id: str = None):
    return await fantasy_service.list_contests(fixture_id=fixture_id)


@admin_router.post("/contests/{contest_id}/settle",
                   dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def settle(contest_id: str):
    try:
        return await fantasy_service.settle_contest(contest_id)
    except fantasy_service.SettlementNotReady as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))
    except ValueError as e:
        raise _err(e)


@admin_router.post("/contests/{contest_id}/cancel",
                   dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def cancel(contest_id: str):
    try:
        return await fantasy_service.cancel_contest(contest_id)
    except ValueError as e:
        raise _err(e)


@admin_router.get("/scoring-config",
                  dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_scoring():
    return await fantasy_service.get_scoring_config()


@admin_router.put("/scoring-config",
                  dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def put_scoring(payload: dict, caller: dict = Depends(get_current_user)):
    res = await fantasy_service.update_scoring_config(payload)
    await log_action(caller["id"], "FANTASY_SCORING_UPDATED", target_type="fantasy_scoring_config", target_id="cricket")
    return res


class CreditRequest(BaseModel):
    credit_value: float = Field(ge=0)


@admin_router.put("/fixtures/{fixture_id}/players/{player_id}/credit",
                  dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_credit(fixture_id: str, player_id: str, payload: CreditRequest):
    try:
        return await fantasy_service.set_player_credit(fixture_id, player_id, payload.credit_value)
    except ValueError as e:
        raise _err(e)
