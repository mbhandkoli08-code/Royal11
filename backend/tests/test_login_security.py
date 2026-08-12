"""Brute-force login protection tests.

Uses throwaway emails (email-scope lockout) so real seeded accounts are never
locked. Cleans up login_attempts + security_alerts directly in Mongo afterwards
so the shared pod-IP counter doesn't accumulate across runs.
"""
import asyncio
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"
PWD = "ChangeMe123!"


def _login(email):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": PWD}, timeout=30)


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True, scope="module")
def _cleanup():
    yield
    # Reset counters so the pod IP isn't carried into later tests.
    import sys
    sys.path.insert(0, "/app/backend")
    from app.db import db  # noqa: E402
    asyncio.get_event_loop().run_until_complete(db.login_attempts.delete_many({}))
    asyncio.get_event_loop().run_until_complete(db.security_alerts.delete_many({}))


def test_lockout_after_five_failures_then_429():
    email = f"bf_{uuid.uuid4().hex[:10]}@royal11.com"
    codes = [_login_bad(email) for _ in range(5)]
    assert all(c == 401 for c in codes), codes
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": "x"}, timeout=30)
    assert r.status_code == 429, r.text
    assert "try again" in r.json()["detail"].lower()


def _login_bad(email):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}, timeout=30).status_code


def test_valid_login_not_blocked():
    # A legit account is unaffected by other emails' failures.
    assert _login("player1@royal11.com").status_code == 200


def test_super_admin_sees_and_resolves_alert():
    email = f"bf_{uuid.uuid4().hex[:10]}@royal11.com"
    for _ in range(6):
        requests.post(f"{API}/auth/login", json={"email": email, "password": "wrong"}, timeout=30)
    sa = _login("superadmin@royal11.com").json()["access_token"]
    alerts = requests.get(f"{API}/admin/security/login-alerts", headers=_h(sa), timeout=30).json()
    assert any(a["email"] == email for a in alerts), alerts
    r = requests.post(f"{API}/admin/security/login-alerts/resolve",
                      headers=_h(sa), json={"email": email}, timeout=30)
    assert r.status_code == 200
    # Lock cleared -> next bad attempt is 401 again, not 429.
    assert _login_bad(email) == 401


def test_alerts_rbac_admin_forbidden():
    tok = _login("admin1@royal11.com").json()["access_token"]
    r = requests.get(f"{API}/admin/security/login-alerts", headers=_h(tok), timeout=30)
    assert r.status_code == 403
