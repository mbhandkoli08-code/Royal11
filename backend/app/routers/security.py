"""Super Admin security surface — brute-force login alerts."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from .. import login_security
from ..audit import log_action
from ..deps import get_current_user, require_roles
from ..models import Role

router = APIRouter(prefix="/admin/security", tags=["security"])


@router.get("/login-alerts", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def login_alerts():
    """Accounts that recently hit a brute-force lockout (suspicious activity)."""
    return await login_security.list_alerts()


class ResolveRequest(BaseModel):
    email: EmailStr


@router.post("/login-alerts/resolve", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def resolve_alert(payload: ResolveRequest, caller: dict = Depends(get_current_user)):
    ok = await login_security.resolve_alert(payload.email.strip().lower())
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No alert for that email")
    await log_action(caller["id"], "SECURITY_ALERT_RESOLVED", target_type="security_alert",
                     target_id=payload.email)
    return {"resolved": True, "email": payload.email}
