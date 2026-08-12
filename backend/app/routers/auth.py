import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, wallet_service, login_security, otp_service
from ..audit import log_action
from ..constants import INACTIVITY_NUDGE_DAYS, REFERRAL_BONUS_COINS
from ..db import db
from ..deps import get_current_user
from ..models import (
    LoginRequest,
    RegisterRequest,
    Role,
    TokenResponse,
    TxnType,
    UserPublic,
    UserStatus,
)
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

WELCOME_BONUS_AMOUNT = 1000


def _to_public(user: dict) -> UserPublic:
    return UserPublic(**user)


async def _generate_referral_code() -> str:
    """Short, unique, human-shareable code."""
    for _ in range(10):
        code = uuid.uuid4().hex[:8].upper()
        if not await db.users.find_one({"referral_code": code}, {"_id": 0, "id": 1}):
            return code
    return uuid.uuid4().hex[:12].upper()


async def _credit_referrer(referral_code: str, new_user_id: str) -> None:
    referrer = await db.users.find_one({"referral_code": referral_code}, {"_id": 0})
    if not referrer or referrer["id"] == new_user_id:
        return
    await db.users.update_one({"id": new_user_id}, {"$set": {"referred_by": referrer["id"]}})
    await wallet_service.credit(
        referrer["id"], TxnType.REFERRAL_BONUS, REFERRAL_BONUS_COINS,
        reason="Referral bonus", request_id=f"referral:{new_user_id}",
    )


@router.post("/register")
async def register(payload: RegisterRequest):
    """Public self-signup creates a PENDING_VERIFICATION player and emails a
    6-digit OTP. The account is only activated (welcome bonus, admin assignment,
    referral credit, login token) after the code is verified. Managers/Admins are
    created by Super Admin/Manager elsewhere — never here."""
    email = payload.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        if existing["status"] == UserStatus.PENDING_VERIFICATION.value:
            # Idempotent: same person retrying signup — just (re)send a code.
            await otp_service.create_and_send(email)
            return {"status": "otp_sent", "email": email, "requires_verification": True}
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(payload.password),
        "display_name": payload.display_name,
        "role": Role.PLAYER.value,
        "status": UserStatus.PENDING_VERIFICATION.value,
        "created_by": None,
        "referral_code": await _generate_referral_code(),
        "referred_by": None,
        "pending_referral_code": (payload.referral_code or "").strip().upper() or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    await otp_service.create_and_send(email)
    return {"status": "otp_sent", "email": email, "requires_verification": True}


async def _activate_player(user: dict) -> None:
    """One-time activation side effects, run after OTP verification."""
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"status": UserStatus.ACTIVE.value}, "$unset": {"pending_referral_code": ""}})
    await wallet_service.get_or_create_wallet(user["id"])
    await wallet_service.credit(
        user["id"], TxnType.WELCOME_BONUS, WELCOME_BONUS_AMOUNT,
        reason="Welcome bonus", request_id=f"welcome:{user['id']}",
    )
    admin_id = await assignment_service.auto_assign_player(user["id"])
    ref = user.get("pending_referral_code")
    if ref:
        await _credit_referrer(ref, user["id"])
    await log_action(user["id"], "PLAYER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"auto_assigned_admin_id": admin_id})


class VerifyOtpRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(payload: VerifyOtpRequest):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    if user["status"] != UserStatus.PENDING_VERIFICATION.value:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account is already verified.")
    try:
        await otp_service.verify(email, payload.code.strip())
    except otp_service.OtpError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await _activate_player(user)
    fresh = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    token = create_access_token(fresh["id"], fresh["role"])
    return TokenResponse(access_token=token, user=_to_public(fresh))


class ResendOtpRequest(BaseModel):
    email: EmailStr


@router.post("/resend-otp")
async def resend_otp(payload: ResendOtpRequest):
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0, "status": 1})
    # Generic response to avoid email enumeration; only act for pending accounts.
    if user and user["status"] == UserStatus.PENDING_VERIFICATION.value:
        ok, retry_in = await otp_service.can_resend(email)
        if not ok:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Please wait {retry_in} seconds before requesting another code.")
        await otp_service.create_and_send(email)
    return {"status": "otp_sent", "email": email}


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request):
    email = payload.email.strip().lower()
    ip = login_security.get_client_ip(request)
    # Brute-force gate: block early if this email or IP is in cooldown.
    try:
        await login_security.check_locked(email, ip)
    except login_security.LoginLocked as e:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            f"Too many failed login attempts. Please try again in {e.retry_after_min} "
            f"minute{'s' if e.retry_after_min != 1 else ''}.",
        )

    user = await db.users.find_one({"email": payload.email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await login_security.record_failure(email, ip)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if user["status"] == UserStatus.DISABLED.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    if user["status"] == UserStatus.PENDING_VERIFICATION.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Please verify your email before logging in.")
    await login_security.clear_on_success(email, ip)
    token = create_access_token(user["id"], user["role"])
    return TokenResponse(access_token=token, user=_to_public(user))


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    # Backfill a referral code for older accounts that predate the feature.
    if user["role"] == Role.PLAYER.value and not user.get("referral_code"):
        code = await _generate_referral_code()
        await db.users.update_one({"id": user["id"]}, {"$set": {"referral_code": code}})
        user["referral_code"] = code
    return _to_public(user)


@router.post("/activity")
async def activity(user: dict = Depends(get_current_user)):
    """Called when the app opens. Returns a one-time, non-punitive nudge if the
    player has been away longer than the configured window, then refreshes
    last_seen. Coins never expire — this is purely an engagement reminder."""
    now = datetime.now(timezone.utc)
    prev = user.get("last_seen_at")
    nudge = False
    days_away = 0
    if prev:
        try:
            gap = now - datetime.fromisoformat(prev)
            days_away = gap.days
            if gap >= timedelta(days=INACTIVITY_NUDGE_DAYS):
                nudge = True
        except ValueError:
            pass
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_seen_at": now.isoformat()}})
    return {"nudge": nudge, "days_away": days_away, "threshold_days": INACTIVITY_NUDGE_DAYS}
