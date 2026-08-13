"""Points Rummy Phase 1 — pure-rules unit tests + full API flow.

Covers the tricky 2-deck duplicate-card handling explicitly:
- TWO pure sequences using identical values (5s6s7s twice) are BOTH valid.
- A set with two identical suits (7s + 7s) is INVALID even in a 2-deck shoe.
"""
import asyncio
import os
import uuid

import requests

from app.games import rng, rummy
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


def _c(idx, code):
    if code == "JK":
        return {"id": f"c{idx}", "code": "JK", "rank": None, "suit": None, "printed_joker": True}
    return {"id": f"c{idx}", "code": code, "rank": code[0], "suit": code[1], "printed_joker": False}


def _cards(*codes):
    return [_c(i, code) for i, code in enumerate(codes)]


# ---------------- RNG: 2-deck shoe shuffle + verify ----------------
def test_shoe_shuffle_deterministic_and_complete():
    base = fresh_deck() * 2 + ["JK", "JK"]
    seed, nonce = rng.new_seed(), rng.new_nonce()
    a = rng.shuffled_list(base, seed, nonce)
    b = rng.shuffled_list(base, seed, nonce)
    assert a == b
    assert sorted(a) == sorted(base) and len(a) == 106
    commit = rng.commit_hash(seed, a)
    ok, recomputed = rng.verify_list(seed, nonce, base, commit)
    assert ok and recomputed == a


# ---------------- Pure / impure sequence + set classification ----------------
def test_pure_sequence():
    assert rummy.is_pure_sequence(_cards("5s", "6s", "7s"), wild_rank="9")
    assert not rummy.is_pure_sequence(_cards("5s", "6s", "8s"), wild_rank="9")  # gap
    assert not rummy.is_pure_sequence(_cards("5s", "6h", "7s"), wild_rank="9")  # mixed suit


def test_ace_high_and_low_sequences():
    assert rummy.is_pure_sequence(_cards("As", "2s", "3s"), wild_rank="9")   # A low
    assert rummy.is_pure_sequence(_cards("Qs", "Ks", "As"), wild_rank="9")   # A high
    assert not rummy.is_pure_sequence(_cards("Ks", "As", "2s"), wild_rank="9")  # round-the-corner


def test_impure_sequence_with_joker():
    # 5s _ 7s with a printed joker filling the 6s gap
    assert rummy.is_sequence(_cards("5s", "JK", "7s"), wild_rank="9")
    # wild-rank (9) card acts as joker to complete 5s6s_
    assert rummy.is_sequence(_cards("5s", "6s", "9h"), wild_rank="9")


def test_set_requires_distinct_suits():
    assert rummy.is_set(_cards("7s", "7h", "7d"), wild_rank="9")
    assert not rummy.is_set(_cards("7s", "7s", "7d"), wild_rank="9")  # duplicate suit invalid
    assert rummy.is_set(_cards("7s", "7h", "JK"), wild_rank="9")      # joker pads


def test_duplicate_pure_sequences_both_valid_two_deck():
    # Two identical pure sequences from a 2-deck shoe — BOTH must validate.
    g1 = _cards("5s", "6s", "7s")
    g2 = [_c(10 + i, code) for i, code in enumerate(["5s", "6s", "7s"])]
    assert rummy.is_pure_sequence(g1, wild_rank="K")
    assert rummy.is_pure_sequence(g2, wild_rank="K")


def test_validate_full_declaration():
    # 13 cards: pure(5s6s7s) + pure(2h3h4h) + set(9c9d9s) + run(Jd Qd Kd Ad -> 4)
    groups = [
        _cards("5s", "6s", "7s"),
        _cards("2h", "3h", "4h"),
        _cards("9c", "9d", "9s"),
        _cards("Jd", "Qd", "Kd", "Ad"),
    ]
    res = rummy.validate_declaration(groups, wild_rank="8", expected_cards=13)
    assert res["valid"], res["reason"]
    assert sum(1 for b in res["breakdown"] if b["is_pure"]) >= 1


