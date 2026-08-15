"""Player Support Chatbot API (Q JOKER). Player-only, READ-ONLY assistant that
can escalate to a real support ticket."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..deps import require_roles
from ..models import Role, TicketCategory
from .. import chatbot_service

router = APIRouter(prefix="/chatbot", tags=["chatbot"])


class ChatMessageRequest(BaseModel):
    session_id: str = Field(default="", max_length=80)
    message: str = Field(min_length=1, max_length=2000)
    language: str = Field(default="en", pattern="^(en|hi|ta|te|bn|mr)$")


class EscalateRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=80)
    category: TicketCategory = TicketCategory.GENERAL
    subject: str = Field(min_length=3, max_length=140)
    description: str = Field(default="", max_length=2000)


@router.post("/message", dependencies=[Depends(require_roles(Role.PLAYER))])
async def send_message(payload: ChatMessageRequest, user: dict = Depends(require_roles(Role.PLAYER))):
    return await chatbot_service.chat(user, payload.session_id, payload.message, payload.language)


@router.get("/session/{session_id}", dependencies=[Depends(require_roles(Role.PLAYER))])
async def get_session(session_id: str, user: dict = Depends(require_roles(Role.PLAYER))):
    return await chatbot_service.get_session(user["id"], session_id)


@router.post("/escalate", dependencies=[Depends(require_roles(Role.PLAYER))])
async def escalate(payload: EscalateRequest, user: dict = Depends(require_roles(Role.PLAYER))):
    return await chatbot_service.escalate(
        user, payload.session_id, category=payload.category.value,
        subject=payload.subject, description=payload.description or "Escalated from Zoya chat")
