"""Brute-force login protection (MongoDB-backed, worker-safe).

Two independent throttles on POST /api/auth/login:
  • per-email  — stops password-guessing a single account
  • per-IP     — stops credential-spraying many accounts from one host

Failed attempts are counted within a rolling window; crossing the threshold
locks that key for a cooldown. A successful login clears both keys. When an
email crosses its lockout, a `security_alerts` row is upserted so Super Admin
sees "suspicious login activity". Attempt docs self-expire via a TTL index.
"""
import logging
import os
from datetime import datetime, timedelta, timezone

from .db import db

logger = logging.getLogger(__name__)

# Tunables (env-overridable; sensible defaults).
EMAIL_MAX = int(os.environ.get("LOGIN_EMAIL_MAX_ATTEMPTS", "5"))
EMAIL_WINDOW_MIN = int(os.environ.get("LOGIN_EMAIL_WINDOW_MIN", "15"))
EMAIL_LOCK_MIN = int(os.environ.get("LOGIN_EMAIL_LOCK_MIN", "30"))
IP_MAX = int(os.environ.get("LOGIN_IP_MAX_ATTEMPTS", "20"))
IP_WINDOW_MIN = int(os.environ.get("LOGIN_IP_WINDOW_MIN", "15"))
IP_LOCK_MIN = int(os.environ.get("LOGIN_IP_LOCK_MIN", "30"))
ATTEMPT_TTL_SECONDS = 24 * 3600


class LoginLocked(Exception):
    """Raised when a key is in cooldown. `retry_after_min` is user-facing."""

    def __init__(self, retry_after_min: int):
        self.retry_after_min = retry_after_min
        super().__init__(f"locked for {retry_after_min}m")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(iso: str | None) -> datetime | None:
    if not iso:
        return None
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        return None


def get_client_ip(request) -> str:
    """Real client IP behind the k8s ingress/reverse proxy."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    real = request.headers.get("x-real-ip")
    if real:
        return real.strip()
    return request.client.host if request.client else "unknown"


async def ensure_indexes() -> None:
    await db.login_attempts.create_index("key", unique=True)
    await db.login_attempts.create_index("expire_at", expireAfterSeconds=0)
    await db.security_alerts.create_index("email", unique=True)


def _remaining_lock_min(doc: dict | None) -> int:
    if not doc:
        return 0
    locked_until = _parse(doc.get("locked_until"))
    if locked_until and locked_until > _now():
        return max(1, int((locked_until - _now()).total_seconds() // 60) + 1)
    return 0


async def check_locked(email: str, ip: str) -> None:
    """Raise LoginLocked if either the email or the IP is currently in cooldown."""
    docs = await db.login_attempts.find(
        {"key": {"$in": [f"email:{email}", f"ip:{ip}"]}}, {"_id": 0}
    ).to_list(length=2)
    remaining = max((_remaining_lock_min(d) for d in docs), default=0)
    if remaining:
        raise LoginLocked(remaining)


async def _record_key(key: str, max_attempts: int, window_min: int, lock_min: int) -> bool:
    """Increment one key's failure counter. Returns True if this failure caused
    a fresh lockout (used to raise a Super Admin alert for the email key)."""
    now = _now()
    doc = await db.login_attempts.find_one({"key": key}, {"_id": 0})
    window_start = _parse(doc.get("window_start")) if doc else None
    locked_until = _parse(doc.get("locked_until")) if doc else None

    if locked_until and locked_until > now:
        fails = (doc or {}).get("fails", 0)  # already locked; keep as-is
        newly_locked = False
    elif not doc or not window_start or (now - window_start) > timedelta(minutes=window_min):
        fails, window_start, locked_until, newly_locked = 1, now, None, False
    else:
        fails = doc.get("fails", 0) + 1
        newly_locked = False
        if fails >= max_attempts:
            locked_until = now + timedelta(minutes=lock_min)
            newly_locked = True

    await db.login_attempts.update_one(
        {"key": key},
        {"$set": {
            "key": key,
            "fails": fails,
            "window_start": (window_start or now).isoformat(),
            "locked_until": locked_until.isoformat() if locked_until else None,
            "expire_at": now + timedelta(seconds=ATTEMPT_TTL_SECONDS),
        }},
        upsert=True,
    )
    return newly_locked


async def record_failure(email: str, ip: str) -> None:
    email_locked = await _record_key(f"email:{email}", EMAIL_MAX, EMAIL_WINDOW_MIN, EMAIL_LOCK_MIN)
    await _record_key(f"ip:{ip}", IP_MAX, IP_WINDOW_MIN, IP_LOCK_MIN)
    if email_locked:
        await _raise_alert(email, ip)


async def clear_on_success(email: str, ip: str) -> None:
    await db.login_attempts.delete_many({"key": {"$in": [f"email:{email}", f"ip:{ip}"]}})


async def _raise_alert(email: str, ip: str) -> None:
    now = _now()
    user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1, "display_name": 1, "role": 1})
    await db.security_alerts.update_one(
        {"email": email},
        {"$set": {
            "email": email,
            "user_id": (user or {}).get("id"),
            "display_name": (user or {}).get("display_name"),
            "role": (user or {}).get("role"),
            "last_ip": ip,
            "last_locked_at": now.isoformat(),
            "resolved": False,
        },
         "$inc": {"lock_count": 1},
         "$setOnInsert": {"first_locked_at": now.isoformat()}},
        upsert=True,
    )
    logger.warning("Brute-force lockout: email=%s ip=%s", email, ip)


async def list_alerts(limit: int = 100) -> list[dict]:
    return await db.security_alerts.find({}, {"_id": 0}).sort("last_locked_at", -1).to_list(length=limit)


async def resolve_alert(email: str) -> bool:
    res = await db.security_alerts.update_one(
        {"email": email}, {"$set": {"resolved": True, "resolved_at": _now().isoformat()}})
    # Also clear any active lock on that email so a legit user can log back in.
    await db.login_attempts.delete_one({"key": f"email:{email}"})
    return res.matched_count > 0
