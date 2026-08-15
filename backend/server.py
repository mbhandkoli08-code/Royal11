from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List
import uuid
import json
import re
from datetime import datetime, timezone
from emergentintegrations.llm.chat import LlmChat, UserMessage

from app.db import client, db
from app.wallet_service import ensure_indexes
from app.deposit_service import ensure_deposit_indexes
from app.hierarchy_service import ensure_hierarchy_indexes
from app.fantasy_service import ensure_fantasy_indexes, settle_due_contests, ensure_demo_fantasy
from app import revenue_service, storage_service, payroll_service, login_security, otp_service, bonus_service, surprise_box_service, support_service, referral_service, admin_credit_service, promo_service, festival_service, notification_service
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import date, timedelta
from app.routers.auth import router as auth_router
from app.routers.wallet import router as wallet_router
from app.routers.admin import router as admin_router
from app.routers.zonal import router as zonal_router
from app.routers.games import router as games_router
from app.routers.fantasy import router as fantasy_router, admin_router as fantasy_admin_router
from app.routers.superadmin import router as superadmin_router
from app.routers.api_keys import router as api_keys_router
from app.routers.cricket import router as cricket_router
from app.routers.branding import router as branding_router, public_router as branding_public_router
from app.routers.security import router as security_router
from app.routers.casino import router as casino_router
from app.routers.rummy import router as rummy_router
from app.routers.bonus import router as bonus_router
from app.routers.support import router as support_router
from app.routers.referrals import router as referrals_router
from app.routers.profile import router as profile_router
from app.routers.admin_credit import router as admin_credit_router
from app.routers.promo import router as promo_router
from app.routers.notifications import router as notifications_router
from app.routers.chatbot import router as chatbot_router
from app.routers.crypto_purchase import router as crypto_purchase_router
from app.routers.settlement import router as settlement_router
from app.routers.daily_bonus import router as daily_bonus_router
from app.games import engine as casino_engine
from app.games import progression_service as casino_progression


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")  # Ignore MongoDB's _id field
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    
    # Convert to dict and serialize datetime to ISO string for MongoDB
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    
    _ = await db.status_checks.insert_one(doc)
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    # Exclude MongoDB's _id field from the query results
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    
    # Convert ISO string timestamps back to datetime objects
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    
    return status_checks


# ---------------- Fantasy AI Coach (Claude Sonnet 4.6) ----------------

class Player(BaseModel):
    id: str
    name: str
    team: str
    role: str
    credits: float
    points: int

class CoachRequest(BaseModel):
    players: List[Player]
    budget: float = 100
    size: int = 11

class CoachResponse(BaseModel):
    xi: List[str]
    captain: str
    vice: str
    rationale: str
    source: str  # "ai" or "fallback"


def _extract_json(text: str):
    if not text:
        return None
    start = text.find('{')
    end = text.rfind('}')
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        return json.loads(text[start:end + 1])
    except Exception:
        return None


def _fallback_pick(players: List[Player], budget: float, size: int):
    # Start from the cheapest `size` players to guarantee we're within budget
    # (when feasible), then greedily upgrade to higher-point players.
    by_cheap = sorted(players, key=lambda p: p.credits)
    xi = list(by_cheap[:size])
    pool = list(by_cheap[size:])
    used = sum(p.credits for p in xi)
    improved = True
    while improved:
        improved = False
        for cand in sorted(pool, key=lambda p: p.points, reverse=True):
            worst = min(xi, key=lambda p: p.points)
            if cand.points > worst.points and used - worst.credits + cand.credits <= budget + 0.001:
                xi.remove(worst)
                pool.remove(cand)
                xi.append(cand)
                pool.append(worst)
                used = used - worst.credits + cand.credits
                improved = True
                break
    ranked = sorted(xi, key=lambda p: p.points, reverse=True)
    return {
        "xi": [p.id for p in xi],
        "captain": ranked[0].id,
        "vice": ranked[1].id if len(ranked) > 1 else ranked[0].id,
    }


def _build_from_ranking(players: List[Player], ranking: List[str], budget: float, size: int):
    pmap = {p.id: p for p in players}
    ordered = [pmap[i] for i in ranking if i in pmap]
    for p in players:  # append anything the model left out
        if p not in ordered:
            ordered.append(p)
    chosen, used = [], 0.0
    for p in ordered:
        if len(chosen) >= size:
            break
        slots_after = size - len(chosen) - 1
        rest = [q for q in ordered if q not in chosen and q.id != p.id]
        cheapest_rest = sorted(q.credits for q in rest)[:slots_after]
        if slots_after <= len(rest) and used + p.credits + sum(cheapest_rest) <= budget + 0.001:
            chosen.append(p)
            used += p.credits
    if len(chosen) < size:  # safety fill
        for p in sorted(ordered, key=lambda x: x.credits):
            if len(chosen) >= size:
                break
            if p not in chosen:
                chosen.append(p)
    return chosen


