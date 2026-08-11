"""Backend tests for Task 2: Zonal Manager tier + admin-creation approval + cap.

Focused on the 12 verification points from the review request. Uses fresh unique
emails per run to avoid 409 conflicts on repeated runs.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

SA = ("superadmin@royal11.com", "ChangeMe123!")
ZM = ("zonal1@royal11.com", "ChangeMe123!")
MGR = ("manager1@royal11.com", "ChangeMe123!")  # no zone


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _uniq(prefix):
    return f"TEST_{prefix}_{uuid.uuid4().hex[:8]}@royal11.com"


# --- Session-scoped tokens + shared state ---
@pytest.fixture(scope="module")
def state():
    sa = _login(*SA)
    zm = _login(*ZM)
    mgr = _login(*MGR)
    # resolve ids
    def me(t):
        return requests.get(f"{API}/auth/me", headers=_h(t), timeout=10).json()
    return {
        "sa": sa, "zm": zm, "mgr": mgr,
        "sa_me": me(sa), "zm_me": me(zm), "mgr_me": me(mgr),
        "created": {},
    }


# ---------------- Zonal Manager CRUD (SA) ----------------
class TestZonalManagerSA:
    def test_list_zonal_managers(self, state):
        r = requests.get(f"{API}/admin/zonal-managers", headers=_h(state["sa"]), timeout=10)
        assert r.status_code == 200
        rows = r.json()
        assert any(z["user"]["email"] == "zonal1@royal11.com" for z in rows)

    def test_create_new_zonal_manager(self, state):
        email = _uniq("zm")
        r = requests.post(f"{API}/admin/zonal-managers", headers=_h(state["sa"]),
                          json={"email": email, "password": "ChangeMe123!",
                                "display_name": "Test ZM", "authorized_quota": 500000},
                          timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["email"] == email and j["role"] == "ZONAL_MANAGER"
        state["created"]["new_zm_id"] = j["id"]
        state["created"]["new_zm_email"] = email

    def test_set_zonal_quota(self, state):
        zm_id = state["created"]["new_zm_id"]
        r = requests.patch(f"{API}/admin/zonal-managers/{zm_id}/quota",
                           headers=_h(state["sa"]), json={"authorized_quota": 800000}, timeout=10)
        assert r.status_code == 200
        assert r.json()["authorized_quota"] == 800000

    def test_fund_zonal_wallet(self, state):
        zm_id = state["created"]["new_zm_id"]
        r = requests.post(f"{API}/admin/zonal-managers/{zm_id}/fund",
                          headers=_h(state["sa"]),
                          json={"amount": 300000, "reason": "test fund"}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["amount"] == 300000


# ---------------- ZM console (zonal1) ----------------
class TestZMConsole:
    def test_my_allocation(self, state):
        r = requests.get(f"{API}/admin/zonal/my-allocation", headers=_h(state["zm"]), timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        for k in ("authorized_quota", "allocated_out", "available_quota", "wallet_balance"):
            assert k in j
        assert j["authorized_quota"] >= j["allocated_out"]

    def test_my_managers(self, state):
        r = requests.get(f"{API}/admin/zonal/my-managers", headers=_h(state["zm"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_zm_create_manager_and_fund(self, state):
        email = _uniq("mgr")
        # ZM creates manager in its zone
        r = requests.post(f"{API}/admin/zonal/managers", headers=_h(state["zm"]),
                          json={"email": email, "password": "ChangeMe123!",
                                "display_name": "ZM's mgr", "authorized_quota": 100000},
                          timeout=15)
        assert r.status_code == 200, r.text
        new_mgr = r.json()
        state["created"]["zm_mgr_id"] = new_mgr["id"]
        state["created"]["zm_mgr_email"] = email
        # Verify it appears in zm_my_managers
        r2 = requests.get(f"{API}/admin/zonal/my-managers", headers=_h(state["zm"]), timeout=10)
        assert any(m["user"]["id"] == new_mgr["id"] for m in r2.json())
        # Fund it
        alloc_before = requests.get(f"{API}/admin/zonal/my-allocation", headers=_h(state["zm"]), timeout=10).json()
        r3 = requests.post(f"{API}/admin/zonal/fund-manager", headers=_h(state["zm"]),
                           json={"manager_id": new_mgr["id"], "amount": 50000}, timeout=15)
        assert r3.status_code == 200, r3.text
        assert r3.json()["credit"]["amount"] == 50000
        # Quota reserved
        alloc_after = requests.get(f"{API}/admin/zonal/my-allocation", headers=_h(state["zm"]), timeout=10).json()
        assert alloc_after["allocated_out"] == alloc_before["allocated_out"] + 50000

    def test_zm_cannot_fund_manager_outside_zone(self, state):
        # manager1 has no zone → 403
        mgr_id = state["mgr_me"]["id"]
        r = requests.post(f"{API}/admin/zonal/fund-manager", headers=_h(state["zm"]),
                          json={"manager_id": mgr_id, "amount": 100}, timeout=10)
        assert r.status_code == 403, r.text

    def test_zm_cannot_fund_beyond_quota(self, state):
        r = requests.post(f"{API}/admin/zonal/fund-manager", headers=_h(state["zm"]),
                          json={"manager_id": state["created"]["zm_mgr_id"],
                                "amount": 99999999999}, timeout=10)
        assert r.status_code == 400


# ---------------- Per-Manager cap ----------------
class TestAdminCap:
    def test_sa_sets_cap(self, state):
        mgr_id = state["created"]["zm_mgr_id"]
        r = requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                           headers=_h(state["sa"]), json={"max_admins_allowed": 2}, timeout=10)
        assert r.status_code == 200, r.text
        assert r.json()["max_admins_allowed"] == 2

    def test_zm_sets_cap_on_own_zone_manager(self, state):
        mgr_id = state["created"]["zm_mgr_id"]
        r = requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                           headers=_h(state["zm"]), json={"max_admins_allowed": 3}, timeout=10)
        assert r.status_code == 200, r.text

    def test_zm_cannot_set_cap_outside_zone(self, state):
        mgr_id = state["mgr_me"]["id"]  # manager1 no zone
        r = requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                           headers=_h(state["zm"]), json={"max_admins_allowed": 5}, timeout=10)
        assert r.status_code == 403, r.text


# ---------------- Admin-creation approval workflow ----------------
class TestAdminApprovalWorkflow:
    def test_manager_cannot_create_admin_directly(self, state):
        r = requests.post(f"{API}/admin/admins", headers=_h(state["mgr"]),
                          json={"email": _uniq("adm"), "password": "ChangeMe123!",
                                "display_name": "x", "manager_id": state["mgr_me"]["id"]},
                          timeout=10)
        assert r.status_code == 403, r.text

    def test_manager_submits_request(self, state):
        # Set cap=2 on manager1 (no zone) via SA to enable cap test
        r0 = requests.patch(f"{API}/admin/managers/{state['mgr_me']['id']}/max-admins",
                            headers=_h(state["sa"]),
                            json={"max_admins_allowed": None}, timeout=10)
        assert r0.status_code == 200

        email = _uniq("adm")
        r = requests.post(f"{API}/admin/admin-requests", headers=_h(state["mgr"]),
                          json={"email": email, "password": "ChangeMe123!",
                                "display_name": "Requested Admin", "player_capacity": 10},
                          timeout=15)
        assert r.status_code == 200, r.text
        doc = r.json()
        assert doc["status"] == "PENDING"
        assert "password_hash" not in doc
        state["created"]["mgr_req_id"] = doc["id"]
        state["created"]["mgr_req_email"] = email

    def test_cap_hard_block_on_submit(self, state):
        # Lower cap on manager1 to (existing+pending) so next submit is blocked.
        mgr_id = state["mgr_me"]["id"]
        # cap_state: query my-allocation
        alloc = requests.get(f"{API}/admin/my-allocation", headers=_h(state["mgr"]), timeout=10).json()
        floor = alloc["admin_count"] + alloc["pending_admin_requests"]
        r_set = requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                               headers=_h(state["sa"]),
                               json={"max_admins_allowed": floor}, timeout=10)
        assert r_set.status_code == 200, r_set.text
        # Attempt one more request → 400
        r = requests.post(f"{API}/admin/admin-requests", headers=_h(state["mgr"]),
                          json={"email": _uniq("adm"), "password": "ChangeMe123!",
                                "display_name": "over cap", "player_capacity": 10}, timeout=10)
        assert r.status_code == 400, r.text
        # Try lowering below floor → 400
        r2 = requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                            headers=_h(state["sa"]),
                            json={"max_admins_allowed": max(0, floor - 1)}, timeout=10)
        assert r2.status_code == 400, r2.text
        # Unset cap for later tests
        requests.patch(f"{API}/admin/managers/{mgr_id}/max-admins",
                       headers=_h(state["sa"]), json={"max_admins_allowed": None}, timeout=10)

    def test_zm_cannot_approve_no_zone_request(self, state):
        # zonal1 tries to approve manager1's request (no zone) → 403
        req_id = state["created"]["mgr_req_id"]
        r = requests.post(f"{API}/admin/admin-requests/{req_id}/approve",
                          headers=_h(state["zm"]), timeout=10)
        assert r.status_code == 403, r.text

    def test_sa_approves_and_admin_can_login(self, state):
        req_id = state["created"]["mgr_req_id"]
        r = requests.post(f"{API}/admin/admin-requests/{req_id}/approve",
                          headers=_h(state["sa"]), timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["status"] == "APPROVED" and j["admin_id"]
        # Idempotency: re-approve returns 400
        r2 = requests.post(f"{API}/admin/admin-requests/{req_id}/approve",
                           headers=_h(state["sa"]), timeout=10)
        assert r2.status_code == 400, r2.text
        # New admin can login
        tok = _login(state["created"]["mgr_req_email"], "ChangeMe123!")
        assert tok
        state["created"]["new_admin_token"] = tok

    def test_zm_approves_own_zone_request(self, state):
        # ZM's own manager submits a request → ZM approves
        zm_mgr_email = state["created"]["zm_mgr_email"]
        mgr_tok = _login(zm_mgr_email, "ChangeMe123!")
        req_email = _uniq("adm")
        r = requests.post(f"{API}/admin/admin-requests", headers=_h(mgr_tok),
                          json={"email": req_email, "password": "ChangeMe123!",
                                "display_name": "ZM zone admin", "player_capacity": 5}, timeout=15)
        assert r.status_code == 200, r.text
        req_id = r.json()["id"]
        # Different unrelated ZM would 403 — we don't easily have one; use SA impersonation test:
        # A different ZM: create a temp ZM
        temp_zm_email = _uniq("zm2")
        rz = requests.post(f"{API}/admin/zonal-managers", headers=_h(state["sa"]),
                           json={"email": temp_zm_email, "password": "ChangeMe123!",
                                 "display_name": "Temp ZM", "authorized_quota": 1}, timeout=15)
        assert rz.status_code == 200
        temp_zm_tok = _login(temp_zm_email, "ChangeMe123!")
        r_bad = requests.post(f"{API}/admin/admin-requests/{req_id}/approve",
                              headers=_h(temp_zm_tok), timeout=10)
        assert r_bad.status_code == 403, r_bad.text
        # Owning ZM approves
        r_ok = requests.post(f"{API}/admin/admin-requests/{req_id}/approve",
                             headers=_h(state["zm"]), timeout=15)
        assert r_ok.status_code == 200, r_ok.text


# ---------------- Scope of GET admin-requests ----------------
class TestAdminRequestsScope:
    def test_sa_sees_all(self, state):
        r = requests.get(f"{API}/admin/admin-requests", headers=_h(state["sa"]), timeout=10)
        assert r.status_code == 200
        assert len(r.json()) >= 2

    def test_zm_sees_only_zone(self, state):
        r = requests.get(f"{API}/admin/admin-requests", headers=_h(state["zm"]), timeout=10)
        assert r.status_code == 200
        for row in r.json():
            assert row.get("zonal_manager_id") == state["zm_me"]["id"]

    def test_manager_sees_only_own(self, state):
        r = requests.get(f"{API}/admin/admin-requests", headers=_h(state["mgr"]), timeout=10)
        assert r.status_code == 200
        for row in r.json():
            assert row["manager_id"] == state["mgr_me"]["id"]


# ---------------- Backward compat regression ----------------
class TestBackwardCompat:
    def test_sa_can_fund_manager1_directly(self, state):
        mgr_id = state["mgr_me"]["id"]
        r = requests.post(f"{API}/admin/managers/{mgr_id}/fund", headers=_h(state["sa"]),
                          json={"amount": 1000, "reason": "compat"}, timeout=15)
        assert r.status_code == 200, r.text

    def test_manager1_list_admins(self, state):
        r = requests.get(f"{API}/admin/my-admins", headers=_h(state["mgr"]), timeout=10)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