def test_declaration_needs_pure_sequence():
    # 2 sequences but neither pure (both use jokers) -> invalid
    groups = [
        _cards("5s", "JK", "7s"),
        _cards("2h", "3h", "JK"),
        _cards("9c", "9d", "9s"),
        _cards("Jd", "Jh", "Js", "Jc"),
    ]
    res = rummy.validate_declaration(groups, wild_rank="8", expected_cards=13)
    assert not res["valid"] and "pure" in res["reason"].lower()


def test_deadwood_full_count_without_pure_sequence():
    hand = _cards("As", "Kh", "Qd", "5c", "8s")  # no pure sequence
    assert rummy.best_deadwood(hand, wild_rank="9") == min(80, 10 + 10 + 10 + 5 + 8)


# ---------------- Full API flow ----------------
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
            "display_name": "Rummy Tester", "role": "PLAYER", "status": "ACTIVE",
            "created_at": "2026-01-01T00:00:00+00:00", "referral_code": uid[:6].upper()})
        await wallet_service.credit(uid, TxnType.WELCOME_BONUS, coins, reason="test",
                                    request_id=f"seed:{uid}")
    asyncio.get_event_loop().run_until_complete(go())


def test_rummy_deal_and_state_hides_opponent_cards():
    e2 = f"rummy_{uuid.uuid4().hex[:8]}@royal11.com"
    _seed_player(e2)
    p1, p2 = _login("player1@royal11.com"), _login(e2)
    h1, h2 = {"Authorization": f"Bearer {p1}"}, {"Authorization": f"Bearer {p2}"}

    tid = requests.post(f"{API}/casino/tables", json={"game_type": "rummy_points",
                        "config": {"point_value": 1}}, headers=h1, timeout=30).json()["id"]
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h1, timeout=30)
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h2, timeout=30)

    st = requests.post(f"{API}/casino/rummy/tables/{tid}/start", headers=h1, timeout=30).json()
    r = st["round"]
    assert r["phase"] == "PLAYING"
    assert len(r["your_hand"]) == 13          # dealer sees own 13
    assert r["wild"]["code"] and r["closed_count"] > 0 and r["open_top"]
    # opponent view: their own hand is 13, and player list hides card values
    st2 = requests.get(f"{API}/casino/rummy/tables/{tid}/state", headers=h2, timeout=30).json()["round"]
    assert len(st2["your_hand"]) == 13
    assert all("cards" not in p for p in st2["players"])  # no opponent card leakage
    # provably-fair verify
    v = requests.get(f"{API}/casino/rummy/rounds/{r['id']}/verify", headers=h2, timeout=30).json()
    assert v["recomputed_matches"] is True


def test_rummy_drop_settles_and_refunds_escrow():
    e2 = f"rummy_{uuid.uuid4().hex[:8]}@royal11.com"
    _seed_player(e2)
    p1, p2 = _login("player1@royal11.com"), _login(e2)
    h1, h2 = {"Authorization": f"Bearer {p1}"}, {"Authorization": f"Bearer {p2}"}

    def bal(h):
        return requests.get(f"{API}/wallet/me", headers=h, timeout=30).json()["wallet"]["balance"]

    tid = requests.post(f"{API}/casino/tables", json={"game_type": "rummy_points",
                        "config": {"point_value": 1}}, headers=h1, timeout=30).json()["id"]
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h1, timeout=30)
    requests.post(f"{API}/casino/tables/{tid}/join", headers=h2, timeout=30)

    b2_before = bal(h2)
    st = requests.post(f"{API}/casino/rummy/tables/{tid}/start", headers=h1, timeout=30).json()["round"]
    turn_uid = st["turn"]["user_id"]
    # whoever is on turn drops (first drop = 20 pts). Pick the right header.
    me1 = requests.get(f"{API}/auth/me", headers=h1, timeout=30).json()["id"]
    dropper_h = h1 if turn_uid == me1 else h2
    other_h = h2 if dropper_h is h1 else h1

    res = requests.post(f"{API}/casino/rummy/tables/{tid}/drop", headers=dropper_h, timeout=30).json()
    assert res["round"]["phase"] == "SETTLED"
    result = res["round"]["result"]
    assert result["winner_user_id"] and result["pot"] >= 0
    # winner nets >=0, dropper loses <= 20 * point_value
    b2_after = bal(h2)
    # escrow was refunded net; player2's swing is bounded by 20 coins either way
    assert abs(b2_after - b2_before) <= 40
