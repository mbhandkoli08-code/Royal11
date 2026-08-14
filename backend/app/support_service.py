"""Support / Complaints ticket system + the Support Helper staff role.

Tickets default-route to the raising player's assigned Admin. Support Helpers
(a lightweight, non-financial role parented to an Admin) plus the upline
(Manager -> Zonal -> Super Admin) can view/respond within their scope. Tickets
can be escalated up the hierarchy manually.

Support Helpers can ONLY touch tickets + read basic player context — they are
never added to any financial/admin router allowlist, so those endpoints reject
them by role automatically.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from pymongo.errors import DuplicateKeyError

from . import wallet_service
from .audit import log_action
from .db import db
from .models import Role, TicketCategory, TicketPriority, TicketStatus, UserStatus
from .security import hash_password

HIGH_PRIORITY_CATEGORIES = {TicketCategory.DEPOSIT.value, TicketCategory.WITHDRAWAL.value}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ticket_no() -> str:
    return "R11-" + uuid.uuid4().hex[:6].upper()


async def ensure_support_indexes() -> None:
    await db.support_tickets.create_index("ticket_no", unique=True)
    await db.support_tickets.create_index("player_id")
    await db.support_tickets.create_index("assigned_admin_id")
    await db.support_tickets.create_index("status")
    await db.support_tickets.create_index("escalated_to")
    await db.support_ticket_messages.create_index("ticket_id")


# ---------------------------------------------------------------------------
# Scope resolution
# ---------------------------------------------------------------------------
async def _scope_admin_ids(user: dict):
    """Which Admins' tickets a staff caller may see. None = platform-wide (SA).
    A list = that staff member's downline Admin ids."""
    role = user.get("role")
    if role == Role.SUPER_ADMIN.value:
        return None
    if role == Role.ADMIN.value:
        return [user["id"]]
    if role == Role.SUPPORT_HELPER.value:
        return [user.get("created_by")] if user.get("created_by") else []
    if role == Role.MANAGER.value:
        rows = await db.admin_allocations.find({"manager_id": user["id"]}, {"_id": 0, "user_id": 1}).to_list(2000)
        return [r["user_id"] for r in rows]
    if role == Role.ZONAL_MANAGER.value:
        mgrs = await db.manager_allocations.find({"zonal_manager_id": user["id"]}, {"_id": 0, "user_id": 1}).to_list(2000)
        mgr_ids = [m["user_id"] for m in mgrs]
        rows = await db.admin_allocations.find({"manager_id": {"$in": mgr_ids}}, {"_id": 0, "user_id": 1}).to_list(5000)
        return [r["user_id"] for r in rows]
    return []


async def _can_access(user: dict, ticket: dict) -> bool:
    scope = await _scope_admin_ids(user)
    if scope is None:  # Super Admin
        return True
    return ticket.get("assigned_admin_id") in scope or ticket.get("escalated_to") == user["id"]


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------
async def _name_map(ids) -> dict:
    ids = [i for i in set(ids) if i]
    if not ids:
        return {}
    rows = await db.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "display_name": 1}).to_list(len(ids))
    return {r["id"]: r.get("display_name") for r in rows}


async def _public_ticket(t: dict, names: Optional[dict] = None) -> dict:
    names = names or await _name_map([t.get("player_id"), t.get("assigned_admin_id"), t.get("escalated_to")])
    return {
        "id": t["id"],
        "ticket_no": t["ticket_no"],
        "player_id": t["player_id"],
        "player_name": names.get(t.get("player_id")),
        "category": t["category"],
        "subject": t["subject"],
        "status": t["status"],
        "priority": t["priority"],
        "assigned_admin_id": t.get("assigned_admin_id"),
        "assigned_admin_name": names.get(t.get("assigned_admin_id")),
        "escalated_to": t.get("escalated_to"),
        "escalated_to_name": names.get(t.get("escalated_to")),
        "escalation_level": t.get("escalation_level", 0),
        "related_ref": t.get("related_ref"),
        "created_at": t["created_at"],
        "updated_at": t["updated_at"],
        "resolved_at": t.get("resolved_at"),
    }


