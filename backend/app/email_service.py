"""Emergent-managed Resend email sender (async, non-blocking).

The From address is fixed by the platform; we only set the display name via
`from_name` (required on every send). Key stays server-side, never logged.
"""
import logging
import os

import httpx

logger = logging.getLogger(__name__)

# Constant per playbook — never read from env so it survives deployment.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"


async def send_email(to_email: str, subject: str, html: str) -> bool:
    key = os.environ.get("EMERGENT_EMAIL_KEY")
    from_name = os.environ.get("EMAIL_FROM_NAME", "ROYAL11")
    if not key:
        logger.error("EMERGENT_EMAIL_KEY not set — cannot send email")
        return False
    payload = {"to": [to_email], "subject": subject, "html": html, "from_name": from_name}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": key},
                json=payload,
            )
        resp.raise_for_status()
        return True
    except Exception as e:  # noqa: BLE001 — never leak the key
        code = getattr(getattr(e, "response", None), "status_code", None)
        logger.error("Email send failed: %s%s", type(e).__name__, f" (HTTP {code})" if code else "")
        return False
