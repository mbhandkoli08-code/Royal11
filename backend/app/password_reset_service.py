"""Email-OTP password reset — reuses the same email infrastructure and the
exact OTP mechanics as registration verification (otp_service), but in its OWN
collection (`password_reset_otps`) so a reset can't clash with a pending
registration code for the same email.

A 6-digit code is hashed (never stored plaintext), short-lived, attempt-limited
and single-use (deleted on success so a code can't be replayed).
"""
import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone

from .db import db
from . import email_service

logger = logging.getLogger(__name__)

OTP_TTL_MIN = 10
MAX_VERIFY_ATTEMPTS = 5
RESEND_COOLDOWN_SEC = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _gen_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _parse(val):
    if val is None:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(val)
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


async def ensure_indexes() -> None:
    await db.password_reset_otps.create_index("email", unique=True)
    await db.password_reset_otps.create_index("expire_at", expireAfterSeconds=0)


def _email_html(code: str) -> str:
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fb;padding:32px 0;">
      <tr><td align="center">
        <table width="440" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;padding:32px;font-family:Arial,Helvetica,sans-serif;">
          <tr><td style="font-size:20px;font-weight:bold;color:#c41230;">ROYAL11</td></tr>
          <tr><td style="padding-top:16px;font-size:15px;color:#334155;">We received a request to reset your password. Use this code to continue:</td></tr>
          <tr><td align="center" style="padding:24px 0;">
            <div style="display:inline-block;font-size:34px;letter-spacing:10px;font-weight:bold;color:#0f172a;background:#f1f5f9;border-radius:12px;padding:14px 24px;">{code}</div>
          </td></tr>
          <tr><td style="font-size:13px;color:#64748b;">This code expires in {OTP_TTL_MIN} minutes. If you didn't request a password reset, you can safely ignore this email — your password stays unchanged.</td></tr>
        </table>
      </td></tr>
    </table>
    """


async def create_and_send(email: str) -> None:
    code = _gen_code()
    now = _now()
    await db.password_reset_otps.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "code_hash": _hash(code),
            "attempts": 0,
            "created_at": now.isoformat(),
            "last_sent_at": now.isoformat(),
            "expire_at": now + timedelta(minutes=OTP_TTL_MIN),
        }},
        upsert=True,
    )
    if os.environ.get("OTP_DEBUG_LOG", "false").lower() in ("1", "true", "yes"):
        logger.warning("PWRESET_OTP_DEBUG %s -> %s", email, code)  # dev/preview only
    await email_service.send_email(
        email, "Your ROYAL11 password reset code", _email_html(code))


async def can_resend(email: str) -> tuple[bool, int]:
    doc = await db.password_reset_otps.find_one({"email": email}, {"_id": 0, "last_sent_at": 1})
    if not doc:
        return True, 0
    last = _parse(doc.get("last_sent_at"))
    if not last:
        return True, 0
    elapsed = (_now() - last).total_seconds()
    if elapsed >= RESEND_COOLDOWN_SEC:
        return True, 0
    return False, int(RESEND_COOLDOWN_SEC - elapsed) + 1


class OtpError(Exception):
    pass


async def verify(email: str, code: str) -> None:
    """Raise OtpError on missing/expired/too-many/wrong; on success delete the
    code so it is strictly single-use (can't be replayed)."""
    doc = await db.password_reset_otps.find_one({"email": email}, {"_id": 0})
    if not doc:
        raise OtpError("No reset in progress. Please request a new code.")
    expire = _parse(doc.get("expire_at"))
    if not expire or expire <= _now():
        raise OtpError("Your code has expired. Please request a new one.")
    if doc.get("attempts", 0) >= MAX_VERIFY_ATTEMPTS:
        raise OtpError("Too many incorrect attempts. Please request a new code.")
    if _hash(code) != doc.get("code_hash"):
        await db.password_reset_otps.update_one({"email": email}, {"$inc": {"attempts": 1}})
        raise OtpError("Incorrect code. Please try again.")
    await db.password_reset_otps.delete_one({"email": email})
