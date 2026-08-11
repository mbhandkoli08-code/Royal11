"""Backend tests for the new /console Admin dashboard endpoints.

Covers:
- Super Admin overview / managers / admins / transactions (paginated)
- Manager my-allocation / my-admins / allocate
- Admin my-players / grant
- Role isolation (Manager and Admin blocked from Super Admin endpoints)
- Reversal flow via /admin/transactions/{id}/reverse
"""
import os
import uuid
import time

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

PWD = "ChangeMe123!"
SUPER = "superadmin@royal11.com"
MANAGER = "manager1@royal11.com"
ADMIN = "admin1@royal11.com"
PLAYER = "player1@royal11.com"


def _login(email, password=PWD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def super_tok():
    return _login(SUPER)


@pytest.fixture(scope="module")
def manager_tok():
    return _login(MANAGER)


@pytest.fixture(scope="module")
def admin_tok():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def player_tok():
    return _login(PLAYER)


# --- Super Admin: overview ------------------------------------------------
class TestOverview:
    def test_overview_shape(self, super_tok):
        r = requests.get(f"{API}/admin/overview", headers=_h(super_tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "totals" in data and "managers" in data
        t = data["totals"]
        for k in ["managers", "admins", "players", "coins_in_circulation",
                  "coins_allocated", "coins_remaining"]:
            assert k in t, f"missing key {k}"
            assert isinstance(t[k], int)
        assert isinstance(data["managers"], list)
        if data["managers"]:
            row = data["managers"][0]
            for k in ["id", "name", "authorized_quota", "allocated_out",
                      "admin_count", "player_count", "wallet_balance", "usage_pct"]:
                assert k in row


# --- Managers list & CRUD -------------------------------------------------
class TestManagers:
    def test_list_managers(self, super_tok):
        r = requests.get(f"{API}/admin/managers", headers=_h(super_tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if data:
            m = data[0]
            for k in ["user", "authorized_quota", "allocated_out", "remaining",
                      "usage_pct", "admin_count", "wallet_balance"]:
                assert k in m

    def test_create_fund_and_quota(self, super_tok):
        email = f"TEST_mgr_{uuid.uuid4().hex[:8]}@royal11.com"
        # create
        r = requests.post(f"{API}/admin/managers", headers=_h(super_tok), json={
            "email": email, "password": PWD, "display_name": "TEST Manager",
            "authorized_quota": 500000,
        }, timeout=15)
        assert r.status_code == 200, r.text
        mgr = r.json()
        mid = mgr["id"]
        assert mgr["email"] == email

        # appears in list
        r = requests.get(f"{API}/admin/managers", headers=_h(super_tok), timeout=15)
        assert any(m["user"]["id"] == mid for m in r.json())

        # fund
        r = requests.post(f"{API}/admin/managers/{mid}/fund", headers=_h(super_tok),
                          json={"amount": 100000, "reason": "TEST fund",
                                "request_id": str(uuid.uuid4())}, timeout=15)
        assert r.status_code == 200, r.text

        # wallet balance now 100000
        r = requests.get(f"{API}/admin/managers", headers=_h(super_tok), timeout=15)
        row = next(m for m in r.json() if m["user"]["id"] == mid)
        assert row["wallet_balance"] == 100000

        # quota update
        r = requests.patch(f"{API}/admin/managers/{mid}/quota", headers=_h(super_tok),
                           json={"authorized_quota": 750000}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["authorized_quota"] == 750000

        r = requests.get(f"{API}/admin/managers", headers=_h(super_tok), timeout=15)
        row = next(m for m in r.json() if m["user"]["id"] == mid)
        assert row["authorized_quota"] == 750000


# --- Admins list ----------------------------------------------------------
class TestAdmins:
    def test_list_admins(self, super_tok):
        r = requests.get(f"{API}/admin/admins", headers=_h(super_tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        if data:
            a = data[0]
            for k in ["user", "manager_name", "allocated", "used", "usage_pct",
                      "player_count", "wallet_balance"]:
                assert k in a


# --- Transactions ---------------------------------------------------------
class TestTransactions:
    def test_pagination_shape(self, super_tok):
        r = requests.get(f"{API}/admin/transactions?limit=5&skip=0",
                         headers=_h(super_tok), timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ["items", "total", "skip", "limit"]:
            assert k in data
        assert data["limit"] == 5
        assert isinstance(data["items"], list)
        assert len(data["items"]) <= 5
        if data["items"]:
            t = data["items"][0]
            for k in ["id", "type", "amount", "status", "created_at",
                      "user_name", "user_role"]:
                assert k in t

    def test_type_filter(self, super_tok):
        r = requests.get(f"{API}/admin/transactions?type=ADMIN_GRANT&limit=10",
                         headers=_h(super_tok), timeout=15)
        assert r.status_code == 200
        for t in r.json()["items"]:
            assert t["type"] == "ADMIN_GRANT"

    def test_reverse_creates_reversal(self, super_tok, admin_tok):
        # generate a grant txn first
        r = requests.get(f"{API}/admin/my-players", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        players = r.json()
        if not players:
            pytest.skip("Admin has no assigned players")
        pid = players[0]["player"]["id"]
        r = requests.post(f"{API}/admin/grant", headers=_h(admin_tok), json={
            "player_id": pid, "amount": 5, "reason": "TEST grant for reversal",
            "request_id": str(uuid.uuid4()),
        }, timeout=15)
        assert r.status_code == 200, r.text
        credit_id = r.json()["credit"]["id"]

        # reverse
        r = requests.post(f"{API}/admin/transactions/{credit_id}/reverse",
                          headers=_h(super_tok),
                          json={"reason": "TEST reversal"}, timeout=15)
        assert r.status_code == 200, r.text
        rev = r.json()
        assert rev["type"] == "REVERSAL"


# --- Manager scope --------------------------------------------------------
class TestManagerScope:
    def test_my_allocation(self, manager_tok):
        r = requests.get(f"{API}/admin/my-allocation", headers=_h(manager_tok), timeout=15)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ["authorized_quota", "allocated_out", "available_quota", "wallet_balance"]:
            assert k in d and isinstance(d[k], int)

    def test_my_admins(self, manager_tok):
        r = requests.get(f"{API}/admin/my-admins", headers=_h(manager_tok), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_allocate_increases_admin_wallet(self, manager_tok, super_tok):
        # find an admin under this manager
        r = requests.get(f"{API}/admin/my-admins", headers=_h(manager_tok), timeout=15)
        admins = r.json()
        if not admins:
            pytest.skip("Manager has no admins")
        target = admins[0]
        aid = target["user"]["id"]
        before = target["wallet_balance"]

        # Ensure manager has quota+wallet headroom (raise quota + fund if needed)
        alloc = requests.get(f"{API}/admin/my-allocation", headers=_h(manager_tok), timeout=15).json()
        # discover manager id
        me = requests.get(f"{API}/auth/me", headers=_h(manager_tok), timeout=15).json()
        mid = me["id"]
        if alloc["available_quota"] < 1000:
            requests.patch(f"{API}/admin/managers/{mid}/quota", headers=_h(super_tok),
                           json={"authorized_quota": alloc["authorized_quota"] + 100000}, timeout=15)
        if alloc["wallet_balance"] < 1000:
            requests.post(f"{API}/admin/managers/{mid}/fund", headers=_h(super_tok),
                          json={"amount": 100000, "reason": "TEST top-up",
                                "request_id": str(uuid.uuid4())}, timeout=15)

        r = requests.post(f"{API}/admin/allocate", headers=_h(manager_tok), json={
            "admin_id": aid, "amount": 1000, "request_id": str(uuid.uuid4()),
        }, timeout=15)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/admin/my-admins", headers=_h(manager_tok), timeout=15)
        after = next(a for a in r.json() if a["user"]["id"] == aid)["wallet_balance"]
        assert after == before + 1000


# --- Admin scope ----------------------------------------------------------
class TestAdminScope:
    def test_my_players(self, admin_tok):
        r = requests.get(f"{API}/admin/my-players", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_wallet_me(self, admin_tok):
        r = requests.get(f"{API}/wallet/me", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "wallet" in data and "balance" in data["wallet"]


# --- Role isolation --------------------------------------------------------
class TestRoleIsolation:
    @pytest.mark.parametrize("path", [
        "/admin/overview", "/admin/managers", "/admin/admins",
        "/admin/transactions",
    ])
    def test_manager_forbidden(self, manager_tok, path):
        r = requests.get(f"{API}{path}", headers=_h(manager_tok), timeout=15)
        assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    @pytest.mark.parametrize("path", [
        "/admin/overview", "/admin/managers", "/admin/admins",
        "/admin/transactions",
    ])
    def test_admin_forbidden(self, admin_tok, path):
        r = requests.get(f"{API}{path}", headers=_h(admin_tok), timeout=15)
        assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    def test_player_forbidden_on_admin_endpoints(self, player_tok):
        r = requests.get(f"{API}/admin/overview", headers=_h(player_tok), timeout=15)
        assert r.status_code == 403
