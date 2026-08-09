"""FastAPI dependencies: current-user resolution and role guards.

require_roles(...) is what every admin-hierarchy endpoint should depend on
instead of hand-rolling a role check — one place to get it right.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import db
from .models import Role
from .security import decode_access_token

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)) -> dict:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_access_token(creds.credentials)
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User no longer exists")
    if user["status"] != "ACTIVE":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    return user


def require_roles(*roles: Role):
    allowed = {r.value for r in roles}

    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user["role"] not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient role permissions")
        return user

    return _checker
