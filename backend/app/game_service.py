"""Player game economy — Lucky Spin, Rewards Store, Boosts, Contest entries.

Every coin movement goes through the server-authoritative wallet ledger. Prizes,
prices and entry fees are decided HERE (never trusted from the client), so a
tampered request can't mint coins or buy items for free. Inventory lives in
`player_inventory` (one doc per player).
"""
import random
import uuid
from datetime import datetime, timedelta, timezone

from . import wallet_service
from .db import db
from .models import TxnType
from .wallet_service import InsufficientFunds

# --- Authoritative catalog (mirrors frontend lib/data.js for display) ---
SPIN_COST = 150
SPIN_PRIZES = [50, 200, 0, 500, 100, 1000, 75, 300]

STORE_ITEMS = {
    "av1": {"type": "avatar", "name": "Neon Striker", "price": 300},
    "av2": {"type": "avatar", "name": "Golden Captain", "price": 800},
    "av3": {"type": "avatar", "name": "Pixel Pro", "price": 500},
    "bd1": {"type": "badge", "name": "MVP Badge", "price": 400},
    "bd2": {"type": "badge", "name": "Streak Master", "price": 600},
    "bd3": {"type": "badge", "name": "Champion", "price": 1000},
    "bo1": {"type": "boost", "name": "2x Coins Boost", "price": 250, "boost_seconds": 60},
    "bo2": {"type": "boost", "name": "XP Booster", "price": 350},
    "bo4": {"type": "boost", "name": "Mega 2x Boost", "price": 900, "boost_seconds": 300},
}

CONTESTS = {"ipl_grand_league": {"name": "IPL Grand League", "entry_fee": 100}}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _inventory_doc(player_id: str) -> dict:
    return await db.player_inventory.find_one({"player_id": player_id}, {"_id": 0}) or {
        "player_id": player_id, "owned_items": [], "equipped_avatar_id": None, "boost_until": None,
    }


async def get_inventory(player_id: str) -> dict:
    inv = await _inventory_doc(player_id)
    inv.pop("_id", None)
    return {
        "owned_items": inv.get("owned_items", []),
        "equipped_avatar_id": inv.get("equipped_avatar_id"),
        "boost_until": inv.get("boost_until"),
    }


async def spin(player_id: str) -> dict:
    """Debit the spin cost, then credit a server-chosen prize. Each spin is a
    distinct event (fresh request_ids)."""
    base = uuid.uuid4().hex
    try:
        await wallet_service.debit(player_id, TxnType.GAME_ENTRY, SPIN_COST,
                                   actor_id=player_id, reason="Lucky Spin", request_id=f"spin:{base}:entry")
    except InsufficientFunds:
        raise ValueError("Not enough coins to spin")
    prize = random.choice(SPIN_PRIZES)
    if prize > 0:
        txn = await wallet_service.credit(player_id, TxnType.GAME_REWARD, prize,
                                          actor_id=player_id, reason="Lucky Spin win",
                                          request_id=f"spin:{base}:reward")
        balance = txn["balance_after"]
    else:
        w = await db.wallets.find_one({"user_id": player_id}, {"_id": 0, "balance": 1})
        balance = w["balance"] if w else 0
    return {"prize": prize, "won": prize, "balance": balance}


async def buy_item(player_id: str, item_id: str) -> dict:
    item = STORE_ITEMS.get(item_id)
    if not item:
        raise ValueError("Unknown item")
    inv = await _inventory_doc(player_id)
    owned = inv.get("owned_items", [])
    # Avatars/badges are one-time; boosts are consumable (repeatable).
    if item["type"] in ("avatar", "badge") and item_id in owned:
        raise ValueError("You already own this item")

    try:
        txn = await wallet_service.debit(player_id, TxnType.STORE_PURCHASE, item["price"],
                                         actor_id=player_id, reason=f"Store: {item['name']}",
                                         request_id=f"store:{player_id}:{item_id}:{uuid.uuid4().hex}"
                                         if item["type"] == "boost" else f"store:{player_id}:{item_id}")
    except InsufficientFunds:
        raise ValueError("Not enough coins for this item")

    update: dict = {"$set": {"player_id": player_id, "updated_at": _now()}}
    if item["type"] in ("avatar", "badge"):
        update["$addToSet"] = {"owned_items": item_id}
    if item["type"] == "boost" and item.get("boost_seconds"):
        until = datetime.now(timezone.utc) + timedelta(seconds=item["boost_seconds"])
        update["$set"]["boost_until"] = until.isoformat()
    await db.player_inventory.update_one({"player_id": player_id}, update, upsert=True)
    return {"item_id": item_id, "balance": txn["balance_after"], "inventory": await get_inventory(player_id)}


async def equip_avatar(player_id: str, item_id: str) -> dict:
    inv = await _inventory_doc(player_id)
    if item_id not in inv.get("owned_items", []):
        raise ValueError("You don't own this avatar")
    await db.player_inventory.update_one(
        {"player_id": player_id}, {"$set": {"equipped_avatar_id": item_id, "updated_at": _now()}}, upsert=True)
    return {"equipped_avatar_id": item_id}


async def join_contest(player_id: str, contest_id: str) -> dict:
    contest = CONTESTS.get(contest_id)
    if not contest:
        raise ValueError("Unknown contest")
    existing = await db.contest_entries.find_one({"player_id": player_id, "contest_id": contest_id}, {"_id": 0})
    if existing:
        raise ValueError("You've already joined this contest")
    try:
        txn = await wallet_service.debit(player_id, TxnType.FANTASY_ENTRY, contest["entry_fee"],
                                         actor_id=player_id, reason=f"Contest: {contest['name']}",
                                         request_id=f"contest:{player_id}:{contest_id}")
    except InsufficientFunds:
        raise ValueError("Not enough coins to join this contest")
    await db.contest_entries.insert_one({
        "id": str(uuid.uuid4()), "player_id": player_id, "contest_id": contest_id,
        "entry_fee": contest["entry_fee"], "created_at": _now(),
    })
    return {"contest_id": contest_id, "balance": txn["balance_after"]}
