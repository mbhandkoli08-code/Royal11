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
from app.routers.auth import router as auth_router
from app.routers.wallet import router as wallet_router
from app.routers.admin import router as admin_router


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


# Include the router in the main app
api_router.include_router(auth_router)
api_router.include_router(wallet_router)
api_router.include_router(admin_router)
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

@app.on_event("startup")
async def ensure_db_indexes():
    await ensure_indexes()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()