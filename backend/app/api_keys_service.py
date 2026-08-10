"""Third-party API-key helpers: provider detection + a minimal, cheap liveness
test per provider.

Security: functions here receive the plaintext key only transiently to make a
single request. The key is NEVER logged, returned, or embedded in any error
message we surface.
"""
import logging

import httpx

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = ("openai", "anthropic", "google", "unknown")
_TIMEOUT = httpx.Timeout(12.0)


def detect_provider(key: str) -> str:
    """Best-effort provider detection from the key's shape/prefix."""
    k = (key or "").strip()
    if k.startswith("sk-ant-"):
        return "anthropic"
    if k.startswith("AIza"):
        return "google"
    if k.startswith("sk-"):  # covers sk-proj-... and classic sk-...
        return "openai"
    return "unknown"


def _result(status: str, message: str, balance_info=None) -> dict:
    return {"status": status, "message": message, "balance_info": balance_info}


async def test_key(provider: str, key: str) -> dict:
    """Make ONE cheap, read-only call (list models / equivalent) to verify the
    key is live. Never triggers a paid completion. Returns
    {status, message, balance_info}. No provider here exposes a real balance via
    a simple key call, so balance_info is honestly None.
    """
    provider = (provider or "").lower().strip()
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if provider == "openai":
                r = await client.get("https://api.openai.com/v1/models",
                                     headers={"Authorization": f"Bearer {key}"})
            elif provider == "anthropic":
                r = await client.get("https://api.anthropic.com/v1/models",
                                     headers={"x-api-key": key, "anthropic-version": "2023-06-01"})
            elif provider == "google":
                r = await client.get("https://generativelanguage.googleapis.com/v1beta/models",
                                     params={"key": key})
            else:
                return _result("failed", "Unknown provider — set a supported provider "
                               "(openai, anthropic, google) to test this key.")
    except httpx.HTTPError:
        # Do not leak the key or raw request details.
        return _result("failed", "Could not reach the provider (network/timeout). Please try again.")

    if 200 <= r.status_code < 300:
        return _result("ok", "Key is valid and live.", balance_info=None)
    if r.status_code in (401, 403):
        return _result("failed", "Provider rejected the key (unauthorized). Check the key and try again.")
    if r.status_code == 429:
        return _result("failed", "Provider rate-limited the request (429). The key may still be valid; retry later.")
    return _result("failed", f"Provider returned HTTP {r.status_code}.")
