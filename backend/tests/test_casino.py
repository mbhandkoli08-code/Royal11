"""Casino Phase 0 tests — provably-fair RNG + High Card round flow + rake split."""
import asyncio
import os
import uuid

import requests

from app.games import rng
from app.games.cards import fresh_deck

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"
PWD = "ChangeMe123!"


# ---------------- RNG unit tests (pure, no DB) ----------------
def test_shuffle_is_deterministic_and_full_deck():
    seed, nonce = "abc123", "n1"
    d1 = rng.shuffled_deck(seed, nonce)
    d2 = rng.shuffled_deck(seed, nonce)
    assert d1 == d2                      # deterministic from seed
    assert sorted(d1) == sorted(fresh_deck())  # a real permutation of 52 cards
    assert rng.shuffled_deck(seed, "n2") != d1  # nonce changes the order


def test_commit_verify_roundtrip():
    seed, nonce = rng.new_seed(), rng.new_nonce()
    deck = rng.shuffled_deck(seed, nonce)
    commit = rng.commit_hash(seed, deck)
    ok, recomputed = rng.verify(seed, nonce, commit)
    assert ok and recomputed == deck
    # tampering breaks verification
    assert rng.verify(seed, nonce, "deadbeef")[0] is False


# ---------------- API flow ----------------
def _login(email):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": PWD}, timeout=30).json()["access_token"]


def _seed_player(email, coins=5000):
    import sys
    sys.path.insert(0, "/app/backend")
    from app.db import db
    from app.security import hash_password
    from app import wallet_service
    from app.models import TxnType

    async def go():
        await db.users.delete_one({"email": email})
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "email": email, "password_hash": hash_password(PWD),
            "display_name": "Casino Tester", "role": "PLAYER", "status": "ACTIVE",
            "created_at": "2026-01-01T00:00:00+00:00", "referral_code": uid[:6].upper()})
        await wallet_service.credit(uid, TxnType.WELCOME_BONUS, coins, reason="test",
                                    request_id=f"seed:{uid}")
    asyncio.get_event_loop().run_until_complete(go())


def test_high_card_full_round_and_rake_split():
    p2_email = f"casino_test_{uuid.uuid4().hex[:8]}@royal11.com"
    _seed_player(p2_email)
    p1, p2 = _login("player1@royal11.com"), _login(p2_email)
    h1, h2 = {"Authorization": f"Bearer {p1}"}, {"Authorization": f"Bearer {p2}"}

    tid = requests.post(f"{API}/casino/tables", json={"game_type": "high_card"}, headers=h1, timeout=30).json()["id"]
    assert requests.post(f"{API}/casino/tables/{tid}/join", headers=h1, timeout=30).status_code == 200
    assert requests.post(f"{API}/casino/tables/{tid}/join", headers=h2, timeout=30).status_code == 200

    r = requests.post(f"{API}/casino/tables/{tid}/start", headers=h1, timeout=30).json()["round"]
    assert r["phase"] == "SETTLED"
    assert r["pot"] == 20 and r["rake"] == 14 and r["payout"] == 6  # 2 x stake 10, 70% rake
    assert r["winner_user_id"] and len(r["seats"]) == 2

    v = requests.get(f"{API}/casino/rounds/{r['id']}/verify", headers=h2, timeout=30).json()
    assert v["recomputed_matches"] is True

    # rake attributed + split recorded (SA only)
    sa = _login("superadmin@royal11.com")
    rake = requests.get(f"{API}/casino/admin/rake", headers={"Authorization": f"Bearer {sa}"}, timeout=30).json()
    entry = next(e for e in rake["entries"] if e["round_id"] == r["id"])
    assert entry["rake"] == 14
    assert entry["super_admin_share"] + entry["admin_share"] == 14


def test_min_players_enforced():
    p1 = _login("player1@royal11.com")
    h1 = {"Authorization": f"Bearer {p1}"}
    tid = requests.post(f"{API}/casino/tables", json={"game_type": "high_card"}, headers=h1, timeout=30).json()["id"]
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h1, timeout=30)
    r = requests.post(f"{API}/casino/tables/{tid}/start", headers=h1, timeout=30)
    assert r.status_code == 400  # only 1 player


def test_rake_rbac_admin_forbidden():
    a = _login("admin1@royal11.com")
    r = requests.get(f"{API}/casino/admin/rake", headers={"Authorization": f"Bearer {a}"}, timeout=30)
    assert r.status_code == 403


def _play_round(h1, h2, is_practice):
    body = {"game_type": "high_card", "is_practice": is_practice}
    tid = requests.post(f"{API}/casino/tables", json=body, headers=h1, timeout=30).json()["id"]
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h1, timeout=30)
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h2, timeout=30)
    return requests.post(f"{API}/casino/tables/{tid}/start", headers=h1, timeout=30).json()["round"]


def test_practice_round_uses_chips_not_real_wallet_and_no_rake():
    p2_email = f"casino_test_{uuid.uuid4().hex[:8]}@royal11.com"
    _seed_player(p2_email)
    p1, p2 = _login("player1@royal11.com"), _login(p2_email)
    h1, h2 = {"Authorization": f"Bearer {p1}"}, {"Authorization": f"Bearer {p2}"}

    def real_bal(h):
        return requests.get(f"{API}/wallet/me", headers=h, timeout=30).json()["wallet"]["balance"]
    before = real_bal(h1)
    r = _play_round(h1, h2, is_practice=True)
    assert r["is_practice"] is True
    assert real_bal(h1) == before  # real wallet untouched by practice

    sa = _login("superadmin@royal11.com")
    rake = requests.get(f"{API}/casino/admin/rake", headers={"Authorization": f"Bearer {sa}"}, timeout=30).json()
    assert not any(e["round_id"] == r["id"] for e in rake["entries"])  # no rake on practice


def test_cash_round_awards_progression_xp():
    p2_email = f"casino_test_{uuid.uuid4().hex[:8]}@royal11.com"
    _seed_player(p2_email)
    p1, p2 = _login("player1@royal11.com"), _login(p2_email)
    h1, h2 = {"Authorization": f"Bearer {p1}"}, {"Authorization": f"Bearer {p2}"}
    before = requests.get(f"{API}/casino/progression/me", headers=h1, timeout=30).json()["xp"]
    _play_round(h1, h2, is_practice=False)
    after = requests.get(f"{API}/casino/progression/me", headers=h1, timeout=30).json()
    assert after["xp"] == before + 1  # stake 10 @ 1xp/10coins
    assert after["tier"] in {"bronze", "silver", "gold", "platinum", "royal"}
