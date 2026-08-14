"""Independence Day Festival Gift bonus — claim, idempotency, window gate."""
import asyncio
import uuid
from datetime import datetime, timezone

from app import festival_service, bonus_service
from app.db import db


def _mkuser():
    return f"festtest-{uuid.uuid4().hex[:8]}"


def test_window_gate():
    assert festival_service.is_active(datetime(2026, 8, 14, tzinfo=timezone.utc)) is True
    assert festival_service.is_active(datetime(2026, 8, 12, tzinfo=timezone.utc)) is False
    assert festival_service.is_active(datetime(2026, 8, 17, tzinfo=timezone.utc)) is False
    assert festival_service.is_active(datetime(2026, 1, 14, tzinfo=timezone.utc)) is False


def test_claim_credits_bonus_rail_once():
    async def run():
        uid = _mkuser()
        before = await bonus_service.get_status(uid)
        res = await festival_service.claim(uid)
        assert res["bonus_coins"] == festival_service.FESTIVAL_AMOUNT
        after = await bonus_service.get_status(uid)
        assert after["bonus_balance"] == before["bonus_balance"] + festival_service.FESTIVAL_AMOUNT
        # Idempotent: second claim rejected, balance unchanged.
        try:
            await festival_service.claim(uid)
            assert False, "expected ValueError on second claim"
        except ValueError:
            pass
        again = await bonus_service.get_status(uid)
        assert again["bonus_balance"] == after["bonus_balance"]
        status = await festival_service.get_status(uid)
        assert status["claimed"] is True and status["active"] is True
        # cleanup
        await db.festival_claims.delete_many({"user_id": uid})
        await db.bonus_grants.delete_many({"request_id": f"festival:{festival_service.FESTIVAL_ID}:{uid}"})
    asyncio.run(run())
