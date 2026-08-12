"""Fantasy Cricket engine tests — validation, scoring, settlement, idempotency.

Uses seeded pool/contest docs + a monkeypatched Sportmonks stats fetch so the
full settlement path is exercised deterministically (no live API needed).
"""
import asyncio
import uuid

import pytest

from app import fantasy_service, wallet_service
from app.db import db
from app.models import TxnType

FIX = f"TESTFIX-{uuid.uuid4().hex[:6]}"


def _role_players():
    players = []
    for team in ("A", "B"):
        players += [
            {"pid": f"{team}1", "role": "WK"},
            {"pid": f"{team}2", "role": "BAT"}, {"pid": f"{team}3", "role": "BAT"},
            {"pid": f"{team}4", "role": "BAT"}, {"pid": f"{team}5", "role": "BAT"},
            {"pid": f"{team}6", "role": "AR"}, {"pid": f"{team}7", "role": "AR"},
            {"pid": f"{team}8", "role": "BOWL"}, {"pid": f"{team}9", "role": "BOWL"},
            {"pid": f"{team}10", "role": "BOWL"}, {"pid": f"{team}11", "role": "BOWL"},
        ]
        for p in players[-11:]:
            p["team"] = team
    return players


async def _seed_pool():
    for p in _role_players():
        await db.fantasy_player_pool.update_one(
            {"fixture_id": FIX, "player_id": p["pid"]},
            {"$set": {"fixture_id": FIX, "player_id": p["pid"], "name": p["pid"],
                      "team_id": p["team"], "role": p["role"], "credit_value": 8.5}},
            upsert=True)


async def _user_with_coins(coins: int) -> str:
    uid = f"tu-{uuid.uuid4().hex[:8]}"
    await wallet_service.get_or_create_wallet(uid)
    await wallet_service.credit(uid, TxnType.ADMIN_GRANT, coins, actor_id="test",
                                reason="seed", request_id=f"seed:{uid}")
    return uid


VALID_XI = ["A1", "A2", "A3", "B2", "A6", "B6", "A8", "A9", "B8", "B9", "B10"]


def test_scoring_engine_values():
    cfg = {**fantasy_service.DEFAULT_SCORING}
    batting = [{"player_id": "A1", "score": 50, "four_x": 4, "six_x": 2, "ball": 30},
               {"player_id": "A2", "score": 0, "ball": 3}]  # duck (BAT)
    bowling = [{"player_id": "A8", "wickets": 3, "medians": 1}]
    roles = {"A1": "WK", "A2": "BAT", "A8": "BOWL"}
    pts = fantasy_service.compute_player_points(batting, bowling, cfg, roles)
    # A1: 50*1 + 4*1 + 2*2 + fifty(8) = 66
    assert pts["A1"] == 66
    # A2 duck: -2
    assert pts["A2"] == -2
    # A8: 3*25 + 1 maiden*12 + 3-wkt bonus 4 = 91
    assert pts["A8"] == 91


def test_team_score_captain_vice():
    points = {p: 10 for p in VALID_XI}
    team = {"selections": VALID_XI, "captain_id": "A1", "vice_captain_id": "A2"}
    # 11*10 + captain extra(10) + vc extra(5) = 125
    assert fantasy_service._team_score(team, points) == 125


def test_validation_and_settlement():
    asyncio.run(_run_validation_and_settlement())


async def _run_validation_and_settlement():
    await _seed_pool()
    # contest (OPEN, far-future lock so joins allowed)
    cid = str(uuid.uuid4())
    await db.fantasy_contests.insert_one({
        "id": cid, "fixture_id": FIX, "name": "Test Mega", "created_by": "sa",
        "entry_fee": 100, "max_participants": 10, "prize_pool": 1000,
        "prize_distribution": fantasy_service.DEFAULT_PRIZE_DISTRIBUTION,
        "status": "OPEN", "lock_at": "2999-01-01T00:00:00+00:00", "participant_count": 0,
        "created_at": "2026-01-01T00:00:00+00:00"})

    u1 = await _user_with_coins(500)
    u2 = await _user_with_coins(500)

    # invalid: only 10 players
    with pytest.raises(ValueError):
        await fantasy_service.join_contest(u1, cid, VALID_XI[:10], "A1", "A2")
    # invalid: captain not in team
    with pytest.raises(ValueError):
        await fantasy_service.join_contest(u1, cid, VALID_XI, "B11", "A2")

    # valid join for both
    r1 = await fantasy_service.join_contest(u1, cid, VALID_XI, "A1", "A2")
    assert r1["balance"] == 400  # 500 - 100 entry
    await fantasy_service.join_contest(u2, cid, VALID_XI, "A8", "A9")

    # duplicate join blocked
    with pytest.raises(ValueError):
        await fantasy_service.join_contest(u1, cid, VALID_XI, "A1", "A2")

    # --- settlement with monkeypatched stats ---
    async def fake_stats(fixture_id):
        return {"fixture_id": fixture_id, "status": "Finished", "finished": True,
                "batting": [{"player_id": "A1", "score": 100, "four_x": 10, "six_x": 2},
                            {"player_id": "A2", "score": 30}],
                "bowling": [{"player_id": "A8", "wickets": 5}]}
    fantasy_service.cricket_service.get_fixture_stats = fake_stats

    res = await fantasy_service.settle_contest(cid)
    assert res["status"] == "SETTLED" and res["teams_scored"] == 2

    teams = [t async for t in db.fantasy_teams.find({"contest_id": cid}, {"_id": 0}).sort("rank", 1)]
    # u1 captain=A1 (big scorer) should outrank u2 (captain=A8)
    assert teams[0]["rank"] == 1
    assert teams[0]["winnings"] == 500  # 50% of 1000
    assert teams[1]["winnings"] == 300  # 30%
    # winner actually paid
    w = await db.wallets.find_one({"user_id": teams[0]["user_id"]})
    bal_after = w["balance"]

    # idempotent: re-settling returns already + no double pay
    res2 = await fantasy_service.settle_contest(cid)
    assert res2.get("already") is True
    w2 = await db.wallets.find_one({"user_id": teams[0]["user_id"]})
    assert w2["balance"] == bal_after

    # cleanup
    await db.fantasy_contests.delete_one({"id": cid})
    await db.fantasy_teams.delete_many({"contest_id": cid})
    await db.fantasy_player_pool.delete_many({"fixture_id": FIX})
