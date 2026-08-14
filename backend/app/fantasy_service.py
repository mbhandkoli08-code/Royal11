"""Dream11-style Fantasy Cricket — Phase 1 (server-authoritative).

Scores are ALWAYS computed here from real Sportmonks stats after the match —
never submitted by the client. Contest entry fees and winner payouts go through
the wallet ledger idempotently.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

from . import cricket_service, demo_data, wallet_service
from .db import db
from .models import TxnType
from .wallet_service import InsufficientFunds

logger = logging.getLogger(__name__)

# --- Team-builder rules (config-ish; can be lifted to a doc later) ---
BUDGET = 100.0
DEFAULT_CREDIT = 8.5
MAX_PER_TEAM = 7
TEAM_SIZE = 11
CAPTAIN_MULT = 2.0
VICE_MULT = 1.5
ROLE_RANGES = {"WK": (1, 4), "BAT": (3, 6), "AR": (1, 4), "BOWL": (3, 6)}
SETTLE_RETRY_HOURS = 6

# House commission on Fantasy contests: prize pool = total entry fees * (1 - pct/100).
COMMISSION_PCT = 25

DEFAULT_SCORING = {
    "run": 1, "four_bonus": 1, "six_bonus": 2, "fifty_bonus": 8, "century_bonus": 16,
    "duck_penalty": -2, "wicket": 25, "three_wkt_bonus": 4, "five_wkt_bonus": 16,
    "maiden_over": 12, "catch": 8, "stumping": 12, "run_out": 8,
}
DEFAULT_PRIZE_DISTRIBUTION = [{"rank": 1, "pct": 50}, {"rank": 2, "pct": 30}, {"rank": 3, "pct": 20}]


class SettlementNotReady(Exception):
    """Raised when Sportmonks final data isn't available yet — retry later."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def default_prize_pool(entry_fee: int, max_participants: int) -> int:
    """Prize pool after the house commission (used when none is supplied)."""
    return round(entry_fee * max_participants * (100 - COMMISSION_PCT) / 100)


def map_role(position: str) -> str:
    p = (position or "").lower()
    if "keeper" in p or p == "wk":
        return "WK"
    if "all" in p or "rounder" in p:
        return "AR"
    if "bowl" in p:
        return "BOWL"
    return "BAT"


async def ensure_fantasy_indexes() -> None:
    await db.fantasy_player_pool.create_index([("fixture_id", 1), ("player_id", 1)], unique=True)
    await db.fantasy_contests.create_index("fixture_id")
    await db.fantasy_contests.create_index("status")
    await db.fantasy_teams.create_index([("contest_id", 1), ("user_id", 1)], unique=True)


# ---------------------------------------------------------------------------
# Scoring config (Super Admin editable)
# ---------------------------------------------------------------------------
async def get_scoring_config() -> dict:
    doc = await db.fantasy_scoring_config.find_one({"id": "cricket"}, {"_id": 0})
    if not doc:
        return {"id": "cricket", **DEFAULT_SCORING}
    return {**DEFAULT_SCORING, **{k: v for k, v in doc.items() if k in DEFAULT_SCORING}, "id": "cricket"}


async def update_scoring_config(values: dict) -> dict:
    clean = {k: values[k] for k in DEFAULT_SCORING if k in values and values[k] is not None}
    await db.fantasy_scoring_config.update_one(
        {"id": "cricket"}, {"$set": {**clean, "id": "cricket", "updated_at": _now().isoformat()}}, upsert=True)
    return await get_scoring_config()


# ---------------------------------------------------------------------------
# Player pool (built from Sportmonks lineup)
# ---------------------------------------------------------------------------
async def build_player_pool(fixture_id: str) -> dict:
    lineup = await cricket_service.get_fixture_lineup(fixture_id)
    players = lineup.get("players") or []
    if not players:
        raise ValueError("Squad/lineup isn't available for this fixture yet — try again closer to the match.")
    team_names = lineup.get("team_names") or {}
    for p in players:
        role = map_role(p.get("position"))
        await db.fantasy_player_pool.update_one(
            {"fixture_id": fixture_id, "player_id": p["player_id"]},
            {"$set": {
                "fixture_id": fixture_id, "player_id": p["player_id"], "name": p["name"],
                "team_id": p.get("team_id"), "team_name": team_names.get(p.get("team_id")),
                "role": role, "updated_at": _now().isoformat(),
            }, "$setOnInsert": {"credit_value": DEFAULT_CREDIT}},
            upsert=True,
        )
    return {"fixture_id": fixture_id, "match_label": lineup.get("match_label"),
            "starting_at": lineup.get("starting_at"), "player_count": len(players)}


