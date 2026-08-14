"""Player profile API.

Self-service (player): read/update own contact, payout + marketing consent.
Super-Admin-only: reveal a player's sensitive details (audit-logged) + a masked
lookup. NO Admin/Manager/Zonal/Support-Helper endpoint exposes these fields.
"""
from fastapi import APIRouter, Depends, Query

from .. import player_profile_service
from ..deps import get_current_user, require_roles
from ..models import PlayerProfileUpdate, Role

router = APIRouter(tags=["profile"])


# --- Player self-service ---------------------------------------------------
@router.get("/me/profile", dependencies=[Depends(require_roles(Role.PLAYER))])
async def get_my_profile(user: dict = Depends(get_current_user)):
    return await player_profile_service.get_own(user["id"])


@router.put("/me/profile", dependencies=[Depends(require_roles(Role.PLAYER))])
async def update_my_profile(payload: PlayerProfileUpdate, user: dict = Depends(get_current_user)):
    return await player_profile_service.update_own(user["id"], payload)


# --- Super Admin only ------------------------------------------------------
@router.get("/admin/players/lookup", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def sa_lookup(user: dict = Depends(get_current_user), q: str = Query(default="")):
    return await player_profile_service.lookup(user, q)


@router.get("/admin/players/{player_id}/sensitive", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def sa_sensitive(player_id: str, user: dict = Depends(get_current_user)):
    return await player_profile_service.get_sensitive(user, player_id)
