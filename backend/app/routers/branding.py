"""Per-Admin login branding endpoints.

- Admin manages their OWN branding (/api/admin/branding*).
- Super Admin manages any Admin's branding (/api/admin/admins/{id}/branding*).
- Public, unauthenticated read for the branded login page (/api/public/branding/*).
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from .. import branding_service
from ..audit import log_action
from ..deps import get_current_user, require_not_suspended, require_roles
from ..models import Role

router = APIRouter(prefix="/admin", tags=["branding"])
public_router = APIRouter(prefix="/public", tags=["branding-public"])

LOGO_MAX = branding_service.LOGO_MAX_BYTES


class BrandingRequest(BaseModel):
    brand_name: str = Field(min_length=1, max_length=80)
    slug: str | None = Field(default=None, max_length=60)


async def _read_logo(file: UploadFile) -> tuple[bytes, str, str]:
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be an image")
    data = await file.read()
    if len(data) > LOGO_MAX:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be under 4 MB")
    return data, file.content_type, file.filename or "logo.png"


# ------------------------------- Admin (self) -------------------------------
@router.get("/branding", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_branding(caller: dict = Depends(get_current_user)):
    return await branding_service.get_branding(caller["id"])


@router.put("/branding",
            dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def set_my_branding(payload: BrandingRequest, caller: dict = Depends(get_current_user)):
    try:
        res = await branding_service.set_branding(caller["id"], payload.brand_name, payload.slug)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "BRANDING_UPDATED", target_type="user", target_id=caller["id"])
    return res


@router.post("/branding/logo",
             dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def set_my_logo(logo: UploadFile = File(...), caller: dict = Depends(get_current_user)):
    data, ct, fn = await _read_logo(logo)
    try:
        res = await branding_service.set_logo(caller["id"], data, ct, fn)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "BRANDING_LOGO_UPDATED", target_type="user", target_id=caller["id"])
    return res


# --------------------------- Super Admin (any Admin) ---------------------------
@router.get("/admins/{admin_id}/branding",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def admin_branding(admin_id: str):
    try:
        return await branding_service.get_branding(admin_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e))


@router.put("/admins/{admin_id}/branding",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_admin_branding(admin_id: str, payload: BrandingRequest,
                             caller: dict = Depends(get_current_user)):
    try:
        res = await branding_service.set_branding(admin_id, payload.brand_name, payload.slug)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "BRANDING_UPDATED", target_type="user", target_id=admin_id)
    return res


@router.post("/admins/{admin_id}/branding/logo",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_admin_logo(admin_id: str, logo: UploadFile = File(...),
                         caller: dict = Depends(get_current_user)):
    data, ct, fn = await _read_logo(logo)
    try:
        res = await branding_service.set_logo(admin_id, data, ct, fn)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "BRANDING_LOGO_UPDATED", target_type="user", target_id=admin_id)
    return res


# ------------------------------- Public -------------------------------
@public_router.get("/branding/{slug}")
async def public_branding(slug: str):
    data = await branding_service.get_public_branding(slug)
    if not data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No branding for this link")
    return data


@public_router.get("/branding/{slug}/logo")
async def public_branding_logo(slug: str):
    result = await branding_service.get_public_logo(slug)
    if not result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No logo")
    data, content_type = result
    return Response(content=data, media_type=content_type,
                    headers={"Cache-Control": "public, max-age=300"})
