import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, wallet_service, login_security, otp_service, password_reset_service
from ..audit import log_action
from ..constants import INACTIVITY_NUDGE_DAYS
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
        try:
            from .. import referral_service
            await referral_service.register_referral(user, ref)
        except Exception:
            pass  # referral is best-effort; never blocks activation
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
    token = create_access_token(user["id"], user["role"], remember=payload.remember_me)
    return TokenResponse(access_token=token, user=_to_public(user))


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


GENERIC_RESET_MSG = "If an account exists for this email, we've sent a reset code."


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordRequest):
    """Emails a 6-digit reset code — but ALWAYS returns the same generic message
    so callers can't probe which emails exist (anti-enumeration)."""
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email}, {"_id": 0, "status": 1})
    # Only act for real accounts that can actually sign in. Pending-verification
    # accounts must finish registration OTP first (different flow).
    if user and user["status"] != UserStatus.PENDING_VERIFICATION.value:
        ok, _retry = await password_reset_service.can_resend(email)
        if ok:
            await password_reset_service.create_and_send(email)
    return {"status": "ok", "message": GENERIC_RESET_MSG}


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8)


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest):
    """Verify the single-use OTP, set the new password, and stamp
    password_changed_at so every previously-issued token is rejected going
    forward (see deps.get_current_user)."""
    email = payload.email.strip().lower()
    user = await db.users.find_one({"email": email})
    # Verify FIRST so a wrong/expired code returns the same error whether or not
    # the account exists (still anti-enumeration on this step).
    try:
        await password_reset_service.verify(email, payload.code.strip())
    except password_reset_service.OtpError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    if not user:
        # Code somehow existed without a user — treat as invalid.
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid reset request.")
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.users.update_one({"id": user["id"]}, {"$set": {
        "password_hash": hash_password(payload.new_password),
        "password_changed_at": now_iso,
    }})
    # Clear any brute-force lockout so the user can log in immediately.
    try:
        await login_security.clear_on_success(email, None)
    except Exception:
        pass
    await log_action(user["id"], "PASSWORD_RESET", target_type="user", target_id=user["id"])
    return {"status": "ok", "message": "Password reset. Please sign in with your new password."}


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    # Backfill a referral code for older accounts that predate the feature.
    if user["role"] == Role.PLAYER.value and not user.get("referral_code"):
        code = await _generate_referral_code()
        await db.users.update_one({"id": user["id"]}, {"$set": {"referral_code": code}})
        user["referral_code"] = code
    return _to_public(user)


CONSOLE_THEMES = {"default", "dark", "sky", "navy"}


class ConsoleThemeRequest(BaseModel):
    theme: str


@router.put("/console-theme")
async def set_console_theme(payload: ConsoleThemeRequest, user: dict = Depends(get_current_user)):
    theme = payload.theme if payload.theme in CONSOLE_THEMES else "default"
    await db.users.update_one({"id": user["id"]}, {"$set": {"console_theme": theme}})
    return {"console_theme": theme}


RUMMY_THEMES = {"luxury", "red_felt", "green_felt"}


class RummyThemeRequest(BaseModel):
    theme: str


@router.put("/rummy-theme")
async def set_rummy_theme(payload: RummyThemeRequest, user: dict = Depends(get_current_user)):
    theme = payload.theme if payload.theme in RUMMY_THEMES else "luxury"
    await db.users.update_one({"id": user["id"]}, {"$set": {"rummy_theme": theme}})
    return {"rummy_theme": theme}


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
