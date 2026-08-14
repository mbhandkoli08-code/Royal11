"""End-to-end API tests for the Fantasy demo flow (iter24).

Covers:
 - login (player + super admin)
 - GET /api/fantasy/matches -> demo fixture first + team names present
 - GET /api/fantasy/fixtures/{id}/players -> 22 players + role ranges
 - GET /api/fantasy/contests?fixture_id=demo -> demo contests seeded with 25% commission
 - POST /api/fantasy/contests/{id}/join -> valid team joins, wallet debited
 - Invalid team join returns 400
 - GET /api/fantasy/my-contests -> shows joined contest
 - POST /api/admin/fantasy/contests/{id}/settle -> pays rank1 half of prize_pool
"""
import os
import uuid
import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"
API = f"{BASE_URL}/api"

PLAYER_EMAIL = "player1@royal11.com"
SA_EMAIL = "superadmin@royal11.com"
PWD = "ChangeMe123!"

DEMO_FIXTURE = "demo-t20-royal11"
DEMO_MEGA = "demo-contest-mega"
DEMO_FREE = "demo-contest-free"
DEMO_H2H = "demo-contest-h2h"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def player_token():
    return _login(PLAYER_EMAIL, PWD)


@pytest.fixture(scope="module")
def sa_token():
    return _login(SA_EMAIL, PWD)


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# --- matches list ---
def test_matches_demo_first(player_token):
    r = requests.get(f"{API}/fantasy/matches", headers=_h(player_token), timeout=20)
    assert r.status_code == 200
    data = r.json()
    matches = data["matches"]
    assert matches, "no matches returned"
    assert matches[0]["id"] == DEMO_FIXTURE
    assert matches[0]["name"] == "Royal Strikers vs Coastal Kings"
    # Any real fixture should also have a name (not "TBD vs TBD")
    for m in matches[1:]:
        assert "TBD vs TBD" not in (m.get("name") or ""), f"got TBD placeholder: {m}"


def test_fixture_players(player_token):
    r = requests.get(f"{API}/fantasy/fixtures/{DEMO_FIXTURE}/players", headers=_h(player_token), timeout=20)
    assert r.status_code == 200
    data = r.json()
    assert len(data["players"]) == 22
    assert data["budget"] == 100
    assert data["max_per_team"] == 7
    roles = data["role_ranges"]
    assert roles["WK"] == [1, 4] and roles["BOWL"] == [3, 6]


def test_demo_contests_commission(player_token):
    r = requests.get(f"{API}/fantasy/contests?fixture_id=" + DEMO_FIXTURE,
                     headers=_h(player_token), timeout=20)
    assert r.status_code == 200
    contests = {c["id"]: c for c in r.json()}
    # H2H: entry 100 * 2 * 0.75 = 150
    h2h = contests.get(DEMO_H2H)
    if h2h:  # may be full/settled from prior runs
        assert h2h["commission_pct"] == 25
        assert h2h["prize_pool"] == 150
    mega = contests[DEMO_MEGA]
    assert mega["commission_pct"] == 25
    # 50 * 1000 * 0.75 = 37500
    assert mega["prize_pool"] == 37500


# --- join flow uses Free Practice (entry 0) to be idempotent across reruns ---
def _valid_selection():
    # 7 from team A, 4 from team B; roles WK1 BAT3 AR2 BOWL5 = 11
    # From roster: d1(WK), d2,d3(BAT-A), d6(AR-A), d8,d9,d10(BOWL-A) -> 7 team A
    #             d14(BAT-B), d17(AR-B), d19,d20(BOWL-B) -> 4 team B
    return ["d1", "d2", "d3", "d6", "d8", "d9", "d10", "d14", "d17", "d19", "d20"]


def test_invalid_team_rejected(player_token):
    # 11 from team A -> should fail max_per_team=7. Use MEGA (OPEN, not yet joined).
    bad = ["d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11"]
    r = requests.post(f"{API}/fantasy/contests/{DEMO_MEGA}/join",
                      headers=_h(player_token),
                      json={"selections": bad, "captain_id": "d2", "vice_captain_id": "d3"},
                      timeout=20)
    assert r.status_code == 400, r.text
    assert "one team" in r.text.lower() or "at most" in r.text.lower(), r.text


def test_free_practice_join_bug(player_token):
    """Documents two demo-seed bugs on the Free Practice contest:
     1) lock_at is set once via $setOnInsert and goes stale after ~6h, so the
        contest becomes 'closed for entries' and unjoinable on demo.
     2) even if OPEN, entry_fee=0 fails inside wallet_service.debit
        ('debit amount must be positive').
    """
    sel = _valid_selection()
    r = requests.post(f"{API}/fantasy/contests/{DEMO_FREE}/join",
                      headers=_h(player_token),
                      json={"selections": sel, "captain_id": "d2", "vice_captain_id": "d14"},
                      timeout=20)
    if r.status_code == 400 and ("positive" in r.text.lower() or "closed" in r.text.lower()):
        pytest.xfail(f"Known demo-seed bug: {r.text}")
    if r.status_code == 400 and "already" in r.text.lower():
        pytest.skip("already joined")
    assert r.status_code == 200, r.text


def test_join_mega_and_my_contests(player_token):
    # Wallet balance before
    w = requests.get(f"{API}/wallet", headers=_h(player_token), timeout=20)
    bal_before = w.json().get("balance") if w.status_code == 200 else None

    sel = _valid_selection()
    payload = {"selections": sel, "captain_id": "d2", "vice_captain_id": "d14"}
    r = requests.post(f"{API}/fantasy/contests/{DEMO_MEGA}/join",
                      headers=_h(player_token), json=payload, timeout=20)
    if r.status_code == 400 and "already" in r.text.lower():
        pytest.skip("player already joined mega contest — treat as pass")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["team"]["captain_id"] == "d2"
    assert body["team"]["vice_captain_id"] == "d14"
    if bal_before is not None:
        assert body["balance"] == bal_before - 50, "wallet not debited by entry fee"

    r2 = requests.get(f"{API}/fantasy/my-contests", headers=_h(player_token), timeout=20)
    assert r2.status_code == 200
    ids = [row["contest"]["id"] for row in r2.json()]
    assert DEMO_MEGA in ids


def test_settle_endpoint_gated_by_super_admin(player_token):
    r = requests.post(f"{API}/admin/fantasy/contests/{DEMO_MEGA}/settle",
                      headers=_h(player_token), timeout=20)
    assert r.status_code in (401, 403)


def test_super_admin_can_settle_demo(sa_token, player_token):
    sel = _valid_selection()
    requests.post(f"{API}/fantasy/contests/{DEMO_MEGA}/join", headers=_h(player_token),
                  json={"selections": sel, "captain_id": "d2", "vice_captain_id": "d14"}, timeout=20)

    r = requests.post(f"{API}/admin/fantasy/contests/{DEMO_MEGA}/settle",
                      headers=_h(sa_token), timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "SETTLED"

    r2 = requests.get(f"{API}/fantasy/contests/{DEMO_MEGA}",
                      headers=_h(player_token), timeout=20)
    assert r2.status_code == 200
    detail = r2.json()
    assert detail["contest"]["status"] == "SETTLED"
    assert detail["leaderboard"], "leaderboard should not be empty after settle"
    top = detail["leaderboard"][0]
    assert top["rank"] == 1
    # rank1 gets 50% of prize_pool. Mega pool=37500 -> 18750
    assert top["winnings"] == 18750
