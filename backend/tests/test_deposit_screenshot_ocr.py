"""Backend tests for Task 1 — deposit screenshot upload + OCR (graceful
'unavailable' because GOOGLE_CLOUD_VISION_API_KEY is intentionally unset) +
duplicate-UTR fraud flag + admin screenshot streaming + scope isolation.

Runs against the public URL (REACT_APP_BACKEND_URL). Deposits are
multipart/form-data now.
"""
import io
import os
import uuid
import struct
import zlib

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
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


def _tiny_png() -> bytes:
    """Minimal valid 1x1 PNG."""
    def chunk(typ, data):
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    idat = chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00"))
    iend = chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


@pytest.fixture(scope="module")
def tokens():
    return {k: _login(e, p) for k, (e, p) in CREDS.items()}


@pytest.fixture(scope="module")
def admin_scope(tokens):
    """Return {'target_admin_id': ..., 'is_admin1': bool}"""
    info = requests.get(f"{API}/wallet/deposit-info", headers=_hdr(tokens["player"])).json()
    admin_me = requests.get(f"{API}/auth/me", headers=_hdr(tokens["admin"])).json()
    return {
        "target_admin_id": info.get("admin_id"),
        "is_admin1": info.get("admin_id") == admin_me["id"],
        "admin1_id": admin_me["id"],
    }


# ---------------------------------------------------------------------------
# 1) Deposit without screenshot
# ---------------------------------------------------------------------------
def test_deposit_no_screenshot(tokens):
    ref = f"TEST-NOSCR-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "150", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "PENDING"
    assert d["has_screenshot"] is False
    assert d.get("screenshot_path") is None
    assert d.get("ocr") is None
    assert d.get("duplicate_utr") is False


# ---------------------------------------------------------------------------
# 2) Deposit WITH screenshot → has_screenshot true, ocr status 'unavailable'
# ---------------------------------------------------------------------------
def test_deposit_with_screenshot_ocr_unavailable(tokens):
    ref = f"TEST-SCR-{uuid.uuid4().hex[:8]}"
    png = _tiny_png()
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "275", "reference_note": ref},
        files={"screenshot": ("payment.png", png, "image/png")},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "PENDING"
    assert d["has_screenshot"] is True, f"expected has_screenshot=True, got {d}"
    assert d.get("screenshot_path"), "screenshot_path must be set"
    assert d.get("ocr") is not None, "ocr must be present"
    assert d["ocr"].get("status") == "unavailable"
    assert d["ocr"].get("match", {}).get("overall") == "unknown"


# ---------------------------------------------------------------------------
# 3) Non-image screenshot → 415
# ---------------------------------------------------------------------------
def test_deposit_non_image_rejected(tokens):
    ref = f"TEST-BAD-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "50", "reference_note": ref},
        files={"screenshot": ("payment.pdf", b"%PDF-1.4 hello", "application/pdf")},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 415, r.text


# ---------------------------------------------------------------------------
# 4) Duplicate-UTR flag after admin confirms
# ---------------------------------------------------------------------------
def test_duplicate_utr_flag(tokens, admin_scope):
    if not admin_scope["is_admin1"]:
        pytest.skip("player1 not assigned to admin1")

    ref = f"TEST-DUP-{uuid.uuid4().hex[:8]}"
    # First deposit — unique ref, must be duplicate_utr=False
    r1 = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "100", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["duplicate_utr"] is False

    # Admin confirms
    c = requests.post(
        f"{API}/admin/deposits/{d1['id']}/confirm",
        json={"note": "TEST"},
        headers=_hdr(tokens["admin"]),
    )
    assert c.status_code == 200, c.text
    assert c.json()["status"] == "CONFIRMED"

    # NEW deposit with the SAME reference → duplicate_utr must be True
    r2 = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "100", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r2.status_code == 200, r2.text
    d2 = r2.json()
    assert d2["duplicate_utr"] is True, f"expected duplicate_utr=True, got {d2}"

    # Fresh unique reference must NOT be duplicate
    fresh_ref = f"TEST-FRESH-{uuid.uuid4().hex[:8]}"
    r3 = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "100", "reference_note": fresh_ref},
        headers=_hdr(tokens["player"]),
    )
    assert r3.status_code == 200
    assert r3.json()["duplicate_utr"] is False


# ---------------------------------------------------------------------------
# 5) Admin can fetch the screenshot; scope isolation; 404 when no screenshot
# ---------------------------------------------------------------------------
def test_admin_can_view_screenshot(tokens, admin_scope):
    if not admin_scope["is_admin1"]:
        pytest.skip("player1 not assigned to admin1")

    ref = f"TEST-VIEWSCR-{uuid.uuid4().hex[:8]}"
    png = _tiny_png()
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "60", "reference_note": ref},
        files={"screenshot": ("payment.png", png, "image/png")},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200, r.text
    dep_id = r.json()["id"]

    # Admin (the target) can view it
    v = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["admin"]))
    assert v.status_code == 200, v.text
    assert v.headers.get("content-type", "").startswith("image/")
    assert len(v.content) > 0

    # Manager can view within chain
    v_mgr = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["manager"]))
    assert v_mgr.status_code == 200

    # Super Admin can view
    v_sup = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["super"]))
    assert v_sup.status_code == 200


