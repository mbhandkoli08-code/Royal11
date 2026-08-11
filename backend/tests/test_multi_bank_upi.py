"""Multi bank accounts + UPI QR feature tests (Part 1b extension).

Covers:
- GET/POST /api/admin/bank-accounts (multi-account, first auto-active, upi_id optional)
- PATCH /api/admin/bank-accounts/{id}/activate (exactly one active, isolation, 404)
- Deposit stamping with active account_id, per-account totals
- Suspension blocks add/activate
- GET /api/wallet/deposit-info returns active bank with upi_id + id
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


def _login(email, password=PWD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"Login failed {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_tok():
    return _login("admin1@royal11.com")


@pytest.fixture(scope="module")
def player_tok():
    return _login("player1@royal11.com")


@pytest.fixture(scope="module")
def manager_tok():
    return _login("manager1@royal11.com")


@pytest.fixture(scope="module")
def super_tok():
    return _login("superadmin@royal11.com")


@pytest.fixture(scope="module")
def fresh_admin(super_tok):
    """Create a fresh admin with two bank accounts for isolation/activate tests."""
    mgrs = requests.get(f"{API}/admin/managers", headers=_h(super_tok), timeout=30).json()
    # Prefer a manager with room; else raise max_admins
    mgr_id = mgrs[0]["user"]["id"]
    # Raise cap on this manager to unlimited so admin creation succeeds
    requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                   headers=_h(super_tok), json={"max_admins_allowed": None}, timeout=30)

    email = f"TEST_bankadmin_{uuid.uuid4().hex[:8]}@royal11.com"
    r = requests.post(f"{API}/admin/admins", headers=_h(super_tok), json={
        "email": email, "password": PWD, "display_name": "TEST Bank Admin",
        "manager_id": mgr_id, "player_capacity": 10,
    }, timeout=30)
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    tok = _login(email)

    acc1 = {
        "account_holder_name": "TEST Holder One",
        "account_number": f"9911{uuid.uuid4().hex[:8]}",
        "ifsc": "TEST0001234",
        "bank_name": "TEST Bank A",
        "upi_id": None,
    }
    r = requests.post(f"{API}/admin/bank-accounts", headers=_h(tok), json=acc1, timeout=30)
    assert r.status_code == 200, r.text
    acc1_doc = r.json()

    acc2 = {**acc1, "account_number": f"8822{uuid.uuid4().hex[:8]}",
            "bank_name": "TEST Bank B", "upi_id": "testb@okicici"}
    r = requests.post(f"{API}/admin/bank-accounts", headers=_h(tok), json=acc2, timeout=30)
    assert r.status_code == 200
    acc2_doc = r.json()

    return {"tok": tok, "id": new_id, "email": email, "acc1": acc1_doc, "acc2": acc2_doc}


# ---------------------------------------------------------------------------
# GET / POST /admin/bank-accounts
# ---------------------------------------------------------------------------
class TestListBankAccounts:
    def test_admin_list_shape(self, admin_tok):
        r = requests.get(f"{API}/admin/bank-accounts", headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        keys = {"id", "is_active", "confirmed_total_week",
                "confirmed_total_all_time", "account_holder_name",
                "account_number", "ifsc", "bank_name"}
        for a in data:
            missing = keys - a.keys()
            assert not missing, f"Missing keys {missing} in {a}"
        actives = [a for a in data if a["is_active"]]
        assert len(actives) == 1
        assert data[0]["is_active"] is True

    def test_manager_can_list_own(self, manager_tok):
        r = requests.get(f"{API}/admin/bank-accounts", headers=_h(manager_tok), timeout=30)
        assert r.status_code == 200

    def test_super_admin_forbidden(self, super_tok):
        r = requests.get(f"{API}/admin/bank-accounts", headers=_h(super_tok), timeout=30)
        assert r.status_code == 403


class TestCreateBankAccountRules:
    def test_first_is_auto_active_second_inactive(self, fresh_admin):
        assert fresh_admin["acc1"]["is_active"] is True
        assert fresh_admin["acc1"]["upi_id"] is None
        assert fresh_admin["acc2"]["is_active"] is False
        assert fresh_admin["acc2"]["upi_id"] == "testb@okicici"


# ---------------------------------------------------------------------------
# Activate + isolation
# ---------------------------------------------------------------------------
class TestActivateAndIsolation:
    def test_activate_switches_active(self, fresh_admin):
        tok = fresh_admin["tok"]
        acc2 = fresh_admin["acc2"]
        r = requests.patch(f"{API}/admin/bank-accounts/{acc2['id']}/activate",
                           headers=_h(tok), timeout=30)
        assert r.status_code == 200
        rows = requests.get(f"{API}/admin/bank-accounts", headers=_h(tok), timeout=30).json()
        actives = [a for a in rows if a["is_active"]]
        assert len(actives) == 1
        assert actives[0]["id"] == acc2["id"]

    def test_activate_other_admins_account_returns_404(self, admin_tok, fresh_admin):
        r = requests.patch(f"{API}/admin/bank-accounts/{fresh_admin['acc1']['id']}/activate",
                           headers=_h(admin_tok), timeout=30)
        assert r.status_code == 404

    def test_admin_cannot_see_other_admin_accounts(self, admin_tok, fresh_admin):
        rows = requests.get(f"{API}/admin/bank-accounts", headers=_h(admin_tok), timeout=30).json()
        other_ids = {fresh_admin["acc1"]["id"], fresh_admin["acc2"]["id"]}
        my_ids = {a["id"] for a in rows}
        assert not (my_ids & other_ids)


# ---------------------------------------------------------------------------
# Deposit stamping + wallet/deposit-info + per-account totals
# ---------------------------------------------------------------------------
class TestDepositStamping:
    def test_deposit_info_returns_active_with_upi(self, player_tok):
        r = requests.get(f"{API}/wallet/deposit-info", headers=_h(player_tok), timeout=30)
        assert r.status_code == 200
        b = r.json()["bank_account"]
        assert b is not None
        assert "id" in b and "upi_id" in b
        assert b.get("is_active") is True

    def test_deposit_stamps_and_totals(self, admin_tok, player_tok):
        rows = requests.get(f"{API}/admin/bank-accounts", headers=_h(admin_tok), timeout=30).json()
        active_A = next(a for a in rows if a["is_active"])
        others = [a for a in rows if not a["is_active"]]
        if not others:
            pytest.skip("admin1 needs >=2 bank accounts for stamping test")
        active_B = others[0]

        ref1 = f"TEST_MB_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/wallet/deposit-request", headers=_h(player_tok),
                          data={"amount_inr": "111", "reference_note": ref1}, timeout=30)
        assert r.status_code == 200, r.text
        dep1 = r.json()
        assert dep1["account_id"] == active_A["id"]

        # switch active
        r = requests.patch(f"{API}/admin/bank-accounts/{active_B['id']}/activate",
                           headers=_h(admin_tok), timeout=30)
        assert r.status_code == 200

        ref2 = f"TEST_MB_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/wallet/deposit-request", headers=_h(player_tok),
                          data={"amount_inr": "222", "reference_note": ref2}, timeout=30)
        assert r.status_code == 200
        dep2 = r.json()
        assert dep2["account_id"] == active_B["id"]

        def totals():
            rows = requests.get(f"{API}/admin/bank-accounts", headers=_h(admin_tok), timeout=30).json()
            return {a["id"]: a for a in rows}

        before = totals()
        r = requests.post(f"{API}/admin/deposits/{dep1['id']}/confirm",
                          headers=_h(admin_tok), json={"note": "ok"}, timeout=30)
        assert r.status_code == 200, r.text
        mid = totals()
        assert mid[active_A["id"]]["confirmed_total_all_time"] == \
               before[active_A["id"]]["confirmed_total_all_time"] + 111
        assert mid[active_B["id"]]["confirmed_total_all_time"] == \
               before[active_B["id"]]["confirmed_total_all_time"]

        r = requests.post(f"{API}/admin/deposits/{dep2['id']}/confirm",
                          headers=_h(admin_tok), json={"note": "ok"}, timeout=30)
        assert r.status_code == 200
        after = totals()
        assert after[active_B["id"]]["confirmed_total_all_time"] == \
               mid[active_B["id"]]["confirmed_total_all_time"] + 222
        assert after[active_A["id"]]["confirmed_total_all_time"] == \
               mid[active_A["id"]]["confirmed_total_all_time"]

        assert after[active_A["id"]]["confirmed_total_week"] >= \
               before[active_A["id"]]["confirmed_total_week"] + 111
        assert after[active_B["id"]]["confirmed_total_week"] >= \
               before[active_B["id"]]["confirmed_total_week"] + 222

        # Restore
        requests.patch(f"{API}/admin/bank-accounts/{active_A['id']}/activate",
                       headers=_h(admin_tok), timeout=30)


# ---------------------------------------------------------------------------
# Suspension blocks add/activate (403)
# ---------------------------------------------------------------------------
class TestSuspensionBlocks:
    def test_suspended_admin_cannot_add_or_activate(self, fresh_admin):
        # Direct DB mutation to set SUSPENDED status (no admin API for it).
        import motor.motor_asyncio
        mongo_url = os.environ.get("MONGO_URL")
        db_name = os.environ.get("DB_NAME")
        if not (mongo_url and db_name):
            # Read from backend/.env
            with open("/app/backend/.env") as f:
                for line in f:
                    if line.startswith("MONGO_URL="):
                        mongo_url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    elif line.startswith("DB_NAME="):
                        db_name = line.split("=", 1)[1].strip().strip('"').strip("'")
        assert mongo_url and db_name
        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_url)
        db = client[db_name]

        async def set_status(status):
            await db.users.update_one({"id": fresh_admin["id"]},
                                      {"$set": {"status": status, "suspension_reason": "test"}})

        asyncio.get_event_loop().run_until_complete(set_status("SUSPENDED"))
        try:
            tok = fresh_admin["tok"]
            # add
            r = requests.post(f"{API}/admin/bank-accounts", headers=_h(tok), json={
                "account_holder_name": "S H",
                "account_number": f"6622{uuid.uuid4().hex[:8]}",
                "ifsc": "SUSP0001234", "bank_name": "SBank2", "upi_id": None,
            }, timeout=30)
            assert r.status_code == 403, f"Expected 403 add, got {r.status_code} {r.text}"
            # activate
            r = requests.patch(f"{API}/admin/bank-accounts/{fresh_admin['acc1']['id']}/activate",
                               headers=_h(tok), timeout=30)
            assert r.status_code == 403, f"Expected 403 activate, got {r.status_code} {r.text}"
        finally:
            asyncio.get_event_loop().run_until_complete(set_status("ACTIVE"))
            client.close()
