"""Backend tests for PART 1-4: deposits, bank-account, revenue-split, settlements,
auto-suspend, referral, activity nudge, daily-summary. Runs against the public URL.
"""
import os
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://royal-sports-hub-2.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "super": ("superadmin@royal11.com", "ChangeMe123!"),
    "manager": ("manager1@royal11.com", "ChangeMe123!"),
    "admin": ("admin1@royal11.com", "ChangeMe123!"),
    "player": ("player1@royal11.com", "ChangeMe123!"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(e, p) for k, (e, p) in CREDS.items()}


# ---------------------------------------------------------------------------
# PART 1b — bank account upsert (Admin)
# ---------------------------------------------------------------------------
def test_admin_bank_account_upsert_and_get(tokens):
    payload = {
        "account_holder_name": "TEST Admin1",
        "account_number": "1234567890",
        "ifsc": "HDFC0001234",
        "bank_name": "HDFC TEST",
        "is_active": True,
    }
    r = requests.put(f"{API}/admin/bank-account", json=payload, headers=_hdr(tokens["admin"]))
    assert r.status_code == 200, r.text
    got = requests.get(f"{API}/admin/bank-account", headers=_hdr(tokens["admin"]))
    assert got.status_code == 200
    data = got.json()
    assert data["account_number"] == payload["account_number"]
    assert data["bank_name"] == payload["bank_name"]


# ---------------------------------------------------------------------------
# PART 1 — deposit-info shows assigned admin + bank
# ---------------------------------------------------------------------------
def test_player_deposit_info(tokens):
    r = requests.get(f"{API}/wallet/deposit-info", headers=_hdr(tokens["player"]))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "admin_id" in data
    assert data.get("ratio") == 1
    # bank_account may be from another admin if player1 isn't assigned to admin1


# ---------------------------------------------------------------------------
# PART 1 — deposit request creation does NOT credit; confirm is idempotent
# ---------------------------------------------------------------------------
def test_deposit_create_confirm_idempotent(tokens):
    # Get player wallet before
    w0 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    balance_before = w0["wallet"]["balance"]

    # find player's assigned admin
    info = requests.get(f"{API}/wallet/deposit-info", headers=_hdr(tokens["player"])).json()
    target_admin_id = info["admin_id"]
    assert target_admin_id, "player should be assigned to an admin"

    # Create deposit request
    ref = f"TEST-UTR-{uuid.uuid4().hex[:8]}"
    amt = 250
    r = requests.post(f"{API}/wallet/deposit-request",
                      json={"amount_inr": amt, "reference_note": ref},
                      headers=_hdr(tokens["player"]))
    assert r.status_code == 200, r.text
    dep = r.json()
    assert dep["status"] == "PENDING"
    assert dep["coins_to_credit"] == amt

    # Wallet balance should NOT have moved yet
    w1 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    assert w1["wallet"]["balance"] == balance_before, "coins credited before confirm!"

    # Confirm must be done by the target admin. Log in as that admin.
    # Find matching credentials -- if target_admin isn't admin1, we log in as super_admin and impersonate?
    # We can't impersonate. Instead check if target is admin1.
    admin_me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["admin"])).json()
    if admin_me["id"] != target_admin_id:
        pytest.skip(f"player1 not assigned to admin1 (assigned to {target_admin_id}); reassign not attempted here")

    # confirm
    c = requests.post(f"{API}/admin/deposits/{dep['id']}/confirm",
                      json={"note": "TEST confirm"}, headers=_hdr(tokens["admin"]))
    assert c.status_code == 200, c.text
    confirmed = c.json()
    assert confirmed["status"] == "CONFIRMED"

    # Wallet balance should now have increased by amt
    w2 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    assert w2["wallet"]["balance"] == balance_before + amt, "coins not credited after confirm"

    # Second confirm → 400 already confirmed; balance unchanged
    c2 = requests.post(f"{API}/admin/deposits/{dep['id']}/confirm",
                       json={"note": "again"}, headers=_hdr(tokens["admin"]))
    assert c2.status_code == 400
    w3 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    assert w3["wallet"]["balance"] == balance_before + amt, "double-credit detected"


def test_deposit_reject(tokens):
    info = requests.get(f"{API}/wallet/deposit-info", headers=_hdr(tokens["player"])).json()
    target_admin_id = info["admin_id"]
    admin_me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["admin"])).json()
    if admin_me["id"] != target_admin_id:
        pytest.skip("player1 not assigned to admin1")

    ref = f"TEST-REJ-{uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API}/wallet/deposit-request",
                      json={"amount_inr": 100, "reference_note": ref},
                      headers=_hdr(tokens["player"]))
    assert r.status_code == 200
    dep_id = r.json()["id"]

    balance_before = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()["wallet"]["balance"]
    rej = requests.post(f"{API}/admin/deposits/{dep_id}/reject",
                        json={"reason": "TEST invalid UTR"}, headers=_hdr(tokens["admin"]))
    assert rej.status_code == 200, rej.text
    assert rej.json()["status"] == "REJECTED"
    balance_after = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()["wallet"]["balance"]
    assert balance_after == balance_before, "reject should not credit"


