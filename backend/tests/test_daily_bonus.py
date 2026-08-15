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

            # Streak ladder (day-7 jackpot + reset) — same loop, same client.
            await _streak_scenarios()
            await daily_bonus_service.set_config({"enabled": True, "amount": 50, "day7_amount": 250})
        finally:
            await _cleanup(uid)
    asyncio.run(go())



def test_streak_ladder_and_next_day_pure():
    """Pure streak helpers: 7-day ladder + continuation/loop/reset rules."""
    cfg = {"enabled": True, "amount": 50, "day7_amount": 250}
    assert daily_bonus_service._ladder(cfg) == [50, 50, 50, 50, 50, 50, 250]

    yday = "2026-08-14"
    # No prior claim -> day 1.
    assert daily_bonus_service._next_streak_day(None, yday) == 1
    # Unbroken run continues.
    assert daily_bonus_service._next_streak_day({"ist_date": yday, "streak_day": 1}, yday) == 2
    assert daily_bonus_service._next_streak_day({"ist_date": yday, "streak_day": 6}, yday) == 7
    # Day 7 loops back to day 1.
    assert daily_bonus_service._next_streak_day({"ist_date": yday, "streak_day": 7}, yday) == 1
    # A missed day (last claim not yesterday) resets to day 1.
    assert daily_bonus_service._next_streak_day({"ist_date": "2020-01-01", "streak_day": 4}, yday) == 1


async def _streak_scenarios():
    """DB-backed streak scenarios (called inside the matrix test's single event
    loop — the shared motor client binds to the first loop, so we must not open
    a second asyncio.run):
    (a) claiming on day 7 after an unbroken run pays the bigger jackpot;
    (b) a missed day resets the ladder to day 1 = base amount."""
    await daily_bonus_service.set_config({"enabled": True, "amount": 50, "day7_amount": 250})
    today, yesterday = daily_bonus_service._ist_today_yesterday(daily_bonus_service._now())

    # (a) Day-7 jackpot: seed an unbroken run where yesterday was day 6.
    uid = await _mk_user()
    try:
        await db.daily_bonus_claims.insert_one({
            "id": f"daily_bonus:{uid}:{yesterday}", "user_id": uid, "ist_date": yesterday,
            "streak_day": 6, "amount": 50, "created_at": yesterday + "T00:00:00+00:00",
        })
        st = await daily_bonus_service.status(uid)
        assert st["claimable"] is True
        assert st["streak_day"] == 7 and st["amount"] == 250  # jackpot preview
        before = await _bonus_balance(uid)
        after = await daily_bonus_service.claim(uid)
        assert after["streak_day"] == 7
        assert await _bonus_balance(uid) - before == 250
        rec = await db.daily_bonus_claims.find_one({"id": f"daily_bonus:{uid}:{today}"}, {"_id": 0})
        assert rec["streak_day"] == 7 and rec["amount"] == 250
    finally:
        await _cleanup(uid)

    # (b) Missed day: last claim older than yesterday -> resets to day 1.
    uid2 = await _mk_user()
    try:
        await db.daily_bonus_claims.insert_one({
            "id": f"daily_bonus:{uid2}:old", "user_id": uid2, "ist_date": "2026-08-01",
            "streak_day": 4, "amount": 50, "created_at": "2026-08-01T00:00:00+00:00",
        })
        st2 = await daily_bonus_service.status(uid2)
        assert st2["streak_day"] == 1 and st2["amount"] == 50
        before2 = await _bonus_balance(uid2)
        after2 = await daily_bonus_service.claim(uid2)
        assert after2["streak_day"] == 1
        assert await _bonus_balance(uid2) - before2 == 50
    finally:
        await _cleanup(uid2)


