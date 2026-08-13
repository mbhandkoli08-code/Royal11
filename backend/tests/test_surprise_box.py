"""Weekly Surprise Box — end-of-week unlock, hidden amount, activity scaling,
delivered via the (non-withdrawable) bonus rail."""
import asyncio
import sys
import uuid
from datetime import datetime, timezone, timedelta

sys.path.insert(0, "/app/backend")

from app.db import db
from app import surprise_box_service as sbs, revenue_service, bonus_service, wallet_service


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _last_week_iso():
    ws, _ = revenue_service.week_bounds(datetime.now(timezone.utc).date() - timedelta(days=7))
    return datetime(ws.year, ws.month, ws.day, 12, tzinfo=timezone.utc).isoformat()


async def _seed_activity(uid, rounds, recharge_coins):
    when = _last_week_iso()
    for _ in range(rounds):
        await db.xp_events.insert_one({"id": str(uuid.uuid4()), "user_id": uid, "source": "rummy",
                                       "xp": 10, "request_id": str(uuid.uuid4()), "created_at": when})
    if recharge_coins:
        await db.deposits.insert_one({"id": str(uuid.uuid4()), "player_id": uid, "status": "CONFIRMED",
                                      "coins_to_credit": recharge_coins, "confirmed_at": when,
                                      "created_at": when})


def test_not_qualified_gives_no_box():
    async def go():
        uid = str(uuid.uuid4())
        await _seed_activity(uid, rounds=5, recharge_coins=0)   # below min_rounds (20)
        st = await sbs.get_status(uid)
        assert st["status"] == "none" and st["ready"] is False
    _run(go())


def test_qualified_box_hides_amount_until_open():
    async def go():
        uid = str(uuid.uuid4())
        await wallet_service.get_or_create_wallet(uid)
        await _seed_activity(uid, rounds=60, recharge_coins=1000)  # full activity, 1000 recharge
        st = await sbs.get_status(uid)
        assert st["status"] == "ready" and st["ready"] is True
        assert "amount" not in st and st["opened_amount"] is None   # HIDDEN before open
        # open reveals + grants as non-withdrawable bonus
        res = await sbs.open_box(uid)
        # 20% of 1000 at full activity, bronze cap 500 -> 200
        assert res["amount"] == 200
        bonus = await bonus_service.get_status(uid)
        assert bonus["bonus_balance"] == 200          # landed in bonus (non-withdrawable)
        assert bonus["real_balance"] == 0             # NOT added to real
        # opening again is idempotent (no double grant)
        res2 = await sbs.open_box(uid)
        assert res2["already"] is True and res2["amount"] == 200
        bonus2 = await bonus_service.get_status(uid)
        assert bonus2["bonus_balance"] == 200
    _run(go())


def test_consolation_floor_when_low_reward():
    async def go():
        uid = str(uuid.uuid4())
        await _seed_activity(uid, rounds=20, recharge_coins=1000)  # min activity (factor 0.4)
        # raw = 1000 * 0.2 * 0.4 = 80 -> floored to consolation 100
        res = await sbs.open_box(uid)
        assert res["amount"] == 100
    _run(go())


def test_status_reflects_opened_amount_after_open():
    async def go():
        uid = str(uuid.uuid4())
        await _seed_activity(uid, rounds=40, recharge_coins=2000)
        await sbs.open_box(uid)
        st = await sbs.get_status(uid)
        assert st["status"] == "opened" and st["opened_amount"] and st["opened_amount"] > 0
    _run(go())
