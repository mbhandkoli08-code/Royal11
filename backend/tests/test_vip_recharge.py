"""VIP recharge bonus — tier-based standing bonus applied at deposit confirm,
delivered via the non-withdrawable bonus rail."""
import asyncio
import sys
import uuid

sys.path.insert(0, "/app/backend")

from app.db import db
from app import deposit_service, bonus_service, wallet_service
from app.games import progression_service


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _set_tier_xp(uid, xp):
    await db.player_progression.update_one({"user_id": uid}, {"$set": {"xp": xp}}, upsert=True)


def test_recharge_offer_reflects_tier():
    async def go():
        uid = str(uuid.uuid4())
        await _set_tier_xp(uid, 30_000)  # Gold (>=25k)
        offer = await progression_service.get_recharge_offer(uid)
        assert offer["tier"] == "gold" and offer["bonus_pct"] == 10
        assert progression_service.recharge_bonus_amount(1000, offer) == 100
    _run(go())


def test_confirm_deposit_grants_vip_bonus_to_bonus_balance():
    async def go():
        uid = str(uuid.uuid4())
        admin_id = str(uuid.uuid4())
        await wallet_service.get_or_create_wallet(uid)
        await _set_tier_xp(uid, 30_000)  # Gold -> 10%
        dep_id = str(uuid.uuid4())
        await db.deposits.insert_one({
            "id": dep_id, "player_id": uid, "target_admin_id": admin_id, "status": "PENDING",
            "coins_to_credit": 1000, "amount_inr": 1000, "created_at": "2026-08-01T00:00:00+00:00",
            "confirmed_at": None})

        await deposit_service.confirm_deposit(dep_id, admin_id, note="ok")

        wallet = await wallet_service.get_or_create_wallet(uid)
        assert wallet["balance"] == 1000          # base recharge -> REAL (withdrawable)
        status = await bonus_service.get_status(uid)
        assert status["bonus_balance"] == 100     # +10% VIP bonus -> BONUS (non-withdrawable)
        assert status["active_grants"][0]["wagering_required"] == 300  # 100 x default 3x

        # idempotent: re-confirm path must not double-grant (deposit already CONFIRMED)
        try:
            await deposit_service.confirm_deposit(dep_id, admin_id, note="again")
        except Exception:
            pass
        status2 = await bonus_service.get_status(uid)
        assert status2["bonus_balance"] == 100
    _run(go())


def test_bronze_gets_no_recharge_bonus():
    async def go():
        uid = str(uuid.uuid4())
        admin_id = str(uuid.uuid4())
        await wallet_service.get_or_create_wallet(uid)
        await _set_tier_xp(uid, 0)  # Bronze -> 0%
        dep_id = str(uuid.uuid4())
        await db.deposits.insert_one({
            "id": dep_id, "player_id": uid, "target_admin_id": admin_id, "status": "PENDING",
            "coins_to_credit": 1000, "amount_inr": 1000, "created_at": "2026-08-01T00:00:00+00:00",
            "confirmed_at": None})
        await deposit_service.confirm_deposit(dep_id, admin_id, note="ok")
        status = await bonus_service.get_status(uid)
        assert status["bonus_balance"] == 0
    _run(go())
