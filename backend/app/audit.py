"""Audit log — spec Section 11: every important admin action must leave an
auditable trail (PLAYER_CREATED, COIN_GRANTED, ADMIN_DISABLED, ...).
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import db


async def log_action(actor_id: Optional[str], action: str, *,
                     target_type: Optional[str] = None,
                     target_id: Optional[str] = None,
                     metadata: Optional[dict] = None) -> None:
    await db.audit_logs.insert_one({
        "id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
