"""Player Support Chatbot — 'Q JOKER' self-serve assistant (READ-ONLY).

Reuses the EXISTING Emergent LLM integration (Gemini, same as the match-preview
feature) — no new integration/key. The bot can read the player's OWN context
(wallet, recent play, open tickets) to give specific answers, but it can NEVER
take a state-changing action (no refunds/credits/unlocks). When it can't help,
it points the player to 'Raise a Support Ticket', which creates a real ticket
through the existing support_service, pre-filled with the full chat transcript
and routed to the player's assigned Admin / SUPPORT_HELPER.
"""
import os
import uuid
from datetime import datetime, timezone

from emergentintegrations.llm.chat import LlmChat, UserMessage

from .db import db
from . import wallet_service, bonus_service, support_service

MAX_HISTORY = 12  # turns kept in context

SYSTEM_PROMPT = (
    "You are 'Q JOKER', the friendly in-app support assistant for ROYAL11, a virtual-coin "
    "sports, fantasy and casual-gaming app. Personality: warm, upbeat, concise, a little playful "
    "(you're the wild card that fits everywhere) but always professional.\n\n"
    "STRICT RULES:\n"
    "- You are READ-ONLY. You can EXPLAIN things and read the player's own context, but you can "
    "NEVER perform or promise any account action: no refunds, no adding/removing coins, no "
    "unlocking accounts, no confirming deposits, no changing any balance or status. If asked for "
    "any of these, politely explain you can't do that and offer to raise a support ticket to a "
    "human agent.\n"
    "- Only use the CONTEXT block for facts about this player. Never invent balances, transactions "
    "or outcomes. If you don't know, say so and offer a ticket.\n"
    "- Keep answers short (2-4 sentences). Use simple language.\n"
    "- All coins are virtual and non-withdrawable in the ways described by the app; never promise "
    "cash payouts.\n"
    "- If the player seems stuck, frustrated, or asks for a human, recommend the 'Raise a Support "
    "Ticket' button.\n\n"
    "KNOWLEDGE BASE:\n"
    "- Add coins: Wallet > Add Coins. Pay the assigned agent via UPI/bank, then submit the amount + "
    "UTR reference; the agent confirms and coins are credited. Attaching a payment screenshot speeds it up.\n"
    "- Bonus coins are non-withdrawable and unlock to real balance as you play (wagering/playthrough).\n"
    "- Games (Rummy, High Card, 777 Slots) are provably fair: every result is committed before play "
    "and independently verifiable via the 'Provably Fair' / Verify panel.\n"
    "- Fantasy: build an 11-player team within the credit budget, pick a captain (2x) & vice-captain "
    "(1.5x), join a contest; winnings settle after the match from real stats.\n"
    "- VIP tiers grow with play and give recharge bonuses / rakeback.\n"
    "- Deposits pending too long, wrong amount credited, or account issues => raise a ticket to a human agent.\n"
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes() -> None:
    await db.chatbot_sessions.create_index([("user_id", 1), ("session_id", 1)], unique=True)


async def _build_context(user: dict) -> str:
    """Compact, read-only snapshot of the player's own account for the LLM."""
    uid = user["id"]
    lines = [f"Player name: {user.get('display_name', 'Player')}"]
    try:
        status = await bonus_service.get_status(uid)
        lines.append(f"Real coin balance: {status['real_balance']}")
        lines.append(f"Bonus (locked, non-withdrawable) balance: {status['bonus_balance']}")
        if status.get("active_grants"):
            g = status["active_grants"][0]
            lines.append(f"Active bonus playthrough: {g['wagered']}/{g['wagering_required']} wagered "
                         f"({g['progress_pct']}% to unlock {g['amount']} coins)")
    except Exception:
        pass
    # recent ledger transactions
    try:
        txns = await db.ledger_transactions.find(
            {"user_id": uid}, {"_id": 0, "type": 1, "amount": 1, "reason": 1, "created_at": 1}
        ).sort("created_at", -1).to_list(5)
        if txns:
            lines.append("Recent transactions:")
            for t in txns:
                lines.append(f"  - {t.get('type')} {t.get('amount')} ({t.get('reason') or ''}) at {t.get('created_at','')[:16]}")
    except Exception:
        pass
    # recent deposits
    try:
        deps = await db.deposits.find(
            {"player_id": uid}, {"_id": 0, "amount_inr": 1, "status": 1, "created_at": 1}
        ).sort("created_at", -1).to_list(3)
        if deps:
            lines.append("Recent top-up requests:")
            for d in deps:
                lines.append(f"  - ₹{d.get('amount_inr')} — {d.get('status')} ({d.get('created_at','')[:16]})")
    except Exception:
        pass
    # recent slot spins
    try:
        spins = await db.casino_spins.find(
            {"user_id": uid}, {"_id": 0, "stake": 1, "payout": 1, "is_win": 1}
        ).sort("created_at", -1).to_list(3)
        if spins:
            wins = sum(1 for s in spins if s.get("is_win"))
            lines.append(f"Recent 777 Slots spins: {len(spins)} (won {wins}).")
    except Exception:
        pass
    # open tickets
    try:
        tickets = await support_service.list_player_tickets(uid)
        open_t = [t for t in tickets if t["status"] in ("OPEN", "IN_PROGRESS")]
        if open_t:
            lines.append(f"Open support tickets: " + ", ".join(f"{t['ticket_no']} ({t['status']})" for t in open_t[:3]))
    except Exception:
        pass
    return "\n".join(lines)


async def _get_session(uid: str, session_id: str) -> dict:
    doc = await db.chatbot_sessions.find_one({"user_id": uid, "session_id": session_id}, {"_id": 0})
    if not doc:
        doc = {"user_id": uid, "session_id": session_id, "messages": [], "created_at": _now()}
        await db.chatbot_sessions.insert_one(dict(doc))
    return doc


async def get_session(uid: str, session_id: str) -> dict:
    doc = await _get_session(uid, session_id)
    return {"session_id": session_id, "messages": doc.get("messages", [])}


async def chat(user: dict, session_id: str, message: str) -> dict:
    uid = user["id"]
    session_id = (session_id or "").strip() or str(uuid.uuid4())
    session = await _get_session(uid, session_id)
    history = session.get("messages", [])

    context = await _build_context(user)
    recent = history[-MAX_HISTORY:]
    convo = "\n".join(f"{m['role'].upper()}: {m['text']}" for m in recent)
    prompt = (
        f"CONTEXT (this player's own read-only data):\n{context}\n\n"
        f"CONVERSATION SO FAR:\n{convo or '(new conversation)'}\n\n"
        f"PLAYER: {message}\n\nReply as Q JOKER (short, helpful, within the rules)."
    )

    reply_text = ("I'm having a little trouble right now — please try again, or tap "
                  "'Raise a Support Ticket' to reach a human agent.")
    try:
        chat_client = LlmChat(
            api_key=os.environ["EMERGENT_LLM_KEY"],
            session_id=f"chatbot:{uid}:{session_id}",
            system_message=SYSTEM_PROMPT,
        ).with_model("gemini", "gemini-3-flash-preview")
        resp = await chat_client.send_message(UserMessage(text=prompt))
        text = resp if isinstance(resp, str) else getattr(resp, "text", None) or str(resp)
        if text and text.strip():
            reply_text = text.strip()
    except Exception:
        pass

    now = _now()
    new_msgs = [
        {"role": "user", "text": message, "at": now},
        {"role": "assistant", "text": reply_text, "at": now},
    ]
    await db.chatbot_sessions.update_one(
        {"user_id": uid, "session_id": session_id},
        {"$push": {"messages": {"$each": new_msgs}}, "$set": {"updated_at": now}})
    return {"session_id": session_id, "reply": reply_text}


async def escalate(user: dict, session_id: str, *, category: str, subject: str, description: str) -> dict:
    """Create a real support ticket pre-filled with the chat transcript."""
    uid = user["id"]
    session = await _get_session(uid, session_id)
    transcript_lines = []
    for m in session.get("messages", []):
        who = "You" if m["role"] == "user" else "Q JOKER"
        transcript_lines.append(f"{who}: {m['text']}")
    transcript = "\n".join(transcript_lines) or "(no chat history)"
    full_desc = (
        f"{description.strip()}\n\n"
        f"--- Chat transcript with Q JOKER ---\n{transcript}"
    )
    ticket = await support_service.create_ticket(
        user, category=category, subject=subject[:140], description=full_desc, related_ref=None)
    await db.chatbot_sessions.update_one(
        {"user_id": uid, "session_id": session_id},
        {"$set": {"escalated_ticket_no": ticket["ticket_no"], "updated_at": _now()}})
    return ticket