async def get_player_pool(fixture_id: str) -> list[dict]:
    return [p async for p in db.fantasy_player_pool.find({"fixture_id": fixture_id}, {"_id": 0}).sort("role", 1)]


# player→team affiliation must always reflect the CURRENT squad (players change
# teams between seasons/auctions), so we rebuild the pool from the live lineup
# on read — TTL-guarded to avoid hammering Sportmonks on every poll/view.
_POOL_REFRESH_TTL = 60  # seconds
_pool_refreshed_at: dict[str, float] = {}


async def refresh_player_pool(fixture_id: str) -> None:
    now = time.monotonic()
    if now - _pool_refreshed_at.get(fixture_id, 0) < _POOL_REFRESH_TTL:
        return
    _pool_refreshed_at[fixture_id] = now
    try:
        await build_player_pool(fixture_id)  # $sets fresh team_id/team_name/role
    except Exception:  # noqa: BLE001 — lineup not published yet; keep stored pool
        pass


async def set_player_credit(fixture_id: str, player_id: str, credit_value: float) -> dict:
    res = await db.fantasy_player_pool.update_one(
        {"fixture_id": fixture_id, "player_id": player_id},
        {"$set": {"credit_value": float(credit_value), "updated_at": _now().isoformat()}})
    if res.matched_count == 0:
        raise ValueError("Player not in this fixture's pool")
    return {"fixture_id": fixture_id, "player_id": player_id, "credit_value": credit_value}


# ---------------------------------------------------------------------------
# Contest CRUD
# ---------------------------------------------------------------------------
async def create_contest(creator_id: str, fixture_id: str, entry_fee: int, max_participants: int,
                         prize_pool: int, prize_distribution=None, name: str = "") -> dict:
    pool = await build_player_pool(fixture_id)  # ensures a real fixture + squad
    lineup = await cricket_service.get_fixture_lineup(fixture_id)
    # Default the prize pool to entry fees minus the house commission.
    if not prize_pool:
        prize_pool = default_prize_pool(entry_fee, max_participants)
    doc = {
        "id": str(uuid.uuid4()),
        "fixture_id": fixture_id,
        "match_label": pool.get("match_label"),
        "name": name or "Fantasy Contest",
        "created_by": creator_id,
        "entry_fee": entry_fee,
        "max_participants": max_participants,
        "prize_pool": prize_pool,
        "commission_pct": COMMISSION_PCT,
        "prize_distribution": prize_distribution or DEFAULT_PRIZE_DISTRIBUTION,
        "status": "OPEN",
        "lock_at": lineup.get("starting_at"),
        "participant_count": 0,
        "created_at": _now().isoformat(),
    }
    await db.fantasy_contests.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_contests(fixture_id: str = None, only_open: bool = False) -> list[dict]:
    q = {}
    if fixture_id:
        q["fixture_id"] = fixture_id
    if only_open:
        q["status"] = "OPEN"
    return [c async for c in db.fantasy_contests.find(q, {"_id": 0}).sort("created_at", -1)]


async def _lock_if_started(contest: dict) -> dict:
    if contest["status"] == "OPEN" and contest.get("lock_at"):
        try:
            lock = datetime.fromisoformat(contest["lock_at"].replace(" ", "T"))
            if lock.tzinfo is None:
                lock = lock.replace(tzinfo=timezone.utc)
            if _now() >= lock:
                await db.fantasy_contests.update_one({"id": contest["id"]}, {"$set": {"status": "LOCKED"}})
                contest["status"] = "LOCKED"
        except ValueError:
            pass
    return contest


async def contest_detail(contest_id: str, user_id: str = None) -> dict:
    c = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not c:
        raise ValueError("Contest not found")
    c = await _lock_if_started(c)
    my_team = None
    if user_id:
        my_team = await db.fantasy_teams.find_one({"contest_id": contest_id, "user_id": user_id}, {"_id": 0})
    leaderboard = []
    if c["status"] == "SETTLED":
        leaderboard = [t async for t in db.fantasy_teams.find(
            {"contest_id": contest_id}, {"_id": 0, "user_id": 1, "score": 1, "rank": 1, "winnings": 1})
            .sort("rank", 1).limit(50)]
    return {"contest": c, "my_team": my_team, "leaderboard": leaderboard}


