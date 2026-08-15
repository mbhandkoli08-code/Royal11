"""API-level Pool/Deals/Points Rummy variants + turn gating (iter38)."""
import os
import requests
import pytest
from pathlib import Path

def _load_base():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    envf = Path("/app/frontend/.env")
    if envf.exists():
        for line in envf.read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE = _load_base()
P1 = ("player1@royal11.com", "ChangeMe123!")
P2 = ("casino_p2@royal11.com", "ChangeMe123!")


def _login(email, password):
    r = requests.post(f"{BASE}/api/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def tokens():
    return {"p1": _login(*P1), "p2": _login(*P2)}


@pytest.fixture(scope="module")
def uids(tokens):
    r1 = requests.get(f"{BASE}/api/auth/me", headers=_h(tokens["p1"])).json()
    r2 = requests.get(f"{BASE}/api/auth/me", headers=_h(tokens["p2"])).json()
    return {"p1": r1["id"], "p2": r2["id"]}


def _create_join_start(tokens, game_type, config):
    tc = requests.post(f"{BASE}/api/casino/tables",
                       json={"game_type": game_type, "config": config, "is_practice": True},
                       headers=_h(tokens["p1"]), timeout=30)
    assert tc.status_code == 200, f"create {game_type}: {tc.status_code} {tc.text}"
    tid = tc.json()["id"]
    # p1 join
    j1 = requests.post(f"{BASE}/api/casino/tables/{tid}/join", headers=_h(tokens["p1"]), timeout=30)
    assert j1.status_code == 200, f"p1 join: {j1.status_code} {j1.text}"
    # p2 join
    j2 = requests.post(f"{BASE}/api/casino/tables/{tid}/join", headers=_h(tokens["p2"]), timeout=30)
    assert j2.status_code == 200, f"p2 join: {j2.status_code} {j2.text}"
    s = requests.post(f"{BASE}/api/casino/rummy/tables/{tid}/start", headers=_h(tokens["p1"]), timeout=30)
    assert s.status_code == 200, f"start: {s.status_code} {s.text}"
    return tid


def _state(tid, tok):
    r = requests.get(f"{BASE}/api/casino/rummy/tables/{tid}/state", headers=_h(tok), timeout=30)
    assert r.status_code == 200, f"state: {r.status_code} {r.text}"
    return r.json()


def test_pool_rummy_match_lifecycle(tokens):
    tid = _create_join_start(tokens, "rummy_pool", {"pool_type": 101, "entry_fee": 100})
    st = _state(tid, tokens["p1"])
    m = st.get("match")
    assert m is not None, "match object missing for pool"
    assert m["variant"] == "pool"
    assert m["pool_limit"] == 101
    assert m["status"] == "RUNNING"
    assert m["deals_played"] == 0
    # practice → no rake → prize = entry_fee * 2
    assert m["prize_pool"] == 200, f"expected 200, got {m['prize_pool']}"
    assert st["round"] and st["round"]["config"]["variant"] == "pool"
    hand = st["round"].get("your_hand") or []
    assert len(hand) == 13, f"expected 13 cards, got {len(hand)}"


def test_deals_rummy_match(tokens):
    tid = _create_join_start(tokens, "rummy_deals", {"num_deals": 2, "entry_fee": 100})
    st = _state(tid, tokens["p1"])
    m = st.get("match")
    assert m is not None
    assert m["variant"] == "deals"
    assert m["num_deals"] == 2
    assert m["prize_pool"] == 200


def test_points_rummy_no_match_object(tokens):
    tid = _create_join_start(tokens, "rummy_points", {"point_value": 1})
    st = _state(tid, tokens["p1"])
    assert st.get("match") is None, "points rummy must NOT have match object"
    assert st["round"] is not None
    assert st["round"]["phase"] == "PLAYING"
    hand = st["round"].get("your_hand") or []
    assert len(hand) == 13


def test_turn_gating_non_turn_player_400(tokens, uids):
    tid = _create_join_start(tokens, "rummy_points", {"point_value": 1})
    st = _state(tid, tokens["p1"])
    rnd = st["round"]
    turn_uid = (rnd.get("turn") or {}).get("user_id") or rnd.get("turn_user_id")
    assert turn_uid, f"round has no turn user: {rnd}"
    # Non-turn player attempts draw → expect 400
    non_turn_tok = tokens["p2"] if turn_uid == uids["p1"] else tokens["p1"]
    r = requests.post(f"{BASE}/api/casino/rummy/tables/{tid}/draw",
                      json={"source": "closed"},
                      headers=_h(non_turn_tok), timeout=30)
    assert r.status_code == 400, f"non-turn draw expected 400, got {r.status_code} {r.text}"

    # Turn player can draw then discard
    turn_tok = tokens["p1"] if turn_uid == uids["p1"] else tokens["p2"]
    r2 = requests.post(f"{BASE}/api/casino/rummy/tables/{tid}/draw",
                       json={"source": "closed"},
                       headers=_h(turn_tok), timeout=30)
    assert r2.status_code == 200, f"turn draw: {r2.status_code} {r2.text}"
    st2 = _state(tid, turn_tok)
    hand = st2["round"]["your_hand"]
    # Discard first card
    card = hand[0]
    card_id = card["id"] if isinstance(card, dict) else card
    r3 = requests.post(f"{BASE}/api/casino/rummy/tables/{tid}/discard",
                       json={"card_id": card_id},
                       headers=_h(turn_tok), timeout=30)
    assert r3.status_code == 200, f"discard: {r3.status_code} {r3.text}"
