"""Player-owned profile: contact (mobile), payout (bank/UPI) + marketing consent.

Single source of truth the player controls. Reading these sensitive fields is
restricted to SUPER_ADMIN ONLY — no Admin/Vendor, Manager, Zonal, or Support
Helper endpoint ever returns them. Every Super-Admin reveal is audit-logged.
India DND/consent: marketing opt-in is OFF by default, per-channel, with a
stored consent timestamp + source; outreach must only target opted-in players.
"""
from datetime import datetime, timezone
from typing import Optional

from .audit import log_action
from .db import db
from . import storage_service


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty(user_id: str) -> dict:
    return {
        "user_id": user_id,
        "mobile": None,
        "upi_id": None,
        "bank": {"account_holder_name": None, "account_number": None, "ifsc": None, "bank_name": None},
        "consent": {"marketing_opt_in": False, "sms": False, "whatsapp": False, "push": False},
        "consent_updated_at": None,
        "consent_source": None,
        "updated_at": None,
    }


def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def get_own(user_id: str) -> dict:
    doc = await db.player_profiles.find_one({"user_id": user_id}, {"_id": 0})
    if not doc:
        empty = _empty(user_id)
        empty["has_upi_qr"] = False
        return empty
    # Never expose the raw storage path; surface a boolean flag instead.
    doc["has_upi_qr"] = bool(doc.get("upi_qr_path"))
    doc.pop("upi_qr_path", None)
    return doc


async def set_upi_qr(user_id: str, image_bytes: bytes, content_type: Optional[str]) -> dict:
    """Store/replace the player's optional UPI QR screenshot (data-capture only)."""
    path = f"{storage_service.APP_NAME}/player_profiles/{user_id}/upi_qr"
    result = await storage_service.put_object(path, image_bytes, content_type or "image/png")
    await db.player_profiles.update_one(
        {"user_id": user_id},
        {"$set": {"upi_qr_path": result["path"], "updated_at": _now()}},
        upsert=True,
    )
    return await get_own(user_id)


async def get_upi_qr_path(user_id: str) -> Optional[str]:
    doc = await db.player_profiles.find_one({"user_id": user_id}, {"_id": 0, "upi_qr_path": 1})
    return (doc or {}).get("upi_qr_path")


async def clear_upi_qr(user_id: str) -> dict:
    await db.player_profiles.update_one(
        {"user_id": user_id}, {"$set": {"upi_qr_path": None, "updated_at": _now()}}, upsert=True)
    return await get_own(user_id)


async def update_own(user_id: str, patch) -> dict:
    current = await get_own(user_id)
    updates: dict = {"updated_at": _now()}
    if patch.mobile is not None:
        updates["mobile"] = patch.mobile.strip() or None
    if patch.upi_id is not None:
        updates["upi_id"] = patch.upi_id.strip() or None
    if patch.bank is not None:
        updates["bank"] = patch.bank.model_dump()
    if patch.consent is not None:
        new_consent = patch.consent.model_dump()
        # Stamp consent metadata whenever the consent block changes (audit trail
        # for TRAI/DND + WhatsApp policy).
        if new_consent != current.get("consent"):
            updates["consent_updated_at"] = _now()
            updates["consent_source"] = "player_self_service"
        updates["consent"] = new_consent
    await db.player_profiles.update_one({"user_id": user_id}, {"$set": updates}, upsert=True)
    return await get_own(user_id)


async def get_sensitive(super_admin: dict, player_id: str) -> dict:
    """SUPER_ADMIN-only reveal. Audit-logged for accountability."""
    player = await db.users.find_one({"id": player_id}, {"_id": 0, "id": 1, "display_name": 1, "email": 1, "role": 1})
    if not player:
        from fastapi import HTTPException, status
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Player not found")
    profile = await get_own(player_id)
    await log_action(super_admin["id"], "PLAYER_SENSITIVE_VIEWED", target_type="user",
                     target_id=player_id, metadata={"by": super_admin.get("email")})
    return {
        "player": {"id": player["id"], "display_name": player.get("display_name"), "email": player.get("email")},
        "profile": _clean(profile),
    }


async def lookup(super_admin: dict, query: str) -> list:
    """SUPER_ADMIN-only search of players by email/name/id, returning a MASKED
    summary (reveal full details via get_sensitive). Never used by lower roles."""
    q = (query or "").strip()
    filt = {"role": "PLAYER"}
    if q:
        filt["$or"] = [
            {"email": {"$regex": q, "$options": "i"}},
            {"display_name": {"$regex": q, "$options": "i"}},
            {"id": q},
        ]
    users = await db.users.find(filt, {"_id": 0, "id": 1, "display_name": 1, "email": 1}).limit(50).to_list(50)
    ids = [u["id"] for u in users]
    profs = {p["user_id"]: p async for p in db.player_profiles.find({"user_id": {"$in": ids}}, {"_id": 0})}

    def _mask(v: Optional[str], keep: int = 4) -> Optional[str]:
        if not v:
            return None
        return ("•" * max(0, len(v) - keep)) + v[-keep:]

    out = []
    for u in users:
        p = profs.get(u["id"], {})
        bank = (p.get("bank") or {})
        out.append({
            "id": u["id"],
            "display_name": u.get("display_name"),
            "email": u.get("email"),
            "mobile_masked": _mask(p.get("mobile"), 4),
            "upi_masked": _mask(p.get("upi_id"), 4),
            "bank_masked": _mask(bank.get("account_number"), 4),
            "marketing_opt_in": bool((p.get("consent") or {}).get("marketing_opt_in")),
            "has_payout": bool(p.get("upi_id") or bank.get("account_number")),
        })
    return out
