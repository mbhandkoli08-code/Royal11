"""Lightweight in-app notifications (bell) — per-user feed.

Used for events the player should see explicitly (e.g. a referral reward firing
when a referred friend recharges). Simple uuid-keyed docs; never returns raw
Mongo _id.
"""
import uuid
from datetime import datetime, timezone

from .db import db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.notifications.create_index("id", unique=True)
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])


async def create(user_id: str, type_: str, title: str, body: str,
                 data: dict | None = None, request_id: str | None = None) -> dict:
    """Create a notification. If request_id is given, it's idempotent."""
    if request_id:
        existing = await db.notifications.find_one({"request_id": request_id}, {"_id": 0})
        if existing:
            return existing
    doc = {
        "id": str(uuid.uuid4()), "user_id": user_id, "type": type_,
        "title": title, "body": body, "data": data or {},
        "read": False, "request_id": request_id, "created_at": _now(),
    }
    await db.notifications.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def list_for(user_id: str, limit: int = 30) -> dict:
    items = await db.notifications.find({"user_id": user_id}, {"_id": 0}) \
        .sort("created_at", -1).to_list(limit)
    unread = await db.notifications.count_documents({"user_id": user_id, "read": False})
    return {"items": items, "unread_count": unread}


async def mark_read(user_id: str, ids: list[str] | None = None) -> dict:
    q = {"user_id": user_id, "read": False}
    if ids:
        q["id"] = {"$in": ids}
    res = await db.notifications.update_many(q, {"$set": {"read": True}})
    return {"marked": res.modified_count}