# ---------------------------------------------------------------------------
# PART 1 — list deposits scoped
# ---------------------------------------------------------------------------
def test_deposits_scoped(tokens):
    r_super = requests.get(f"{API}/admin/deposits", headers=_hdr(tokens["super"]))
    r_mgr = requests.get(f"{API}/admin/deposits", headers=_hdr(tokens["manager"]))
    r_adm = requests.get(f"{API}/admin/deposits", headers=_hdr(tokens["admin"]))
    assert r_super.status_code == 200
    assert r_mgr.status_code == 200
    assert r_adm.status_code == 200
    # super sees >= manager sees >= admin sees
    assert len(r_super.json()) >= len(r_mgr.json())
    assert len(r_mgr.json()) >= len(r_adm.json())


# ---------------------------------------------------------------------------
# PART 2 — revenue split + settlements
# ---------------------------------------------------------------------------
def test_revenue_split_update(tokens):
    admin_me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["admin"])).json()
    r = requests.patch(f"{API}/admin/admins/{admin_me['id']}/revenue-split",
                       json={"revenue_split_super_admin_pct": 65},
                       headers=_hdr(tokens["super"]))
    assert r.status_code == 200, r.text
    assert r.json()["revenue_split_super_admin_pct"] == 65
    # revert to 70
    requests.patch(f"{API}/admin/admins/{admin_me['id']}/revenue-split",
                   json={"revenue_split_super_admin_pct": 70},
                   headers=_hdr(tokens["super"]))


def test_revenue_split_bounds(tokens):
    admin_me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["admin"])).json()
    r = requests.patch(f"{API}/admin/admins/{admin_me['id']}/revenue-split",
                       json={"revenue_split_super_admin_pct": 150},
                       headers=_hdr(tokens["super"]))
    assert r.status_code == 422


def test_settlements_list_and_math(tokens):
    r = requests.get(f"{API}/admin/settlements", headers=_hdr(tokens["super"]))
    assert r.status_code == 200, r.text
    rows = r.json()
    for s in rows:
        total = s["total_deposits_inr"]
        pct = s["split_pct_used"]
        assert s["super_admin_share_inr"] == round(total * pct / 100)
        assert s["admin_share_inr"] == total - s["super_admin_share_inr"]


def test_settlements_forbidden_for_admin(tokens):
    r = requests.get(f"{API}/admin/settlements", headers=_hdr(tokens["admin"]))
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# PART 4 — referral: register with referral_code credits referrer +200
# ---------------------------------------------------------------------------
def test_register_with_referral_credits_referrer(tokens):
    # Get player1's referral code (backfill happens on /me if missing)
    me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["player"])).json()
    ref_code = me.get("referral_code")
    assert ref_code, "player1 should have a referral code (backfilled)"

    wallet_before = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()["wallet"]["balance"]

    email = f"test_ref_{uuid.uuid4().hex[:8]}@royal11.com"
    r = requests.post(f"{API}/auth/register", json={
        "email": email,
        "password": "TestPass123!",
        "display_name": "TEST Referred",
        "referral_code": ref_code,
    })
    assert r.status_code == 200, r.text
    new_user = r.json()["user"]
    # New user should also have a referral code
    assert new_user.get("referral_code")

    # Referrer (player1) wallet should be +200
    wallet_after = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()["wallet"]["balance"]
    assert wallet_after == wallet_before + 200, f"referral bonus not credited: before={wallet_before} after={wallet_after}"


# ---------------------------------------------------------------------------
# PART 4 — activity nudge (fresh call → no nudge; sets last_seen_at)
# ---------------------------------------------------------------------------
def test_activity_nudge_shape(tokens):
    r = requests.post(f"{API}/auth/activity", headers=_hdr(tokens["player"]))
    assert r.status_code == 200, r.text
    data = r.json()
    assert "nudge" in data and "days_away" in data and "threshold_days" in data
    assert data["threshold_days"] == 2
    # after immediate second call, no nudge
    r2 = requests.post(f"{API}/auth/activity", headers=_hdr(tokens["player"]))
    assert r2.json()["nudge"] is False


