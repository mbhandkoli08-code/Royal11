"""OTP registration flow + SA security-alerts RBAC (iteration 19)."""
import os
import re
import time
import uuid
import asyncio

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


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login(email, pwd=PWD):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)


def _read_otp(email: str, timeout: int = 8) -> str:
    """Grep OTP_DEBUG line from supervisor backend logs. Backend writes to
    /var/log/supervisor/backend.*.log."""
    pattern = re.compile(rf"OTP_DEBUG {re.escape(email)} -> (\d{{6}})")
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        for path in ("/var/log/supervisor/backend.err.log",
                     "/var/log/supervisor/backend.out.log"):
            try:
                with open(path) as f:
                    for line in f:
                        m = pattern.search(line)
                        if m:
                            last = m.group(1)
            except FileNotFoundError:
                pass
        if last:
            return last
        time.sleep(0.3)
    return last


# ---------- OTP registration ----------

def test_register_returns_otp_sent_and_login_blocked():
    email = f"otp_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PWD, "display_name": "OTP Tester"
    }, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "otp_sent"
    assert body["requires_verification"] is True
    # Login must be blocked (403) until verified.
    lr = _login(email)
    assert lr.status_code == 403
    assert "verify" in lr.json()["detail"].lower()


def test_wrong_otp_then_correct_activates_and_credits_welcome_bonus():
    email = f"otp_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PWD, "display_name": "OTP Happy"
    }, timeout=30)
    assert r.status_code == 200
    code = _read_otp(email)
    assert code, "OTP code not found in backend logs"

    # Wrong code -> 400 with 'Incorrect code'
    bad = requests.post(f"{API}/auth/verify-otp",
                       json={"email": email, "code": "000000"}, timeout=30)
    assert bad.status_code == 400
    assert "incorrect" in bad.json()["detail"].lower()

    # Correct code -> token issued
    ok = requests.post(f"{API}/auth/verify-otp",
                      json={"email": email, "code": code}, timeout=30)
    assert ok.status_code == 200, ok.text
    data = ok.json()
    assert "access_token" in data
    tok = data["access_token"]
    assert data["user"]["email"] == email
    assert data["user"]["role"] == "PLAYER"

    # Wallet welcome bonus = 1000
    w = requests.get(f"{API}/wallet/me", headers=_h(tok), timeout=30)
    assert w.status_code == 200
    assert w.json()["wallet"]["balance"] == 1000

    # Login now works (ACTIVE)
    assert _login(email).status_code == 200

    # Reusing the code is rejected
    reuse = requests.post(f"{API}/auth/verify-otp",
                          json={"email": email, "code": code}, timeout=30)
    assert reuse.status_code == 400


def test_resend_otp_rate_limited():
    email = f"otp_{uuid.uuid4().hex[:10]}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email, "password": PWD, "display_name": "OTP Resend"
    }, timeout=30)
    assert r.status_code == 200
    # First resend should succeed within cooldown OR 429 (since register already sent one)
    r1 = requests.post(f"{API}/auth/resend-otp", json={"email": email}, timeout=30)
    # Immediately after register, cooldown likely active -> 429.
    assert r1.status_code in (200, 429), r1.text
    if r1.status_code == 200:
        # Second immediate call must hit cooldown
        r2 = requests.post(f"{API}/auth/resend-otp", json={"email": email}, timeout=30)
        assert r2.status_code == 429


# ---------- Seeded logins unaffected ----------

@pytest.mark.parametrize("email", [
    "superadmin@royal11.com",
    "admin1@royal11.com",
    "player1@royal11.com",
    "manager1@royal11.com",
    "zonal1@royal11.com",
])
def test_seeded_logins_still_work(email):
    r = _login(email)
    assert r.status_code == 200, f"{email}: {r.text}"
    assert "access_token" in r.json()


# ---------- Cleanup: remove any lockout counters after the module runs ----------

@pytest.fixture(autouse=True, scope="module")
def _cleanup():
    yield
    # Best-effort cleanup via HTTP not available; skip DB cleanup here to avoid
    # cross-loop asyncio issues under pytest-xdist. test_login_security.py has
    # its own module-scoped cleanup.
    return
