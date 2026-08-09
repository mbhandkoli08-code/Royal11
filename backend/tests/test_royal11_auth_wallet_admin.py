"""ROYAL11 backend test suite - Auth, Wallet, Admin hierarchy, RBAC, Idempotency.

Covers spec Sections: Auth (register/login/me), Wallet (server-authoritative),
Admin hierarchy (SUPER_ADMIN -> MANAGER -> ADMIN -> PLAYER), RBAC, idempotency
& atomicity (Section 6), reversals, player assignment & capacity.

Run: pytest /app/backend/tests/test_royal11_auth_wallet_admin.py -v
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback: read from frontend .env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"
SEED_PWD = "ChangeMe123!"

SEEDED = {
    "SUPER_ADMIN": "superadmin@royal11.com",
    "MANAGER": "manager1@royal11.com",
    "ADMIN": "admin1@royal11.com",
    "PLAYER": "player1@royal11.com",
}


def _login(email, password=SEED_PWD):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        # Print for debugging - login should succeed for known accounts
        print(f"LOGIN FAILED for {email}: {r.status_code} {r.text[:300]}")
    return r


def _login_token(email, password=SEED_PWD):
    """Login and return access_token, with 1 retry on transient failure."""
    r = _login(email, password)
    if r.status_code != 200:
        import time
        time.sleep(0.5)
        r = _login(email, password)
    assert r.status_code == 200, f"Login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for role, email in SEEDED.items():
        r = _login(email)
        assert r.status_code == 200, f"Seed login failed for {role} ({email}): {r.status_code} {r.text}"
        out[role] = r.json()["access_token"]
    return out


# --------------------------------------------------------------------------
# Regression: existing endpoints unchanged
# --------------------------------------------------------------------------
class TestRegression:
    def test_status_get(self):
        r = requests.get(f"{API}/status")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_status_post(self):
        r = requests.post(f"{API}/status", json={"client_name": "TEST_regression"})
        assert r.status_code == 200
        assert r.json()["client_name"] == "TEST_regression"

    def test_fantasy_coach_still_works(self):
        players = [
            {"id": f"p{i}", "name": f"P{i}", "team": "A" if i % 2 else "B",
             "role": "BAT", "credits": 8.0, "points": 50 + i}
            for i in range(15)
        ]
        r = requests.post(f"{API}/fantasy/coach",
                          json={"players": players, "budget": 100, "size": 11},
                          timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert len(d["xi"]) == 11
        assert d["captain"] in d["xi"]
        assert d["vice"] in d["xi"]
        assert d["captain"] != d["vice"]
        assert d["source"] in ("ai", "fallback")


# --------------------------------------------------------------------------
# Auth: register / login / me
# --------------------------------------------------------------------------
class TestAuthRegister:
    def test_register_player_and_welcome_bonus(self):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@royal11.com"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "Password123!", "display_name": "TestReg"
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "access_token" in d and d["access_token"]
        assert d["user"]["role"] == "PLAYER"
        assert d["user"]["status"] == "ACTIVE"
        assert d["user"]["email"] == email

        # Wallet has 1000 welcome bonus
        w = requests.get(f"{API}/wallet/me", headers=_auth(d["access_token"]))
        assert w.status_code == 200
        wd = w.json()
        assert wd["wallet"]["balance"] == 1000
        types = [t["type"] for t in wd["transactions"]]
        assert "WELCOME_BONUS" in types

    def test_register_duplicate_email_409(self):
        email = f"TEST_dup_{uuid.uuid4().hex[:8]}@royal11.com"
        p = {"email": email, "password": "Password123!", "display_name": "Dup"}
        r1 = requests.post(f"{API}/auth/register", json=p)
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register", json=p)
        assert r2.status_code == 409

    def test_register_short_password_422(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": f"TEST_short_{uuid.uuid4().hex[:6]}@royal11.com",
            "password": "short", "display_name": "X"
        })
        assert r.status_code == 422

    def test_register_invalid_email_422(self):
        r = requests.post(f"{API}/auth/register", json={
            "email": "not-an-email", "password": "Password123!", "display_name": "X"
        })
        assert r.status_code == 422

    def test_register_auto_assigns_to_admin(self, tokens):
        # Register a new player, then check that admin1's my-players contains them
        email = f"TEST_assign_{uuid.uuid4().hex[:8]}@royal11.com"
        r = requests.post(f"{API}/auth/register", json={
            "email": email, "password": "Password123!", "display_name": "AutoAssignee"
        })
        assert r.status_code == 200
        new_player_id = r.json()["user"]["id"]

        mp = requests.get(f"{API}/admin/my-players", headers=_auth(tokens["ADMIN"]))
        assert mp.status_code == 200
        ids = [p["player"]["id"] for p in mp.json()]
        # Could be assigned to any admin with capacity, but only admin1 is seeded → must be admin1
        assert new_player_id in ids, f"Player {new_player_id} not assigned to admin1"


class TestAuthLoginMe:
    def test_login_success(self):
        r = _login(SEEDED["PLAYER"])
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "PLAYER"

    def test_login_wrong_password_401(self):
        r = _login(SEEDED["PLAYER"], password="WrongPassword!")
        assert r.status_code == 401

    def test_me_with_token(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=_auth(tokens["PLAYER"]))
        assert r.status_code == 200
        assert r.json()["email"] == SEEDED["PLAYER"]

    def test_me_no_token_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token_401(self):
        r = requests.get(f"{API}/auth/me", headers=_auth("garbage.token.here"))
        assert r.status_code == 401


# --------------------------------------------------------------------------
# Wallet
# --------------------------------------------------------------------------
class TestWallet:
    def test_wallet_me_shape(self, tokens):
        r = requests.get(f"{API}/wallet/me", headers=_auth(tokens["PLAYER"]))
        assert r.status_code == 200
        d = r.json()
        assert "wallet" in d and "transactions" in d
        assert "balance" in d["wallet"]
        assert isinstance(d["wallet"]["balance"], int)

    def test_wallet_me_unauth(self):
        r = requests.get(f"{API}/wallet/me")
        assert r.status_code == 401


# --------------------------------------------------------------------------
# RBAC
# --------------------------------------------------------------------------
class TestRBAC:
    def test_player_denied_admin_routes(self, tokens):
        r = requests.get(f"{API}/admin/my-players", headers=_auth(tokens["PLAYER"]))
        assert r.status_code == 403

    def test_admin_denied_allocate(self, tokens):
        r = requests.post(f"{API}/admin/allocate",
                          headers=_auth(tokens["ADMIN"]),
                          json={"admin_id": "x", "amount": 10})
        assert r.status_code == 403

    def test_unauth_admin_route_401(self):
        r = requests.get(f"{API}/admin/my-players")
        assert r.status_code == 401

    def test_manager_cannot_create_manager(self, tokens):
        r = requests.post(f"{API}/admin/managers",
                          headers=_auth(tokens["MANAGER"]),
                          json={"email": "x@royal11.com", "password": "Password123!",
                                "display_name": "x", "authorized_quota": 0})
        assert r.status_code == 403


# --------------------------------------------------------------------------
# Super Admin -> Manager
# --------------------------------------------------------------------------
class TestSuperAdminManagerFlow:
    def test_create_manager_fund_quota(self, tokens):
        email = f"TEST_mgr_{uuid.uuid4().hex[:6]}@royal11.com"
        # Create manager
        r = requests.post(f"{API}/admin/managers", headers=_auth(tokens["SUPER_ADMIN"]),
                          json={"email": email, "password": "Password123!",
                                "display_name": "TestMgr", "authorized_quota": 5000})
        assert r.status_code == 200, r.text
        mgr = r.json()
        assert mgr["role"] == "MANAGER"
        mgr_id = mgr["id"]

        # Fund manager
        rf = requests.post(f"{API}/admin/managers/{mgr_id}/fund",
                           headers=_auth(tokens["SUPER_ADMIN"]),
                           json={"amount": 3000, "reason": "test"})
        assert rf.status_code == 200, rf.text
        assert rf.json()["type"] == "SUPER_ADMIN_TO_MANAGER"

        # Verify balance persisted via manager login
        mtok = _login_token(email, "Password123!")
        w = requests.get(f"{API}/wallet/me", headers=_auth(mtok))
        assert w.status_code == 200
        assert w.json()["wallet"]["balance"] == 3000

        # Update quota below allocated_out — allocated_out is 0, so setting 0 is fine.
        # We test rejection by first allocating out, then trying to shrink.
        # Simpler: patch quota to a higher value first, then try to shrink below allocated_out.
        rq = requests.patch(f"{API}/admin/managers/{mgr_id}/quota",
                            headers=_auth(tokens["SUPER_ADMIN"]),
                            json={"authorized_quota": 10000})
        assert rq.status_code == 200

    def test_quota_below_allocated_out_rejected(self, tokens):
        """Build a fresh chain, actually allocate coins, then try to shrink quota below allocated_out."""
        sa = tokens["SUPER_ADMIN"]
        mgr_email = f"TEST_qshrink_{uuid.uuid4().hex[:6]}@royal11.com"
        r = requests.post(f"{API}/admin/managers", headers=_auth(sa),
                          json={"email": mgr_email, "password": "Password123!",
                                "display_name": "QShrink", "authorized_quota": 5000})
        assert r.status_code == 200
        mgr_id = r.json()["id"]
        requests.post(f"{API}/admin/managers/{mgr_id}/fund", headers=_auth(sa),
                      json={"amount": 5000})
        mtok = _login_token(mgr_email, "Password123!")
        # Create an admin under this manager
        aemail = f"TEST_qshrinkadm_{uuid.uuid4().hex[:6]}@royal11.com"
        ra = requests.post(f"{API}/admin/admins", headers=_auth(mtok),
                           json={"email": aemail, "password": "Password123!",
                                 "display_name": "QSAdm"})
        admin_id = ra.json()["id"]
        # Allocate 2000 to admin -> allocated_out becomes 2000
        al = requests.post(f"{API}/admin/allocate", headers=_auth(mtok),
                           json={"admin_id": admin_id, "amount": 2000})
        assert al.status_code == 200, al.text
        # Now try to shrink quota to 100 (< 2000 allocated_out) -> 400
        r = requests.patch(f"{API}/admin/managers/{mgr_id}/quota",
                           headers=_auth(sa),
                           json={"authorized_quota": 100})
        assert r.status_code == 400, r.text


# --------------------------------------------------------------------------
# Manager -> Admin allocation + Admin -> Player grant + idempotency
# --------------------------------------------------------------------------
@pytest.fixture(scope="module")
def isolated_chain(tokens):
    """Build a fresh Manager->Admin->Player chain so tests don't collide with seed data."""
    sa = tokens["SUPER_ADMIN"]
    # Create manager
    mgr_email = f"TEST_chainmgr_{uuid.uuid4().hex[:6]}@royal11.com"
    r = requests.post(f"{API}/admin/managers", headers=_auth(sa),
                      json={"email": mgr_email, "password": "Password123!",
                            "display_name": "ChainMgr", "authorized_quota": 100000})
    assert r.status_code == 200, r.text
    mgr_id = r.json()["id"]
    # Fund manager wallet
    rf = requests.post(f"{API}/admin/managers/{mgr_id}/fund", headers=_auth(sa),
                       json={"amount": 50000})
    assert rf.status_code == 200
    mgr_tok = _login_token(mgr_email, "Password123!")

    # Manager creates admin under themselves
    admin_email = f"TEST_chainadm_{uuid.uuid4().hex[:6]}@royal11.com"
    ra = requests.post(f"{API}/admin/admins", headers=_auth(mgr_tok),
                       json={"email": admin_email, "password": "Password123!",
                             "display_name": "ChainAdm", "player_capacity": 5})
    assert ra.status_code == 200, ra.text
    admin_id = ra.json()["id"]
    admin_tok = _login_token(admin_email, "Password123!")

    # Register a player and manually assign to this admin (manager can)
    player_email = f"TEST_chainply_{uuid.uuid4().hex[:6]}@royal11.com"
    rp = requests.post(f"{API}/auth/register",
                       json={"email": player_email, "password": "Password123!",
                             "display_name": "ChainPly"})
    assert rp.status_code == 200
    player_id = rp.json()["user"]["id"]
    player_tok = rp.json()["access_token"]

    # Reassign to our admin
    rassign = requests.post(f"{API}/admin/players/assign", headers=_auth(mgr_tok),
                            json={"player_id": player_id, "admin_id": admin_id})
    assert rassign.status_code == 200, rassign.text

    return {
        "mgr_id": mgr_id, "mgr_tok": mgr_tok,
        "admin_id": admin_id, "admin_tok": admin_tok,
        "player_id": player_id, "player_tok": player_tok,
    }


