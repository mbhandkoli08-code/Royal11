"""Part 5 — Admin self-recharge tests (backend).

Covers:
- POST /api/admin/recharge-request creates PENDING with 1.5x bonus
- Super Admin sees it in GET /api/superadmin/recharges
- POST /api/superadmin/recharges/{id}/confirm credits Admin wallet with 1.5x once (idempotent → 400)
- Reject path marks REJECTED with reason, no credit
- Suspension recovery: COINS_EXHAUSTED admin auto-reinstated on confirmed recharge
- recharge-request is NOT blocked by suspension (other actions still blocked)
- Role isolation: SUPER_ADMIN-only queue; ADMIN-only recharge-request
"""
import os
import uuid
import time
import pytest
import requests

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    # Fallback: read /app/frontend/.env
    try:
        with open("/app/frontend/.env") as fh:
            for line in fh:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_backend_url()
API = f"{BASE_URL}/api"

SUPER = ("superadmin@royal11.com", "ChangeMe123!")
MANAGER = ("manager1@royal11.com", "ChangeMe123!")
ADMIN = ("admin1@royal11.com", "ChangeMe123!")
PLAYER = ("player1@royal11.com", "ChangeMe123!")


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def tokens():
    return {
        "super": _login(*SUPER),
        "manager": _login(*MANAGER),
        "admin": _login(*ADMIN),
        "player": _login(*PLAYER),
    }


def _wallet_balance(token):
    r = requests.get(f"{API}/wallet/me", headers=_h(token), timeout=10)
    assert r.status_code == 200, r.text
    return r.json()["wallet"]["balance"]


# -- Basic role isolation --------------------------------------------------

def test_recharge_queue_role_isolation(tokens):
    r_super = requests.get(f"{API}/superadmin/recharges", headers=_h(tokens["super"]), timeout=10)
    assert r_super.status_code == 200
    assert isinstance(r_super.json(), list)

    r_mgr = requests.get(f"{API}/superadmin/recharges", headers=_h(tokens["manager"]), timeout=10)
    assert r_mgr.status_code == 403

    r_adm = requests.get(f"{API}/superadmin/recharges", headers=_h(tokens["admin"]), timeout=10)
    assert r_adm.status_code == 403


def test_recharge_request_admin_only(tokens):
    payload = {"amount_inr": 100, "reference_note": "TEST_ROLE"}
    r_super = requests.post(f"{API}/admin/recharge-request", json=payload,
                            headers=_h(tokens["super"]), timeout=10)
    assert r_super.status_code == 403
    r_mgr = requests.post(f"{API}/admin/recharge-request", json=payload,
                          headers=_h(tokens["manager"]), timeout=10)
    assert r_mgr.status_code == 403
    r_pl = requests.post(f"{API}/admin/recharge-request", json=payload,
                         headers=_h(tokens["player"]), timeout=10)
    assert r_pl.status_code == 403


def test_recharge_info_returns_bonus_rate(tokens):
    r = requests.get(f"{API}/admin/recharge-info", headers=_h(tokens["admin"]), timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data["bonus_rate"] == 1.5


# -- Create → Confirm (1.5x, idempotent) -----------------------------------

def test_create_confirm_credits_once(tokens):
    amount = 200
    ref = f"TEST_REF_{uuid.uuid4().hex[:8]}"
    bal_before = _wallet_balance(tokens["admin"])

    r = requests.post(f"{API}/admin/recharge-request",
                      json={"amount_inr": amount, "reference_note": ref},
                      headers=_h(tokens["admin"]), timeout=10)
    assert r.status_code == 200, r.text
    doc = r.json()
    assert doc["status"] == "PENDING"
    assert doc["coins_credited"] == int(amount * 1.5) == 300
    assert doc["bonus_rate"] == 1.5
    assert doc["amount_inr"] == amount
    rid = doc["id"]

    # Appears in Super Admin queue with admin_name
    q = requests.get(f"{API}/superadmin/recharges", headers=_h(tokens["super"]), timeout=10).json()
    match = [x for x in q if x["id"] == rid]
    assert len(match) == 1
    assert match[0]["admin_name"]  # non-empty

    # Appears in Admin's my-recharges
    mine = requests.get(f"{API}/admin/my-recharges", headers=_h(tokens["admin"]), timeout=10).json()
    assert any(x["id"] == rid for x in mine)

    # Confirm → credits +300
    c = requests.post(f"{API}/superadmin/recharges/{rid}/confirm",
                      json={"note": "ok"}, headers=_h(tokens["super"]), timeout=10)
    assert c.status_code == 200, c.text
    assert c.json()["status"] == "CONFIRMED"

    bal_after = _wallet_balance(tokens["admin"])
    assert bal_after == bal_before + 300, f"expected +300, got {bal_after - bal_before}"

    # Idempotent — second confirm rejects, no double credit
    c2 = requests.post(f"{API}/superadmin/recharges/{rid}/confirm",
                       json={"note": "again"}, headers=_h(tokens["super"]), timeout=10)
    assert c2.status_code == 400
    bal_final = _wallet_balance(tokens["admin"])
    assert bal_final == bal_after, "Second confirm double-credited!"


# -- Reject path ------------------------------------------------------------

def test_reject_no_credit(tokens):
    ref = f"TEST_REJ_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/admin/recharge-request",
                      json={"amount_inr": 500, "reference_note": ref},
                      headers=_h(tokens["admin"]), timeout=10)
    assert r.status_code == 200
    rid = r.json()["id"]

    bal_before = _wallet_balance(tokens["admin"])
    rej = requests.post(f"{API}/superadmin/recharges/{rid}/reject",
                       json={"reason": "TEST_reject_reason"},
                       headers=_h(tokens["super"]), timeout=10)
    assert rej.status_code == 200, rej.text
    body = rej.json()
    assert body["status"] == "REJECTED"
    assert body["rejected_reason"] == "TEST_reject_reason"

    bal_after = _wallet_balance(tokens["admin"])
    assert bal_after == bal_before

    # Cannot confirm a rejected recharge
    c = requests.post(f"{API}/superadmin/recharges/{rid}/confirm",
                     json={"note": "n/a"}, headers=_h(tokens["super"]), timeout=10)
    assert c.status_code == 400


