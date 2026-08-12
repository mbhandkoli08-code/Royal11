"""Iteration 16 backend tests — Lucky Spin, Rewards Store, Contest, Payslips, QR (backend part), Payroll catch-up idempotence."""
import os
import uuid
import asyncio
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

PLAYER_EMAIL = "player1@royal11.com"
MANAGER_EMAIL = "manager1@royal11.com"
ZM_EMAIL = "zonal1@royal11.com"
PWD = "ChangeMe123!"


def _login(email: str, password: str = PWD) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


def _register(email: str, name: str, password: str = PWD) -> tuple[str, str]:
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": password, "display_name": name},
                      timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]["id"]


def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


def _balance(tok):
    r = requests.get(f"{API}/wallet/me", headers=_auth(tok), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["wallet"]["balance"]


@pytest.fixture(scope="module")
def fresh_player():
    email = f"TEST_iter16_{uuid.uuid4().hex[:10]}@royal11.com"
    tok, uid = _register(email, "Iter16 Tester")
    return {"tok": tok, "id": uid, "email": email}


# --- LUCKY SPIN ---------------------------------------------------------------
class TestLuckySpin:
    def test_spin_debits_and_credits(self, fresh_player):
        tok = fresh_player["tok"]
        bal_before = _balance(tok)
        assert bal_before >= 150, f"welcome bonus should give >= 150 coins, got {bal_before}"
        r = requests.post(f"{API}/games/spin", headers=_auth(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "prize" in data and "won" in data and "balance" in data
        assert data["prize"] in [50, 200, 0, 500, 100, 1000, 75, 300]
        expected = bal_before - 150 + data["prize"]
        assert data["balance"] == expected, f"expected net {expected}, got {data['balance']}"
        # persist
        assert _balance(tok) == expected

    def test_spin_insufficient(self):
        # register a fresh player, drain to <150 by making purchases (or just spin till broke)
        tok, uid = _register(f"TEST_iter16_broke_{uuid.uuid4().hex[:8]}@royal11.com", "Broke")
        # welcome bonus is 1000; buy av2 (800), then attempt spin (1000-800 net + spin outcomes; try until <150)
        r = requests.post(f"{API}/games/store/buy", json={"item_id": "av2"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        # balance now 200. spin cost 150 -> may leave 50..1050. keep spinning until below 150
        for _ in range(20):
            b = _balance(tok)
            if b < 150:
                break
            requests.post(f"{API}/games/spin", headers=_auth(tok))
        assert _balance(tok) < 150
        r = requests.post(f"{API}/games/spin", headers=_auth(tok), timeout=30)
        assert r.status_code == 400
        assert "coin" in r.text.lower() or "enough" in r.text.lower()


# --- STORE --------------------------------------------------------------------
class TestStore:
    def test_buy_avatar_and_reject_double_and_equip(self):
        tok, _ = _register(f"TEST_iter16_store_{uuid.uuid4().hex[:8]}@royal11.com", "Store")
        bal0 = _balance(tok)
        r = requests.post(f"{API}/games/store/buy", json={"item_id": "av1"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["balance"] == bal0 - 300
        assert "av1" in data["inventory"]["owned_items"]

        # already owned
        r2 = requests.post(f"{API}/games/store/buy", json={"item_id": "av1"}, headers=_auth(tok))
        assert r2.status_code == 400
        assert "already" in r2.text.lower()

        # equip owned
        r3 = requests.post(f"{API}/games/store/equip", json={"item_id": "av1"}, headers=_auth(tok))
        assert r3.status_code == 200
        assert r3.json()["equipped_avatar_id"] == "av1"

        # equip unowned
        r4 = requests.post(f"{API}/games/store/equip", json={"item_id": "av2"}, headers=_auth(tok))
        assert r4.status_code == 400

        # inventory endpoint reflects
        r5 = requests.get(f"{API}/games/inventory", headers=_auth(tok))
        assert r5.status_code == 200
        inv = r5.json()
        assert "av1" in inv["owned_items"]
        assert inv["equipped_avatar_id"] == "av1"

    def test_buy_boost_repeatable_and_sets_boost_until(self):
        tok, _ = _register(f"TEST_iter16_boost_{uuid.uuid4().hex[:8]}@royal11.com", "Boost")
        # bo1 = 250, boost_seconds=60
        r = requests.post(f"{API}/games/store/buy", json={"item_id": "bo1"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        b1 = r.json()
        assert b1["inventory"]["boost_until"] is not None
        r2 = requests.post(f"{API}/games/store/buy", json={"item_id": "bo1"}, headers=_auth(tok))
        assert r2.status_code == 200, r2.text  # repeatable
        assert _balance(tok) == 1000 - 500  # welcome 1000 - 2x250

    def test_unknown_item(self):
        tok, _ = _register(f"TEST_iter16_unk_{uuid.uuid4().hex[:8]}@royal11.com", "Unk")
        r = requests.post(f"{API}/games/store/buy", json={"item_id": "xyz"}, headers=_auth(tok))
        assert r.status_code == 400

    def test_insufficient(self):
        tok, _ = _register(f"TEST_iter16_ins_{uuid.uuid4().hex[:8]}@royal11.com", "Ins")
        # welcome 1000, badge bd3 = 1000 first buy ok; second (same item) blocked as already own, so buy bd2 (600)
        r = requests.post(f"{API}/games/store/buy", json={"item_id": "bd3"}, headers=_auth(tok))
        assert r.status_code == 200
        # now 0 coins, buy bd2 -> insufficient
        r2 = requests.post(f"{API}/games/store/buy", json={"item_id": "bd2"}, headers=_auth(tok))
        assert r2.status_code == 400
        assert "coin" in r2.text.lower() or "enough" in r2.text.lower()


# --- CONTEST ------------------------------------------------------------------
class TestContest:
    def test_join_and_double_join_and_unknown(self):
        tok, _ = _register(f"TEST_iter16_con_{uuid.uuid4().hex[:8]}@royal11.com", "Con")
        bal0 = _balance(tok)
        r = requests.post(f"{API}/games/contest/join",
                          json={"contest_id": "ipl_grand_league"}, headers=_auth(tok))
        assert r.status_code == 200, r.text
        assert r.json()["balance"] == bal0 - 100
        r2 = requests.post(f"{API}/games/contest/join",
                           json={"contest_id": "ipl_grand_league"}, headers=_auth(tok))
        assert r2.status_code == 400
        assert "already" in r2.text.lower()
        r3 = requests.post(f"{API}/games/contest/join",
                           json={"contest_id": "nonexistent"}, headers=_auth(tok))
        assert r3.status_code == 400


# --- PAYSLIPS -----------------------------------------------------------------
class TestPayslips:
    def test_manager_payslips(self):
        tok = _login(MANAGER_EMAIL)
        r = requests.get(f"{API}/admin/my-payroll", headers=_auth(tok), timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "payslips" in data
        assert isinstance(data["payslips"], list)
        if data["payslips"]:
            s = data["payslips"][0]
            for k in ("week_start", "salary_inr", "incentive_inr", "total_inr"):
                assert k in s
            assert s["total_inr"] == s["salary_inr"] + s["incentive_inr"]
            # newest first
            weeks = [x["week_start"] for x in data["payslips"]]
            assert weeks == sorted(weeks, reverse=True)

    def test_zm_payslips(self):
        tok = _login(ZM_EMAIL)
        r = requests.get(f"{API}/admin/zonal/my-payroll", headers=_auth(tok), timeout=30)
        assert r.status_code == 200, r.text
        assert "payslips" in r.json()


# --- PAYROLL CATCH-UP IDEMPOTENCE --------------------------------------------
class TestPayrollCatchup:
    def test_run_recent_payroll_idempotent(self):
        """Invoke payroll_service.run_recent_payroll() twice; wallet balance for
        manager1 must not change on the second run, and salary ledger entries per
        week must remain unique."""
        import sys
        sys.path.insert(0, "/app/backend")
        from app import payroll_service
        from app.db import db

        async def run():
            mgr = await db.users.find_one({"email": MANAGER_EMAIL}, {"_id": 0, "id": 1})
            assert mgr, "manager1 not seeded"
            mid = mgr["id"]

            await payroll_service.run_recent_payroll()
            w1 = await db.wallets.find_one({"user_id": mid}, {"_id": 0, "balance": 1})
            count1 = await db.ledger_transactions.count_documents(
                {"user_id": mid, "type": "SALARY", "status": "COMPLETED"})

            await payroll_service.run_recent_payroll()
            w2 = await db.wallets.find_one({"user_id": mid}, {"_id": 0, "balance": 1})
            count2 = await db.ledger_transactions.count_documents(
                {"user_id": mid, "type": "SALARY", "status": "COMPLETED"})

            assert w1["balance"] == w2["balance"], f"balance drifted: {w1['balance']} -> {w2['balance']}"
            assert count1 == count2, f"salary txn count drifted: {count1} -> {count2}"

            # unique request_ids per week (all salary rids for this user)
            rids = []
            async for t in db.ledger_transactions.find(
                {"user_id": mid, "type": "SALARY", "status": "COMPLETED"},
                {"_id": 0, "request_id": 1}):
                rids.append(t["request_id"])
            assert len(rids) == len(set(rids)), "duplicate salary request_ids exist"

        asyncio.get_event_loop().run_until_complete(run()) if False else asyncio.run(run())


# --- WALLET HISTORY LABELS ----------------------------------------------------
class TestWalletHistory:
    def test_labels_present(self):
        tok, _ = _register(f"TEST_iter16_hist_{uuid.uuid4().hex[:8]}@royal11.com", "Hist")
        requests.post(f"{API}/games/spin", headers=_auth(tok))
        requests.post(f"{API}/games/store/buy", json={"item_id": "av1"}, headers=_auth(tok))
        requests.post(f"{API}/games/contest/join",
                      json={"contest_id": "ipl_grand_league"}, headers=_auth(tok))
        r = requests.get(f"{API}/wallet/me", headers=_auth(tok), timeout=30)
        assert r.status_code == 200
        types = {t["type"] for t in r.json()["transactions"]}
        assert "GAME_ENTRY" in types
        assert "STORE_PURCHASE" in types
        assert "FANTASY_ENTRY" in types