class TestAllocationAndGrant:
    def test_manager_allocate_to_admin(self, isolated_chain):
        c = isolated_chain
        r = requests.post(f"{API}/admin/allocate", headers=_auth(c["mgr_tok"]),
                          json={"admin_id": c["admin_id"], "amount": 10000,
                                "request_id": f"alloc-{uuid.uuid4().hex}"})
        assert r.status_code == 200, r.text
        # Admin balance should be 10000
        w = requests.get(f"{API}/wallet/me", headers=_auth(c["admin_tok"]))
        assert w.json()["wallet"]["balance"] == 10000

    def test_allocation_beyond_quota_400(self, isolated_chain):
        c = isolated_chain
        # Quota was 100000, already allocated 10000 → try to allocate 1_000_000
        r = requests.post(f"{API}/admin/allocate", headers=_auth(c["mgr_tok"]),
                          json={"admin_id": c["admin_id"], "amount": 1_000_000})
        assert r.status_code == 400

    def test_admin_grant_to_player(self, isolated_chain):
        c = isolated_chain
        r = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                          json={"player_id": c["player_id"], "amount": 500,
                                "reason": "test grant",
                                "request_id": f"grant-{uuid.uuid4().hex}"})
        assert r.status_code == 200, r.text
        w = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"]))
        # Welcome 1000 + grant 500 = 1500
        assert w.json()["wallet"]["balance"] == 1500

    def test_admin_grant_idempotency_double_request(self, isolated_chain):
        """CRITICAL: same request_id must apply once, not twice."""
        c = isolated_chain
        # Get current player balance
        before = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"])).json()["wallet"]["balance"]
        req_id = f"idem-{uuid.uuid4().hex}"
        r1 = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                           json={"player_id": c["player_id"], "amount": 300,
                                 "request_id": req_id})
        assert r1.status_code == 200, r1.text
        r2 = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                           json={"player_id": c["player_id"], "amount": 300,
                                 "request_id": req_id})
        assert r2.status_code == 200, r2.text  # idempotent success
        after = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"])).json()["wallet"]["balance"]
        assert after == before + 300, f"Idempotency broken: expected {before+300} got {after}"

    def test_grant_to_unassigned_player_404(self, isolated_chain, tokens):
        c = isolated_chain
        # Register random player not assigned to c["admin_id"]
        pemail = f"TEST_other_{uuid.uuid4().hex[:6]}@royal11.com"
        rp = requests.post(f"{API}/auth/register", json={
            "email": pemail, "password": "Password123!", "display_name": "Other"
        })
        other_id = rp.json()["user"]["id"]
        # Reassign away from admin — auto-assigned may have gone to admin1 (seed). Ensure it's not on isolated_chain admin.
        r = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                          json={"player_id": other_id, "amount": 100})
        assert r.status_code == 404

    def test_grant_overspend_400(self, isolated_chain):
        c = isolated_chain
        # Admin balance right now: 10000 - 500 - 300 = 9200. Try 1_000_000.
        r = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                          json={"player_id": c["player_id"], "amount": 10_000_000})
        assert r.status_code == 400

    def test_manager_allocate_beyond_wallet_balance_400(self, tokens):
        """Manager whose quota > wallet balance: allocation of an amount > wallet balance -> 400."""
        sa = tokens["SUPER_ADMIN"]
        mgr_email = f"TEST_broke_{uuid.uuid4().hex[:6]}@royal11.com"
        r = requests.post(f"{API}/admin/managers", headers=_auth(sa),
                          json={"email": mgr_email, "password": "Password123!",
                                "display_name": "Broke", "authorized_quota": 100000})
        assert r.status_code == 200
        mgr_id = r.json()["id"]
        # Fund with only 100
        requests.post(f"{API}/admin/managers/{mgr_id}/fund", headers=_auth(sa),
                      json={"amount": 100})
        mtok = _login_token(mgr_email, "Password123!")
        # Create admin under this manager
        aemail = f"TEST_brokeadm_{uuid.uuid4().hex[:6]}@royal11.com"
        ra = requests.post(f"{API}/admin/admins", headers=_auth(mtok),
                           json={"email": aemail, "password": "Password123!",
                                 "display_name": "BrokeAdm"})
        admin_id = ra.json()["id"]
        # Try to allocate 500 (quota allows, wallet has only 100)
        r = requests.post(f"{API}/admin/allocate", headers=_auth(mtok),
                          json={"admin_id": admin_id, "amount": 500})
        assert r.status_code == 400


