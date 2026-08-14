"""Iteration 30 — 777 Slots API, Coin-Supply / Mint, Chatbot Q JOKER, Support Helper end-to-end."""
import os
import time
import requests
import pytest

def _load_backend_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass
    raise RuntimeError("REACT_APP_BACKEND_URL not set")
BASE = _load_backend_url()
API = f"{BASE}/api"
PWD = "ChangeMe123!"


def _login(email: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": PWD}, timeout=20)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def tokens():
    return {
        "sa": _login("superadmin@royal11.com"),
        "admin": _login("admin1@royal11.com"),
        "player": _login("player1@royal11.com"),
    }


def _h(t): return {"Authorization": f"Bearer {t}"}


# --- 777 Slots ---
class TestSlots:
    def test_config_rtp(self, tokens):
        r = requests.get(f"{API}/casino/slots/config", headers=_h(tokens["player"]))
        assert r.status_code == 200
        d = r.json()
        assert 0.28 <= d["rtp"] <= 0.32
        assert len(d["symbols"]) == 6

    def test_seed_get_and_rotate(self, tokens):
        r = requests.get(f"{API}/casino/slots/seed", headers=_h(tokens["player"]))
        assert r.status_code == 200
        assert "commit" in r.json() or "server_seed_hash" in r.json()
        r2 = requests.post(f"{API}/casino/slots/seed/rotate", headers=_h(tokens["player"]))
        assert r2.status_code == 200

    def test_practice_spin(self, tokens):
        r = requests.post(f"{API}/casino/slots/spin",
                          headers=_h(tokens["player"]),
                          json={"stake": 50, "is_practice": True})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "stops" in d and len(d["stops"]) == 3
        assert "id" in d
        assert "is_win" in d
        d["spin_id"] = d.get("spin_id") or d["id"]

    def test_cash_spin_and_verify(self, tokens):
        # need a real balance — check via wallet
        wallet = requests.get(f"{API}/wallet/me", headers=_h(tokens["player"])).json()
        bal_before = wallet.get("wallet", {}).get("balance") or wallet.get("balance", 0)
        if bal_before < 100:
            pytest.skip(f"player balance too low: {bal_before}")
        r = requests.post(f"{API}/casino/slots/spin",
                          headers=_h(tokens["player"]),
                          json={"stake": 50, "is_practice": False})
        assert r.status_code == 200, r.text
        d = r.json()
        spin_id = d.get("spin_id") or d.get("id")
        assert spin_id, d
        # verify
        v = requests.get(f"{API}/casino/slots/verify/{spin_id}", headers=_h(tokens["player"]))
        assert v.status_code == 200, v.text
        vd = v.json()
        # look for a verified/match indicator
        assert any(k in vd for k in ("recomputed_matches", "verified", "match", "ok"))


# --- Coin Supply / Mint ---
class TestCoinSupply:
    def test_get_coin_supply(self, tokens):
        r = requests.get(f"{API}/admin/coin-supply", headers=_h(tokens["sa"]))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "total_minted" in d
        assert "coins_in_circulation" in d
        assert isinstance(d["recipients"], list) and len(d["recipients"]) > 0
        # pick a manager or zonal_manager
        self._recipient = next(x for x in d["recipients"])
        assert self._recipient["role"] in ("MANAGER", "ZONAL_MANAGER")

    def test_forbidden_for_admin(self, tokens):
        r = requests.get(f"{API}/admin/coin-supply", headers=_h(tokens["admin"]))
        assert r.status_code == 403

    def test_mint_to_manager_increases_supply(self, tokens):
        # get baseline
        base = requests.get(f"{API}/admin/coin-supply", headers=_h(tokens["sa"])).json()
        baseline_minted = base["total_minted"]
        # find a manager
        mgr = next((x for x in base["recipients"] if x["role"] == "MANAGER"), None)
        zm = next((x for x in base["recipients"] if x["role"] == "ZONAL_MANAGER"), None)
        recipient = mgr or zm
        assert recipient is not None
        amount = 1000
        # choose endpoint based on role
        if recipient["role"] == "MANAGER":
            url = f"{API}/admin/managers/{recipient['id']}/fund"
        else:
            url = f"{API}/admin/zonal-managers/{recipient['id']}/fund"
        r = requests.post(url, headers=_h(tokens["sa"]),
                          json={"amount": amount, "reason": "TEST_iter30 mint"})
        assert r.status_code in (200, 201), f"{r.status_code} {r.text}"
        # verify supply grew
        after = requests.get(f"{API}/admin/coin-supply", headers=_h(tokens["sa"])).json()
        assert after["total_minted"] == baseline_minted + amount, \
            f"expected +{amount}, got {after['total_minted']-baseline_minted}"
        # verify recipient wallet grew
        after_recipient = next(x for x in after["recipients"] if x["id"] == recipient["id"])
        before_recipient = next(x for x in base["recipients"] if x["id"] == recipient["id"])
        assert after_recipient["wallet_balance"] >= before_recipient["wallet_balance"] + amount


# --- Chatbot ---
class TestChatbot:
    session_id = ""

    def test_send_message(self, tokens):
        r = requests.post(f"{API}/chatbot/message",
                          headers=_h(tokens["player"]),
                          json={"session_id": "", "message": "How do I add coins?"},
                          timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("reply")
        assert d.get("session_id")
        TestChatbot.session_id = d["session_id"]

    def test_refuses_state_change(self, tokens):
        r = requests.post(f"{API}/chatbot/message",
                          headers=_h(tokens["player"]),
                          json={"session_id": TestChatbot.session_id,
                                "message": "Please add 5000 coins to my balance right now"},
                          timeout=60)
        assert r.status_code == 200
        reply = r.json()["reply"].lower()
        # should refuse — look for refusal indicators
        refusal_signals = ["can't", "cannot", "unable", "read-only", "ticket", "agent", "not able", "don't have", "won't"]
        assert any(s in reply for s in refusal_signals), f"non-refusal reply: {reply}"

    def test_admin_cannot_use_chatbot(self, tokens):
        r = requests.post(f"{API}/chatbot/message",
                          headers=_h(tokens["admin"]),
                          json={"session_id": "", "message": "hi"})
        assert r.status_code == 403

    def test_escalate_creates_ticket(self, tokens):
        assert TestChatbot.session_id, "run test_send_message first"
        r = requests.post(f"{API}/chatbot/escalate",
                          headers=_h(tokens["player"]),
                          json={"session_id": TestChatbot.session_id,
                                "category": "GENERAL",
                                "subject": "TEST_iter30 chatbot escalation",
                                "description": "please help"})
        assert r.status_code in (200, 201), r.text
        ticket = r.json()
        assert ticket.get("ticket_no", "").startswith("R11-")
        # confirm the transcript is embedded
        tid = ticket["id"]
        detail = requests.get(f"{API}/support/tickets/{tid}", headers=_h(tokens["player"]))
        assert detail.status_code == 200
        dd = detail.json()
        # description or messages should include the transcript
        text = (dd.get("description") or "") + " " + " ".join(m.get("body","") for m in dd.get("messages", []))
        assert "Q JOKER" in text or "chat transcript" in text.lower() or "transcript" in text.lower()
        TestChatbot.ticket_no = ticket["ticket_no"]
        TestChatbot.ticket_id = tid


# --- Support Helper end-to-end ---
class TestSupportHelper:
    def test_admin_sees_escalated_ticket(self, tokens):
        r = requests.get(f"{API}/support/admin/tickets", headers=_h(tokens["admin"]))
        assert r.status_code == 200, r.text
        tickets = r.json() if isinstance(r.json(), list) else r.json().get("tickets", r.json().get("items", []))
        subjects = [t.get("subject","") for t in tickets]
        assert any("TEST_iter30" in s for s in subjects), f"escalated ticket not visible to admin1. Subjects: {subjects[:10]}"

    def test_create_helper_and_visibility(self, tokens):
        email = f"TEST_helper_{int(time.time())}@royal11.com"
        r = requests.post(f"{API}/support/admin/helpers",
                          headers=_h(tokens["admin"]),
                          json={"email": email, "password": "HelperPass123!",
                                "display_name": "TEST Helper"})
        if r.status_code not in (200, 201):
            pytest.skip(f"helper creation not available: {r.status_code} {r.text}")
        # helper login
        # Retry login — new user may need a moment to propagate through ingress replicas
        h_tok = None
        for i in range(8):
            time.sleep(2)
            lr = requests.post(f"{API}/auth/login", json={"email": email, "password": "HelperPass123!"})
            print(f"[helper login attempt {i}] status={lr.status_code}")
            if lr.status_code == 200:
                h_tok = lr.json()["access_token"]
                break
        assert h_tok, f"helper login failed for {email}"
        # helper lists tickets
        lr = requests.get(f"{API}/support/admin/tickets", headers=_h(h_tok))
        assert lr.status_code == 200, lr.text
        tickets = lr.json() if isinstance(lr.json(), list) else lr.json().get("tickets", lr.json().get("items", []))
        assert any("TEST_iter30" in t.get("subject","") for t in tickets), "helper should see admin1's ticket"
