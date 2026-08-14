"""Iteration 26: Festival + Referral + Notifications HTTP endpoint tests."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]
BASE = BASE_URL.rstrip("/")

PLAYER = {"email": "player1@royal11.com", "password": "ChangeMe123!"}
SA = {"email": "superadmin@royal11.com", "password": "ChangeMe123!"}


def _login(creds):
    r = requests.post(f"{BASE}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def player_token():
    return _login(PLAYER)


@pytest.fixture(scope="module")
def sa_token():
    return _login(SA)


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# --- Festival ---
def test_festival_status_active(player_token):
    r = requests.get(f"{BASE}/api/bonus/festival", headers=_h(player_token), timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["active"] is True
    assert data["bonus_coins"] == 151
    # claimed may be True/False depending on prior run; capture for next test
    pytest.festival_claimed_before = bool(data["claimed"])


def test_festival_claim_then_idempotent(player_token):
    before = requests.get(f"{BASE}/api/bonus/me", headers=_h(player_token)).json()
    bal_before = before["bonus_balance"]
    r = requests.post(f"{BASE}/api/bonus/festival/claim", headers=_h(player_token), timeout=15)
    if getattr(pytest, "festival_claimed_before", False):
        assert r.status_code == 400
    else:
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        after = requests.get(f"{BASE}/api/bonus/me", headers=_h(player_token)).json()
        assert after["bonus_balance"] - bal_before == 151
    # second claim always 400
    r2 = requests.post(f"{BASE}/api/bonus/festival/claim", headers=_h(player_token), timeout=15)
    assert r2.status_code == 400
    # status now shows claimed
    st = requests.get(f"{BASE}/api/bonus/festival", headers=_h(player_token)).json()
    assert st["claimed"] is True


# --- Referral ---
def test_referral_me(player_token):
    r = requests.get(f"{BASE}/api/referrals/me", headers=_h(player_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    # accept various shapes: check code + config
    assert "referral_code" in d or "code" in d
    cfg = d.get("config") or d
    assert cfg.get("referrer_amount") == 125
    assert cfg.get("referee_amount") == 75
    assert cfg.get("qualify_event") == "FIRST_RECHARGE"
    assert "referrals" in d or "history" in d


def test_referral_admin_stats_sa(sa_token):
    r = requests.get(f"{BASE}/api/referrals/admin/stats", headers=_h(sa_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    for k in ("total_referrals", "rewarded", "pending_qualification", "unique_referrers", "bonus_paid"):
        assert k in d, k
    for k in ("to_referrers", "to_referees", "total"):
        assert k in d["bonus_paid"], k


def test_referral_admin_stats_forbidden_for_player(player_token):
    r = requests.get(f"{BASE}/api/referrals/admin/stats", headers=_h(player_token), timeout=15)
    assert r.status_code == 403


# --- Notifications ---
def test_notifications_list(player_token):
    r = requests.get(f"{BASE}/api/notifications", headers=_h(player_token), timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "items" in d and "unread_count" in d


def test_notifications_mark_read(player_token):
    r = requests.post(f"{BASE}/api/notifications/read", headers=_h(player_token), json={}, timeout=15)
    assert r.status_code == 200
    after = requests.get(f"{BASE}/api/notifications", headers=_h(player_token)).json()
    assert after["unread_count"] == 0
