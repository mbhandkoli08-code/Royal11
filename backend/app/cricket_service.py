"""Server-side Sportmonks Cricket API integration.

The Sportmonks API token (SPORTMONKS_CRICKET_API_KEY) is read from the
environment and used ONLY here — it is never sent to the frontend. Responses
are normalized to a small shape the UI understands and cached in-memory for a
short TTL to avoid hitting rate limits when many players load the app at once.

Security: httpx error strings can contain the request URL (which includes the
api_token), so we NEVER log exception messages — only the exception type.
"""
import logging
import os
import time
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)

BASE = "https://cricket.sportmonks.com/api/v2.0"
CACHE_TTL_SECONDS = 45
_INCLUDES = "localteam,visitorteam,runs"

# key -> (expires_at_monotonic, payload)
_cache: dict[str, tuple[float, dict]] = {}


def _token() -> str | None:
    return os.environ.get("SPORTMONKS_CRICKET_API_KEY")


def _team_score(runs: list, team_id) -> dict:
    entries = [r for r in (runs or []) if r.get("team_id") == team_id]
    if not entries:
        return {"score": "", "ov": ""}
    last = sorted(entries, key=lambda r: r.get("inning", 0))[-1]
    score, wk, ov = last.get("score"), last.get("wickets"), last.get("overs")
    return {
        "score": f"{score}/{wk}" if score is not None else "",
        "ov": str(ov) if ov is not None else "",
    }


def normalize(fx: dict) -> dict:
    lt = fx.get("localteam") or {}
    vt = fx.get("visitorteam") or {}
    runs = fx.get("runs") or []
    a = _team_score(runs, fx.get("localteam_id"))
    b = _team_score(runs, fx.get("visitorteam_id"))
    return {
        "id": str(fx.get("id")),
        "sport": f"Cricket · {fx.get('type') or 'Match'}",
        "league": fx.get("round") or fx.get("type") or "Cricket",
        "teamA": {"name": lt.get("code") or lt.get("name") or "TBD",
                  "full": lt.get("name"), "image": lt.get("image_path"), **a},
        "teamB": {"name": vt.get("code") or vt.get("name") or "TBD",
                  "full": vt.get("name"), "image": vt.get("image_path"), **b},
        "note": fx.get("note") or fx.get("status") or "",
        "status": fx.get("status"),
        "live": bool(fx.get("live")),
        "starting_at": fx.get("starting_at"),
    }


async def _fetch(path: str, extra: dict) -> list:
    token = _token()
    if not token:
        raise RuntimeError("SPORTMONKS_CRICKET_API_KEY not configured")
    params = {"api_token": token, "include": _INCLUDES, **extra}
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(f"{BASE}/{path}", params=params)
        r.raise_for_status()
        data = r.json().get("data", [])
        return data if isinstance(data, list) else []


async def _payload(cache_key: str, path: str, extra: dict,
                   limit: int | None = None, sort_recent: bool = False) -> dict:
    now = time.monotonic()
    hit = _cache.get(cache_key)
    if hit and hit[0] > now:
        return hit[1]
    try:
        rows = await _fetch(path, extra)
        matches = [normalize(fx) for fx in rows]
        if sort_recent:
            matches.sort(key=lambda m: m.get("starting_at") or "", reverse=True)
        if limit:
            matches = matches[:limit]
        payload = {
            "status": "ok",
            "matches": matches,
            "count": len(matches),
            "cached_at": datetime.now(timezone.utc).isoformat(),
        }
        _cache[cache_key] = (now + CACHE_TTL_SECONDS, payload)
        return payload
    except Exception as exc:  # noqa: BLE001 — never leak the token in logs
        code = getattr(getattr(exc, "response", None), "status_code", None)
        logger.error("Sportmonks %s failed: %s%s", path, type(exc).__name__,
                     f" (HTTP {code})" if code else "")
        if hit:  # serve last good data if we have it
            return hit[1]
        return {"status": "unavailable", "matches": [], "count": 0,
                "message": "Live scores temporarily unavailable"}


async def get_live() -> dict:
    return await _payload("live", "livescores", {})


async def get_matches() -> dict:
    return await _payload("matches", "fixtures", {"sort": "-starting_at"},
                          limit=20, sort_recent=True)
