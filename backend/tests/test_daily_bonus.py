"""Daily Bonus: one idempotent claim per IST calendar day, credited to the
non-withdrawable bonus rail. Uses a throwaway user (never touches seeds)."""
import asyncio
import uuid
from datetime import datetime, timezone

from app import daily_bonus_service, bonus_service, wallet_service
from app.db import db


async def _mk_user():
    uid = f"test-daily-{uuid.uuid4()}"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_one({"id": uid, "role": "PLAYER", "status": "ACTIVE",
                               "email": f"{uid}@t.local", "display_name": "T", "created_at": now})
    await wallet_service.get_or_create_wallet(uid)
    return uid


async def _cleanup(uid):
    await db.users.delete_many({"id": uid})
    await db.wallets.delete_many({"user_id": uid})
    await db.daily_bonus_claims.delete_many({"user_id": uid})
    await db.ledger_transactions.delete_many({"user_id": uid})
    await db.bonus_grants.delete_many({"user_id": uid})


async def _bonus_balance(uid):
    w = await db.wallets.find_one({"user_id": uid}, {"_id": 0, "bonus_balance": 1})
    return (w or {}).get("bonus_balance", 0)


def test_daily_bonus_matrix():
    """One event loop (motor binds to the first) — claim/idempotency + disabled."""
    async def go():
        uid = await _mk_user()
        try:
            await daily_bonus_service.set_config({"enabled": True, "amount": 50})
            st = await daily_bonus_service.status(uid)
            assert st["claimable"] is True and st["amount"] == 50
            assert st["next_claim_at"] and st["server_time"]

            before = await _bonus_balance(uid)
            after_claim = await daily_bonus_service.claim(uid)
            assert after_claim["claimed_today"] is True
            assert after_claim["claimable"] is False
            assert await _bonus_balance(uid) - before == 50

            # Second claim same IST day -> rejected, no extra credit.
            try:
                await daily_bonus_service.claim(uid)
                assert False, "expected DailyBonusError on second claim"
            except daily_bonus_service.DailyBonusError:
                pass
            assert await _bonus_balance(uid) - before == 50

            # The bonus grant is keyed by the claim id (idempotency); a BONUS_GRANT
            # ledger row is written for the user.
            today = daily_bonus_service._ist_date(daily_bonus_service._now())
            grant = await db.bonus_grants.find_one(
                {"user_id": uid, "request_id": f"daily_bonus:{uid}:{today}"}, {"_id": 0})
            assert grant is not None, "bonus grant not recorded under claim id"
            led = await db.ledger_transactions.find_one(
                {"user_id": uid, "type": "BONUS_GRANT"}, {"_id": 0})
            assert led is not None, "no BONUS_GRANT ledger row"

            # Disabled config blocks claim for a fresh user.
            uid2 = await _mk_user()
            try:
                await daily_bonus_service.set_config({"enabled": False, "amount": 50})
                st2 = await daily_bonus_service.status(uid2)
                assert st2["claimable"] is False
                try:
                    await daily_bonus_service.claim(uid2)
                    assert False, "expected DailyBonusError when disabled"
                except daily_bonus_service.DailyBonusError:
                    pass
            finally:
                await daily_bonus_service.set_config({"enabled": True, "amount": 50})
                await _cleanup(uid2)
        finally:
            await _cleanup(uid)
    asyncio.run(go())
