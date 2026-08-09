"""Password hashing and JWT helpers.

Kept in one small file so the part of the app a security review should read
first is easy to find. Nothing outside auth.py / deps.py should need to touch
this directly.
"""
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from passlib.context import CryptContext

logger = logging.getLogger(__name__)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.environ.get("JWT_SECRET_KEY")
if not JWT_SECRET:
    # Don't crash local/dev boot before .env is wired up, but make it very
    # obvious this must not ship to a real deployment like this.
    logger.warning(
        "JWT_SECRET_KEY is not set in the environment — using an insecure "
        "development-only fallback. Set JWT_SECRET_KEY in backend/.env "
        "before deploying anywhere real."
    )
    JWT_SECRET = "dev-only-insecure-secret-change-me"

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": user_id, "role": role, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
