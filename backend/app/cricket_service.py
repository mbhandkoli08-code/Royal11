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


async def _fetch_one(path: str, extra: dict) -> dict:
    """Fetch a single Sportmonks resource (returns the `data` object, not list)."""
    token = _token()
    if not token:
        raise RuntimeError("SPORTMONKS_CRICKET_API_KEY not configured")
    params = {"api_token": token, **extra}
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(f"{BASE}/{path}", params=params)
            r.raise_for_status()
            data = r.json().get("data", {})
            return data if isinstance(data, dict) else {}
    except (httpx.HTTPError, ValueError) as exc:
        # Unknown fixture / Sportmonks hiccup → treat as "no data" so callers
        # degrade gracefully (e.g. contest creation → clean 400, settlement → retry).
        logger.warning(f"Sportmonks fetch {path} failed: {type(exc).__name__}")
        return {}


async def get_upcoming_fixtures(limit: int = 25) -> dict:
    """Fixtures that haven't finished yet — candidates for fantasy contests."""
    payload = await _payload("upcoming", "fixtures", {"sort": "starting_at",
                             "filter[status]": "NS"}, limit=limit)
    return payload


async def get_fixture_lineup(fixture_id: str) -> dict:
    """Squad/lineup for a fixture -> normalized selectable players with roles."""
    fx = await _fetch_one(f"fixtures/{fixture_id}", {"include": "lineup,localteam,visitorteam"})
    lt, vt = fx.get("localteam") or {}, fx.get("visitorteam") or {}
    team_names = {lt.get("id"): lt.get("name"), vt.get("id"): vt.get("name")}
    players = []
    for p in (fx.get("lineup") or []):
        pos = p.get("position")
        pos_name = pos.get("name") if isinstance(pos, dict) else (pos or "")
        players.append({
            "player_id": str(p.get("player_id") or p.get("id")),
            "name": p.get("fullname") or p.get("name") or "Unknown",
            "team_id": str(p.get("lineup", {}).get("team_id") if isinstance(p.get("lineup"), dict) else p.get("team_id") or ""),
            "position": pos_name or "",
        })
    return {
        "fixture_id": str(fx.get("id")),
        "starting_at": fx.get("starting_at"),
        "status": fx.get("status"),
        "match_label": f"{lt.get('name', 'TBD')} vs {vt.get('name', 'TBD')}",
        "team_names": {str(k): v for k, v in team_names.items() if k},
        "players": players,
    }


# Sportmonks statuses that mean the match is truly over (safe to settle).
FINISHED_STATUSES = {"Finished", "Aban.", "Cancl.", "Postp.", "Awarded"}


async def get_fixture_stats(fixture_id: str) -> dict:
    """Final per-player batting/bowling stats for settlement."""
    fx = await _fetch_one(f"fixtures/{fixture_id}",
                          {"include": "batting,bowling,localteam,visitorteam"})
    return {
        "fixture_id": str(fx.get("id")),
        "status": fx.get("status"),
        "finished": fx.get("status") in FINISHED_STATUSES,
        "batting": fx.get("batting") or [],
        "bowling": fx.get("bowling") or [],
    }
