"""Pool & Deals Rummy match layer (multi-deal): fixed entry charged ONCE at
match start, deal points accumulate on the match, Pool eliminates at the limit
(last player standing wins), Deals plays a fixed number of deals (lowest total
wins), and the prize pool is paid once at match end. Runs everything inside ONE
event loop (the shared motor client binds to the first loop)."""
import asyncio
import uuid
from datetime import datetime, timezone

from app import wallet_service
from app.models import TxnType
from app.games import rummy_engine as re, engine
from app.db import db


async def _mk_funded(balance: int) -> str:
    uid = f"test-rmatch-{uuid.uuid4()}"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_one({"id": uid, "role": "PLAYER", "status": "ACTIVE",
                               "email": f"{uid}@t.local", "display_name": "T", "created_at": now})
    await wallet_service.get_or_create_wallet(uid)
    await wallet_service.credit(uid, TxnType.GAME_REWARD, balance, reason="test fund",
                                request_id=f"fund:{uid}")
    return uid


async def _bal(uid: str) -> int:
    w = await db.wallets.find_one({"user_id": uid}, {"_id": 0, "balance": 1})
    return (w or {}).get("balance", 0)


async def _cleanup(*uids):
    for uid in uids:
        await db.users.delete_many({"id": uid})
        await db.wallets.delete_many({"user_id": uid})
        await db.ledger_transactions.delete_many({"user_id": uid})
        await db.bonus_grants.delete_many({"user_id": uid})


async def _drive_match(table_id: str, winner_uid: str, max_deals: int = 60) -> dict:
    """Force-settle each running deal with a fixed winner until the match ends."""
    for _ in range(max_deals):
        t = await re._get(table_id)
        if (t.get("match") or {}).get("status") != "RUNNING":
            break
        r = await re._active_round(t)
        if not r or r["phase"] == "SETTLED":
            break
        await re._settle(r, winner_uid, "test winner")
    return await re.get_state(table_id, winner_uid)


def test_pool_and_deals_match():
    async def go():
        # ---- POOL 101 ----
        a = await _mk_funded(100_000)
        b = await _mk_funded(100_000)
        try:
            tbl = await engine.create_table("rummy_pool", a, config={"pool_type": 101, "entry_fee": 100})
            tid = tbl["id"]
            await engine.join_table(tid, {"id": a, "display_name": "A"})
            await engine.join_table(tid, {"id": b, "display_name": "B"})
            state = await re.start_round(tid, a)

            # Entry charged exactly once at match start.
            assert await _bal(a) == 99_900 and await _bal(b) == 99_900
            m = state["match"]
            assert m and m["variant"] == "pool" and m["pool_limit"] == 101
            assert m["status"] == "RUNNING" and m["deals_played"] == 0
            # prize pool = 200 collected − 70% rake (140) = 60
            assert m["prize_pool"] == 60
            assert state["round"] and state["round"]["config"]["variant"] == "pool"

            end = await _drive_match(tid, a)
            fm = end["match"]
            assert fm["status"] == "ENDED"
            assert fm["winner_user_id"] == a               # A won every deal; B crossed 101
            assert fm["scores"][a] < 101                    # winner stays under the limit
            assert b in fm["eliminated"]
            assert fm["standings"][0]["user_id"] == a and fm["standings"][0]["won"] is True
            # Prize paid ONCE; entry never re-charged across deals.
            assert await _bal(a) == 99_900 + 60
            assert await _bal(b) == 99_900
            # Rake ledger row keyed by the match id.
            rk = await db.casino_rake_ledger.find_one({"round_id": f"match:{fm['id']}"}, {"_id": 0})
            assert rk and rk["rake"] == 140
        finally:
            await _cleanup(a, b)

        # ---- DEALS (2 deals) ----
        c = await _mk_funded(100_000)
        d = await _mk_funded(100_000)
        try:
            tbl2 = await engine.create_table("rummy_deals", c, config={"num_deals": 2, "entry_fee": 100})
            tid2 = tbl2["id"]
            await engine.join_table(tid2, {"id": c, "display_name": "C"})
            await engine.join_table(tid2, {"id": d, "display_name": "D"})
            state2 = await re.start_round(tid2, c)
            assert await _bal(c) == 99_900 and await _bal(d) == 99_900
            m2 = state2["match"]
            assert m2["variant"] == "deals" and m2["num_deals"] == 2

            end2 = await _drive_match(tid2, c)
            fm2 = end2["match"]
            assert fm2["status"] == "ENDED"
            assert fm2["deals_played"] == 2                 # exactly the configured number
            assert fm2["winner_user_id"] == c               # C won both deals → lowest total
            assert fm2["scores"][c] <= fm2["scores"][d]
            assert await _bal(c) == 99_900 + 60             # prize paid once
            assert await _bal(d) == 99_900
        finally:
            await _cleanup(c, d)
    asyncio.run(go())
