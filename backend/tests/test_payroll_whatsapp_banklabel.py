"""Task 3 tests: Payroll (salary+incentive) + WhatsApp contact + Bank label.

Covers:
- PATCH /api/admin/managers/{id}/payroll & zonal-managers/{id}/payroll
- GET  /api/admin/my-payroll & /api/admin/zonal/my-payroll
- Auth (SA only for PATCH; MANAGER/ZM for GET)
- PUT /api/admin/profile/whatsapp + GET /api/admin/profile
- GET /api/wallet/my-agent + /api/wallet/deposit-info (admin_whatsapp)
- Bank account with `label`
- Idempotent payroll credit via payroll_service.run_payroll_for_week
"""
import os
import asyncio
import uuid
import pytest
import requests

def _load_env():
    for p in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            with open(p) as f:
                for line in f:
                    if "=" in line and not line.strip().startswith("#"):
                        k, v = line.strip().split("=", 1)
                        os.environ.setdefault(k, v.strip().strip('"').strip("'"))
        except FileNotFoundError:
            pass
_load_env()
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "sa": _login("superadmin@royal11.com", "ChangeMe123!"),
        "zm": _login("zonal1@royal11.com", "ChangeMe123!"),
        "mgr": _login("manager1@royal11.com", "ChangeMe123!"),
        "admin": _login("admin1@royal11.com", "ChangeMe123!"),
        "player": _login("player1@royal11.com", "ChangeMe123!"),
    }


@pytest.fixture(scope="module")
def ids(tokens):
    r = requests.get(f"{API}/admin/managers", headers=_h(tokens["sa"]), timeout=30)
    assert r.status_code == 200
    managers = r.json()
    mgr = next((m for m in managers if m["user"]["email"] == "manager1@royal11.com"), None)
    assert mgr, "manager1 not found"
    r2 = requests.get(f"{API}/admin/zonal-managers", headers=_h(tokens["sa"]), timeout=30)
    assert r2.status_code == 200
    zms = r2.json()
    zm = next((z for z in zms if z["user"]["email"] == "zonal1@royal11.com"), None)
    assert zm, "zonal1 not found"
    return {"mgr_id": mgr["user"]["id"], "zm_id": zm["user"]["id"]}


