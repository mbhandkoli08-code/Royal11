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


async def _downline_admin_ids(user: dict):
    """Resolve which Admins' commission a caller may see. None = platform-wide
    (Super Admin). A list = that role's own team; [] = nothing in scope."""
    from ..db import db
    role = user.get("role")
    if role == Role.SUPER_ADMIN.value:
        return None
    if role == Role.ADMIN.value:
        return [user["id"]]
    if role == Role.MANAGER.value:
        rows = await db.admin_allocations.find({"manager_id": user["id"]}, {"_id": 0, "user_id": 1}).to_list(2000)
        return [r["user_id"] for r in rows]
    if role == Role.ZONAL_MANAGER.value:
        mgrs = await db.manager_allocations.find({"zonal_manager_id": user["id"]}, {"_id": 0, "user_id": 1}).to_list(2000)
        mgr_ids = [m["user_id"] for m in mgrs]
        rows = await db.admin_allocations.find({"manager_id": {"$in": mgr_ids}}, {"_id": 0, "user_id": 1}).to_list(5000)
        return [r["user_id"] for r in rows]
    return []  # players / others see nothing


async def _commission_for_week(week_offset: int, admin_ids=None) -> dict:
    """Aggregate the per-round house commission for a given Sun–Sat week,
    optionally scoped to a set of owning Admin ids (None = platform-wide)."""
    from datetime import datetime, timezone, timedelta
    from ..db import db
    from .. import revenue_service

    today = datetime.now(timezone.utc).date()
    ws, we = revenue_service.week_bounds(today - timedelta(days=7 * week_offset))
    start_iso = datetime(ws.year, ws.month, ws.day, tzinfo=timezone.utc).isoformat()
    end_iso = (datetime(we.year, we.month, we.day, tzinfo=timezone.utc) + timedelta(days=1)).isoformat()

    match: dict = {"created_at": {"$gte": start_iso, "$lt": end_iso}}
    if admin_ids is not None:
        match["admin_id"] = {"$in": admin_ids}

    games: dict[str, dict] = {}
    grand = {"bets": 0, "payouts": 0, "commission": 0, "super_admin_share": 0, "admin_share": 0, "rounds": 0}
    if admin_ids is None or len(admin_ids) > 0:
        pipeline = [
            {"$match": match},
            {"$group": {
                "_id": {"game_type": "$game_type", "bet_type": "$bet_type"},
                "bets": {"$sum": "$pot"}, "rake": {"$sum": "$rake"},
                "sa": {"$sum": "$super_admin_share"}, "admin": {"$sum": "$admin_share"},
                "rounds": {"$sum": 1},
            }},
        ]
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


_REPORT_ROLES = require_roles(Role.SUPER_ADMIN, Role.ZONAL_MANAGER, Role.MANAGER, Role.ADMIN)


