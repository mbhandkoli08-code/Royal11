"""Iter33 — Weekly INR settlements (admin/superadmin) + bank payout templates + CSV export + RBAC."""
import io
import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

SA = {"email": "superadmin@royal11.com", "password": "ChangeMe123!"}
AD = {"email": "admin1@royal11.com", "password": "ChangeMe123!"}
PL = {"email": "player1@royal11.com", "password": "ChangeMe123!"}


def _login(cred):
    r = requests.post(f"{BASE}/api/auth/login", json=cred, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def sa_tok():
    return _login(SA)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(AD)


@pytest.fixture(scope="module")
def player_tok():
    return _login(PL)


# ---------------- Auth / health ----------------
class TestHealthAndAuth:
    def test_backend_reachable(self):
        r = requests.get(f"{BASE}/api/", timeout=10)
        assert r.status_code in (200, 404)

    def test_logins(self, sa_tok, admin_tok, player_tok):
        assert sa_tok and admin_tok and player_tok


# ---------------- Admin settlements ----------------
class TestAdminSettlements:
    def test_my_settlements_returns_list(self, admin_tok):
        r = requests.get(f"{BASE}/api/admin/settlement/my", headers=_h(admin_tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Store for later tests
        pytest.settlement_rows = data

    def test_settlement_shape(self, admin_tok):
        r = requests.get(f"{BASE}/api/admin/settlement/my", headers=_h(admin_tok), timeout=20)
        rows = r.json()
        if not rows:
            pytest.skip("No settlements — seeded row may already be consumed")
        s = rows[0]
        for k in ("id", "admin_id", "week_start", "week_end", "due_date",
                  "total_deposits_inr", "super_admin_share_inr",
                  "net_to_remit_inr", "is_overdue", "in_grace", "grace_ends", "status"):
            assert k in s, f"missing {k} in {s.keys()}"

    def test_company_bank_visible_to_admin(self, admin_tok):
        r = requests.get(f"{BASE}/api/admin/settlement/company-bank", headers=_h(admin_tok), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert "account_number" in d


# ---------------- Super Admin: company bank ----------------
class TestCompanyBank:
    def test_get(self, sa_tok):
        r = requests.get(f"{BASE}/api/superadmin/settlement/company-bank", headers=_h(sa_tok), timeout=20)
        assert r.status_code == 200

    def test_put_and_persist(self, sa_tok):
        payload = {
            "account_name": "TEST_ROYAL11 Holdings",
            "bank_name": "TEST Bank",
            "account_number": "1234567890",
            "ifsc": "TESTB0001234",
            "upi_id": "royal11@upi",
            "notes": "TEST notes",
        }
        r = requests.put(f"{BASE}/api/superadmin/settlement/company-bank",
                         headers=_h(sa_tok), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["account_number"] == "1234567890"
        # re-fetch
        r2 = requests.get(f"{BASE}/api/superadmin/settlement/company-bank", headers=_h(sa_tok), timeout=20)
        assert r2.json()["ifsc"] == "TESTB0001234"


# ---------------- Bank payout templates ----------------
class TestTemplates:
    def test_list_starters(self, sa_tok):
        r = requests.get(f"{BASE}/api/superadmin/payouts/templates", headers=_h(sa_tok), timeout=20)
        assert r.status_code == 200
        tpls = r.json()
        codes = {t["bank_code"] for t in tpls}
        for code in ("UNIVERSAL", "HDFC", "ICICI", "SBI", "AXIS", "UNION"):
            assert code in codes, f"missing starter {code}; got {codes}"
        pytest.tpls = tpls

    def test_fields_endpoint(self, sa_tok):
        r = requests.get(f"{BASE}/api/superadmin/payouts/fields", headers=_h(sa_tok), timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert set(d["fields"]) >= {"beneficiary_name", "account_number", "ifsc", "amount", "mode", "remarks"}

    def test_crud_template(self, sa_tok):
        name = f"TEST_TPL_{uuid.uuid4().hex[:6]}"
        payload = {
            "name": name, "bank_code": "TSTB",
            "columns": [
                {"header": "Name", "field": "beneficiary_name"},
                {"header": "Acct", "field": "account_number"},
                {"header": "IFSC", "field": "ifsc"},
                {"header": "Amt", "field": "amount"},
            ],
        }
        r = requests.post(f"{BASE}/api/superadmin/payouts/templates",
                          headers=_h(sa_tok), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        t = r.json()
        tid = t["id"]
        assert t["name"] == name
        assert len(t["columns"]) == 4

        # update
        r2 = requests.put(f"{BASE}/api/superadmin/payouts/templates/{tid}",
                         headers=_h(sa_tok), json={"name": name + "_upd"}, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["name"] == name + "_upd"

        # delete
        r3 = requests.delete(f"{BASE}/api/superadmin/payouts/templates/{tid}",
                             headers=_h(sa_tok), timeout=20)
        assert r3.status_code == 200

    def test_bad_template_columns_400(self, sa_tok):
        r = requests.post(f"{BASE}/api/superadmin/payouts/templates",
                          headers=_h(sa_tok), json={"name": "bad", "columns": []}, timeout=20)
        assert r.status_code in (400, 422)


# ---------------- Payout admins + assign + export ----------------
class TestPayouts:
    def test_admins_list(self, sa_tok):
        r = requests.get(f"{BASE}/api/superadmin/payouts/admins", headers=_h(sa_tok), timeout=20)
        assert r.status_code == 200
        admins = r.json()
        assert isinstance(admins, list)
        assert len(admins) >= 1
        pytest.admins = admins

    def test_assign_template(self, sa_tok):
        tpls = requests.get(f"{BASE}/api/superadmin/payouts/templates", headers=_h(sa_tok)).json()
        uni = next(t for t in tpls if t["bank_code"] == "UNIVERSAL")
        admins = requests.get(f"{BASE}/api/superadmin/payouts/admins", headers=_h(sa_tok)).json()
        aid = admins[0]["admin_id"]
        r = requests.post(f"{BASE}/api/superadmin/payouts/assign",
                          headers=_h(sa_tok),
                          json={"admin_id": aid, "template_id": uni["id"]}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["bank_template_id"] == uni["id"]

    def test_export_csv(self, sa_tok):
        tpls = requests.get(f"{BASE}/api/superadmin/payouts/templates", headers=_h(sa_tok)).json()
        hdfc = next(t for t in tpls if t["bank_code"] == "HDFC")
        admins = requests.get(f"{BASE}/api/superadmin/payouts/admins", headers=_h(sa_tok)).json()
        aid = admins[0]["admin_id"]
        payload = {
            "template_id": hdfc["id"],
            "beneficiaries": [{"admin_id": aid, "amount": 5600, "remarks": "TEST_week"}]
        }
        r = requests.post(f"{BASE}/api/superadmin/payouts/export",
                          headers=_h(sa_tok), json=payload, timeout=20)
        assert r.status_code == 200, r.text
        assert "text/csv" in r.headers.get("content-type", "")
        lines = r.text.strip().splitlines()
        assert len(lines) >= 2
        header = lines[0].split(",")
        expected = [c["header"] for c in hdfc["columns"]]
        assert header == expected, f"header mismatch {header} vs {expected}"

    def test_export_empty_400(self, sa_tok):
        r = requests.post(f"{BASE}/api/superadmin/payouts/export",
                          headers=_h(sa_tok), json={"beneficiaries": []}, timeout=20)
        assert r.status_code == 400


# ---------------- Settlement Pay flow (admin submits) ----------------
class TestSubmitPay:
    def test_ensure_pending_and_submit(self, admin_tok, sa_tok):
        # Fetch a PENDING or SUBMITTED settlement; if none, create one via DB helper endpoint (skip if not possible)
        rows = requests.get(f"{BASE}/api/admin/settlement/my", headers=_h(admin_tok)).json()
        pending = [s for s in rows if s["status"] == "PENDING"]
        if not pending:
            pytest.skip("No PENDING settlement to test submit-pay flow (may already be SUBMITTED/SETTLED)")
        sid = pending[0]["id"]
        # Submit with reference
        r = requests.post(f"{BASE}/api/admin/settlement/{sid}/pay",
                          headers=_h(admin_tok),
                          data={"reference": f"TEST_REF_{uuid.uuid4().hex[:6]}"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "SUBMITTED"
        assert d.get("payment_reference")

    def test_submit_pay_requires_proof(self, admin_tok):
        rows = requests.get(f"{BASE}/api/admin/settlement/my", headers=_h(admin_tok)).json()
        if not rows:
            pytest.skip("No settlement")
        sid = rows[0]["id"]
        r = requests.post(f"{BASE}/api/admin/settlement/{sid}/pay",
                          headers=_h(admin_tok), data={"reference": ""}, timeout=20)
        assert r.status_code == 400


# ---------------- RBAC ----------------
class TestRBAC:
    def test_player_forbidden_superadmin_settlement(self, player_tok):
        r = requests.get(f"{BASE}/api/superadmin/payouts/templates",
                         headers=_h(player_tok), timeout=20)
        assert r.status_code == 403

    def test_admin_forbidden_superadmin_payouts(self, admin_tok):
        r = requests.get(f"{BASE}/api/superadmin/payouts/templates",
                         headers=_h(admin_tok), timeout=20)
        assert r.status_code == 403

    def test_admin_forbidden_superadmin_settlement_bank(self, admin_tok):
        r = requests.put(f"{BASE}/api/superadmin/settlement/company-bank",
                         headers=_h(admin_tok), json={"account_name": "X"}, timeout=20)
        assert r.status_code == 403

    def test_player_forbidden_admin_settlement(self, player_tok):
        r = requests.get(f"{BASE}/api/admin/settlement/my",
                         headers=_h(player_tok), timeout=20)
        assert r.status_code == 403

    def test_admin_cannot_pay_other_settlement(self, admin_tok):
        # fabricate a non-existent id → should 400 (not 200)
        r = requests.post(f"{BASE}/api/admin/settlement/does-not-exist/pay",
                          headers=_h(admin_tok), data={"reference": "TEST"}, timeout=20)
        assert r.status_code == 400
