"""Free-practice chip balance — completely separate from the real coin wallet.

Practice chips are non-withdrawable, earn no real payout, incur no rake/revenue,
and auto top-up so new players can learn any game risk-free. Games played in
practice still use the SAME provably-fair RNG, so they feel identical.
"""
from ..db import db

START_CHIPS = 10_000
REFILL_TO = 5_000
REFILL_WHEN_BELOW = 500


class InsufficientChips(Exception):
    pass


async def get_balance(user_id: str) -> int:
    doc = await db.practice_wallets.find_one({"user_id": user_id}, {"_id": 0, "balance": 1})
    if not doc:
        await db.practice_wallets.insert_one({"user_id": user_id, "balance": START_CHIPS})
        return START_CHIPS
    return doc["balance"]


async def ensure_min(user_id: str) -> int:
    """Top practice chips back up if the player has run low (keeps play risk-free)."""
    bal = await get_balance(user_id)
    if bal < REFILL_WHEN_BELOW:
        await db.practice_wallets.update_one({"user_id": user_id}, {"$set": {"balance": REFILL_TO}})
        return REFILL_TO
    return bal


async def debit(user_id: str, amount: int) -> None:
    bal = await ensure_min(user_id)
    if bal < amount:
        raise InsufficientChips("Not enough practice chips")
    await db.practice_wallets.update_one({"user_id": user_id}, {"$inc": {"balance": -amount}})


async def credit(user_id: str, amount: int) -> None:
    await db.practice_wallets.update_one(
        {"user_id": user_id}, {"$inc": {"balance": amount}}, upsert=True)
