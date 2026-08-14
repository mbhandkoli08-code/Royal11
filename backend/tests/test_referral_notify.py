"""Referral program + reward notification regression."""
import asyncio
import uuid

from app import referral_service, notification_service, bonus_service
from app.db import db


def _seed_user(**extra):
    uid = f"reftest-{uuid.uuid4().hex[:8]}"
    doc = {"id": uid, "email": f"{uid}@t.com", "display_name": extra.get("name", "Friend"),
           "role": "PLAYER", "referral_code": f"RC{uid[-6:].upper()}"}
    return uid, doc


def test_referral_reward_and_notification():
    async def run():
        cfg = await referral_service.get_config()
        # referrer
        rid, rdoc = _seed_user(name="Referrer")
        await db.users.insert_one(rdoc)
        # referee
        eid, edoc = _seed_user(name="Bob Referee")
        await db.users.insert_one(edoc)

        eb_before = (await bonus_service.get_status(eid))["bonus_balance"]
        await referral_service.register_referral({"id": eid}, rdoc["referral_code"])
        eb_after = (await bonus_service.get_status(eid))["bonus_balance"]
        assert eb_after - eb_before == int(cfg["referee_amount"])  # referee bonus

        # referrer not rewarded yet (FIRST_RECHARGE pending)
        rb_before = (await bonus_service.get_status(rid))["bonus_balance"]
        await referral_service.try_qualify(eid, "FIRST_RECHARGE", int(cfg["qualify_min_amount"]))
        rb_after = (await bonus_service.get_status(rid))["bonus_balance"]
        assert rb_after - rb_before == int(cfg["referrer_amount"])  # referrer bonus on qualify

        # notification created for the referrer, naming the friend
        nl = await notification_service.list_for(rid)
        assert nl["unread_count"] >= 1
        body = nl["items"][0]["body"]
        assert "Bob Referee" in body and str(int(cfg["referrer_amount"])) in body

        # self-referral is blocked
        sid, sdoc = _seed_user(name="Selfie")
        await db.users.insert_one(sdoc)
        await referral_service.register_referral({"id": sid}, sdoc["referral_code"])
        assert await db.referrals.find_one({"referee_id": sid}) is None

        # cleanup
        for u in (rid, eid, sid):
            await db.users.delete_one({"id": u})
            await db.referrals.delete_many({"referee_id": u})
            await db.referrals.delete_many({"referrer_id": u})
            await db.notifications.delete_many({"user_id": u})
            await db.bonus_grants.delete_many({"source_ref": u})

        # admin aggregate stats shape
        stats = await referral_service.admin_stats()
        assert {"total_referrals", "rewarded", "pending_qualification", "unique_referrers", "bonus_paid"} <= set(stats)
        assert {"to_referrers", "to_referees", "total"} <= set(stats["bonus_paid"])
    asyncio.run(run())
