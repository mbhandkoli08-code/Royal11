"""Referral program — built on the existing per-player `referral_code`.

Both the referrer and the referee are rewarded via the non-withdrawable BONUS
rail (bonus_service), so referral coins require playthrough and are never
instantly cashable — consistent with VIP recharge / Surprise Box / Festival Gift.

Anti-fraud default ("qualified referrer"): the referee gets their bonus at
activation, but the referrer's bonus is HELD until the referee qualifies —
their first recharge OR first real-money wager of >= a configurable minimum.
Super Admin can switch the qualify event (or make it instant on signup) and tune
amounts via referral_config.
"""
import uuid
from datetime import datetime, timezone

from . import bonus_service
from . import notification_service
from .audit import log_action
from .db import db

DEFAULTS = {
    "enabled": True,
    "referrer_amount": 125,          # coins to the referrer (bonus rail)
    "referee_amount": 75,            # coins to the new player (bonus rail)
    "qualify_event": "FIRST_RECHARGE",  # SIGNUP | FIRST_RECHARGE | FIRST_WAGER
    "qualify_min_amount": 100,       # min recharge/wager coins to qualify
    "multiple": None,                # playthrough multiple (None = bonus default)
    "expiry_days": None,             # None = bonus default
    "max_referrals_per_user": 100,   # cap on rewarded referrals per referrer
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.referrals.create_index("referee_id", unique=True)
    await db.referrals.create_index("referrer_id")


async def get_config() -> dict:
    doc = await db.referral_config.find_one({"_id": "referral"}, {"_id": 0})
    return {**DEFAULTS, **(doc or {})}


async def set_config(patch: dict) -> dict:
    allowed_keys = ("enabled", "referrer_amount", "referee_amount", "qualify_event",
                    "qualify_min_amount", "multiple", "expiry_days", "max_referrals_per_user")
    upd = {k: patch[k] for k in allowed_keys if k in patch}
    if upd:
        await db.referral_config.update_one({"_id": "referral"}, {"$set": upd}, upsert=True)
    return await get_config()


async def _grant(user_id: str, kind: str, amount: int, cfg: dict, referee_id: str) -> None:
    if amount <= 0:
        return
    await bonus_service.grant_bonus(
        user_id, "referral", amount,
        request_id=f"referral_{kind}:{referee_id}",
        multiple=cfg.get("multiple"), expiry_days=cfg.get("expiry_days"),
        source_ref=referee_id,
    )


async def _reward_referrer(rec: dict, cfg: dict) -> None:
    """Grant the referrer bonus + mark the referral REWARDED (idempotent)."""
    if rec.get("status") == "REWARDED":
        return
    rewarded = await db.referrals.count_documents({"referrer_id": rec["referrer_id"], "status": "REWARDED"})
    if rewarded >= int(cfg.get("max_referrals_per_user", 100)):
        return  # cap reached — no reward, but the join still stands
    await _grant(rec["referrer_id"], "referrer", int(cfg["referrer_amount"]), cfg, rec["referee_id"])
    await db.referrals.update_one({"id": rec["id"]}, {"$set": {
        "status": "REWARDED", "referrer_reward": int(cfg["referrer_amount"]),
        "qualified_at": _now(),
    }})
    await log_action(None, "REFERRAL_REWARDED", target_type="referral", target_id=rec["id"],
                     metadata={"referrer_id": rec["referrer_id"], "referee_id": rec["referee_id"]})
    # Explicit, named notification to the referrer (bell + toast on the client).
    referee = await db.users.find_one({"id": rec["referee_id"]}, {"_id": 0, "display_name": 1})
    friend = (referee or {}).get("display_name") or "Your friend"
    amount = int(cfg["referrer_amount"])
    await notification_service.create(
        rec["referrer_id"], "referral_reward", "Referral reward unlocked!",
        f"🎉 {friend} joined using your code and made their first recharge — you earned {amount} coins!",
        data={"amount": amount, "referee_name": friend, "referee_id": rec["referee_id"]},
        request_id=f"referral_reward_notif:{rec['referee_id']}")


async def register_referral(referee: dict, referral_code: str) -> None:
    """Called once at player activation. Links the referee to the referrer,
    grants the referee bonus, and (if qualify_event=SIGNUP) rewards the referrer
    immediately; otherwise the referrer reward waits for try_qualify()."""
    cfg = await get_config()
    if not cfg.get("enabled"):
        return
    referrer = await db.users.find_one({"referral_code": referral_code}, {"_id": 0, "id": 1})
    if not referrer or referrer["id"] == referee["id"]:
        return
    if await db.referrals.find_one({"referee_id": referee["id"]}, {"_id": 0, "id": 1}):
        return  # already linked

    await db.users.update_one({"id": referee["id"]}, {"$set": {"referred_by": referrer["id"]}})
    rec = {
        "id": str(uuid.uuid4()),
        "referrer_id": referrer["id"],
        "referee_id": referee["id"],
        "status": "JOINED",
        "referrer_reward": 0,
        "referee_reward": int(cfg["referee_amount"]),
        "created_at": _now(),
        "qualified_at": None,
    }
    await db.referrals.insert_one(rec)
    await _grant(referee["id"], "referee", int(cfg["referee_amount"]), cfg, referee["id"])
    await log_action(None, "REFERRAL_JOINED", target_type="referral", target_id=rec["id"],
                     metadata={"referrer_id": referrer["id"], "referee_id": referee["id"]})

    if cfg.get("qualify_event") == "SIGNUP":
        await _reward_referrer(rec, cfg)


async def try_qualify(referee_id: str, event: str, amount: int) -> None:
    """Best-effort hook from recharge/wager paths. No-ops unless a JOINED
    referral exists for this referee AND the event/amount matches config."""
    cfg = await get_config()
    if not cfg.get("enabled") or cfg.get("qualify_event") != event:
        return
    if amount < int(cfg.get("qualify_min_amount", 0)):
        return
    rec = await db.referrals.find_one({"referee_id": referee_id, "status": "JOINED"}, {"_id": 0})
    if not rec:
        return
    await _reward_referrer(rec, cfg)


async def me(user: dict) -> dict:
    """Referral dashboard for a player: code, share link, stats + list."""
    code = user.get("referral_code")
    rows = await db.referrals.find({"referrer_id": user["id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    ref_ids = [r["referee_id"] for r in rows]
    names = {}
    if ref_ids:
        urows = await db.users.find({"id": {"$in": ref_ids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(len(ref_ids))
        names = {u["id"]: u.get("display_name") for u in urows}
    cfg = await get_config()
    total_earned = sum(r.get("referrer_reward", 0) for r in rows if r.get("status") == "REWARDED")
    return {
        "code": code,
        "config": {
            "referrer_amount": cfg["referrer_amount"],
            "referee_amount": cfg["referee_amount"],
            "qualify_event": cfg["qualify_event"],
            "enabled": cfg["enabled"],
        },
        "stats": {
            "joined": len(rows),
            "qualified": sum(1 for r in rows if r["status"] in ("REWARDED",)),
            "total_earned": total_earned,
        },
        "referrals": [{
            "referee_name": names.get(r["referee_id"], "Player"),
            "status": r["status"],
            "referrer_reward": r.get("referrer_reward", 0),
            "created_at": r["created_at"],
        } for r in rows],
    }


async def admin_stats() -> dict:
    """Aggregate referral program stats for Super Admin."""
    total = await db.referrals.count_documents({})
    rewarded = await db.referrals.count_documents({"status": "REWARDED"})
    pending = await db.referrals.count_documents({"status": "JOINED"})
    # Total bonus paid: referrer rewards (only on REWARDED) + every referee reward.
    agg = db.referrals.aggregate([{"$group": {
        "_id": None,
        "referrer_paid": {"$sum": "$referrer_reward"},
        "referee_paid": {"$sum": "$referee_reward"},
    }}])
    row = await agg.to_list(1)
    referrer_paid = row[0]["referrer_paid"] if row else 0
    referee_paid = row[0]["referee_paid"] if row else 0
    unique_referrers = len(await db.referrals.distinct("referrer_id"))
    return {
        "total_referrals": total,
        "rewarded": rewarded,
        "pending_qualification": pending,
        "unique_referrers": unique_referrers,
        "bonus_paid": {
            "to_referrers": referrer_paid,
            "to_referees": referee_paid,
            "total": referrer_paid + referee_paid,
        },
    }