# Super Admin: rake/commission taken by the house across games.
@router.get("/admin/rake", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def rake_ledger():
    from ..db import db
    rows = await db.casino_rake_ledger.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    total = sum(r["rake"] for r in rows)
    return {"total_rake": total, "entries": rows}


@router.get("/admin/commission-report")
async def commission_report(week_offset: int = 0, user: dict = Depends(_REPORT_ROLES)):
    """Weekly rollup of the house commission recorded per-round in
    casino_rake_ledger — auto-summed, ROLE-SCOPED: Super Admin sees the whole
    platform; Zonal Manager / Manager / Admin each see only their own downline's
    commission. Broken down by game_type (and bet_type where present, e.g. Thane
    Matka Single/Jodi/Panna/Motor). Payouts = bets − commission."""
    return await _commission_for_week(week_offset, await _downline_admin_ids(user))


@router.get("/admin/commission-trend")
async def commission_trend(weeks: int = 8, user: dict = Depends(_REPORT_ROLES)):
    """Week-over-week House P&L (role-scoped) for the last N Sun–Sat weeks."""
    weeks = max(1, min(weeks, 26))
    scope = await _downline_admin_ids(user)
    points = []
    for off in range(weeks - 1, -1, -1):
        w = await _commission_for_week(off, scope)
        t = w["totals"]
        points.append({"week_start": w["week_start"], "week_end": w["week_end"], "week_offset": off,
                       "commission": t["commission"], "bets": t["bets"], "payouts": t["payouts"]})
    return {"weeks": weeks, "points": points}


@router.get("/admin/commission-report.csv")
async def commission_report_csv(week_offset: int = 0, user: dict = Depends(_REPORT_ROLES)):
    """One-tap CSV export of a week's commission breakdown (role-scoped)."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    w = await _commission_for_week(week_offset, await _downline_admin_ids(user))
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f"ROYAL11 Casino Commission — week {w['week_start']} to {w['week_end']}"])
    writer.writerow(["Game", "Bet Type", "Bets", "Payouts", "Commission (70%)", "SA Share", "Admin Share", "Rounds"])
    for g in w["games"]:
        writer.writerow([g["game_type"], "", g["bets"], g["payouts"], g["commission"],
                         g["super_admin_share"], g["admin_share"], g["rounds"]])
        for b in g.get("bet_types", []):
            writer.writerow([g["game_type"], b["bet_type"], b["bets"], b["payouts"],
                             b["commission"], "", "", b["rounds"]])
    t = w["totals"]
    writer.writerow(["TOTAL", "", t["bets"], t["payouts"], t["commission"],
                     t["super_admin_share"], t["admin_share"], t["rounds"]])
    buf.seek(0)
    fname = f"royal11_commission_{w['week_start']}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f"attachment; filename={fname}"})


@router.get("/admin/commission-report.pdf")
async def commission_report_pdf(week_offset: int = 0, user: dict = Depends(_REPORT_ROLES)):
    """One-tap formatted PDF export of a week's commission breakdown (role-scoped)."""
    import io
    from fastapi.responses import StreamingResponse
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import getSampleStyleSheet

    w = await _commission_for_week(week_offset, await _downline_admin_ids(user))
    t = w["totals"]
    labels = {"rummy_points": "Points Rummy", "high_card": "High Card", "thane_matka": "Thane Matka"}

    def n(v):
        return f"{(v or 0):,}"

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm)
    styles = getSampleStyleSheet()
    title = styles["Title"]; title.textColor = colors.HexColor("#c41230")
    story = [
        Paragraph("ROYAL11 — Casino Commission Report", title),
        Paragraph(f"Week: {w['week_start']} to {w['week_end']} &nbsp;·&nbsp; House commission (70%) auto-summed from the per-round rake ledger", styles["Normal"]),
        Spacer(1, 8 * mm),
    ]

    summary = [
        ["Total Bets", "Total Payouts", "House Commission", "SA Share", "Admin Share", "Rounds"],
        [n(t["bets"]), n(t["payouts"]), n(t["commission"]), n(t["super_admin_share"]), n(t["admin_share"]), n(t["rounds"])],
    ]
    st = Table(summary, hAlign="LEFT")
    st.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0ea5e9")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 1), (-1, 1), "Helvetica-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story += [st, Spacer(1, 8 * mm), Paragraph("Breakdown by game", styles["Heading3"])]

    rows = [["Game", "Bets", "Payouts", "Commission (70%)", "Rounds"]]
    for g in w["games"]:
        rows.append([labels.get(g["game_type"], g["game_type"]), n(g["bets"]), n(g["payouts"]), n(g["commission"]), n(g["rounds"])])
        for b in g.get("bet_types", []):
            rows.append([f"   \u21b3 {b['bet_type']}", n(b["bets"]), n(b["payouts"]), n(b["commission"]), n(b["rounds"])])
    if len(rows) == 1:
        rows.append(["No game activity this week", "", "", "", ""])
    gt = Table(rows, hAlign="LEFT", colWidths=[70 * mm, 25 * mm, 25 * mm, 35 * mm, 20 * mm])
    gt.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f2937")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(gt)

    doc.build(story)
    buf.seek(0)
    fname = f"royal11_commission_{w['week_start']}.pdf"
    return StreamingResponse(iter([buf.getvalue()]), media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={fname}"})


@router.get("/admin/vip-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_vip_config():
    from ..games import progression_service
    return await progression_service.get_config()


class VipConfigRequest(BaseModel):
    coins_per_xp: int | None = None
    practice_multiplier: float | None = None
    recharge_bonus_max_coins: int | None = None
    tiers: list[dict] | None = None


@router.put("/admin/vip-config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_vip_config(payload: VipConfigRequest):
    from ..games import progression_service
    return await progression_service.set_config(payload.model_dump(exclude_none=True))
