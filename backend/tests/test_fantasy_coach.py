"""Tests for Fantasy AI Coach endpoint."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://royal-sports-hub-2.preview.emergentagent.com').rstrip('/')

PLAYERS = [
    {"id": "p1", "name": "Ishan Kishan", "team": "MI", "role": "WK", "credits": 9.0, "points": 88},
    {"id": "p2", "name": "MS Dhoni", "team": "CSK", "role": "WK", "credits": 9.5, "points": 76},
    {"id": "p3", "name": "Rohit Sharma", "team": "MI", "role": "BAT", "credits": 10.5, "points": 120},
    {"id": "p4", "name": "Suryakumar Yadav", "team": "MI", "role": "BAT", "credits": 10.0, "points": 140},
    {"id": "p5", "name": "Ruturaj Gaikwad", "team": "CSK", "role": "BAT", "credits": 9.5, "points": 110},
    {"id": "p6", "name": "Devon Conway", "team": "CSK", "role": "BAT", "credits": 9.0, "points": 95},
    {"id": "p7", "name": "Tilak Varma", "team": "MI", "role": "BAT", "credits": 8.5, "points": 70},
    {"id": "p8", "name": "Hardik Pandya", "team": "MI", "role": "AR", "credits": 11.0, "points": 160},
    {"id": "p9", "name": "Ravindra Jadeja", "team": "CSK", "role": "AR", "credits": 10.5, "points": 150},
    {"id": "p10", "name": "Kieron Pollard", "team": "MI", "role": "AR", "credits": 9.0, "points": 80},
    {"id": "p11", "name": "Moeen Ali", "team": "CSK", "role": "AR", "credits": 8.5, "points": 90},
    {"id": "p12", "name": "Jasprit Bumrah", "team": "MI", "role": "BOWL", "credits": 11.0, "points": 130},
    {"id": "p13", "name": "Trent Boult", "team": "MI", "role": "BOWL", "credits": 9.0, "points": 100},
    {"id": "p14", "name": "Matheesha Pathirana", "team": "CSK", "role": "BOWL", "credits": 8.5, "points": 85},
    {"id": "p15", "name": "Deepak Chahar", "team": "CSK", "role": "BOWL", "credits": 8.5, "points": 75},
    {"id": "p16", "name": "Mitchell Santner", "team": "CSK", "role": "BOWL", "credits": 8.0, "points": 60},
]
PMAP = {p["id"]: p for p in PLAYERS}


def _call_coach():
    r = requests.post(f"{BASE_URL}/api/fantasy/coach",
                      json={"players": PLAYERS, "budget": 100, "size": 11},
                      timeout=60)
    return r


def _validate(data):
    assert set(["xi", "captain", "vice", "rationale", "source"]).issubset(data.keys())
    xi = data["xi"]
    assert isinstance(xi, list) and len(xi) == 11, f"xi len={len(xi)}"
    assert len(set(xi)) == 11, "duplicates in xi"
    for pid in xi:
        assert pid in PMAP, f"unknown id {pid}"
    total = sum(PMAP[i]["credits"] for i in xi)
    assert total <= 100 + 0.01, f"budget exceeded: {total}"
    assert data["captain"] in xi
    assert data["vice"] in xi
    assert data["captain"] != data["vice"]
    assert isinstance(data["rationale"], str) and len(data["rationale"].strip()) > 0
    assert data["source"] in ("ai", "fallback")
    return total


class TestFantasyCoach:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/", timeout=10)
        assert r.status_code == 200

    @pytest.mark.parametrize("run", [1, 2, 3])
    def test_coach_invariants(self, run):
        r = _call_coach()
        assert r.status_code == 200, r.text
        data = r.json()
        total = _validate(data)
        print(f"Run {run}: source={data['source']} used={total} rationale={data['rationale'][:120]}")

    def test_at_least_one_ai_response(self):
        sources = []
        for _ in range(3):
            r = _call_coach()
            assert r.status_code == 200
            data = r.json()
            _validate(data)
            sources.append(data["source"])
            if data["source"] == "ai":
                # rationale substantive
                assert len(data["rationale"]) > 15
        print(f"Sources across 3 runs: {sources}")
        assert "ai" in sources, f"Expected at least one 'ai' source, got {sources}"
