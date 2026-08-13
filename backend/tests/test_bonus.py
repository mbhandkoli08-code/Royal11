"""Bonus balance + wagering-requirement foundation — direct service tests."""
import asyncio
import sys
import uuid

sys.path.insert(0, "/app/backend")

from app.db import db
from app.models import TxnType
from app import bonus_service, wallet_service


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _seed_user(real=0):
    uid = str(uuid.uuid4())
    await wallet_service.get_or_create_wallet(uid)
    if real:
        await wallet_service.credit(uid, TxnType.WELCOME_BONUS, real, reason="seed", request_id=f"seed:{uid}")
    return uid


def test_grant_credits_bonus_balance_not_real():
    async def go():
        uid = await _seed_user(real=1000)
        g = await bonus_service.grant_bonus(uid, "vip_recharge", 300, request_id=f"t:{uuid.uuid4()}", multiple=3)
        assert g["wagering_required"] == 900
        st = await bonus_service.get_status(uid)
        assert st["real_balance"] == 1000            # real untouched
        assert st["bonus_balance"] == 300            # bonus separate
        assert st["active_grants"][0]["progress_pct"] == 0
    _run(go())


def test_grant_is_idempotent():
    async def go():
        uid = await _seed_user()
        rid = f"t:{uuid.uuid4()}"
        await bonus_service.grant_bonus(uid, "festival", 200, request_id=rid, multiple=2)
        await bonus_service.grant_bonus(uid, "festival", 200, request_id=rid, multiple=2)  # replay
        st = await bonus_service.get_status(uid)
        assert st["bonus_balance"] == 200            # only granted once
    _run(go())


def test_incremental_release_on_wager():
    async def go():
        uid = await _seed_user(real=0)
        await bonus_service.grant_bonus(uid, "test", 300, request_id=f"t:{uuid.uuid4()}", multiple=3)  # req 900
        await bonus_service.record_wager(uid, 90)    # 10% of requirement -> release 30
        st = await bonus_service.get_status(uid)
        assert st["bonus_balance"] == 270 and st["real_balance"] == 30
        assert st["active_grants"][0]["wagered"] == 90 and st["active_grants"][0]["progress_pct"] == 10
        await bonus_service.record_wager(uid, 810)   # completes the 900 requirement
        st2 = await bonus_service.get_status(uid)
        assert st2["bonus_balance"] == 0 and st2["real_balance"] == 300   # fully converted
        assert st2["active_grants"] == []            # grant cleared
    _run(go())


def test_debit_playable_spends_real_first_then_bonus():
    async def go():
        uid = await _seed_user(real=50)
        await bonus_service.grant_bonus(uid, "test", 100, request_id=f"t:{uuid.uuid4()}", multiple=1)
        rid = f"bet:{uuid.uuid4()}"
        res = await bonus_service.debit_playable(uid, TxnType.GAME_ENTRY, 80, reason="bet", request_id=rid)
        assert res["real_part"] == 50 and res["bonus_part"] == 30   # real drained first
        st = await bonus_service.get_status(uid)
        assert st["real_balance"] == 0 and st["bonus_balance"] == 70
        # idempotent replay must NOT double-debit
        res2 = await bonus_service.debit_playable(uid, TxnType.GAME_ENTRY, 80, reason="bet", request_id=rid)
        assert res2["real_part"] == 50 and res2["bonus_part"] == 30
        st2 = await bonus_service.get_status(uid)
        assert st2["real_balance"] == 0 and st2["bonus_balance"] == 70
    _run(go())


def test_debit_playable_insufficient_raises():
    async def go():
        uid = await _seed_user(real=10)
        try:
            await bonus_service.debit_playable(uid, TxnType.GAME_ENTRY, 100, reason="x", request_id=f"bet:{uuid.uuid4()}")
            assert False, "should have raised"
        except wallet_service.InsufficientFunds:
            pass
    _run(go())


def test_expiry_forfeits_unreleased_bonus():
    async def go():
        uid = await _seed_user()
        g = await bonus_service.grant_bonus(uid, "test", 100, request_id=f"t:{uuid.uuid4()}", multiple=3)
        # force it into the past
        await db.bonus_grants.update_one({"id": g["id"]}, {"$set": {"expires_at": "2000-01-01T00:00:00+00:00"}})
        await bonus_service.expire_bonuses()
        st = await bonus_service.get_status(uid)
        assert st["bonus_balance"] == 0 and st["active_grants"] == []
        doc = await db.bonus_grants.find_one({"id": g["id"]})
        assert doc["status"] == "expired"
    _run(go())