# ---------------------------------------------------------------------------
# PAYROLL SET: only SUPER_ADMIN
# ---------------------------------------------------------------------------
class TestPayrollSet:
    def test_set_manager_payroll_sa_ok(self, tokens, ids):
        payload = {"weekly_salary_inr": 5000, "incentive_target_inr": 1000, "incentive_pct": 10}
        r = requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                           json=payload, headers=_h(tokens["sa"]), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["weekly_salary_inr"] == 5000
        assert data["incentive_target_inr"] == 1000
        assert data["incentive_pct"] == 10

    def test_set_manager_payroll_forbidden_for_manager(self, tokens, ids):
        r = requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                           json={"weekly_salary_inr": 100, "incentive_target_inr": 0, "incentive_pct": 0},
                           headers=_h(tokens["mgr"]), timeout=30)
        assert r.status_code == 403

    def test_set_manager_payroll_forbidden_for_zonal(self, tokens, ids):
        r = requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                           json={"weekly_salary_inr": 100, "incentive_target_inr": 0, "incentive_pct": 0},
                           headers=_h(tokens["zm"]), timeout=30)
        assert r.status_code == 403

    def test_set_zonal_payroll_sa_ok(self, tokens, ids):
        r = requests.patch(f"{API}/admin/zonal-managers/{ids['zm_id']}/payroll",
                           json={"weekly_salary_inr": 8000, "incentive_target_inr": 5000, "incentive_pct": 5},
                           headers=_h(tokens["sa"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["weekly_salary_inr"] == 8000 and d["incentive_target_inr"] == 5000 and d["incentive_pct"] == 5

    def test_set_zonal_payroll_forbidden_zm(self, tokens, ids):
        r = requests.patch(f"{API}/admin/zonal-managers/{ids['zm_id']}/payroll",
                           json={"weekly_salary_inr": 1, "incentive_target_inr": 0, "incentive_pct": 0},
                           headers=_h(tokens["zm"]), timeout=30)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# PAYROLL VIEW
# ---------------------------------------------------------------------------
class TestPayrollView:
    def test_manager_my_payroll(self, tokens, ids):
        # ensure payroll set to salary=5000/target=1000/pct=10
        requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                       json={"weekly_salary_inr": 5000, "incentive_target_inr": 1000, "incentive_pct": 10},
                       headers=_h(tokens["sa"]), timeout=30)
        r = requests.get(f"{API}/admin/my-payroll", headers=_h(tokens["mgr"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("week_start", "week_end", "weekly_salary_inr", "incentive_target_inr",
                  "incentive_pct", "current_week_revenue_inr", "target_met",
                  "projected_incentive_inr", "projected_total_inr", "history"):
            assert k in d, f"missing key {k}"
        assert d["weekly_salary_inr"] == 5000
        assert d["incentive_target_inr"] == 1000
        assert d["incentive_pct"] == 10
        rev = d["current_week_revenue_inr"]
        if rev >= 1000:
            assert d["target_met"] is True
            assert d["projected_incentive_inr"] == round(rev * 0.10)
            assert d["projected_total_inr"] == 5000 + d["projected_incentive_inr"]
        else:
            assert d["target_met"] is False
            assert d["projected_incentive_inr"] == 0
            assert d["projected_total_inr"] == 5000
        assert isinstance(d["history"], list)

    def test_manager_payroll_target_high(self, tokens, ids):
        # Set target very high so target not met
        requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                       json={"weekly_salary_inr": 5000, "incentive_target_inr": 10_000_000, "incentive_pct": 10},
                       headers=_h(tokens["sa"]), timeout=30)
        r = requests.get(f"{API}/admin/my-payroll", headers=_h(tokens["mgr"]), timeout=30)
        d = r.json()
        assert d["target_met"] is False
        assert d["projected_incentive_inr"] == 0
        assert d["projected_total_inr"] == 5000
        # reset back
        requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                       json={"weekly_salary_inr": 5000, "incentive_target_inr": 1000, "incentive_pct": 10},
                       headers=_h(tokens["sa"]), timeout=30)

    def test_zonal_my_payroll(self, tokens):
        r = requests.get(f"{API}/admin/zonal/my-payroll", headers=_h(tokens["zm"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "weekly_salary_inr" in d and "projected_total_inr" in d and "history" in d

    def test_my_payroll_forbidden_for_admin(self, tokens):
        r = requests.get(f"{API}/admin/my-payroll", headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# IDEMPOTENT PAYROLL CREDIT via payroll_service.run_payroll_for_week
# ---------------------------------------------------------------------------
class TestPayrollIdempotent:
    def test_run_payroll_idempotent(self, tokens, ids):
        """Directly invoke payroll_service and verify wallet increments once."""
        import sys
        sys.path.insert(0, "/app/backend")
        from app import payroll_service
        from app.db import db
        from datetime import datetime, timezone
        from app.revenue_service import week_bounds

        # ensure known payroll on manager1
        requests.patch(f"{API}/admin/managers/{ids['mgr_id']}/payroll",
                       json={"weekly_salary_inr": 5000, "incentive_target_inr": 1000, "incentive_pct": 10},
                       headers=_h(tokens["sa"]), timeout=30)

        async def run():
            today = datetime.now(timezone.utc).date()
            ws, we = week_bounds(today)
            # snapshot wallet
            w0 = await db.wallets.find_one({"user_id": ids["mgr_id"]}, {"_id": 0}) or {"balance": 0}
            bal0 = w0["balance"]
            salary_before = await db.ledger_transactions.count_documents(
                {"user_id": ids["mgr_id"], "type": "SALARY", "request_id": f"salary:{ids['mgr_id']}:{ws.isoformat()}"})
            await payroll_service.run_payroll_for_week(ws, we)
            w1 = await db.wallets.find_one({"user_id": ids["mgr_id"]}, {"_id": 0})
            bal1 = w1["balance"]
            salary_after = await db.ledger_transactions.count_documents(
                {"user_id": ids["mgr_id"], "type": "SALARY", "request_id": f"salary:{ids['mgr_id']}:{ws.isoformat()}"})
            # Second run — must NOT double credit
            await payroll_service.run_payroll_for_week(ws, we)
            w2 = await db.wallets.find_one({"user_id": ids["mgr_id"]}, {"_id": 0})
            bal2 = w2["balance"]
            salary_after2 = await db.ledger_transactions.count_documents(
                {"user_id": ids["mgr_id"], "type": "SALARY", "request_id": f"salary:{ids['mgr_id']}:{ws.isoformat()}"})
            return bal0, bal1, bal2, salary_before, salary_after, salary_after2

        bal0, bal1, bal2, sb, sa, sa2 = asyncio.run(run())
        # Wallet may already have salary from earlier — key check: idempotency
        assert bal1 == bal2, f"double-credited: {bal0}->{bal1}->{bal2}"
        assert sa == sa2 == 1, f"salary txn count not exactly 1: before={sb} after={sa} after2={sa2}"
        # If salary wasn't credited yet in this week: bal1 == bal0 + 5000 (+ optional incentive)
        assert bal1 >= bal0  # never decreases


# ---------------------------------------------------------------------------
# WHATSAPP
# ---------------------------------------------------------------------------
class TestWhatsApp:
    def test_admin_set_and_get_whatsapp(self, tokens):
        num = "+919876543210"
        r = requests.put(f"{API}/admin/profile/whatsapp",
                         json={"whatsapp_number": num}, headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["whatsapp_number"] == num

        r2 = requests.get(f"{API}/admin/profile", headers=_h(tokens["admin"]), timeout=30)
        assert r2.status_code == 200
        assert r2.json()["whatsapp_number"] == num

    def test_manager_set_whatsapp(self, tokens):
        r = requests.put(f"{API}/admin/profile/whatsapp",
                         json={"whatsapp_number": "+911234567890"}, headers=_h(tokens["mgr"]), timeout=30)
        assert r.status_code == 200

    def test_player_cannot_set_whatsapp(self, tokens):
        r = requests.put(f"{API}/admin/profile/whatsapp",
                         json={"whatsapp_number": "+910000000000"}, headers=_h(tokens["player"]), timeout=30)
        assert r.status_code == 403

    def test_player_my_agent_returns_whatsapp(self, tokens):
        # ensure admin1's whatsapp is set
        requests.put(f"{API}/admin/profile/whatsapp",
                     json={"whatsapp_number": "+919876543210"}, headers=_h(tokens["admin"]), timeout=30)
        r = requests.get(f"{API}/wallet/my-agent", headers=_h(tokens["player"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "admin_name" in d and "admin_whatsapp" in d
        assert d["admin_whatsapp"] == "+919876543210"

    def test_deposit_info_includes_whatsapp(self, tokens):
        r = requests.get(f"{API}/wallet/deposit-info", headers=_h(tokens["player"]), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "admin_whatsapp" in d
        assert d["admin_whatsapp"] == "+919876543210"

    def test_my_agent_null_when_no_whatsapp(self, tokens):
        # Clear whatsapp
        requests.put(f"{API}/admin/profile/whatsapp",
                     json={"whatsapp_number": None}, headers=_h(tokens["admin"]), timeout=30)
        r = requests.get(f"{API}/wallet/my-agent", headers=_h(tokens["player"]), timeout=30)
        assert r.status_code == 200
        assert r.json()["admin_whatsapp"] is None
        # restore
        requests.put(f"{API}/admin/profile/whatsapp",
                     json={"whatsapp_number": "+919876543210"}, headers=_h(tokens["admin"]), timeout=30)


# ---------------------------------------------------------------------------
# BANK ACCOUNT LABEL
# ---------------------------------------------------------------------------
class TestBankLabel:
    def test_create_bank_account_with_label(self, tokens):
        unique = uuid.uuid4().hex[:8]
        payload = {
            "account_holder_name": f"TEST_LBL_{unique}",
            "account_number": f"ACC{unique}",
            "ifsc": "HDFC0000123",
            "bank_name": "TEST BANK",
            "label": "Primary Collection",
            "upi_id": None,
        }
        r = requests.post(f"{API}/admin/bank-accounts", json=payload,
                          headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["label"] == "Primary Collection"

        # list returns it with label
        r2 = requests.get(f"{API}/admin/bank-accounts", headers=_h(tokens["admin"]), timeout=30)
        assert r2.status_code == 200
        found = next((a for a in r2.json() if a["account_number"] == f"ACC{unique}"), None)
        assert found is not None
        assert found["label"] == "Primary Collection"

    def test_create_bank_account_without_label_ok(self, tokens):
        unique = uuid.uuid4().hex[:8]
        payload = {
            "account_holder_name": f"TEST_NOLBL_{unique}",
            "account_number": f"ACC{unique}",
            "ifsc": "HDFC0000123",
            "bank_name": "TEST BANK",
        }
        r = requests.post(f"{API}/admin/bank-accounts", json=payload,
                          headers=_h(tokens["admin"]), timeout=30)
        assert r.status_code == 200
        assert r.json().get("label") is None
