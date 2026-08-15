"""End-to-end tests for the Admin -> Super Admin USDT (TRC-20) coin-purchase channel.

Covers:
- Super Admin config get/set + QR upload + fetch
- Admin buy submit (below min blocked, valid submit -> PENDING)
- Super Admin confirm -> coins credited (delta), transaction row, idempotent
- Super Admin reject -> no credit
- Coin-supply report line item total_crypto_purchased
- RBAC (player + admin cannot hit superadmin endpoints)
"""
import io
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split()[0]).rstrip("/")
API = f"{BASE_URL}/api"

SA = {"email": "superadmin@royal11.com", "password": "ChangeMe123!"}
ADMIN = {"email": "admin1@royal11.com", "password": "ChangeMe123!"}
PLAYER = {"email": "player1@royal11.com", "password": "ChangeMe123!"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("access_token") or r.json().get("token")
    assert tok, r.text
    return tok


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _balance(tok):
    r = requests.get(f"{API}/wallet/me", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()["wallet"]["balance"]



@pytest.fixture(scope="module")
def sa_token():
    return _login(SA)


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def player_token():
    return _login(PLAYER)


# ---------------- Super Admin config ----------------
class TestConfig:
    def test_get_config_defaults(self, sa_token):
        r = requests.get(f"{API}/superadmin/crypto/config", headers=_h(sa_token))
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert "usdt_address" in cfg and "network" in cfg
        assert "coin_rate" in cfg and "min_inr" in cfg
        assert cfg["coin_rate"] > 0

    def test_set_config(self, sa_token):
        payload = {
            "usdt_address": "TXYZabc1234567890TESTAddress",
            "network": "TRC-20",
            "coin_rate": 1.5,
            "min_inr": 100000,
        }
        r = requests.put(f"{API}/superadmin/crypto/config", headers=_h(sa_token), json=payload)
        assert r.status_code == 200, r.text
        cfg = r.json()
        assert cfg["coin_rate"] == 1.5
        assert cfg["min_inr"] == 100000
        assert cfg["usdt_address"] == payload["usdt_address"]

    def test_upload_qr_and_fetch(self, sa_token, admin_token):
        # minimal PNG (1x1 transparent)
        png = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
               b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0"
               b"\x00\x00\x00\x03\x00\x01\x8e\xdf\x1eg\x00\x00\x00\x00IEND\xaeB`\x82")
        files = {"qr": ("qr.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/superadmin/crypto/config/qr", headers=_h(sa_token), files=files)
        assert r.status_code == 200, r.text
        assert r.json().get("has_qr") is True

        # Admin can fetch QR image bytes
        r2 = requests.get(f"{API}/admin/crypto/qr", headers=_h(admin_token))
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
        assert len(r2.content) > 0


# ---------------- Admin buy screen config ----------------
class TestAdminConfig:
    def test_admin_gets_public_config(self, admin_token):
        r = requests.get(f"{API}/admin/crypto/config", headers=_h(admin_token))
        assert r.status_code == 200, r.text
        cfg = r.json()
        for k in ("usdt_address", "network", "coin_rate", "min_inr", "has_qr"):
            assert k in cfg


# ---------------- Admin submits + Super Admin confirm ----------------
class TestPurchaseFlow:
    def test_submit_below_min_blocked(self, admin_token):
        data = {"usdt_amount": 100, "inr_equivalent": 50000, "tx_id": "TEST_TX_BELOW"}
        r = requests.post(f"{API}/admin/crypto/purchase-request",
                          headers=_h(admin_token), data=data)
        assert r.status_code == 400, r.text
        assert "Minimum" in r.text or "minimum" in r.text.lower()

    def test_full_confirm_flow_credits_delta(self, admin_token, sa_token):
        # 1) get admin's wallet balance BEFORE
        before = _balance(admin_token)

        # 2) submit valid
        data = {"usdt_amount": 1200, "inr_equivalent": 100000, "tx_id": "TEST_TX_OK_1"}
        r = requests.post(f"{API}/admin/crypto/purchase-request",
                          headers=_h(admin_token), data=data)
        assert r.status_code == 200, r.text
        req = r.json()
        assert req["status"] == "PENDING"
        assert req["coins_preview"] == 150000
        req_id = req["id"]

        # 3) super admin list PENDING contains it
        r2 = requests.get(f"{API}/superadmin/crypto/requests?status=PENDING",
                          headers=_h(sa_token))
        assert r2.status_code == 200
        assert any(x["id"] == req_id for x in r2.json())

        # 4) confirm
        r3 = requests.post(f"{API}/superadmin/crypto/requests/{req_id}/confirm",
                           headers=_h(sa_token))
        assert r3.status_code == 200, r3.text
        assert r3.json()["status"] == "CONFIRMED"
        assert r3.json()["coins_credited"] == 150000

        # 5) idempotent re-confirm returns 400
        r4 = requests.post(f"{API}/superadmin/crypto/requests/{req_id}/confirm",
                           headers=_h(sa_token))
        assert r4.status_code == 400

        # 6) admin wallet delta == 150000
        after = _balance(admin_token)
        assert after - before == 150000, f"delta {after-before} != 150000"

        # 7) my-purchases includes the CONFIRMED
        r6 = requests.get(f"{API}/admin/crypto/my-purchases", headers=_h(admin_token))
        assert r6.status_code == 200
        assert any(x["id"] == req_id and x["status"] == "CONFIRMED" for x in r6.json())

    def test_reject_flow_no_credit(self, admin_token, sa_token):
        before = _balance(admin_token)

        data = {"usdt_amount": 1400, "inr_equivalent": 120000, "tx_id": "TEST_TX_REJECT"}
        r = requests.post(f"{API}/admin/crypto/purchase-request",
                          headers=_h(admin_token), data=data)
        assert r.status_code == 200
        req_id = r.json()["id"]

        r2 = requests.post(f"{API}/superadmin/crypto/requests/{req_id}/reject",
                           headers=_h(sa_token), json={"reason": "Bad tx id"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "REJECTED"
        assert r2.json().get("reason")

        after = _balance(admin_token)
        assert after == before, f"balance changed after reject: {before} -> {after}"


# ---------------- Coin supply report ----------------
class TestCoinSupply:
    def test_report_has_crypto_line(self, sa_token):
        r = requests.get(f"{API}/admin/coin-supply", headers=_h(sa_token))
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("total_minted", "total_inr_deposits", "total_crypto_purchased"):
            assert k in body, f"missing {k} in {body}"
        assert body["total_crypto_purchased"] >= 150000


# ---------------- RBAC ----------------
class TestRBAC:
    def test_player_cannot_hit_admin_crypto(self, player_token):
        r = requests.get(f"{API}/admin/crypto/config", headers=_h(player_token))
        assert r.status_code in (401, 403), r.status_code

    def test_player_cannot_hit_superadmin_crypto(self, player_token):
        r = requests.get(f"{API}/superadmin/crypto/config", headers=_h(player_token))
        assert r.status_code in (401, 403)

    def test_admin_cannot_hit_superadmin_crypto_config(self, admin_token):
        r = requests.get(f"{API}/superadmin/crypto/config", headers=_h(admin_token))
        assert r.status_code == 403

    def test_admin_cannot_confirm(self, admin_token):
        r = requests.post(f"{API}/superadmin/crypto/requests/fakeid/confirm",
                          headers=_h(admin_token))
        assert r.status_code == 403

    def test_admin_cannot_reject(self, admin_token):
        r = requests.post(f"{API}/superadmin/crypto/requests/fakeid/reject",
                          headers=_h(admin_token), json={"reason": "x"})
        assert r.status_code == 403
