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
    is_practice: bool = False


@router.get("/catalog")
async def catalog(_user: dict = Depends(get_current_user)):
    return engine.list_catalog()


@router.get("/practice/balance")
async def practice_balance(user: dict = Depends(get_current_user)):
    from ..games import practice_service
    return {"balance": await practice_service.ensure_min(user["id"])}


@router.get("/progression/me")
async def my_progression(user: dict = Depends(get_current_user)):
    from ..games import progression_service
    return await progression_service.get_progression(user["id"])


@router.get("/tables")
async def tables(game_type: str | None = None, _user: dict = Depends(get_current_user)):
    return await engine.list_tables(game_type)


# Players may open a table; Admin/Super Admin can also create configured tables.
@router.post("/tables")
async def create_table(payload: CreateTableRequest, user: dict = Depends(get_current_user)):
    try:
        return await engine.create_table(payload.game_type, user["id"], payload.name,
                                         payload.config, payload.is_practice)
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


@router.get("/admin/commission-report", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def commission_report(week_offset: int = 0):
    """Weekly rollup of the house commission already recorded per-round in
    casino_rake_ledger — an automatic summary (no manual calc). `week_offset`:
    0 = current Sun–Sat week, 1 = last week, etc. Broken down by game_type (and
    by bet_type where present, e.g. Thane Matka Single/Jodi/Panna/Motor).

    Semantics per ledger entry: `pot` = total bets into the round, `rake` = house
    commission (default 70%), so payouts = pot − rake, split into
    super_admin_share / admin_share.
    """
    from datetime import datetime, timezone, timedelta
    from ..db import db
    from .. import revenue_service

    today = datetime.now(timezone.utc).date()
    ws, we = revenue_service.week_bounds(today - timedelta(days=7 * week_offset))
    start_iso = datetime(ws.year, ws.month, ws.day, tzinfo=timezone.utc).isoformat()
    end_iso = (datetime(we.year, we.month, we.day, tzinfo=timezone.utc) + timedelta(days=1)).isoformat()

    pipeline = [
        {"$match": {"created_at": {"$gte": start_iso, "$lt": end_iso}}},
        {"$group": {
            "_id": {"game_type": "$game_type", "bet_type": "$bet_type"},
            "bets": {"$sum": "$pot"}, "rake": {"$sum": "$rake"},
            "sa": {"$sum": "$super_admin_share"}, "admin": {"$sum": "$admin_share"},
            "rounds": {"$sum": 1},
        }},
    ]
    games: dict[str, dict] = {}
    grand = {"bets": 0, "payouts": 0, "commission": 0, "super_admin_share": 0, "admin_share": 0, "rounds": 0}
    async for r in db.casino_rake_ledger.aggregate(pipeline):
        gt = r["_id"].get("game_type") or "unknown"
        bt = r["_id"].get("bet_type")
        bets, rake = r["bets"] or 0, r["rake"] or 0
        payouts = bets - rake
        g = games.setdefault(gt, {"game_type": gt, "bets": 0, "payouts": 0, "commission": 0,
                                  "super_admin_share": 0, "admin_share": 0, "rounds": 0, "bet_types": []})
        g["bets"] += bets; g["payouts"] += payouts; g["commission"] += rake
        g["super_admin_share"] += r["sa"] or 0; g["admin_share"] += r["admin"] or 0; g["rounds"] += r["rounds"]
        if bt:
            g["bet_types"].append({"bet_type": bt, "bets": bets, "payouts": payouts,
                                   "commission": rake, "rounds": r["rounds"]})
        grand["bets"] += bets; grand["payouts"] += payouts; grand["commission"] += rake
        grand["super_admin_share"] += r["sa"] or 0; grand["admin_share"] += r["admin"] or 0
        grand["rounds"] += r["rounds"]

    return {
        "week_start": ws.isoformat(), "week_end": we.isoformat(), "week_offset": week_offset,
        "totals": grand,
        "games": sorted(games.values(), key=lambda x: x["commission"], reverse=True),
    }


@router.get("/admin/vip-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_vip_config():
    from ..games import progression_service
    return await progression_service.get_config()


class VipConfigRequest(BaseModel):
    coins_per_xp: int | None = None
    practice_multiplier: float | None = None
    tiers: list[dict] | None = None


@router.put("/admin/vip-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_vip_config(payload: VipConfigRequest):
    from ..games import progression_service
    return await progression_service.set_config(payload.model_dump(exclude_none=True))
