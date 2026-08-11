"""OCR-assisted deposit verification.

The actual OCR call lives behind a single provider boundary (`get_ocr_provider`)
so swapping engines later is a one-file change. Today that provider is Google
Cloud Vision (text detection via a plain API key). When the key isn't set the
provider degrades gracefully to `status="unavailable"` — the Admin then reviews
the screenshot manually, exactly like the Sportmonks integration pattern.

OCR only ASSISTS: it never auto-confirms or auto-rejects a deposit.
"""
import base64
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import httpx

logger = logging.getLogger(__name__)


class GoogleVisionOCR:
    """Provider boundary — replace this class to change OCR engines."""

    endpoint = "https://vision.googleapis.com/v1/images:annotate"

    def __init__(self, api_key: str | None):
        self.api_key = api_key

    async def extract_text(self, image_bytes: bytes) -> dict:
        if not self.api_key:
            return {"status": "unavailable", "text": "", "reason": "OCR is not configured"}
        payload = {
            "requests": [{
                "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
            }]
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    self.endpoint,
                    headers={
                        "Content-Type": "application/json; charset=utf-8",
                        "x-goog-api-key": self.api_key,
                    },
                    json=payload,
                )
            resp.raise_for_status()
            body = resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            # Never leak the key or raw provider body.
            logger.error(f"Vision OCR request failed: {type(exc).__name__}")
            return {"status": "unavailable", "text": "", "reason": "Vision request failed"}

        item = (body.get("responses") or [{}])[0]
        if item.get("error"):
            return {"status": "unavailable", "text": "", "reason": "Vision returned an error"}
        text = (item.get("fullTextAnnotation") or {}).get("text")
        if text is None:
            anns = item.get("textAnnotations") or []
            text = anns[0].get("description", "") if anns else ""
        return {"status": "ok", "text": text or ""}


def get_ocr_provider():
    """Read the key at call time so adding it later (+ restart) just works."""
    return GoogleVisionOCR(os.environ.get("GOOGLE_CLOUD_VISION_API_KEY"))


# ---------------------------------------------------------------------------
# Parsing + matching helpers (pure functions — no I/O, easy to unit-test)
# ---------------------------------------------------------------------------
def _alnum(s: str | None) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", s or "").upper()


_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}


def _extract_amounts(text: str) -> list[int]:
    """Whole-rupee amounts that appear next to a currency marker (₹ / Rs / INR)."""
    out: list[int] = []
    for m in re.finditer(r"(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)", text, re.IGNORECASE):
        try:
            out.append(int(round(float(m.group(1).replace(",", "")))))
        except ValueError:
            continue
    return out


def _extract_timestamp(text: str) -> tuple[str | None, datetime | None]:
    """Best-effort date/time extraction for common Indian UPI-app formats.
    Returns (display_string, parsed_datetime|None). Advisory only."""
    low = text.lower()
    # e.g. "12 Jan 2026", "12 January 2026, 3:45 pm"
    m = re.search(r"(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})", low)
    if m:
        mon = _MONTHS.get(m.group(2)[:3])
        if mon:
            try:
                dt = datetime(int(m.group(3)), mon, int(m.group(1)), tzinfo=timezone.utc)
                return m.group(0), dt
            except ValueError:
                pass
    # e.g. "12/01/2026" or "12-01-2026" (dd/mm/yyyy)
    m = re.search(r"(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})", low)
    if m:
        try:
            yr = int(m.group(3))
            yr = yr + 2000 if yr < 100 else yr
            dt = datetime(yr, int(m.group(2)), int(m.group(1)), tzinfo=timezone.utc)
            return m.group(0), dt
        except ValueError:
            pass
    return None, None


def parse_and_match(text: str, entered_amount_inr: int, entered_utr: str, created_at_iso: str | None) -> dict:
    """Compare OCR text against the player-entered amount + UTR (+ advisory
    timestamp). Returns extracted values and per-field match flags plus an
    overall verdict: 'match' (amount AND utr match), 'review', or 'unknown'."""
    if not text:
        return {
            "extracted": {"amount_inr": None, "utr": None, "timestamp": None},
            "match": {"amount": False, "utr": False, "timestamp": None, "overall": "unknown"},
        }

    amounts = _extract_amounts(text)
    text_alnum = _alnum(text)
    entered_alnum = _alnum(entered_utr)

    amount_ok = entered_amount_inr in amounts
    utr_ok = len(entered_alnum) >= 6 and entered_alnum in text_alnum

    ts_display, ts_dt = _extract_timestamp(text)
    ts_ok = None  # advisory / could-not-verify
    if ts_dt and created_at_iso:
        try:
            created = datetime.fromisoformat(created_at_iso)
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            ts_ok = abs((ts_dt.date() - created.date()).days) <= 1
        except ValueError:
            ts_ok = None

    return {
        "extracted": {
            "amount_inr": amounts[0] if amounts else None,
            "utr": entered_alnum if utr_ok else None,
            "timestamp": ts_display,
        },
        "match": {
            "amount": amount_ok,
            "utr": utr_ok,
            "timestamp": ts_ok,
            "overall": "match" if (amount_ok and utr_ok) else "review",
        },
    }


async def run_ocr_verification(image_bytes: bytes, entered_amount_inr: int, entered_utr: str,
                               created_at_iso: str | None) -> dict:
    """Full pipeline: OCR the image, then parse + match. Always returns a dict
    (never raises) so a deposit request is never blocked by OCR problems."""
    provider = get_ocr_provider()
    result = await provider.extract_text(image_bytes)
    if result["status"] != "ok":
        return {
            "status": result["status"],
            "text": "",
            "extracted": {"amount_inr": None, "utr": None, "timestamp": None},
            "match": {"amount": False, "utr": False, "timestamp": None, "overall": "unknown"},
        }
    parsed = parse_and_match(result["text"], entered_amount_inr, entered_utr, created_at_iso)
    return {"status": "ok", "text": result["text"][:2000], **parsed}
