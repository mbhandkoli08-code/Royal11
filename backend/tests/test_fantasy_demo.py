"""Demo Fantasy fixture + 25% commission regression tests.

Guarantees the Sportmonks-free-tier fallback keeps the whole Dream11 flow
demoable: demo match is always present, its lineup is a valid buildable squad,
mock final stats settle, and the commission default is applied.
"""
import asyncio

from app import cricket_service, demo_data, fantasy_service


def test_demo_match_always_present():
    payload = asyncio.run(cricket_service.get_upcoming_fixtures())
    ids = [m["id"] for m in payload["matches"]]
    assert demo_data.DEMO_FIXTURE_ID in ids
    demo = next(m for m in payload["matches"] if m["id"] == demo_data.DEMO_FIXTURE_ID)
    assert demo["name"] == demo_data.MATCH_LABEL  # renders (not "TBD vs TBD")


def test_demo_lineup_is_buildable():
    lineup = asyncio.run(cricket_service.get_fixture_lineup(demo_data.DEMO_FIXTURE_ID))
    players = lineup["players"]
    assert len(players) == 22
    roles = {}
    for p in players:
        r = fantasy_service.map_role(p["position"])
        roles[r] = roles.get(r, 0) + 1
    # Enough of every role to satisfy the team-builder minimums.
    assert roles["WK"] >= 1 and roles["BAT"] >= 3
    assert roles["AR"] >= 1 and roles["BOWL"] >= 3


def test_demo_stats_finished_and_settleable():
    stats = asyncio.run(cricket_service.get_fixture_stats(demo_data.DEMO_FIXTURE_ID))
    assert stats["finished"] is True
    assert stats["batting"] and stats["bowling"]


def test_commission_default_prize_pool():
    # 25% house commission -> 75% of total entry fees.
    assert fantasy_service.COMMISSION_PCT == 25
    assert fantasy_service.default_prize_pool(100, 2) == 150
    assert fantasy_service.default_prize_pool(50, 1000) == 37500
