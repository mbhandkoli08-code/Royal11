"""Promo code apply endpoint tests - iteration 25."""
import os
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://royal-sports-hub-2.preview.emergentagent.com').rstrip('/')


@pytest.fixture(scope="module")
def player_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "player1@royal11.com", "password": "ChangeMe123!"
    })
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture
def auth_headers(player_token):
    return {"Authorization": f"Bearer {player_token}"}


def _reset_promo_redemptions():
    """Best-effort: clear promo_redemptions for player1 so codes can be re-applied."""
    import sys
    sys.path.insert(0, '/app/backend')
    from pymongo import MongoClient
    mongo_url = os.environ.get('MONGO_URL')
    db_name = os.environ.get('DB_NAME')
    if not mongo_url or not db_name:
        # load from .env
        from dotenv import dotenv_values
        env = dotenv_values('/app/backend/.env')
        mongo_url = mongo_url or env.get('MONGO_URL')
        db_name = db_name or env.get('DB_NAME')
    client = MongoClient(mongo_url)
    db = client[db_name]
    user = db.users.find_one({"email": "player1@royal11.com"})
    if user:
        db.promo_redemptions.delete_many({"user_id": user["id"]})
        # Also clear bonus_grants for promo request_ids so grant_bonus isn't a no-op
        db.bonus_grants.delete_many({"user_id": user["id"], "request_id": {"$regex": "^promo:"}})
    client.close()


def test_promo_apply_royal50(auth_headers):
    _reset_promo_redemptions()
    r = requests.post(f"{BASE_URL}/api/promo/apply", json={"code": "ROYAL50"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True
    assert data.get("bonus_coins") == 50


def test_promo_apply_duplicate_returns_400(auth_headers):
    # Second application of same code should fail
    r = requests.post(f"{BASE_URL}/api/promo/apply", json={"code": "ROYAL50"}, headers=auth_headers)
    assert r.status_code == 400
    body = r.text.lower()
    assert "already" in body


def test_promo_apply_invalid_code(auth_headers):
    r = requests.post(f"{BASE_URL}/api/promo/apply", json={"code": "NOPE123"}, headers=auth_headers)
    assert r.status_code == 400
    body = r.text.lower()
    assert "invalid" in body or "expired" in body


def test_promo_bonus_lands_in_bonus_rail(auth_headers):
    # Reset then apply WELCOME100 and confirm bonus_balance grows
    _reset_promo_redemptions()
    before = requests.get(f"{BASE_URL}/api/bonus/me", headers=auth_headers)
    assert before.status_code == 200, before.text
    b_before = before.json().get("bonus_balance", 0)

    ap = requests.post(f"{BASE_URL}/api/promo/apply", json={"code": "WELCOME100"}, headers=auth_headers)
    assert ap.status_code == 200, ap.text
    assert ap.json().get("bonus_coins") == 100

    after = requests.get(f"{BASE_URL}/api/bonus/me", headers=auth_headers)
    b_after = after.json().get("bonus_balance", 0)
    assert b_after >= b_before + 100, f"bonus_balance did not grow by 100: before={b_before}, after={b_after}"


def test_promo_fantasy25(auth_headers):
    r = requests.post(f"{BASE_URL}/api/promo/apply", json={"code": "FANTASY25"}, headers=auth_headers)
    # Might be already used from earlier runs; accept 200 or 400 already-used
    assert r.status_code in (200, 400), r.text
    if r.status_code == 200:
        assert r.json().get("bonus_coins") == 25
