"""Independence Day Festival Gift bonus.

A one-tap, once-per-player festival gift delivered via the shared bonus rail
(non-withdrawable, playable/unlockable-as-you-play — same pattern as VIP
Recharge Bonus). Only claimable while the festival window is active (server
enforces the window; the client never decides eligibility). Idempotent per
(festival, user); every credit lands in the standard bonus ledger so Super
Admin sees who claimed and when.
"""
import logging
from datetime import datetime, timezone

from . import bonus_service
from .db import db

logger = logging.getLogger(__name__)

FESTIVAL_ID = "independence_2026"
FESTIVAL_NAME = "Independence Day Gift"
FESTIVAL_AMOUNT = 151  # auspicious festival amount


def _now() -> datetime:
    return datetime.now(timezone.utc)


def is_active(now: datetime | None = None) -> bool:
    """Aug 13–16 window — mirrors the frontend `isIndependenceWindow`."""
    now = now or _now()
    return now.month == 8 and 13 <= now.day <= 16


async def ensure_indexes() -> None:
    await db.festival_claims.create_index("id", unique=True)


async def _claimed(user_id: str) -> bool:
    return bool(await db.festival_claims.find_one(
        {"id": f"{FESTIVAL_ID}:{user_id}"}, {"_id": 0, "id": 1}))


async def get_status(user_id: str) -> dict:
    return {
        "festival_id": FESTIVAL_ID,
        "festival_name": FESTIVAL_NAME,
        "bonus_coins": FESTIVAL_AMOUNT,
        "active": is_active(),
        "claimed": await _claimed(user_id),
    }


async def claim(user_id: str) -> dict:
    if not is_active():
        raise ValueError("The Independence Day gift isn't available right now")
    if await _claimed(user_id):
        raise ValueError("You've already claimed your Independence Day gift")

    await bonus_service.grant_bonus(
        user_id, "festival", FESTIVAL_AMOUNT,
        request_id=f"festival:{FESTIVAL_ID}:{user_id}", source_ref=FESTIVAL_ID)
    await db.festival_claims.update_one(
        {"id": f"{FESTIVAL_ID}:{user_id}"},
        {"$setOnInsert": {
            "id": f"{FESTIVAL_ID}:{user_id}", "user_id": user_id,
            "festival_id": FESTIVAL_ID, "coins": FESTIVAL_AMOUNT,
            "claimed_at": _now().isoformat(),
        }},
        upsert=True,
    )
    return {"festival_id": FESTIVAL_ID, "bonus_coins": FESTIVAL_AMOUNT, "claimed": True}
