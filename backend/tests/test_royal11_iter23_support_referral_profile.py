"""ROYAL11 iteration-23 tests.

Covers three features added this cycle:
1. Support Tickets (player + staff + Support-Helper role scoping/403 matrix)
2. Referral program (link, bonus grant, SA config, 403 matrix)
3. Player Profile self-service + SUPER_ADMIN-only sensitive/lookup reads
"""
import os
import re
import time
import uuid
import subprocess

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/") + "/api"
PASSWORD = "ChangeMe123!"

SUPER_ADMIN = "superadmin@royal11.com"
MANAGER = "manager1@royal11.com"
ADMIN = "admin1@royal11.com"
PLAYER = "player1@royal11.com"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
def _login(email, password=PASSWORD):
    r = requests.post(f"{BASE_URL}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def sa_token():
    return _login(SUPER_ADMIN)


@pytest.fixture(scope="session")
def manager_token():
    return _login(MANAGER)


@pytest.fixture(scope="session")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def player_token():
    return _login(PLAYER)


@pytest.fixture(scope="session")
def player_id(player_token):
    r = requests.get(f"{BASE_URL}/auth/me", headers=_headers(player_token))
    assert r.status_code == 200
    return r.json()["id"]


# ---------------------------------------------------------------------------
# 1. SUPPORT TICKETS — player
# ---------------------------------------------------------------------------
class TestSupportPlayer:
    def test_create_ticket_deposit_high_priority(self, player_token):
        payload = {
            "category": "DEPOSIT",
            "subject": "TEST_it23 deposit not credited",
            "description": "UTR 12345 pending",
            "related_ref": None,
        }
        r = requests.post(f"{BASE_URL}/support/tickets", headers=_headers(player_token), json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["priority"] == "HIGH"
        assert data["status"] == "OPEN"
        assert data["category"] == "DEPOSIT"
        assert data["ticket_no"].startswith("R11-")
        pytest.ticket_id = data["id"]

    def test_ticket_appears_in_my_list(self, player_token):
        r = requests.get(f"{BASE_URL}/support/tickets", headers=_headers(player_token))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert pytest.ticket_id in ids

    def test_general_ticket_normal_priority(self, player_token):
        payload = {"category": "GENERAL", "subject": "TEST_it23 misc", "description": "hello"}
        r = requests.post(f"{BASE_URL}/support/tickets", headers=_headers(player_token), json=payload)
        assert r.status_code == 200
        assert r.json()["priority"] == "NORMAL"

    def test_player_can_reply_own_ticket(self, player_token):
        r = requests.post(
            f"{BASE_URL}/support/tickets/{pytest.ticket_id}/messages",
            headers=_headers(player_token),
            json={"body": "any update?", "internal": False},
        )
        assert r.status_code == 200
        # Player-side detail must NOT include internal notes
        detail = r.json()
        for m in detail["messages"]:
            assert m["internal"] is False


# ---------------------------------------------------------------------------
# 2. SUPPORT TICKETS — staff (admin1)
# ---------------------------------------------------------------------------
class TestSupportStaff:
    def test_admin_sees_player_ticket(self, admin_token):
        r = requests.get(f"{BASE_URL}/support/admin/tickets", headers=_headers(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "tickets" in body and "counts" in body
        ids = [t["id"] for t in body["tickets"]]
        assert pytest.ticket_id in ids

    def test_admin_reply_moves_to_in_progress(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/support/admin/tickets/{pytest.ticket_id}/reply",
            headers=_headers(admin_token),
            json={"body": "Looking into this", "internal": False},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "IN_PROGRESS"

    def test_admin_internal_note_hidden_from_player(self, admin_token, player_token):
        note = f"internal note {uuid.uuid4().hex[:6]}"
        r = requests.post(
            f"{BASE_URL}/support/admin/tickets/{pytest.ticket_id}/reply",
            headers=_headers(admin_token),
            json={"body": note, "internal": True},
        )
        assert r.status_code == 200
        # Admin view should contain the internal message
        found_internal = any(m["internal"] and note in m["body"] for m in r.json()["messages"])
        assert found_internal
        # Player view must NOT contain internal note
        pr = requests.get(f"{BASE_URL}/support/tickets/{pytest.ticket_id}", headers=_headers(player_token))
        assert pr.status_code == 200
        assert all(not m["internal"] for m in pr.json()["messages"])
        assert all(note not in m["body"] for m in pr.json()["messages"])

    def test_admin_can_resolve(self, admin_token):
        r = requests.put(
            f"{BASE_URL}/support/admin/tickets/{pytest.ticket_id}/status",
            headers=_headers(admin_token),
            json={"status": "RESOLVED"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "RESOLVED"
        assert r.json()["resolved_at"] is not None

    def test_admin_can_escalate(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/support/admin/tickets/{pytest.ticket_id}/escalate",
            headers=_headers(admin_token),
        )
        assert r.status_code == 200
        data = r.json()
        assert data["escalation_level"] >= 1
        assert data["escalated_to"] is not None
        assert data["priority"] == "HIGH"


# ---------------------------------------------------------------------------
# 3. SUPPORT HELPER
# ---------------------------------------------------------------------------
class TestSupportHelper:
    @pytest.fixture(scope="class")
    def helper_creds(self, admin_token):
        email = f"test_helper_{uuid.uuid4().hex[:8]}@royal11.com"
        pw = "HelperPass123!"
        r = requests.post(
            f"{BASE_URL}/support/admin/helpers",
            headers=_headers(admin_token),
            json={"email": email, "password": pw, "display_name": "TEST helper it23"},
        )
        assert r.status_code == 200, r.text
        return {"email": email, "password": pw, "id": r.json()["id"]}

    def test_helper_can_login(self, helper_creds):
        token = _login(helper_creds["email"], helper_creds["password"])
        assert token
        helper_creds["token"] = token

    def test_helper_sees_admin_scope_tickets(self, helper_creds):
        token = helper_creds["token"]
        r = requests.get(f"{BASE_URL}/support/admin/tickets", headers=_headers(token))
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()["tickets"]]
        assert pytest.ticket_id in ids  # created under admin1 scope

    def test_helper_can_reply(self, helper_creds):
        r = requests.post(
            f"{BASE_URL}/support/admin/tickets/{pytest.ticket_id}/reply",
            headers=_headers(helper_creds["token"]),
            json={"body": "Helper acknowledges", "internal": False},
        )
        assert r.status_code == 200

    @pytest.mark.parametrize("path,method,body", [
        ("/admin/overview", "GET", None),
        ("/admin/my-players", "GET", None),
        ("/admin/transactions", "GET", None),
        ("/admin/grant", "POST", {"user_id": "x", "amount": 1, "reason": "no"}),
        ("/support/admin/helpers", "POST", {"email": "x@royal11.com", "password": "abcd1234", "display_name": "n"}),
    ])
    def test_helper_forbidden_on_financial_endpoints(self, helper_creds, path, method, body):
        h = _headers(helper_creds["token"])
        if method == "GET":
            r = requests.get(f"{BASE_URL}{path}", headers=h)
        else:
            r = requests.post(f"{BASE_URL}{path}", headers=h, json=body or {})
        assert r.status_code == 403, f"{path} -> {r.status_code} {r.text}"


# ---------------------------------------------------------------------------
# 4. REFERRAL
# ---------------------------------------------------------------------------
class TestReferralConfig403:
    def test_admin_cannot_read_config(self, admin_token):
        r = requests.get(f"{BASE_URL}/referrals/admin/config", headers=_headers(admin_token))
        assert r.status_code == 403

    def test_manager_cannot_read_config(self, manager_token):
        r = requests.get(f"{BASE_URL}/referrals/admin/config", headers=_headers(manager_token))
        assert r.status_code == 403

    def test_player_cannot_read_config(self, player_token):
        r = requests.get(f"{BASE_URL}/referrals/admin/config", headers=_headers(player_token))
        assert r.status_code == 403

    def test_sa_can_read_config(self, sa_token):
        r = requests.get(f"{BASE_URL}/referrals/admin/config", headers=_headers(sa_token))
        assert r.status_code == 200
        cfg = r.json()
        assert "qualify_event" in cfg


class TestReferralMe:
    def test_player_me(self, player_token):
        r = requests.get(f"{BASE_URL}/referrals/me", headers=_headers(player_token))
        assert r.status_code == 200
        data = r.json()
        assert data["code"]
        assert "stats" in data and "referrals" in data
        pytest.player1_ref_code = data["code"]


def _read_otp_from_logs(email: str, timeout=10) -> str:
    """Grep OTP_DEBUG_LOG line for the given email in supervisor backend log."""
    pattern = re.compile(rf"OTP_DEBUG {re.escape(email)} -> (\d{{4,8}})")
    deadline = time.time() + timeout
    while time.time() < deadline:
        for path in ("/var/log/supervisor/backend.out.log", "/var/log/supervisor/backend.err.log"):
            try:
                out = subprocess.check_output(["tail", "-n", "500", path], text=True, stderr=subprocess.DEVNULL)
            except Exception:
                continue
            matches = pattern.findall(out)
            if matches:
                return matches[-1]
        time.sleep(1)
    return ""


class TestReferralFlow:
    """End-to-end: sign a new player up with player1's referral code, verify
    OTP, and confirm the referral link + referee bonus."""

    def _signup(self, email, ref_code):
        r = requests.post(f"{BASE_URL}/auth/register", json={
            "email": email, "password": PASSWORD,
            "display_name": "TEST it23 referee",
            "referral_code": ref_code,
        })
        return r

    def test_signup_verify_and_link(self, sa_token, player_token):
        # ensure config is FIRST_RECHARGE for baseline
        requests.put(f"{BASE_URL}/referrals/admin/config", headers=_headers(sa_token),
                     json={"qualify_event": "FIRST_RECHARGE", "enabled": True})

        code = pytest.player1_ref_code
        new_email = f"test_ref_{uuid.uuid4().hex[:10]}@royal11.com"
        r = self._signup(new_email, code)
        if r.status_code == 429:
            pytest.skip("brute-force lockout on shared pod IP")
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "otp_sent"

        otp = _read_otp_from_logs(new_email, timeout=15)
        assert otp, "OTP not found in backend logs"

        vr = requests.post(f"{BASE_URL}/auth/verify-otp", json={"email": new_email, "code": otp})
        assert vr.status_code == 200, vr.text
        new_token = vr.json()["access_token"]

        # New player bonus rail must have referee bonus (>=100 coins)
        wr = requests.get(f"{BASE_URL}/bonus/me", headers=_headers(new_token))
        assert wr.status_code == 200, wr.text
        w = wr.json()
        bonus = w.get("bonus_balance") or w.get("balance") or w.get("total") or 0
        # some schemas return grants list only — sum active grants
        if not bonus and isinstance(w.get("grants"), list):
            bonus = sum(g.get("remaining_amount", g.get("amount", 0)) for g in w["grants"])
        assert bonus >= 100, f"referee bonus not credited: {w}"

        # Player1 referrals list must now include this referee
        pr = requests.get(f"{BASE_URL}/referrals/me", headers=_headers(player_token))
        assert pr.status_code == 200
        assert pr.json()["stats"]["joined"] >= 1

        pytest.new_referee_token = new_token
        pytest.new_referee_email = new_email

    def test_signup_qualify_event_SIGNUP_rewards_referrer_immediately(self, sa_token, player_token):
        # switch to SIGNUP
        r = requests.put(f"{BASE_URL}/referrals/admin/config", headers=_headers(sa_token),
                         json={"qualify_event": "SIGNUP", "enabled": True})
        assert r.status_code == 200
        try:
            code = pytest.player1_ref_code
            before = requests.get(f"{BASE_URL}/referrals/me", headers=_headers(player_token)).json()
            before_earned = before["stats"]["total_earned"]

            new_email = f"test_ref_{uuid.uuid4().hex[:10]}@royal11.com"
            r = self._signup(new_email, code)
            if r.status_code == 429:
                pytest.skip("brute-force lockout on shared pod IP")
            assert r.status_code == 200
            otp = _read_otp_from_logs(new_email, timeout=15)
            assert otp
            vr = requests.post(f"{BASE_URL}/auth/verify-otp", json={"email": new_email, "code": otp})
            assert vr.status_code == 200

            after = requests.get(f"{BASE_URL}/referrals/me", headers=_headers(player_token)).json()
            assert after["stats"]["total_earned"] > before_earned, "referrer not rewarded on SIGNUP"
        finally:
            # ALWAYS reset to FIRST_RECHARGE
            requests.put(f"{BASE_URL}/referrals/admin/config", headers=_headers(sa_token),
                         json={"qualify_event": "FIRST_RECHARGE"})


# ---------------------------------------------------------------------------
# 5. PLAYER PROFILE self-service
# ---------------------------------------------------------------------------
class TestPlayerProfileSelf:
    def test_get_own(self, player_token):
        r = requests.get(f"{BASE_URL}/me/profile", headers=_headers(player_token))
        assert r.status_code == 200
        assert "consent" in r.json()
        assert r.json()["consent"]["marketing_opt_in"] is False or r.json()["consent"]["marketing_opt_in"] in (True, False)

    def test_update_own(self, player_token):
        payload = {
            "mobile": "9876543210",
            "upi_id": "test_it23@upi",
            "bank": {"account_holder_name": "Test User", "account_number": "1234567890",
                     "ifsc": "HDFC0001234", "bank_name": "HDFC"},
            "consent": {"marketing_opt_in": True, "sms": True, "whatsapp": True, "push": False},
        }
        r = requests.put(f"{BASE_URL}/me/profile", headers=_headers(player_token), json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["mobile"] == "9876543210"
        assert data["upi_id"] == "test_it23@upi"
        assert data["bank"]["ifsc"] == "HDFC0001234"
        assert data["consent"]["marketing_opt_in"] is True
        assert data["consent_updated_at"] is not None
        assert data["consent_source"] == "player_self_service"


# ---------------------------------------------------------------------------
# 6. CRITICAL — Super Admin only access to sensitive/lookup
# ---------------------------------------------------------------------------
class TestSensitiveAccessMatrix:
    def test_sa_lookup_200(self, sa_token):
        r = requests.get(f"{BASE_URL}/admin/players/lookup?q=player1", headers=_headers(sa_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_sa_sensitive_200(self, sa_token, player_id):
        r = requests.get(f"{BASE_URL}/admin/players/{player_id}/sensitive", headers=_headers(sa_token))
        assert r.status_code == 200
        body = r.json()
        assert body["player"]["id"] == player_id
        assert "profile" in body

    @pytest.mark.parametrize("role_token_fixture", ["admin_token", "manager_token", "player_token"])
    def test_non_sa_lookup_403(self, role_token_fixture, request):
        tok = request.getfixturevalue(role_token_fixture)
        r = requests.get(f"{BASE_URL}/admin/players/lookup?q=player", headers=_headers(tok))
        assert r.status_code == 403, f"{role_token_fixture} -> {r.status_code}"

    @pytest.mark.parametrize("role_token_fixture", ["admin_token", "manager_token", "player_token"])
    def test_non_sa_sensitive_403(self, role_token_fixture, request, player_id):
        tok = request.getfixturevalue(role_token_fixture)
        r = requests.get(f"{BASE_URL}/admin/players/{player_id}/sensitive", headers=_headers(tok))
        assert r.status_code == 403, f"{role_token_fixture} -> {r.status_code}"

    def test_sa_reveal_writes_audit_log(self, sa_token, player_id):
        # trigger reveal
        r = requests.get(f"{BASE_URL}/admin/players/{player_id}/sensitive", headers=_headers(sa_token))
        assert r.status_code == 200
        # verify via mongo directly if possible
        try:
            from pymongo import MongoClient
            mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
            db_name = os.environ.get("DB_NAME", "test_database")
            client = MongoClient(mongo_url)
            logs = list(client[db_name].audit_logs.find(
                {"action": "PLAYER_SENSITIVE_VIEWED", "target_id": player_id}
            ).sort("_id", -1).limit(3))
            assert len(logs) >= 1, "no PLAYER_SENSITIVE_VIEWED audit log"
        except ImportError:
            pytest.skip("pymongo not available")
