import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, wallet_service
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


@router.post("/register", response_model=TokenResponse)
async def register(payload: RegisterRequest):
    """Public self-signup always creates a PLAYER. Managers/Admins are created
    by Super Admin/Manager through the admin router — never here, so there's no
    way to self-elevate through this endpoint."""
    user = {
        "id": str(uuid.uuid4()),
        "email": payload.email,
        "password_hash": hash_password(payload.password),
        "display_name": payload.display_name,
        "role": Role.PLAYER.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": None,
        "referral_code": await _generate_referral_code(),
        "referred_by": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    await wallet_service.get_or_create_wallet(user["id"])
    await wallet_service.credit(
        user["id"], TxnType.WELCOME_BONUS, WELCOME_BONUS_AMOUNT,
        reason="Welcome bonus", request_id=f"welcome:{user['id']}",
    )
    admin_id = await assignment_service.auto_assign_player(user["id"])

    # Reward the referrer (idempotent on the new user's id).
    if payload.referral_code:
        await _credit_referrer(payload.referral_code.strip().upper(), user["id"])

    await log_action(user["id"], "PLAYER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"auto_assigned_admin_id": admin_id})

    token = create_access_token(user["id"], user["role"])
    return TokenResponse(access_token=token, user=_to_public(user))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = await db.users.find_one({"email": payload.email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if user["status"] == UserStatus.DISABLED.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
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