def test_screenshot_404_when_no_screenshot(tokens, admin_scope):
    if not admin_scope["is_admin1"]:
        pytest.skip("player1 not assigned to admin1")
    ref = f"TEST-NOSHOT-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "40", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]
    v = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["admin"]))
    assert v.status_code == 404


def test_screenshot_scope_isolation(tokens, admin_scope):
    """Create a second admin under manager1 with its own player, and verify
    admin1 CANNOT view its screenshot (404), while manager1 and super CAN."""
    tag = uuid.uuid4().hex[:6]

    # Manager1 creates a new admin
    adm_email = f"test_adm2_{tag}@royal11.com"
    ra = requests.post(f"{API}/admin/admins", json={
        "email": adm_email, "password": "TestPass123!",
        "display_name": f"TEST Adm2 {tag}", "player_capacity": 5,
    }, headers=_hdr(tokens["manager"]))
    assert ra.status_code == 200, ra.text
    other_admin_id = ra.json()["id"]
    other_adm_tok = _login(adm_email, "TestPass123!")

    # Register a new player and assign to this new admin
    p_email = f"test_pl2_{tag}@royal11.com"
    rp = requests.post(f"{API}/auth/register", json={
        "email": p_email, "password": "TestPass123!",
        "display_name": f"TEST Pl2 {tag}",
    })
    assert rp.status_code == 200
    p_id = rp.json()["user"]["id"]

    r_assign = requests.post(f"{API}/admin/players/assign", json={
        "player_id": p_id, "admin_id": other_admin_id,
    }, headers=_hdr(tokens["manager"]))
    assert r_assign.status_code == 200, r_assign.text

    p_tok = _login(p_email, "TestPass123!")

    # Player submits deposit WITH screenshot
    png = _tiny_png()
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "77", "reference_note": f"TEST-OTHER-{tag}"},
        files={"screenshot": ("p.png", png, "image/png")},
        headers=_hdr(p_tok),
    )
    assert r.status_code == 200, r.text
    dep_id = r.json()["id"]
    assert r.json()["has_screenshot"] is True

    # admin1 (unrelated) must NOT see it → 404
    v_bad = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["admin"]))
    assert v_bad.status_code == 404, v_bad.text

    # The owning admin CAN see it
    v_ok = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(other_adm_tok))
    assert v_ok.status_code == 200

    # Manager1 (chain owner) can see it
    v_mgr = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["manager"]))
    assert v_mgr.status_code == 200

    # Super sees it
    v_sup = requests.get(f"{API}/admin/deposits/{dep_id}/screenshot", headers=_hdr(tokens["super"]))
    assert v_sup.status_code == 200


# ---------------------------------------------------------------------------
# 6) Regression: confirm still idempotently credits; reject still works
# ---------------------------------------------------------------------------
def test_confirm_regression_idempotent(tokens, admin_scope):
    if not admin_scope["is_admin1"]:
        pytest.skip("player1 not assigned to admin1")
    w0 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    balance_before = w0["wallet"]["balance"]

    ref = f"TEST-REG-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "80", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]

    c1 = requests.post(f"{API}/admin/deposits/{dep_id}/confirm",
                       json={"note": "TEST"}, headers=_hdr(tokens["admin"]))
    assert c1.status_code == 200
    w1 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    assert w1["wallet"]["balance"] == balance_before + 80

    # double-confirm → 400, no double-credit
    c2 = requests.post(f"{API}/admin/deposits/{dep_id}/confirm",
                       json={"note": "again"}, headers=_hdr(tokens["admin"]))
    assert c2.status_code == 400
    w2 = requests.get(f"{API}/wallet/me", headers=_hdr(tokens["player"])).json()
    assert w2["wallet"]["balance"] == balance_before + 80


def test_reject_regression(tokens, admin_scope):
    if not admin_scope["is_admin1"]:
        pytest.skip("player1 not assigned to admin1")
    ref = f"TEST-REGREJ-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/wallet/deposit-request",
        data={"amount_inr": "35", "reference_note": ref},
        headers=_hdr(tokens["player"]),
    )
    assert r.status_code == 200
    dep_id = r.json()["id"]
    rej = requests.post(f"{API}/admin/deposits/{dep_id}/reject",
                        json={"reason": "TEST bad ref"}, headers=_hdr(tokens["admin"]))
    assert rej.status_code == 200
    assert rej.json()["status"] == "REJECTED"
