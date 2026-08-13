"""Weekly Surprise Box — an engagement reward tied to a player's activity across
a full Sun–Sat week, delivered through the shared bonus rail (so it's playable
but non-withdrawable until played through).

Design (as approved):
- Cycle = Sun–Sat, reusing revenue_service.week_bounds. A box is ONLY ever for a
  fully COMPLETED week (the previous week) — it can never be "banked early" mid-week.
- Qualify by whole-week activity: >= min_rounds real-money rounds (or >= min_xp).
- Reward is GUARANTEED (not chance-based) but HIDDEN until opened. It SCALES with
  how much the player played all week (activity_factor ramp) and their weekly
  recharge + VIP tier cap:  reward = clamp(recharge x pct x activity_factor, cap),
  floored to a consolation so a qualified box is never empty.
- Generated lazily on read (idempotent) and by the weekly scheduler; expires after
  `expiry_days`. Opening grants the coins as a bonus (playthrough applies).
All thresholds/%/caps are Super-Admin configurable via `surprise_box_config`.
"""
import uuid
from datetime import datetime, timezone, timedelta, date

from pymongo.errors import DuplicateKeyError

from .db import db
from . import revenue_service, bonus_service
from .games import progression_service

DEFAULTS = {
    "min_rounds": 20,        # weekly rounds to qualify
    "min_xp": 0,             # optional OR-qualifier (0 = disabled)
    "full_rounds": 60,       # rounds at which activity_factor hits 1.0
    "floor_factor": 0.4,     # activity_factor at exactly min_rounds
    "bonus_pct": 20,         # % of weekly recharge
    "consolation": 100,      # guaranteed floor for a qualified box
    "tier_caps": {"bronze": 500, "silver": 1500, "gold": 4000, "platinum": 10000, "royal": 25000},
    "expiry_days": 7,
    "multiple": 3,           # wagering multiple applied to the granted bonus
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def ensure_indexes() -> None:
    await db.surprise_boxes.create_index([("user_id", 1), ("week", 1)], unique=True)


async def get_config() -> dict:
    doc = await db.surprise_box_config.find_one({"_id": "surprise_box"}, {"_id": 0})
    return {**DEFAULTS, **(doc or {})}


async def set_config(patch: dict) -> dict:
    keys = ("min_rounds", "min_xp", "full_rounds", "floor_factor", "bonus_pct",
            "consolation", "tier_caps", "expiry_days", "multiple")
    await db.surprise_box_config.update_one(
        {"_id": "surprise_box"}, {"$set": {k: patch[k] for k in keys if k in patch}}, upsert=True)
    return await get_config()


def _last_completed_week(today: date) -> tuple[str, str, str]:
    ws, we = revenue_service.week_bounds(today - timedelta(days=7))
    start_iso = datetime(ws.year, ws.month, ws.day, tzinfo=timezone.utc).isoformat()
    end_excl = (datetime(we.year, we.month, we.day, tzinfo=timezone.utc) + timedelta(days=1)).isoformat()
    return ws.isoformat(), start_iso, end_excl


async def _week_activity(user_id: str, start_iso: str, end_excl: str) -> dict:
    rounds = await db.xp_events.count_documents(
        {"user_id": user_id, "created_at": {"$gte": start_iso, "$lt": end_excl}})
    xp = 0
    async for r in db.xp_events.aggregate([
        {"$match": {"user_id": user_id, "created_at": {"$gte": start_iso, "$lt": end_excl}}},
        {"$group": {"_id": None, "xp": {"$sum": "$xp"}}},
    ]):
        xp = r["xp"]
    recharge = 0
    async for r in db.deposits.aggregate([
        {"$match": {"player_id": user_id, "status": "CONFIRMED",
                    "confirmed_at": {"$gte": start_iso, "$lt": end_excl}}},
        {"$group": {"_id": None, "coins": {"$sum": "$coins_to_credit"}}},
    ]):
        recharge = r["coins"]
    return {"rounds": rounds, "xp": xp, "recharge": recharge}


def _compute_amount(recharge: int, rounds: int, tier_key: str, cfg: dict) -> int:
    span = max(1, cfg["full_rounds"] - cfg["min_rounds"])
    ramp = max(0.0, min(1.0, (rounds - cfg["min_rounds"]) / span))
    activity_factor = cfg["floor_factor"] + (1 - cfg["floor_factor"]) * ramp
    raw = recharge * cfg["bonus_pct"] / 100 * activity_factor
    cap = cfg["tier_caps"].get(tier_key, cfg["tier_caps"]["bronze"])
    return max(int(cfg["consolation"]), min(int(round(raw)), int(cap)))


async def ensure_box(user_id: str) -> dict:
    """Idempotently materialise the previous completed week's box for a player.
    Caches a 'none' marker when they didn't qualify so we don't recompute."""
    week_key, start_iso, end_excl = _last_completed_week(_now().date())
    existing = await db.surprise_boxes.find_one({"user_id": user_id, "week": week_key}, {"_id": 0})
    if existing:
        # lazily expire an unopened box past its window
        if existing["status"] == "ready" and existing.get("expires_at", "") < _iso(_now()):
            await db.surprise_boxes.update_one(
                {"user_id": user_id, "week": week_key}, {"$set": {"status": "expired"}})
            existing["status"] = "expired"
        return existing

    cfg = await get_config()
    act = await _week_activity(user_id, start_iso, end_excl)
    qualified = act["rounds"] >= cfg["min_rounds"] or (cfg["min_xp"] > 0 and act["xp"] >= cfg["min_xp"])
    base = {"id": str(uuid.uuid4()), "user_id": user_id, "week": week_key,
            "rounds": act["rounds"], "recharge": act["recharge"], "created_at": _iso(_now())}
    if not qualified:
        doc = {**base, "status": "none", "amount": 0, "tier": None,
               "expires_at": None, "opened_at": None}
    else:
        prog = await progression_service.get_progression(user_id)
        tier_val = prog.get("tier")
        tier_key = tier_val.get("key", "bronze") if isinstance(tier_val, dict) else (tier_val or "bronze")
        amount = _compute_amount(act["recharge"], act["rounds"], tier_key, cfg)
        doc = {**base, "status": "ready", "amount": amount, "tier": tier_key,
               "expires_at": _iso(_now() + timedelta(days=cfg["expiry_days"])), "opened_at": None}
    try:
        await db.surprise_boxes.insert_one(dict(doc))
    except DuplicateKeyError:
        return await db.surprise_boxes.find_one({"user_id": user_id, "week": week_key}, {"_id": 0})
    doc.pop("_id", None)
    return doc


async def get_status(user_id: str) -> dict:
    """Player-facing status — the amount stays HIDDEN until the box is opened."""
    box = await ensure_box(user_id)
    return {
        "status": box["status"],                 # none | ready | opened | expired
        "week": box["week"],
        "ready": box["status"] == "ready",
        "expires_at": box.get("expires_at"),
        "opened_amount": box["amount"] if box["status"] == "opened" else None,
    }


async def open_box(user_id: str) -> dict:
    box = await ensure_box(user_id)
    if box["status"] == "opened":
        return {"status": "opened", "amount": box["amount"], "already": True}
    if box["status"] != "ready":
        raise ValueError("No surprise box is available to open")
    if box.get("expires_at", "") < _iso(_now()):
        await db.surprise_boxes.update_one({"id": box["id"]}, {"$set": {"status": "expired"}})
        raise ValueError("Your surprise box has expired")

    cfg = await get_config()
    await bonus_service.grant_bonus(
        user_id, "surprise_box", box["amount"],
        request_id=f"surprise_box:{user_id}:{box['week']}",
        multiple=cfg["multiple"], expiry_days=cfg["expiry_days"], source_ref=box["id"])
    await db.surprise_boxes.update_one(
        {"id": box["id"]}, {"$set": {"status": "opened", "opened_at": _iso(_now())}})
    return {"status": "opened", "amount": box["amount"], "already": False,
            "bonus": await bonus_service.get_status(user_id)}


async def generate_boxes() -> int:
    """Scheduler hook (weekly rollover): pre-create boxes for everyone active in
    the just-completed week. Uses the same window as ensure_box."""
    _week_key, start_iso, end_excl = _last_completed_week(_now().date())
    users = await db.xp_events.distinct("user_id", {"created_at": {"$gte": start_iso, "$lt": end_excl}})
    made = 0
    for uid in users:
        try:
            box = await ensure_box(uid)
            if box["status"] == "ready":
                made += 1
        except Exception:
            continue
    return made
