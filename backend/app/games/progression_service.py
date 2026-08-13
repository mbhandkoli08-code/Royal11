"""VIP / level progression — a platform-wide loyalty layer (ROYAL11 original).

Players earn XP by wagering real coins (across Rummy/Casino and Fantasy entries).
XP unlocks tiers (Bronze→Silver→Gold→Platinum→Royal) with rewards like rakeback.
All rates/thresholds are Super-Admin-configurable via the `vip_config` doc.
XP accrual is idempotent per source transaction so retries never double-count.
"""
from datetime import datetime, timezone

from ..db import db

# Defaults (overridable via vip_config). XP = floor(coins_wagered / COINS_PER_XP).
DEFAULTS = {
    "coins_per_xp": 10,
    "practice_multiplier": 0.0,  # practice earns no XP by default
    "recharge_bonus_max_coins": 25_000,  # per-deposit cap on the VIP recharge bonus
    "tiers": [
        {"key": "bronze", "label": "Bronze", "min_xp": 0, "rakeback_pct": 0, "recharge_bonus_pct": 0},
        {"key": "silver", "label": "Silver", "min_xp": 5_000, "rakeback_pct": 2, "recharge_bonus_pct": 5},
        {"key": "gold", "label": "Gold", "min_xp": 25_000, "rakeback_pct": 5, "recharge_bonus_pct": 10},
        {"key": "platinum", "label": "Platinum", "min_xp": 100_000, "rakeback_pct": 8, "recharge_bonus_pct": 18},
        {"key": "royal", "label": "Royal", "min_xp": 500_000, "rakeback_pct": 12, "recharge_bonus_pct": 30},
    ],
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.player_progression.create_index("user_id", unique=True)
    await db.xp_events.create_index("request_id", unique=True)


async def get_config() -> dict:
    doc = await db.vip_config.find_one({"_id": "vip"}, {"_id": 0})
    return {**DEFAULTS, **(doc or {})}


async def set_config(patch: dict) -> dict:
    allowed = {k: patch[k] for k in ("coins_per_xp", "practice_multiplier", "tiers", "recharge_bonus_max_coins") if k in patch}
    await db.vip_config.update_one({"_id": "vip"}, {"$set": allowed}, upsert=True)
    return await get_config()


async def get_recharge_offer(user_id: str) -> dict:
    """The player's standing VIP recharge bonus (tier-based, NOT win-triggered)."""
    cfg = await get_config()
    doc = await db.player_progression.find_one({"user_id": user_id}, {"_id": 0}) or {"xp": 0}
    tier, nxt = _tier_for(doc.get("xp", 0), cfg["tiers"])
    return {
        "tier": tier["key"], "tier_label": tier["label"],
        "bonus_pct": tier.get("recharge_bonus_pct", 0),
        "cap": cfg.get("recharge_bonus_max_coins", 0),
        "next_tier": (nxt or {}).get("label"),
        "next_tier_bonus_pct": (nxt or {}).get("recharge_bonus_pct") if nxt else None,
    }


def recharge_bonus_amount(coins: int, offer: dict) -> int:
    """Compute the bonus coins for a confirmed recharge (capped)."""
    raw = int(coins * offer.get("bonus_pct", 0) / 100)
    cap = offer.get("cap", 0)
    return min(raw, cap) if cap else raw


def _tier_for(xp: int, tiers: list[dict]) -> tuple[dict, dict | None]:
    ordered = sorted(tiers, key=lambda t: t["min_xp"])
    current = ordered[0]
    nxt = None
    for i, t in enumerate(ordered):
        if xp >= t["min_xp"]:
            current = t
            nxt = ordered[i + 1] if i + 1 < len(ordered) else None
    return current, nxt


async def add_wager_xp(user_id: str, coins_wagered: int, source: str, request_id: str,
                       is_practice: bool = False) -> None:
    """Idempotent XP accrual. Call once per settled wager (unique request_id)."""
    cfg = await get_config()
    mult = cfg["practice_multiplier"] if is_practice else 1.0
    gained = int((coins_wagered / max(1, cfg["coins_per_xp"])) * mult)
    if gained <= 0:
        return
    try:
        await db.xp_events.insert_one(
            {"request_id": request_id, "user_id": user_id, "source": source,
             "xp": gained, "created_at": _now()})
    except Exception:
        return  # duplicate request_id → already counted
    await db.player_progression.update_one(
        {"user_id": user_id},
        {"$inc": {"xp": gained, "lifetime_wagered": coins_wagered},
         "$setOnInsert": {"user_id": user_id, "created_at": _now()}},
        upsert=True)


async def get_progression(user_id: str) -> dict:
    cfg = await get_config()
    doc = await db.player_progression.find_one({"user_id": user_id}, {"_id": 0}) or {"xp": 0, "lifetime_wagered": 0}
    xp = doc.get("xp", 0)
    tier, nxt = _tier_for(xp, cfg["tiers"])
    span = (nxt["min_xp"] - tier["min_xp"]) if nxt else 1
    progress = 100 if not nxt else round(min(100, (xp - tier["min_xp"]) / max(1, span) * 100))
    return {
        "xp": xp, "lifetime_wagered": doc.get("lifetime_wagered", 0),
        "tier": tier["key"], "tier_label": tier["label"], "rakeback_pct": tier["rakeback_pct"],
        "next_tier": nxt["label"] if nxt else None,
        "xp_to_next": (nxt["min_xp"] - xp) if nxt else 0,
        "progress_pct": progress,
        "tiers": cfg["tiers"],
    }
