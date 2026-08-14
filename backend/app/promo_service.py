"""Promo code / coupon redemption.

Codes grant non-withdrawable bonus coins through the shared bonus rail
(playthrough applies). Each code is once-per-player by default and idempotent
per (code, user). No client-supplied amounts — the reward comes from the stored
code definition only.
"""
import logging
from datetime import datetime, timezone

from . import bonus_service
from .db import db

logger = logging.getLogger(__name__)

# Seeded demo codes (Super Admin can add more later).
_DEMO_CODES = [
    {"code": "WELCOME100", "bonus_coins": 100, "description": "Welcome bonus"},
    {"code": "ROYAL50", "bonus_coins": 50, "description": "Royal boost"},
    {"code": "FANTASY25", "bonus_coins": 25, "description": "Fantasy kickstart"},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes() -> None:
    await db.promo_codes.create_index("code", unique=True)
    await db.promo_redemptions.create_index("id", unique=True)


async def seed_demo_codes() -> None:
    for spec in _DEMO_CODES:
        await db.promo_codes.update_one(
            {"code": spec["code"]},
            {"$setOnInsert": {
                "code": spec["code"],
                "bonus_coins": spec["bonus_coins"],
                "description": spec["description"],
                "active": True,
                "per_user_once": True,
                "max_redemptions": None,
                "redeemed_count": 0,
                "created_at": _now().isoformat(),
            }},
            upsert=True,
        )


async def apply_code(user_id: str, raw_code: str) -> dict:
    code = (raw_code or "").strip().upper()
    if not code:
        raise ValueError("Enter a promo code")
    doc = await db.promo_codes.find_one({"code": code}, {"_id": 0})
    if not doc or not doc.get("active", True):
        raise ValueError("Invalid or expired promo code")
    expires_at = doc.get("expires_at")
    if expires_at and _now().isoformat() > expires_at:
        raise ValueError("This promo code has expired")
    if doc.get("per_user_once", True):
        if await db.promo_redemptions.find_one({"id": f"{code}:{user_id}"}, {"_id": 0, "id": 1}):
            raise ValueError("You've already used this promo code")
    max_red = doc.get("max_redemptions")
    if max_red is not None and doc.get("redeemed_count", 0) >= max_red:
        raise ValueError("This promo code has reached its redemption limit")

    coins = int(doc["bonus_coins"])
    await bonus_service.grant_bonus(
        user_id, "promo", coins, request_id=f"promo:{code}:{user_id}",
        source_ref=f"promo:{code}")
    await db.promo_redemptions.update_one(
        {"id": f"{code}:{user_id}"},
        {"$setOnInsert": {
            "id": f"{code}:{user_id}", "user_id": user_id, "code": code,
            "coins": coins, "created_at": _now().isoformat(),
        }},
        upsert=True,
    )
    await db.promo_codes.update_one({"code": code}, {"$inc": {"redeemed_count": 1}})
    return {"code": code, "bonus_coins": coins, "description": doc.get("description", "")}