# ---------------------------------------------------------------------------
# Join / team validation
# ---------------------------------------------------------------------------
async def _validate_team(fixture_id: str, selections: list[str], captain_id: str, vice_captain_id: str) -> dict:
    if len(selections) != TEAM_SIZE or len(set(selections)) != TEAM_SIZE:
        raise ValueError(f"Pick exactly {TEAM_SIZE} distinct players")
    if captain_id not in selections or vice_captain_id not in selections:
        raise ValueError("Captain and Vice-Captain must be in your team")
    if captain_id == vice_captain_id:
        raise ValueError("Captain and Vice-Captain must be different")
    pool = {p["player_id"]: p async for p in db.fantasy_player_pool.find({"fixture_id": fixture_id}, {"_id": 0})}
    chosen = []
    for pid in selections:
        if pid not in pool:
            raise ValueError("A selected player is not in this match's pool")
        chosen.append(pool[pid])
    credits = round(sum(p.get("credit_value", DEFAULT_CREDIT) for p in chosen), 1)
    if credits > BUDGET:
        raise ValueError(f"Team costs {credits} credits — budget is {BUDGET}")
    # role composition
    counts = {"WK": 0, "BAT": 0, "AR": 0, "BOWL": 0}
    team_counts: dict[str, int] = {}
    for p in chosen:
        counts[p.get("role", "BAT")] = counts.get(p.get("role", "BAT"), 0) + 1
        team_counts[p.get("team_id")] = team_counts.get(p.get("team_id"), 0) + 1
    for role, (lo, hi) in ROLE_RANGES.items():
        if not (lo <= counts[role] <= hi):
            raise ValueError(f"{role} must be between {lo} and {hi} (you have {counts[role]})")
    if max(team_counts.values()) > MAX_PER_TEAM:
        raise ValueError(f"At most {MAX_PER_TEAM} players from one team")
    return {"credits_used": credits}


async def join_contest(user_id: str, contest_id: str, selections: list[str],
                       captain_id: str, vice_captain_id: str) -> dict:
    c = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not c:
        raise ValueError("Contest not found")
    c = await _lock_if_started(c)
    if c["status"] != "OPEN":
        raise ValueError("This contest is closed for entries")
    if await db.fantasy_teams.find_one({"contest_id": contest_id, "user_id": user_id}, {"_id": 0, "id": 1}):
        raise ValueError("You've already joined this contest")
    if c["participant_count"] >= c["max_participants"]:
        raise ValueError("This contest is full")
    v = await _validate_team(c["fixture_id"], selections, captain_id, vice_captain_id)

    balance_after = None
    if c["entry_fee"] > 0:
        try:
            txn = await wallet_service.debit(
                user_id, TxnType.FANTASY_ENTRY, c["entry_fee"], actor_id=user_id,
                reason=f"Fantasy entry: {c.get('name')}", request_id=f"contest_join:{contest_id}:{user_id}")
            balance_after = txn["balance_after"]
        except InsufficientFunds:
            raise ValueError("Not enough coins for the entry fee")

    team = {
        "id": str(uuid.uuid4()), "contest_id": contest_id, "fixture_id": c["fixture_id"],
        "user_id": user_id, "selections": selections, "captain_id": captain_id,
        "vice_captain_id": vice_captain_id, "credits_used": v["credits_used"],
        "score": None, "rank": None, "winnings": 0, "created_at": _now().isoformat(),
    }
    await db.fantasy_teams.insert_one(team)
    await db.fantasy_contests.update_one({"id": contest_id}, {"$inc": {"participant_count": 1}})
    team.pop("_id", None)
    if balance_after is None:
        wallet = await wallet_service.get_or_create_wallet(user_id)
        balance_after = wallet["balance"]
    return {"team": team, "balance": balance_after}


async def my_contests(user_id: str) -> list[dict]:
    out = []
    async for t in db.fantasy_teams.find({"user_id": user_id}, {"_id": 0}).sort("created_at", -1):
        c = await db.fantasy_contests.find_one({"id": t["contest_id"]}, {"_id": 0})
        if c:
            out.append({"contest": c, "team": t})
    return out


# ---------------------------------------------------------------------------
# Points engine (pure) + settlement
# ---------------------------------------------------------------------------
def _num(d: dict, *keys) -> float:
    for k in keys:
        v = d.get(k)
        if isinstance(v, (int, float)):
            return v
    return 0


