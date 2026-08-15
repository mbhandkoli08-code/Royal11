"""Service-level tests for OCR high-confidence deposit auto-approval.

E2E is impractical (real Google Vision + a screenshot that yields overall="match"),
so we exercise the decision + crediting core directly against the DB using
THROWAWAY admin/player docs (never the seeded admin1) so parallel suites that
assert on admin1's exact balance are unaffected.

Cases:
- eligible (OCR match, no dup, <= ₹5,000, admin opted-in) -> CONFIRMED,
  confirmed_by SYSTEM_AUTO_OCR, player credited.
- over the ₹5,000 cap -> stays PENDING, no credit.
- OCR verdict "review" -> stays PENDING.
- duplicate UTR -> stays PENDING.
- admin NOT opted-in -> stays PENDING.
"""
import asyncio
import uuid

from datetime import datetime, timezone

from app import deposit_service, wallet_service
from app.db import db
from app.constants import INR_TO_COIN_RATIO


async def _mk_users():
    """Create an isolated ACTIVE admin (self-funded float) + assigned player."""
    admin_id = f"test-admin-{uuid.uuid4()}"
    player_id = f"test-player-{uuid.uuid4()}"
    now = datetime.now(timezone.utc).isoformat()
    await db.users.insert_one({"id": admin_id, "role": "ADMIN", "status": "ACTIVE",
                               "email": f"{admin_id}@t.local", "display_name": "T Admin",
                               "auto_approve_deposits": False, "created_at": now})
    await db.users.insert_one({"id": player_id, "role": "PLAYER", "status": "ACTIVE",
                               "email": f"{player_id}@t.local", "display_name": "T Player",
                               "created_at": now})
    # Fund the admin's float so ensure_admin_float never needs a credit line.
    await wallet_service.get_or_create_wallet(admin_id)
    await wallet_service.get_or_create_wallet(player_id)
    await db.wallets.update_one({"user_id": admin_id},
                                {"$set": {"balance": 1_000_000, "updated_at": now}})
    await db.wallets.update_one({"user_id": player_id},
                                {"$set": {"balance": 0, "updated_at": now}})
    await db.player_assignments.insert_one({"player_id": player_id, "admin_id": admin_id})
    return admin_id, player_id


async def _cleanup(admin_id, player_id):
    ids = [admin_id, player_id]
    await db.users.delete_many({"id": {"$in": ids}})
    await db.wallets.delete_many({"user_id": {"$in": ids}})
    await db.player_assignments.delete_many({"player_id": player_id})
    await db.ledger_transactions.delete_many({"user_id": {"$in": ids}})
    await db.deposits.delete_many({"target_admin_id": admin_id})


async def _balance(uid):
    w = await db.wallets.find_one({"user_id": uid}, {"_id": 0, "balance": 1})
    return (w or {}).get("balance", 0)


def _doc(admin_id, player_id, amount, ocr_overall, duplicate=False):
    return {
        "id": str(uuid.uuid4()),
        "player_id": player_id,
        "target_admin_id": admin_id,
        "amount_inr": amount,
        "reference_note": f"AUTOTEST{uuid.uuid4().hex[:10].upper()}",
        "coins_to_credit": amount * INR_TO_COIN_RATIO,
        "status": "PENDING",
        "confirmed_by": None, "confirmed_at": None, "confirm_note": None,
        "rejected_reason": None, "duplicate_utr": duplicate, "account_id": None,
        "screenshot_path": None, "has_screenshot": True,
        "ocr": {"status": "ok", "match": {"amount": ocr_overall == "match",
                                          "utr": ocr_overall == "match",
                                          "overall": ocr_overall}},
        "auto_approved": False,
        "created_at": "2026-08-15T00:00:00+00:00",
    }


async def _run_case(admin_id, player_id, *, amount, ocr, duplicate, opted_in, expect_approved):
    await db.users.update_one({"id": admin_id}, {"$set": {"auto_approve_deposits": opted_in}})
    doc = _doc(admin_id, player_id, amount, ocr, duplicate)
    await db.deposits.insert_one(dict(doc))
    doc.pop("_id", None)
    before = await _balance(player_id)
    result = await deposit_service._maybe_auto_approve(doc)
    fresh = await db.deposits.find_one({"id": doc["id"]}, {"_id": 0})
    after = await _balance(player_id)

    if expect_approved:
        assert result is not None, "expected auto-approval"
        assert fresh["status"] == "CONFIRMED", fresh["status"]
        assert fresh["confirmed_by"] == deposit_service.AUTO_OCR_ACTOR
        assert fresh["auto_approved"] is True
        assert after - before == doc["coins_to_credit"], (before, after)
    else:
        assert result is None, "expected NO auto-approval"
        assert fresh["status"] == "PENDING", fresh["status"]
        assert fresh["auto_approved"] is False
        assert after == before, "player must NOT be credited"


def test_deposit_auto_approve_matrix():
    """All cases share ONE event loop — motor binds its client to the first loop,
    so separate asyncio.run() calls would hit 'Event loop is closed'."""
    async def go():
        admin_id, player_id = await _mk_users()
        try:
            await _run_case(admin_id, player_id, amount=1000, ocr="match",
                            duplicate=False, opted_in=True, expect_approved=True)
            await _run_case(admin_id, player_id, amount=6000, ocr="match",
                            duplicate=False, opted_in=True, expect_approved=False)
            await _run_case(admin_id, player_id, amount=1000, ocr="review",
                            duplicate=False, opted_in=True, expect_approved=False)
            await _run_case(admin_id, player_id, amount=1000, ocr="match",
                            duplicate=True, opted_in=True, expect_approved=False)
            await _run_case(admin_id, player_id, amount=1000, ocr="match",
                            duplicate=False, opted_in=False, expect_approved=False)
        finally:
            await _cleanup(admin_id, player_id)
    asyncio.run(go())