# ---------------------------------------------------------------------------
# Player actions
# ---------------------------------------------------------------------------
async def create_ticket(player: dict, *, category: str, subject: str, description: str,
                        related_ref: Optional[str]) -> dict:
    assign = await db.player_assignments.find_one({"player_id": player["id"]}, {"_id": 0, "admin_id": 1})
    admin_id = assign["admin_id"] if assign else None
    priority = TicketPriority.HIGH.value if category in HIGH_PRIORITY_CATEGORIES else TicketPriority.NORMAL.value
    ticket = {
        "id": str(uuid.uuid4()),
        "ticket_no": _ticket_no(),
        "player_id": player["id"],
        "category": category,
        "subject": subject,
        "status": TicketStatus.OPEN.value,
        "priority": priority,
        "assigned_admin_id": admin_id,
        "escalated_to": None,
        "escalation_level": 0,
        "related_ref": related_ref,
        "created_at": _now(),
        "updated_at": _now(),
        "resolved_at": None,
    }
    await db.support_tickets.insert_one(ticket)
    await _insert_message(ticket["id"], player, description, internal=False)
    await log_action(player["id"], "SUPPORT_TICKET_CREATED", target_type="ticket",
                     target_id=ticket["id"], metadata={"ticket_no": ticket["ticket_no"], "category": category})
    return await _public_ticket(ticket)


async def list_player_tickets(player_id: str) -> list:
    rows = await db.support_tickets.find({"player_id": player_id}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    names = await _name_map([r.get("assigned_admin_id") for r in rows] + [player_id])
    return [await _public_ticket(r, names) for r in rows]


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------
async def _insert_message(ticket_id: str, author: dict, body: str, *, internal: bool) -> dict:
    msg = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "author_id": author["id"],
        "author_role": author["role"],
        "author_name": author.get("display_name"),
        "body": body,
        "internal": bool(internal),
        "created_at": _now(),
    }
    await db.support_ticket_messages.insert_one(msg)
    return msg


async def get_ticket_detail(caller: dict, ticket_id: str) -> dict:
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    is_player = caller["role"] == Role.PLAYER.value
    if is_player:
        if ticket["player_id"] != caller["id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your ticket")
    elif not await _can_access(caller, ticket):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ticket outside your scope")

    q = {"ticket_id": ticket_id}
    if is_player:
        q["internal"] = False  # players never see internal staff notes
    msgs = await db.support_ticket_messages.find(q, {"_id": 0}).sort("created_at", 1).to_list(500)
    pub = await _public_ticket(ticket)
    pub["messages"] = msgs
    return pub


async def add_message(caller: dict, ticket_id: str, body: str, internal: bool) -> dict:
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    is_player = caller["role"] == Role.PLAYER.value
    if is_player:
        if ticket["player_id"] != caller["id"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your ticket")
        internal = False
    elif not await _can_access(caller, ticket):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ticket outside your scope")

    await _insert_message(ticket_id, caller, body, internal=internal)
    updates = {"updated_at": _now()}
    # A staff reply on an OPEN ticket moves it to IN_PROGRESS; a player reply on a
    # RESOLVED ticket reopens it.
    if not is_player and ticket["status"] == TicketStatus.OPEN.value:
        updates["status"] = TicketStatus.IN_PROGRESS.value
    if is_player and ticket["status"] == TicketStatus.RESOLVED.value:
        updates["status"] = TicketStatus.IN_PROGRESS.value
        updates["resolved_at"] = None
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": updates})
    return await get_ticket_detail(caller, ticket_id)


async def update_status(caller: dict, ticket_id: str, new_status: str) -> dict:
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    if not await _can_access(caller, ticket):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ticket outside your scope")
    updates = {"status": new_status, "updated_at": _now()}
    updates["resolved_at"] = _now() if new_status == TicketStatus.RESOLVED.value else None
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": updates})
    await log_action(caller["id"], "SUPPORT_TICKET_STATUS", target_type="ticket",
                     target_id=ticket_id, metadata={"status": new_status})
    return await get_ticket_detail(caller, ticket_id)


async def escalate(caller: dict, ticket_id: str) -> dict:
    ticket = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    if not await _can_access(caller, ticket):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Ticket outside your scope")

    # Resolve next level up: Admin -> its Manager -> that Manager's Zonal -> Super Admin.
    admin_id = ticket.get("assigned_admin_id")
    target = None
    alloc = await db.admin_allocations.find_one({"user_id": admin_id}, {"_id": 0, "manager_id": 1}) if admin_id else None
    manager_id = alloc.get("manager_id") if alloc else None
    level = ticket.get("escalation_level", 0)
    if level == 0 and manager_id:
        target = manager_id
    elif level <= 1 and manager_id:
        mgr = await db.manager_allocations.find_one({"user_id": manager_id}, {"_id": 0, "zonal_manager_id": 1})
        target = (mgr or {}).get("zonal_manager_id")
    if not target:  # fall back to Super Admin
        sa = await db.users.find_one({"role": Role.SUPER_ADMIN.value}, {"_id": 0, "id": 1})
        target = sa["id"] if sa else None
    if not target:
        raise HTTPException(status.HTTP_409_CONFLICT, "No higher authority to escalate to")

    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {
        "escalated_to": target, "escalation_level": level + 1,
        "priority": TicketPriority.HIGH.value, "updated_at": _now(),
    }})
    await log_action(caller["id"], "SUPPORT_TICKET_ESCALATED", target_type="ticket",
                     target_id=ticket_id, metadata={"to": target, "level": level + 1})
    return await get_ticket_detail(caller, ticket_id)