def _batting_points(b: dict, cfg: dict, role: str) -> float:
    runs = _num(b, "score", "runs")
    fours = _num(b, "four_x", "fours")
    sixes = _num(b, "six_x", "sixes")
    balls = _num(b, "ball", "balls")
    pts = runs * cfg["run"] + fours * cfg["four_bonus"] + sixes * cfg["six_bonus"]
    if runs >= 100:
        pts += cfg["century_bonus"]
    elif runs >= 50:
        pts += cfg["fifty_bonus"]
    # Duck: out for 0 off at least one ball; specialists only.
    if runs == 0 and balls >= 1 and role in ("BAT", "WK", "AR"):
        pts += cfg["duck_penalty"]
    return pts


def _bowling_points(b: dict, cfg: dict) -> float:
    wk = _num(b, "wickets")
    maidens = _num(b, "medians", "maidens", "maiden")
    pts = wk * cfg["wicket"] + maidens * cfg["maiden_over"]
    if wk >= 5:
        pts += cfg["five_wkt_bonus"]
    elif wk >= 3:
        pts += cfg["three_wkt_bonus"]
    return pts


def compute_player_points(batting: list, bowling: list, cfg: dict, roles: dict) -> dict:
    """player_id -> fantasy points from real Sportmonks stats."""
    points: dict[str, float] = {}
    for b in batting:
        pid = str(b.get("player_id") or b.get("id") or "")
        if not pid:
            continue
        points[pid] = points.get(pid, 0) + _batting_points(b, cfg, roles.get(pid, "BAT"))
    for b in bowling:
        pid = str(b.get("player_id") or b.get("id") or "")
        if not pid:
            continue
        points[pid] = points.get(pid, 0) + _bowling_points(b, cfg)
    return points


def _team_score(team: dict, points: dict) -> float:
    total = sum(points.get(pid, 0) for pid in team["selections"])
    total += points.get(team["captain_id"], 0) * (CAPTAIN_MULT - 1)
    total += points.get(team["vice_captain_id"], 0) * (VICE_MULT - 1)
    return round(total, 1)


async def settle_contest(contest_id: str) -> dict:
    c = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not c:
        raise ValueError("Contest not found")
    if c["status"] == "SETTLED":
        return {"contest_id": contest_id, "status": "SETTLED", "already": True}

    stats = await cricket_service.get_fixture_stats(c["fixture_id"])
    if not stats.get("finished") or (not stats["batting"] and not stats["bowling"]):
        raise SettlementNotReady(f"Sportmonks final stats not ready for fixture {c['fixture_id']}")

    cfg = await get_scoring_config()
    roles = {p["player_id"]: p.get("role", "BAT") async for p in db.fantasy_player_pool.find({"fixture_id": c["fixture_id"]}, {"_id": 0, "player_id": 1, "role": 1})}
    points = compute_player_points(stats["batting"], stats["bowling"], cfg, roles)

    teams = [t async for t in db.fantasy_teams.find({"contest_id": contest_id}, {"_id": 0})]
    for t in teams:
        t["_score"] = _team_score(t, points)
    teams.sort(key=lambda t: (-t["_score"], t["created_at"]))

    dist = {d["rank"]: d["pct"] for d in (c.get("prize_distribution") or DEFAULT_PRIZE_DISTRIBUTION)}
    for i, t in enumerate(teams):
        rank = i + 1
        winnings = round(c["prize_pool"] * dist.get(rank, 0) / 100)
        await db.fantasy_teams.update_one({"id": t["id"]}, {"$set": {
            "score": t["_score"], "rank": rank, "winnings": winnings}})
        if winnings > 0:
            await wallet_service.credit(
                t["user_id"], TxnType.FANTASY_REWARD, winnings, actor_id="system",
                reason=f"Fantasy winnings — rank {rank} in {c.get('name')}",
                request_id=f"contest_payout:{contest_id}:{t['user_id']}")

    await db.fantasy_contests.update_one({"id": contest_id}, {"$set": {
        "status": "SETTLED", "settled_at": _now().isoformat()}})
    return {"contest_id": contest_id, "status": "SETTLED", "teams_scored": len(teams)}