# -- Suspension recovery ---------------------------------------------------

def _seed_fresh_chain():
    """Create a fresh manager→admin chain we can drive to COINS_EXHAUSTED."""
    stok = _login(*SUPER)
    tag = uuid.uuid4().hex[:6]
    m_email = f"TEST_mgr_{tag}@royal11.com"
    a_email = f"TEST_adm_{tag}@royal11.com"

    # Create manager
    r = requests.post(f"{API}/admin/managers",
                     json={"email": m_email, "password": "ChangeMe123!",
                           "display_name": f"TEST Manager {tag}"},
                     headers=_h(stok), timeout=15)
    assert r.status_code in (200, 201), r.text
    mgr = r.json()

    # Set quota and fund the manager wallet
    requests.patch(f"{API}/admin/managers/{mgr['id']}/quota",
                  json={"authorized_quota": 1000000},
                  headers=_h(stok), timeout=10)
    requests.post(f"{API}/admin/managers/{mgr['id']}/fund",
                 json={"amount": 1000000, "reason": "TEST"},
                 headers=_h(stok), timeout=10)

    # Manager creates admin
    m_tok = _login(m_email, "ChangeMe123!")
    r = requests.post(f"{API}/admin/admins",
                     json={"email": a_email, "password": "ChangeMe123!",
                           "display_name": f"TEST Admin {tag}",
                           "player_capacity": 5},
                     headers=_h(m_tok), timeout=15)
    assert r.status_code in (200, 201), r.text
    adm = r.json()

    # Allocate small amount so we can exhaust
    r = requests.post(f"{API}/admin/allocate",
                     json={"admin_id": adm["id"], "amount": 100},
                     headers=_h(m_tok), timeout=10)
    assert r.status_code == 200, r.text

    return {"mgr_id": mgr["id"], "adm_id": adm["id"],
            "m_email": m_email, "a_email": a_email, "m_tok": m_tok}


def test_suspension_lift_on_confirm(tokens):
    chain = _seed_fresh_chain()
    a_tok = _login(chain["a_email"], "ChangeMe123!")

    # Register a fresh player and explicitly assign to this admin
    p_email = f"TEST_ply_{uuid.uuid4().hex[:6]}@royal11.com"
    reg = requests.post(f"{API}/auth/register",
                       json={"email": p_email, "password": "ChangeMe123!",
                             "display_name": "TEST Player",
                             "referral_code": None},
                       timeout=15)
    assert reg.status_code in (200, 201), reg.text
    player_id = reg.json().get("user", {}).get("id") or reg.json().get("id")
    if not player_id:
        # Fallback: fetch via login
        p_tok = _login(p_email, "ChangeMe123!")
        me = requests.get(f"{API}/auth/me", headers=_h(p_tok), timeout=10).json()
        player_id = me["id"]

    # Reassign this player to our fresh admin (SUPER_ADMIN action)
    stok = tokens["super"]
    ar = requests.post(f"{API}/admin/players/assign",
                     json={"player_id": player_id, "admin_id": chain["adm_id"],
                           "reason": "TEST reassign"},
                     headers=_h(stok), timeout=10)
    assert ar.status_code == 200, ar.text

    my_players = requests.get(f"{API}/admin/my-players", headers=_h(a_tok), timeout=10).json()
    assert any(p.get("player", {}).get("id") == player_id for p in my_players), my_players
    # Grant 100 = full quota → exhaust
    g = requests.post(f"{API}/admin/grant",
                     json={"player_id": player_id, "amount": 100, "reason": "TEST exhaust"},
                     headers=_h(a_tok), timeout=10)
    assert g.status_code == 200, g.text

    # Verify SUSPENDED
    me = requests.get(f"{API}/auth/me", headers=_h(a_tok), timeout=10).json()
    assert me.get("status") == "SUSPENDED"
    assert me.get("suspended_reason") in ("COINS_EXHAUSTED", None) or "COIN" in str(me.get("suspended_reason", "")).upper()

    # Confirm: recharge-request still allowed while suspended
    ref = f"TEST_REC_{uuid.uuid4().hex[:8]}"
    r = requests.post(f"{API}/admin/recharge-request",
                     json={"amount_inr": 100, "reference_note": ref},
                     headers=_h(a_tok), timeout=10)
    assert r.status_code == 200, f"recharge-request should not be blocked while suspended: {r.status_code} {r.text}"
    rid = r.json()["id"]

    # Grant should be blocked (403) while suspended
    g2 = requests.post(f"{API}/admin/grant",
                      json={"player_id": player_id, "amount": 1, "reason": "TEST blocked"},
                      headers=_h(a_tok), timeout=10)
    assert g2.status_code == 403

    # Super admin confirms → suspension lifts
    c = requests.post(f"{API}/superadmin/recharges/{rid}/confirm",
                     json={"note": "ok"}, headers=_h(stok), timeout=10)
    assert c.status_code == 200, c.text

    # Re-login for a fresh token (status is embedded in JWT? at minimum /auth/me is fresh)
    me2 = requests.get(f"{API}/auth/me", headers=_h(a_tok), timeout=10).json()
    assert me2.get("status") == "ACTIVE", f"admin not reinstated: {me2}"
