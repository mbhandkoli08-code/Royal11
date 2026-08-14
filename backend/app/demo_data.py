"""Seeded demo Fantasy fixture.

Used as a fallback ONLY when the Sportmonks free tier returns no upcoming
fixtures / no published lineups, so the entire Dream11-style flow
(browse match -> build XI -> join contest -> settle -> payouts) is fully
demoable end-to-end without depending on live cricket data.

The real Sportmonks path is untouched; this only kicks in when it is empty.
"""
from datetime import datetime, timedelta, timezone

DEMO_FIXTURE_ID = "demo-t20-royal11"

TEAM_A_ID = "9001"
TEAM_B_ID = "9002"
TEAM_A_NAME = "Royal Strikers"
TEAM_B_NAME = "Coastal Kings"
MATCH_LABEL = f"{TEAM_A_NAME} vs {TEAM_B_NAME}"

# Each team: 1 Wicketkeeper, 4 Batsmen, 2 All-Rounders, 4 Bowlers (11 each).
_ROSTER = [
    # Royal Strikers
    ("d1", "Aarav Menon", TEAM_A_ID, "Wicketkeeper"),
    ("d2", "Rohan Kapoor", TEAM_A_ID, "Batsman"),
    ("d3", "Vikram Rao", TEAM_A_ID, "Batsman"),
    ("d4", "Sameer Joshi", TEAM_A_ID, "Batsman"),
    ("d5", "Dev Patel", TEAM_A_ID, "Batsman"),
    ("d6", "Kabir Nair", TEAM_A_ID, "Allrounder"),
    ("d7", "Arjun Sethi", TEAM_A_ID, "Allrounder"),
    ("d8", "Ishaan Verma", TEAM_A_ID, "Bowler"),
    ("d9", "Manav Gill", TEAM_A_ID, "Bowler"),
    ("d10", "Yash Thakur", TEAM_A_ID, "Bowler"),
    ("d11", "Neel Bose", TEAM_A_ID, "Bowler"),
    # Coastal Kings
    ("d12", "Aditya Shah", TEAM_B_ID, "Wicketkeeper"),
    ("d13", "Karan Malhotra", TEAM_B_ID, "Batsman"),
    ("d14", "Rishi Iyer", TEAM_B_ID, "Batsman"),
    ("d15", "Aryan Chopra", TEAM_B_ID, "Batsman"),
    ("d16", "Veer Sharma", TEAM_B_ID, "Batsman"),
    ("d17", "Nikhil Reddy", TEAM_B_ID, "Allrounder"),
    ("d18", "Siddharth Jain", TEAM_B_ID, "Allrounder"),
    ("d19", "Tanay Ghosh", TEAM_B_ID, "Bowler"),
    ("d20", "Harsh Vora", TEAM_B_ID, "Bowler"),
    ("d21", "Om Prakash", TEAM_B_ID, "Bowler"),
    ("d22", "Laksh Mehta", TEAM_B_ID, "Bowler"),
]

# Fixed mock final stats per player (deterministic so the demo leaderboard is
# stable). Keyed by player_id. Only players who batted/bowled appear.
_BATTING = {
    "d1": {"score": 34, "four_x": 3, "six_x": 1, "ball": 22},
    "d2": {"score": 72, "four_x": 8, "six_x": 3, "ball": 44},
    "d3": {"score": 51, "four_x": 5, "six_x": 2, "ball": 38},
    "d4": {"score": 18, "four_x": 2, "six_x": 0, "ball": 15},
    "d5": {"score": 0, "four_x": 0, "six_x": 0, "ball": 3},
    "d6": {"score": 41, "four_x": 3, "six_x": 2, "ball": 26},
    "d7": {"score": 12, "four_x": 1, "six_x": 0, "ball": 9},
    "d12": {"score": 60, "four_x": 6, "six_x": 2, "ball": 40},
    "d13": {"score": 28, "four_x": 3, "six_x": 0, "ball": 21},
    "d14": {"score": 45, "four_x": 4, "six_x": 1, "ball": 33},
    "d15": {"score": 9, "four_x": 1, "six_x": 0, "ball": 8},
    "d16": {"score": 15, "four_x": 2, "six_x": 0, "ball": 12},
    "d17": {"score": 33, "four_x": 2, "six_x": 2, "ball": 19},
    "d18": {"score": 6, "four_x": 0, "six_x": 0, "ball": 5},
}
_BOWLING = {
    "d8": {"wickets": 3, "medians": 1},
    "d9": {"wickets": 2, "medians": 0},
    "d10": {"wickets": 1, "medians": 0},
    "d11": {"wickets": 0, "medians": 0},
    "d6": {"wickets": 1, "medians": 0},
    "d7": {"wickets": 2, "medians": 0},
    "d19": {"wickets": 4, "medians": 1},
    "d20": {"wickets": 1, "medians": 0},
    "d21": {"wickets": 2, "medians": 0},
    "d22": {"wickets": 0, "medians": 0},
    "d17": {"wickets": 1, "medians": 0},
    "d18": {"wickets": 1, "medians": 0},
}


def is_demo_fixture(fixture_id: str) -> bool:
    return str(fixture_id) == DEMO_FIXTURE_ID


def _starting_at() -> str:
    # Far in the future so seeded demo contests never auto-lock during a demo.
    return (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()


def demo_match() -> dict:
    """Normalized match card (matches the shape FantasyPage renders)."""
    return {
        "id": DEMO_FIXTURE_ID,
        "sport": "Cricket · T20",
        "league": "ROYAL11 Demo League",
        "name": MATCH_LABEL,
        "teamA": {"name": "RS", "full": TEAM_A_NAME, "image": None, "score": "", "ov": ""},
        "teamB": {"name": "CK", "full": TEAM_B_NAME, "image": None, "score": "", "ov": ""},
        "note": "Demo match — build your team & join",
        "status": "NS",
        "live": False,
        "starting_at": _starting_at(),
        "demo": True,
    }


def demo_lineup() -> dict:
    players = [
        {"player_id": pid, "name": name, "team_id": tid, "position": pos}
        for (pid, name, tid, pos) in _ROSTER
    ]
    return {
        "fixture_id": DEMO_FIXTURE_ID,
        "starting_at": _starting_at(),
        "status": "NS",
        "match_label": MATCH_LABEL,
        "team_names": {TEAM_A_ID: TEAM_A_NAME, TEAM_B_ID: TEAM_B_NAME},
        "players": players,
    }


def demo_stats() -> dict:
    """Mock 'final' stats so Super Admin can settle the demo contest."""
    batting = [{"player_id": pid, **stats} for pid, stats in _BATTING.items()]
    bowling = [{"player_id": pid, **stats} for pid, stats in _BOWLING.items()]
    return {
        "fixture_id": DEMO_FIXTURE_ID,
        "status": "Finished",
        "finished": True,
        "batting": batting,
        "bowling": bowling,
    }
