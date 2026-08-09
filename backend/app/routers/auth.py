import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pymongo.errors import DuplicateKeyError

from .. import assignment_service, wallet_service
from ..audit import log_action
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

    await log_action(user["id"], "PLAYER_CREATED", target_type="user", target_id=user["id"],
                     metadata={"auto_assigned_admin_id": admin_id})

    token = create_access_token(user["id"], user["role"])
    return TokenResponse(access_token=token, user=_to_public(user))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    user = await db.users.find_one({"email": payload.email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if user["status"] != UserStatus.ACTIVE.value:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    token = create_access_token(user["id"], user["role"])
    return TokenResponse(access_token=token, user=_to_public(user))


@router.get("/me", response_model=UserPublic)
async def me(user: dict = Depends(get_current_user)):
    return _to_public(user)
