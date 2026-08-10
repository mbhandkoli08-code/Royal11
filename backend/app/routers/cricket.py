"""Public cricket data endpoints backed by Sportmonks (server-side only).

The frontend calls ONLY these endpoints — it never talks to Sportmonks or sees
the API token. Responses are cached briefly in cricket_service.
"""
from fastapi import APIRouter

from ..cricket_service import get_live, get_matches

router = APIRouter(prefix="/cricket", tags=["cricket"])


@router.get("/live")
async def cricket_live():
    return await get_live()


@router.get("/matches")
async def cricket_matches():
    return await get_matches()