# --------------------------------------------------------------------------
# Reversal
# --------------------------------------------------------------------------
class TestReversal:
    def test_reversal_creates_reversal_txn_and_is_idempotent(self, isolated_chain):
        c = isolated_chain
        # Fresh grant with known request_id
        req_id = f"rev-src-{uuid.uuid4().hex}"
        g = requests.post(f"{API}/admin/grant", headers=_auth(c["admin_tok"]),
                         json={"player_id": c["player_id"], "amount": 200, "request_id": req_id})
        assert g.status_code == 200
        credit_txn_id = g.json()["credit"]["id"]

        before = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"])).json()["wallet"]["balance"]

        # Reverse the player's credit
        r1 = requests.post(f"{API}/admin/transactions/{credit_txn_id}/reverse",
                          headers=_auth(c["admin_tok"]), json={"reason": "oops"})
        assert r1.status_code == 200, r1.text
        assert r1.json()["type"] == "REVERSAL"

        after1 = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"])).json()["wallet"]["balance"]
        assert after1 == before - 200

        # Reverse again — must be idempotent
        r2 = requests.post(f"{API}/admin/transactions/{credit_txn_id}/reverse",
                          headers=_auth(c["admin_tok"]), json={"reason": "oops2"})
        assert r2.status_code == 200
        after2 = requests.get(f"{API}/wallet/me", headers=_auth(c["player_tok"])).json()["wallet"]["balance"]
        assert after2 == after1, "Reversal not idempotent!"


