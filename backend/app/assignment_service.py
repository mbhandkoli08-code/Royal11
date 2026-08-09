"""Player -> Admin assignment and capacity — spec Section 4.

Known limitation: auto_assign_player's capacity check (count, then insert) has a
small race window under concurrent registrations — two players could both see a
free slot and both land on the same Admin, exceeding capacity by a small margin.
Hardening this to a single atomic operation (e.g. an admin-side counter updated
with $inc + a conditional check) is a Part 8 item; noted here rather than
silently shipped as if it were airtight.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import db


async def auto_assign_player(player_id: str) -> Optional[str]:
    """Assign a newly-registered player to any Admin with spare capacity.
    Returns the assigned admin_id, or None if every Admin is full (the player
    stays unassigned until a Manager/Super Admin assigns them).
    """
    async for alloc in db.admin_allocations.find({}, {"_id": 0}):
        current = await db.player_assignments.count_documents({"admin_id": alloc["user_id"]})
        if current < alloc["player_capacity"]:
            await assign_player(player_id, alloc["user_id"],
                                changed_by_id="system:auto-assign",
                                reason="Auto-assigned at registration")
            return alloc["user_id"]
    return None


async def assign_player(player_id: str, admin_id: str, *, changed_by_id: str,
                        reason: Optional[str] = None) -> dict:
    existing = await db.player_assignments.find_one({"player_id": player_id}, {"_id": 0})
    from_admin_id = existing["admin_id"] if existing else None

    doc = {
        "id": existing["id"] if existing else str(uuid.uuid4()),
        "player_id": player_id,
        "admin_id": admin_id,
        "assigned_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.player_assignments.update_one({"player_id": player_id}, {"$set": doc}, upsert=True)

    await db.player_assignment_history.insert_one({
        "id": str(uuid.uuid4()),
        "player_id": player_id,
        "from_admin_id": from_admin_id,
        "to_admin_id": admin_id,
        "changed_by_id": changed_by_id,
        "reason": reason,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return doc