@api_router.post("/fantasy/coach", response_model=CoachResponse)
async def fantasy_coach(req: CoachRequest):
    pmap = {p.id: p for p in req.players}
    players_json = json.dumps([p.model_dump() for p in req.players])

    system_message = (
        "You are ROYAL11's Fantasy Cricket AI Coach for a T20 match. "
        "You reply with STRICT JSON only — no markdown fences, no prose."
    )
    prompt = (
        f"Analyse the player pool below for a T20 fantasy match and rank EVERY player from most "
        f"to least valuable (consider form 'points', role balance and match impact).\n"
        f"Also nominate a captain (earns 2x) and a vice-captain (1.5x) — your two highest-impact "
        f"players, and they must be different.\n\n"
        f"Player pool (JSON):\n{players_json}\n\n"
        f'Respond with STRICT JSON exactly like:\n'
        f'{{"ranking": ["id_best", "...", "id_worst"], "captain": "id", "vice": "id", '
        f'"rationale": "1-2 short sentences on your strategy"}}\n'
        f"'ranking' must include ALL {len(req.players)} player ids exactly once."
    )

    source = "fallback"
    rationale = ""
    data = None
    try:
        chat = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=str(uuid.uuid4()),
            system_message=system_message,
        ).with_model("anthropic", "claude-sonnet-4-6")
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp if isinstance(resp, str) else getattr(resp, "text", str(resp))
        logger.info(f"AI coach raw (type={type(resp).__name__}): {str(text)[:400]}")
        data = _extract_json(text)
    except Exception as e:
        logger.error(f"AI coach error: {e}")
        data = None

    ranking = data.get("ranking") if data else None
    # The model provides the strategy/order; the backend enforces the hard budget.
    if isinstance(ranking, list) and any(i in pmap for i in ranking):
        source = "ai"
        rationale = str(data.get("rationale", "")).strip() if data else ""
        chosen = _build_from_ranking(req.players, ranking, req.budget, req.size)
        chosen_ids = [p.id for p in chosen]
        cap = data.get("captain")
        vice = data.get("vice")
        if cap not in chosen_ids or vice not in chosen_ids or cap == vice:
            ranked = sorted(chosen, key=lambda p: p.points, reverse=True)
            cap = ranked[0].id
            vice = ranked[1].id if len(ranked) > 1 else ranked[0].id
        xi = chosen_ids
    else:
        fb = _fallback_pick(req.players, req.budget, req.size)
        xi, cap, vice = fb["xi"], fb["captain"], fb["vice"]

    if not rationale:
        rationale = "Picked the highest-scoring balanced XI that fits your credit budget."

    result = {"xi": xi, "captain": cap, "vice": vice, "rationale": rationale, "source": source}

    try:
        await db.ai_suggestions.insert_one({
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "budget": req.budget,
            "size": req.size,
            "result": result,
        })
    except Exception as e:
        logger.error(f"Failed to store suggestion: {e}")

    return result


# ---------------- AI Match Preview (Gemini 3 Flash) ----------------

class MatchPreviewRequest(BaseModel):
    sport: str
    league: str
    team_a: str
    team_b: str
    context: str = ""

class MatchPreviewResponse(BaseModel):
    preview: str
    favorite: str
    win_prob: int
    prediction: str
    source: str  # "ai" or "fallback"


@api_router.post("/match/preview", response_model=MatchPreviewResponse)
async def match_preview(req: MatchPreviewRequest):
    system_message = (
        "You are ROYAL11's witty, sharp sports analyst. You write a crisp, exciting "
        "pre-match preview and a win prediction. Reply with STRICT JSON only — no markdown, no prose."
    )
    prompt = (
        f"Write a short, punchy preview for this live {req.sport} match in the {req.league}: "
        f"{req.team_a} vs {req.team_b}. Current situation: {req.context or 'match in progress'}.\n\n"
        f'Respond with STRICT JSON exactly like:\n'
        f'{{"preview": "1-2 energetic sentences", "favorite": "{req.team_a} or {req.team_b}", '
        f'"win_prob": 55, "prediction": "a short one-line verdict / likely result"}}\n'
        f"win_prob is an integer 0-100 = the favorite's chance to win."
    )

    data = None
    try:
        chat = LlmChat(
            api_key=os.environ['EMERGENT_LLM_KEY'],
            session_id=str(uuid.uuid4()),
            system_message=system_message,
        ).with_model("gemini", "gemini-3-flash-preview")
        resp = await chat.send_message(UserMessage(text=prompt))
        text = resp if isinstance(resp, str) else getattr(resp, "text", str(resp))
        data = _extract_json(text)
    except Exception as e:
        logger.error(f"Match preview error: {e}")
        data = None

    fav = req.team_a
    prob = 50
    valid = False
    if data:
        fav = data.get("favorite") if data.get("favorite") in (req.team_a, req.team_b) else req.team_a
        try:
            prob = max(0, min(100, int(data.get("win_prob", 50))))
        except (TypeError, ValueError):
            prob = 50
        if str(data.get("preview", "")).strip():
            valid = True

    if valid:
        result = {
            "preview": str(data["preview"]).strip(),
            "favorite": fav,
            "win_prob": prob,
            "prediction": str(data.get("prediction", "")).strip() or "Too close to call — should be a thriller.",
            "source": "ai",
        }
    else:
        result = {
            "preview": f"{req.team_a} take on {req.team_b} in a {req.league} clash that's poised on a knife's edge.",
            "favorite": req.team_a,
            "win_prob": 55,
            "prediction": "Momentum matters — expect a close finish.",
            "source": "fallback",
        }

    try:
        await db.match_previews.insert_one({
            "id": str(uuid.uuid4()),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "match": req.model_dump(),
            "result": result,
        })
    except Exception as e:
        logger.error(f"Failed to store match preview: {e}")

    return result