# --------------------------------------------------------------------------
# Player assignment & capacity
# --------------------------------------------------------------------------
class TestAssignmentCapacity:
    def test_assign_beyond_capacity_400(self, tokens):
        sa = tokens["SUPER_ADMIN"]
        # Create manager
        me = f"TEST_capmgr_{uuid.uuid4().hex[:6]}@royal11.com"
        rm = requests.post(f"{API}/admin/managers", headers=_auth(sa),
                          json={"email": me, "password": "Password123!",
                                "display_name": "CapMgr", "authorized_quota": 0})
        mgr_id = rm.json()["id"]
        mtok = _login_token(me, "Password123!")
        # Create admin with capacity 1
        ae = f"TEST_capadm_{uuid.uuid4().hex[:6]}@royal11.com"
        ra = requests.post(f"{API}/admin/admins", headers=_auth(mtok),
                          json={"email": ae, "password": "Password123!",
                                "display_name": "CapAdm", "player_capacity": 1})
        admin_id = ra.json()["id"]

        # Register 2 players
        p1e = f"TEST_capp1_{uuid.uuid4().hex[:6]}@royal11.com"
        p2e = f"TEST_capp2_{uuid.uuid4().hex[:6]}@royal11.com"
        p1 = requests.post(f"{API}/auth/register", json={
            "email": p1e, "password": "Password123!", "display_name": "P1"}).json()["user"]["id"]
        p2 = requests.post(f"{API}/auth/register", json={
            "email": p2e, "password": "Password123!", "display_name": "P2"}).json()["user"]["id"]

        # Assign p1 (ok)
        r1 = requests.post(f"{API}/admin/players/assign", headers=_auth(mtok),
                          json={"player_id": p1, "admin_id": admin_id})
        assert r1.status_code == 200, r1.text
        # Assign p2 -> should fail 400 (capacity 1)
        r2 = requests.post(f"{API}/admin/players/assign", headers=_auth(mtok),
                          json={"player_id": p2, "admin_id": admin_id})
        assert r2.status_code == 400

    def test_my_players_lists_assigned(self, isolated_chain):
        c = isolated_chain
        r = requests.get(f"{API}/admin/my-players", headers=_auth(c["admin_tok"]))
        assert r.status_code == 200
        ids = [p["player"]["id"] for p in r.json()]
        assert c["player_id"] in ids
        # Each entry has balance
        for p in r.json():
            assert "balance" in p
            assert isinstance(p["balance"], int)


# --------------------------------------------------------------------------
# Super Admin creating Admin requires manager_id
# --------------------------------------------------------------------------
class TestSuperAdminCreateAdmin:
    def test_super_admin_needs_manager_id(self, tokens):
        r = requests.post(f"{API}/admin/admins", headers=_auth(tokens["SUPER_ADMIN"]),
                         json={"email": f"TEST_noMgr_{uuid.uuid4().hex[:6]}@royal11.com",
                               "password": "Password123!", "display_name": "X"})
        assert r.status_code == 400
