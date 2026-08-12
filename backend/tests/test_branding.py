"""Per-Admin login branding tests.

Covers:
- Admin sets own brand_name (PUT /admin/branding) -> slug auto-generated
- GET /admin/branding
- Logo upload (multipart) + public logo streaming
- Public GET /public/branding/{slug} (active admin, branding set)
- Public 404 for bogus/unknown slug
- RBAC: player 403 on /admin/branding; admin 403 on SA-only endpoint
- Super Admin can edit a specific admin's branding
"""
import io
import os
import uuid

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

# 1x1 transparent PNG
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000d49444154789c6360000002000100" "05" "0001" + "0" * 8)


def _login(email):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PWD}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_admin_set_and_get_branding():
    tok = _login("admin1@royal11.com")
    name = f"Test Club {uuid.uuid4().hex[:6]}"
    r = requests.put(f"{API}/admin/branding", json={"brand_name": name}, headers=_h(tok), timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["brand_name"] == name
    assert data["brand_slug"]  # auto-generated
    assert data["login_path"] == f"/login/{data['brand_slug']}"

    g = requests.get(f"{API}/admin/branding", headers=_h(tok), timeout=30)
    assert g.status_code == 200
    assert g.json()["brand_slug"] == data["brand_slug"]

    # public read works for the slug
    p = requests.get(f"{API}/public/branding/{data['brand_slug']}", timeout=30)
    assert p.status_code == 200
    assert p.json()["brand_name"] == name


def test_logo_upload_and_public_logo():
    tok = _login("admin1@royal11.com")
    # ensure branding exists
    requests.put(f"{API}/admin/branding", json={"brand_name": "Logo Test Club"}, headers=_h(tok), timeout=30)
    files = {"logo": ("logo.png", io.BytesIO(PNG), "image/png")}
    r = requests.post(f"{API}/admin/branding/logo", files=files, headers=_h(tok), timeout=60)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["has_logo"] is True
    slug = data["brand_slug"]
    lg = requests.get(f"{API}/public/branding/{slug}/logo", timeout=30)
    assert lg.status_code == 200
    assert lg.headers["content-type"].startswith("image/")


def test_public_unknown_slug_404():
    r = requests.get(f"{API}/public/branding/no-such-brand-{uuid.uuid4().hex[:8]}", timeout=30)
    assert r.status_code == 404


def test_logo_rejects_non_image():
    tok = _login("admin1@royal11.com")
    files = {"logo": ("x.txt", io.BytesIO(b"hello"), "text/plain")}
    r = requests.post(f"{API}/admin/branding/logo", files=files, headers=_h(tok), timeout=30)
    assert r.status_code == 400


def test_player_cannot_access_admin_branding():
    tok = _login("player1@royal11.com")
    r = requests.get(f"{API}/admin/branding", headers=_h(tok), timeout=30)
    assert r.status_code == 403


def test_admin_cannot_use_superadmin_endpoint():
    tok = _login("admin1@royal11.com")
    # editing an arbitrary admin's branding is SA-only
    r = requests.put(f"{API}/admin/admins/{uuid.uuid4()}/branding",
                     json={"brand_name": "Nope"}, headers=_h(tok), timeout=30)
    assert r.status_code == 403


def test_superadmin_edits_specific_admin_branding():
    sa = _login("superadmin@royal11.com")
    admins = requests.get(f"{API}/admin/admins", headers=_h(sa), timeout=30).json()
    assert admins, "no admins seeded"
    admin_id = admins[0]["user"]["id"]
    name = f"SA Set {uuid.uuid4().hex[:6]}"
    r = requests.put(f"{API}/admin/admins/{admin_id}/branding",
                     json={"brand_name": name}, headers=_h(sa), timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["brand_name"] == name
