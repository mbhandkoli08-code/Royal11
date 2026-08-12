"""Iter17 — Fantasy Cricket Phase 1 endpoint auth/behavior tests (live API via REACT_APP_BACKEND_URL)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    # Fallback to frontend/.env
    from pathlib import Path
    for line in Path("/app/frontend/.env").read_text().splitlines():
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip()
BASE_URL = BASE_URL.rstrip("/")

PWD = "ChangeMe123!"


def _login(email: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": PWD}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def super_token():
    return _login("superadmin@royal11.com")


@pytest.fixture(scope="module")
def admin_token():
    return _login("admin1@royal11.com")


@pytest.fixture(scope="module")
def player_token():
    return _login("player1@royal11.com")


def H(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---- RBAC ----
class TestRBAC:
    def test_player_forbidden_scoring_config(self, player_token):
        r = requests.get(f"{BASE_URL}/api/admin/fantasy/scoring-config", headers=H(player_token))
        assert r.status_code == 403

    def test_player_forbidden_admin_contests(self, player_token):
        r = requests.get(f"{BASE_URL}/api/admin/fantasy/contests", headers=H(player_token))
        assert r.status_code == 403

    def test_player_forbidden_create_contest(self, player_token):
        r = requests.post(f"{BASE_URL}/api/admin/fantasy/contests", headers=H(player_token),
                          json={"fixture_id": "x", "entry_fee": 10, "max_participants": 2, "prize_pool": 100})
        assert r.status_code == 403

    def test_admin_forbidden_settle(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/admin/fantasy/contests/nonexistent/settle", headers=H(admin_token))
        assert r.status_code == 403

    def test_admin_forbidden_scoring_config(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/fantasy/scoring-config", headers=H(admin_token))
        assert r.status_code == 403

    def test_admin_allowed_list_contests(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/admin/fantasy/contests", headers=H(admin_token))
        assert r.status_code == 200


# ---- Scoring config ----
class TestScoringConfig:
    def test_defaults(self, super_token):
        r = requests.get(f"{BASE_URL}/api/admin/fantasy/scoring-config", headers=H(super_token))
        assert r.status_code == 200
        cfg = r.json()
        # Confirm required defaults
        assert cfg.get("wicket") == 25
        assert cfg.get("six_bonus") == 2
        assert cfg.get("century_bonus") == 16
        assert cfg.get("run") == 1
        assert cfg.get("duck_penalty") == -2

    def test_update_persists_and_ignores_invalid(self, super_token):
        # Read current
        r0 = requests.get(f"{BASE_URL}/api/admin/fantasy/scoring-config", headers=H(super_token)).json()
        original = r0.get("wicket", 25)
        new_val = int(original) + 1
        put = requests.put(f"{BASE_URL}/api/admin/fantasy/scoring-config",
                           headers=H(super_token),
                           json={"wicket": new_val, "not_a_real_key_xyz": 999})
        assert put.status_code == 200
        after = requests.get(f"{BASE_URL}/api/admin/fantasy/scoring-config", headers=H(super_token)).json()
        assert after["wicket"] == new_val
        assert "not_a_real_key_xyz" not in after
        # restore
        requests.put(f"{BASE_URL}/api/admin/fantasy/scoring-config",
                     headers=H(super_token), json={"wicket": original})


# ---- Player-facing endpoints ----
class TestPlayerEndpoints:
    def test_matches(self, player_token):
        r = requests.get(f"{BASE_URL}/api/fantasy/matches", headers=H(player_token))
        assert r.status_code == 200
        body = r.json()
        assert "matches" in body
        assert isinstance(body["matches"], list)

    def test_contests_only_open(self, player_token):
        r = requests.get(f"{BASE_URL}/api/fantasy/contests", headers=H(player_token))
        assert r.status_code == 200
        data = r.json()
        # Should be list-like; each item OPEN
        items = data if isinstance(data, list) else data.get("contests", [])
        for c in items:
            assert c.get("status") == "OPEN"

    def test_my_contests(self, player_token):
        r = requests.get(f"{BASE_URL}/api/fantasy/my-contests", headers=H(player_token))
        assert r.status_code == 200

    def test_fixture_players_shape(self, player_token):
        # Use a bogus fixture id — should still return shape but empty players, or 400 gracefully
        r = requests.get(f"{BASE_URL}/api/fantasy/fixtures/bogus_fixture_zzz/players", headers=H(player_token))
        # Endpoint returns shape even if empty; if it 400s that's still graceful (no 500)
        assert r.status_code in (200, 400)
        if r.status_code == 200:
            body = r.json()
            assert body.get("budget") == 100
            assert body.get("max_per_team") == 7
            assert "role_ranges" in body


# ---- Admin contest creation graceful failure ----
class TestAdminCreate:
    def test_bogus_fixture_returns_400(self, super_token):
        r = requests.post(f"{BASE_URL}/api/admin/fantasy/contests", headers=H(super_token),
                          json={"fixture_id": "bogus_zzz_9999", "name": "TEST_bogus",
                                "entry_fee": 10, "max_participants": 2, "prize_pool": 100})
        assert r.status_code == 400, f"Expected 400 got {r.status_code}: {r.text}"
        # No crash / must have error text
        assert r.text