# ---------------------------------------------------------------------------
# PART 4 — daily summary
# ---------------------------------------------------------------------------
def test_daily_summary(tokens):
    r = requests.get(f"{API}/admin/daily-summary", headers=_hdr(tokens["super"]))
    assert r.status_code == 200, r.text
    rows = r.json()
    assert isinstance(rows, list)
    if rows:
        row = rows[0]
        for k in ("date", "total_deposits_inr", "total_allocations_coins", "total_transactions"):
            assert k in row


def test_daily_summary_export_csv(tokens):
    r = requests.get(f"{API}/admin/daily-summary/export", headers=_hdr(tokens["super"]))
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    txt = r.text.strip().splitlines()
    assert txt[0] == "date,total_deposits_inr,total_allocations_coins,total_transactions"


def test_daily_summary_forbidden_admin(tokens):
    r = requests.get(f"{API}/admin/daily-summary", headers=_hdr(tokens["admin"]))
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# PART 3 — usage_level exposed in /admin/admins
# ---------------------------------------------------------------------------
def test_admins_list_has_usage_level(tokens):
    r = requests.get(f"{API}/admin/admins", headers=_hdr(tokens["super"]))
    assert r.status_code == 200
    for a in r.json():
        assert "usage_level" in a
        assert "usage_pct" in a
        assert "revenue_split_super_admin_pct" in a


# ---------------------------------------------------------------------------
# PART 3 — auto-suspend end-to-end (fresh manager/admin/player chain)
# ---------------------------------------------------------------------------
def test_auto_suspend_and_reinstate(tokens):
    # Create fresh manager under super admin
    tag = uuid.uuid4().hex[:6]
    mgr_email = f"test_mgr_{tag}@royal11.com"
    r = requests.post(f"{API}/admin/managers", json={
        "email": mgr_email, "password": "TestPass123!",
        "display_name": f"TEST Mgr {tag}", "authorized_quota": 5000,
    }, headers=_hdr(tokens["super"]))
    assert r.status_code == 200, r.text
    mgr_id = r.json()["id"]

    # Fund manager wallet
    f = requests.post(f"{API}/admin/managers/{mgr_id}/fund",
                      json={"amount": 5000, "reason": "TEST"}, headers=_hdr(tokens["super"]))
    assert f.status_code == 200, f.text

    mgr_tok = _login(mgr_email, "TestPass123!")

    # Manager creates a fresh admin
    adm_email = f"test_adm_{tag}@royal11.com"
    ra = requests.post(f"{API}/admin/admins", json={
        "email": adm_email, "password": "TestPass123!",
        "display_name": f"TEST Adm {tag}", "player_capacity": 5,
    }, headers=_hdr(mgr_tok))
    assert ra.status_code == 200, ra.text
    adm_id = ra.json()["id"]
    adm_tok = _login(adm_email, "TestPass123!")

    # Register a new player
    p_email = f"test_pl_{tag}@royal11.com"
    rp = requests.post(f"{API}/auth/register", json={
        "email": p_email, "password": "TestPass123!", "display_name": f"TEST Pl {tag}",
    })
    assert rp.status_code == 200
    p_id = rp.json()["user"]["id"]

    # Assign player to our admin (manager can do this)
    r_assign = requests.post(f"{API}/admin/players/assign", json={
        "player_id": p_id, "admin_id": adm_id,
    }, headers=_hdr(mgr_tok))
    assert r_assign.status_code == 200, r_assign.text

    # Manager allocates 100 coins to admin
    al = requests.post(f"{API}/admin/allocate", json={"admin_id": adm_id, "amount": 100},
                       headers=_hdr(mgr_tok))
    assert al.status_code == 200, al.text

    # Admin grants all 100 → should auto-suspend
    g = requests.post(f"{API}/admin/grant", json={"player_id": p_id, "amount": 100},
                      headers=_hdr(adm_tok))
    assert g.status_code == 200, g.text

    # /me still works even if suspended
    me = requests.get(f"{API}/auth/me", headers=_hdr(adm_tok))
    assert me.status_code == 200
    assert me.json()["status"] == "SUSPENDED"
    assert me.json().get("suspension_reason") == "COINS_EXHAUSTED"

    # Further grant blocked with 403
    g2 = requests.post(f"{API}/admin/grant", json={"player_id": p_id, "amount": 1},
                       headers=_hdr(adm_tok))
    assert g2.status_code == 403

    # Manager reallocates more coins → admin reinstated
    al2 = requests.post(f"{API}/admin/allocate", json={"admin_id": adm_id, "amount": 200},
                        headers=_hdr(mgr_tok))
    assert al2.status_code == 200, al2.text

    me2 = requests.get(f"{API}/auth/me", headers=_hdr(adm_tok))
    assert me2.json()["status"] == "ACTIVE"
    assert me2.json().get("suspension_reason") in (None, "")