async def cancel_contest(contest_id: str) -> dict:
    c = await db.fantasy_contests.find_one({"id": contest_id}, {"_id": 0})
    if not c:
        raise ValueError("Contest not found")
    if c["status"] in ("SETTLED", "CANCELLED"):
        raise ValueError(f"Contest already {c['status'].lower()}")
    # Refund every entry (idempotent).
    async for t in db.fantasy_teams.find({"contest_id": contest_id}, {"_id": 0}):
        await wallet_service.credit(
            t["user_id"], TxnType.FANTASY_REWARD, c["entry_fee"], actor_id="system",
            reason=f"Refund — {c.get('name')} cancelled",
            request_id=f"contest_refund:{contest_id}:{t['user_id']}")
    await db.fantasy_contests.update_one({"id": contest_id}, {"$set": {"status": "CANCELLED", "cancelled_at": _now().isoformat()}})
    return {"contest_id": contest_id, "status": "CANCELLED"}


async def settle_due_contests() -> dict:
    """Scheduler: settle contests whose match ended >=30 min ago. Retries on
    not-ready; after SETTLE_RETRY_HOURS marks NEEDS_REVIEW (never pays partial)."""
    settled = review = 0
    async for c in db.fantasy_contests.find({"status": {"$in": ["OPEN", "LOCKED"]}}, {"_id": 0}):
        lock_at = c.get("lock_at")
        if not lock_at:
            continue
        try:
            start = datetime.fromisoformat(lock_at.replace(" ", "T"))
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        # A match runs a few hours; only attempt settlement ~30 min after a
        # generous match window, and always re-check Sportmonks 'finished'.
        if _now() < start + timedelta(hours=3, minutes=30):
            continue
        try:
            await settle_contest(c["id"])
            settled += 1
        except SettlementNotReady:
            if _now() > start + timedelta(hours=3, minutes=30) + timedelta(hours=SETTLE_RETRY_HOURS):
                await db.fantasy_contests.update_one({"id": c["id"]}, {"$set": {"status": "NEEDS_REVIEW"}})
                review += 1
        except Exception as e:  # noqa: BLE001
            logger.error(f"settle_contest {c['id']} error: {type(e).__name__}")
    return {"settled": settled, "needs_review": review}


# ---------------------------------------------------------------------------
# Demo seeding — makes the whole Fantasy flow testable without live fixtures
# ---------------------------------------------------------------------------
_DEMO_CONTESTS = [
    {"id": "demo-contest-mega", "name": "Mega Contest", "entry_fee": 50, "max_participants": 1000},
    {"id": "demo-contest-h2h", "name": "Head to Head", "entry_fee": 100, "max_participants": 2},
    {"id": "demo-contest-free", "name": "Free Practice", "entry_fee": 0, "max_participants": 100,
     "prize_pool": 500},
]


async def ensure_demo_fantasy() -> None:
    """Idempotently seed the demo fixture's player pool + a few contests so the
    Fantasy lobby is never empty on the Sportmonks free tier."""
    fid = demo_data.DEMO_FIXTURE_ID
    try:
        await build_player_pool(fid)  # uses the demo lineup fallback
    except ValueError:
        return
    lineup = await cricket_service.get_fixture_lineup(fid)
    for spec in _DEMO_CONTESTS:
        prize = spec.get("prize_pool")
        if prize is None:
            prize = default_prize_pool(spec["entry_fee"], spec["max_participants"])
        await db.fantasy_contests.update_one(
            {"id": spec["id"]},
            {"$setOnInsert": {
                "id": spec["id"],
                "fixture_id": fid,
                "match_label": demo_data.MATCH_LABEL,
                "name": spec["name"],
                "created_by": "system",
                "entry_fee": spec["entry_fee"],
                "max_participants": spec["max_participants"],
                "prize_pool": prize,
                "commission_pct": COMMISSION_PCT,
                "prize_distribution": DEFAULT_PRIZE_DISTRIBUTION,
                "status": "OPEN",
                "lock_at": lineup.get("starting_at"),
                "participant_count": 0,
                "created_at": _now().isoformat(),
                "demo": True,
            }},
            upsert=True,
        )
    # Repair stale demo state on restart: refresh the (far-future) lock time and
    # reopen any contest that auto-locked, so the demo is always joinable.
    await db.fantasy_contests.update_many(
        {"fixture_id": fid}, {"$set": {"lock_at": lineup.get("starting_at")}})
    await db.fantasy_contests.update_many(
        {"fixture_id": fid, "status": "LOCKED"}, {"$set": {"status": "OPEN"}})
    logger.info("Demo fantasy fixture + contests ensured")