# ---------------------------------------------------------------------------
# Staff queue
# ---------------------------------------------------------------------------
async def staff_list_tickets(caller: dict, *, status_filter: Optional[str] = None,
                             category: Optional[str] = None) -> list:
    scope = await _scope_admin_ids(caller)
    query: dict = {}
    if scope is not None:
        query["$or"] = [{"assigned_admin_id": {"$in": scope}}, {"escalated_to": caller["id"]}]
    if status_filter:
        query["status"] = status_filter
    if category:
        query["category"] = category
    rows = await db.support_tickets.find(query, {"_id": 0}).sort("updated_at", -1).to_list(500)
    ids = []
    for r in rows:
        ids += [r.get("player_id"), r.get("assigned_admin_id"), r.get("escalated_to")]
    names = await _name_map(ids)
    tickets = [await _public_ticket(r, names) for r in rows]
    counts = {
        "open": sum(1 for t in tickets if t["status"] == TicketStatus.OPEN.value),
        "in_progress": sum(1 for t in tickets if t["status"] == TicketStatus.IN_PROGRESS.value),
        "resolved": sum(1 for t in tickets if t["status"] == TicketStatus.RESOLVED.value),
        "total": len(tickets),
    }
    return tickets, counts


# ---------------------------------------------------------------------------
# Support Helper staff management (Admin-parented)
# ---------------------------------------------------------------------------
async def create_support_helper(admin: dict, *, email: str, password: str, display_name: str) -> dict:
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(password),
        "display_name": display_name,
        "role": Role.SUPPORT_HELPER.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": admin["id"],
        "created_at": _now(),
    }
    try:
        await db.users.insert_one(user)
    except DuplicateKeyError:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    await wallet_service.get_or_create_wallet(user["id"])
    await log_action(admin["id"], "SUPPORT_HELPER_CREATED", target_type="user", target_id=user["id"])
    return _public_helper(user)


def _public_helper(u: dict) -> dict:
    return {
        "id": u["id"], "email": u["email"], "display_name": u["display_name"],
        "status": u["status"], "created_at": u["created_at"],
    }


async def list_support_helpers(admin: dict) -> list:
    rows = await db.users.find({"role": Role.SUPPORT_HELPER.value, "created_by": admin["id"]},
                               {"_id": 0}).sort("created_at", -1).to_list(200)
    return [_public_helper(u) for u in rows]


async def set_helper_status(admin: dict, helper_id: str, new_status: str) -> dict:
    helper = await db.users.find_one({"id": helper_id, "role": Role.SUPPORT_HELPER.value}, {"_id": 0})
    if not helper or helper.get("created_by") != admin["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Support Helper not found in your team")
    await db.users.update_one({"id": helper_id}, {"$set": {"status": new_status}})
    await log_action(admin["id"], "SUPPORT_HELPER_STATUS", target_type="user",
                     target_id=helper_id, metadata={"status": new_status})
    helper["status"] = new_status
    return _public_helper(helper)
