"""Support / Complaints ticket API.

Player endpoints: raise + track their own tickets.
Staff endpoints: scoped queue + reply/status/escalate (Admin, Support Helper,
Manager, Zonal, Super Admin).
Helper management: an Admin builds a small support team under themselves.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from .. import support_service
from ..deps import get_current_user, require_not_suspended, require_roles
from ..models import (
    CreateSupportHelperRequest,
    Role,
    SetHelperStatusRequest,
    SupportMessageCreate,
    SupportTicketCreate,
    TicketStatusUpdate,
)

router = APIRouter(prefix="/support", tags=["support"])

STAFF_ROLES = (Role.SUPER_ADMIN, Role.ZONAL_MANAGER, Role.MANAGER, Role.ADMIN, Role.SUPPORT_HELPER)


# ---------------------------------------------------------------------------
# Player
# ---------------------------------------------------------------------------
@router.post("/tickets", dependencies=[Depends(require_roles(Role.PLAYER))])
async def create_ticket(payload: SupportTicketCreate, user: dict = Depends(get_current_user)):
    return await support_service.create_ticket(
        user, category=payload.category.value, subject=payload.subject,
        description=payload.description, related_ref=payload.related_ref,
    )


@router.get("/tickets", dependencies=[Depends(require_roles(Role.PLAYER))])
async def my_tickets(user: dict = Depends(get_current_user)):
    return await support_service.list_player_tickets(user["id"])


@router.get("/tickets/{ticket_id}")
async def ticket_detail(ticket_id: str, user: dict = Depends(get_current_user)):
    return await support_service.get_ticket_detail(user, ticket_id)


@router.post("/tickets/{ticket_id}/messages")
async def post_message(ticket_id: str, payload: SupportMessageCreate, user: dict = Depends(get_current_user)):
    return await support_service.add_message(user, ticket_id, payload.body, payload.internal)


# ---------------------------------------------------------------------------
# Staff queue
# ---------------------------------------------------------------------------
@router.get("/admin/tickets", dependencies=[Depends(require_roles(*STAFF_ROLES))])
async def staff_tickets(
    user: dict = Depends(get_current_user),
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
):
    tickets, counts = await support_service.staff_list_tickets(user, status_filter=status, category=category)
    return {"tickets": tickets, "counts": counts}


@router.post("/admin/tickets/{ticket_id}/reply",
             dependencies=[Depends(require_roles(*STAFF_ROLES)), Depends(require_not_suspended)])
async def staff_reply(ticket_id: str, payload: SupportMessageCreate, user: dict = Depends(get_current_user)):
    return await support_service.add_message(user, ticket_id, payload.body, payload.internal)


@router.put("/admin/tickets/{ticket_id}/status",
            dependencies=[Depends(require_roles(*STAFF_ROLES)), Depends(require_not_suspended)])
async def staff_status(ticket_id: str, payload: TicketStatusUpdate, user: dict = Depends(get_current_user)):
    return await support_service.update_status(user, ticket_id, payload.status.value)


@router.post("/admin/tickets/{ticket_id}/escalate",
             dependencies=[Depends(require_roles(*STAFF_ROLES)), Depends(require_not_suspended)])
async def staff_escalate(ticket_id: str, user: dict = Depends(get_current_user)):
    return await support_service.escalate(user, ticket_id)


# ---------------------------------------------------------------------------
# Support Helper team management (Admin only)
# ---------------------------------------------------------------------------
@router.post("/admin/helpers",
             dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def create_helper(payload: CreateSupportHelperRequest, user: dict = Depends(get_current_user)):
    return await support_service.create_support_helper(
        user, email=payload.email, password=payload.password, display_name=payload.display_name,
    )


@router.get("/admin/helpers", dependencies=[Depends(require_roles(Role.ADMIN))])
async def list_helpers(user: dict = Depends(get_current_user)):
    return await support_service.list_support_helpers(user)


@router.put("/admin/helpers/{helper_id}/status",
            dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def set_helper(helper_id: str, payload: SetHelperStatusRequest, user: dict = Depends(get_current_user)):
    return await support_service.set_helper_status(user, helper_id, payload.status.value)
