"""Weekly casino commission rollup — GET /api/casino/admin/commission-report."""
import os

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


def _login(email):
    return requests.post(f"{API}/auth/login", json={"email": email, "password": PWD}, timeout=30).json()["access_token"]


def test_commission_report_structure_and_rollup():
    sa = _login("superadmin@royal11.com")
    r = requests.get(f"{API}/casino/admin/commission-report?week_offset=0",
                     headers={"Authorization": f"Bearer {sa}"}, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert {"week_start", "week_end", "totals", "games"} <= set(data)
    t = data["totals"]
    assert {"bets", "payouts", "commission", "super_admin_share", "admin_share", "rounds"} <= set(t)
    # payouts = bets - commission, and SA + Admin share = commission (rollup invariant)
    assert t["payouts"] == t["bets"] - t["commission"]
    assert t["super_admin_share"] + t["admin_share"] == t["commission"]
    for g in data["games"]:
        assert g["payouts"] == g["bets"] - g["commission"]
        assert "bet_types" in g  # ready for Thane Matka Single/Jodi/Panna/Motor


def test_commission_report_rbac_player_forbidden():
    p = _login("player1@royal11.com")
    r = requests.get(f"{API}/casino/admin/commission-report",
                     headers={"Authorization": f"Bearer {p}"}, timeout=30)
    assert r.status_code == 403
