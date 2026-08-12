"""Backend tests for PUT /api/auth/console-theme + GET /api/auth/me persistence.
Also verifies invalid theme falls back to default (per implementation)."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

CREDS = {
    "superadmin": ("superadmin@royal11.com", "ChangeMe123!"),
    "admin1": ("admin1@royal11.com", "ChangeMe123!"),
    "zonal1": ("zonal1@royal11.com", "ChangeMe123!"),
    "manager1": ("manager1@royal11.com", "ChangeMe123!"),
    "player1": ("player1@royal11.com", "ChangeMe123!"),
}


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email} failed: {r.status_code} {r.text}"
    return r.json()


def _me(token):
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _set_theme(token, theme):
    r = requests.put(
        f"{API}/auth/console-theme",
        headers={"Authorization": f"Bearer {token}"},
        json={"theme": theme},
        timeout=15,
    )
    return r


@pytest.mark.parametrize("key", ["superadmin", "admin1", "zonal1", "manager1"])
def test_console_theme_persistence_all_console_roles(key):
    email, pwd = CREDS[key]
    data = _login(email, pwd)
    token = data["access_token"]

    # Login response should include console_theme field on user
    assert "console_theme" in data.get("user", {}), f"login user missing console_theme: {data.get('user')}"

    # Set to dark
    r = _set_theme(token, "dark")
    assert r.status_code == 200, r.text
    assert r.json()["console_theme"] == "dark"

    # /me reflects it
    me = _me(token)
    assert me["console_theme"] == "dark"

    # Re-login and confirm persisted
    data2 = _login(email, pwd)
    assert data2["user"]["console_theme"] == "dark"

    # Reset to default (cleanup for superadmin/admin1 per instructions)
    r = _set_theme(data2["access_token"], "default")
    assert r.status_code == 200
    assert r.json()["console_theme"] == "default"


def test_console_theme_invalid_falls_back_to_default():
    email, pwd = CREDS["superadmin"]
    token = _login(email, pwd)["access_token"]
    r = _set_theme(token, "hot-pink")
    assert r.status_code == 200
    assert r.json()["console_theme"] == "default"


@pytest.mark.parametrize("theme", ["default", "dark", "sky", "navy"])
def test_all_four_themes_accepted(theme):
    token = _login(*CREDS["admin1"])["access_token"]
    r = _set_theme(token, theme)
    assert r.status_code == 200
    assert r.json()["console_theme"] == theme
    assert _me(token)["console_theme"] == theme
    # Cleanup at the end of parametrized run - reset default after last
    if theme == "navy":
        _set_theme(token, "default")


def test_theme_endpoint_requires_auth():
    r = requests.put(f"{API}/auth/console-theme", json={"theme": "dark"}, timeout=10)
    assert r.status_code in (401, 403), r.status_code


def test_themes_independent_between_users():
    su_token = _login(*CREDS["superadmin"])["access_token"]
    admin_token = _login(*CREDS["admin1"])["access_token"]

    _set_theme(su_token, "navy")
    _set_theme(admin_token, "sky")

    assert _me(su_token)["console_theme"] == "navy"
    assert _me(admin_token)["console_theme"] == "sky"

    # cleanup
    _set_theme(su_token, "default")
    _set_theme(admin_token, "default")
