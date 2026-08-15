"""Player profile API.

Self-service (player): read/update own contact, payout + marketing consent.
Super-Admin-only: reveal a player's sensitive details (audit-logged) + a masked
lookup. NO Admin/Manager/Zonal/Support-Helper endpoint exposes these fields.
"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from .. import player_profile_service, storage_service
from ..deps import get_current_user, require_roles
from ..models import PlayerProfileUpdate, Role

router = APIRouter(tags=["profile"])

MAX_QR_BYTES = 5 * 1024 * 1024  # 5MB


# --- Player self-service ---------------------------------------------------
@router.get("/me/profile", dependencies=[Depends(require_roles(Role.PLAYER))])
async def get_my_profile(user: dict = Depends(get_current_user)):
    return await player_profile_service.get_own(user["id"])


@router.put("/me/profile", dependencies=[Depends(require_roles(Role.PLAYER))])
async def update_my_profile(payload: PlayerProfileUpdate, user: dict = Depends(get_current_user)):
    return await player_profile_service.update_own(user["id"], payload)


@router.post("/me/profile/upi-qr", dependencies=[Depends(require_roles(Role.PLAYER))])
async def upload_my_upi_qr(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    """Optional data-capture: player uploads a screenshot of their UPI QR."""
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please upload an image file")
    data = await file.read()
    if len(data) > MAX_QR_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image too large (max 5MB)")
    return await player_profile_service.set_upi_qr(user["id"], data, file.content_type)


@router.get("/me/profile/upi-qr", dependencies=[Depends(require_roles(Role.PLAYER))])
async def get_my_upi_qr(user: dict = Depends(get_current_user)):
    path = await player_profile_service.get_upi_qr_path(user["id"])
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No QR uploaded")
    try:
        data, content_type = await storage_service.get_object(path)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR image unavailable")
    return Response(content=data, media_type=content_type)


@router.delete("/me/profile/upi-qr", dependencies=[Depends(require_roles(Role.PLAYER))])
async def delete_my_upi_qr(user: dict = Depends(get_current_user)):
    return await player_profile_service.clear_upi_qr(user["id"])


# --- Super Admin only ------------------------------------------------------
@router.get("/admin/players/lookup", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def sa_lookup(user: dict = Depends(get_current_user), q: str = Query(default="")):
    return await player_profile_service.lookup(user, q)


@router.get("/admin/players/{player_id}/sensitive", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def sa_sensitive(player_id: str, user: dict = Depends(get_current_user)):
    return await player_profile_service.get_sensitive(user, player_id)


@router.get("/admin/players/{player_id}/upi-qr", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def sa_player_upi_qr(player_id: str):
    """SUPER_ADMIN-only stream of a player's uploaded UPI QR (payout verification)."""
    path = await player_profile_service.get_upi_qr_path(player_id)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No QR uploaded")
    try:
        data, content_type = await storage_service.get_object(path)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR image unavailable")
    return Response(content=data, media_type=content_type)