# Include the router in the main app
api_router.include_router(auth_router)
api_router.include_router(wallet_router)
api_router.include_router(admin_router)
api_router.include_router(zonal_router)
api_router.include_router(games_router)
api_router.include_router(fantasy_router)
api_router.include_router(fantasy_admin_router)
api_router.include_router(superadmin_router)
api_router.include_router(api_keys_router)
api_router.include_router(cricket_router)
api_router.include_router(branding_router)
api_router.include_router(branding_public_router)
api_router.include_router(security_router)
api_router.include_router(casino_router)
api_router.include_router(rummy_router)
api_router.include_router(bonus_router)
api_router.include_router(support_router)
api_router.include_router(referrals_router)
api_router.include_router(profile_router)
api_router.include_router(admin_credit_router)
api_router.include_router(promo_router)
api_router.include_router(notifications_router)
api_router.include_router(chatbot_router)
api_router.include_router(crypto_purchase_router)
api_router.include_router(settlement_router)
api_router.include_router(daily_bonus_router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


async def _daily_maintenance():
    """Idempotent: regenerate yesterday's summary, (re)generate the most recent
    week's settlements, and apply/lift settlement-overdue suspensions."""
    try:
        await revenue_service.generate_daily_summary(date.today() - timedelta(days=1))
        await revenue_service.ensure_recent_settlements()
        await revenue_service.send_due_reminders()
        await payroll_service.run_recent_payroll()
        await bonus_service.expire_bonuses()
        await surprise_box_service.generate_boxes()
    except Exception as e:
        logger.error(f"daily maintenance failed: {e}")


async def _settle_fantasy():
    try:
        result = await settle_due_contests()
        if result.get("settled") or result.get("needs_review"):
            logger.info(f"fantasy settlement: {result}")
    except Exception as e:
        logger.error(f"fantasy settlement failed: {e}")


@app.on_event("startup")
async def ensure_db_indexes():
    await ensure_indexes()
    await ensure_deposit_indexes()
    await ensure_hierarchy_indexes()
    await ensure_fantasy_indexes()
    try:
        await ensure_demo_fantasy()
    except Exception as e:  # noqa: BLE001
        logger.error(f"Demo fantasy seed failed: {type(e).__name__}")
    await login_security.ensure_indexes()
    await otp_service.ensure_indexes()
    from app import password_reset_service
    await password_reset_service.ensure_indexes()
    from app import daily_bonus_service
    await daily_bonus_service.ensure_indexes()
    await casino_engine.ensure_indexes()
    from app.games import slots_service as casino_slots
    await casino_slots.ensure_indexes()
    await casino_progression.ensure_indexes()
    from app import chatbot_service
    await chatbot_service.ensure_indexes()
    from app import crypto_purchase_service
    await crypto_purchase_service.ensure_indexes()
    from app import bank_template_service
    await bank_template_service.ensure_indexes()
    await bank_template_service.seed_starter_templates()
    await bonus_service.ensure_indexes()
    await surprise_box_service.ensure_indexes()
    await support_service.ensure_support_indexes()
    await referral_service.ensure_indexes()
    await admin_credit_service.ensure_indexes()
    await promo_service.ensure_indexes()
    await festival_service.ensure_indexes()
    await notification_service.ensure_indexes()
    try:
        await promo_service.seed_demo_codes()
    except Exception as e:  # noqa: BLE001
        logger.error(f"Promo seed failed: {type(e).__name__}")
    try:
        await storage_service.init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed (screenshots will retry lazily): {type(e).__name__}")
    # Runs every day at 00:10 UTC; lazy on-read generation covers the rest.
    scheduler.add_job(_daily_maintenance, "cron", hour=0, minute=10, id="daily_maintenance", replace_existing=True)
    scheduler.add_job(_settle_fantasy, "interval", minutes=15, id="fantasy_settlement", replace_existing=True)
    scheduler.start()

@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        scheduler.shutdown(wait=False)
    except Exception:
        pass
    client.close()