"""Emergent-managed object storage wrapper.

The underlying storage API is synchronous (`requests`); we run every call in a
worker thread so the FastAPI event loop is never blocked. The DB remains the
source of truth for what a stored path means — this module only moves bytes.
"""
import asyncio
import logging
import os

import requests

logger = logging.getLogger(__name__)

# `or`, not a default= argument: the platform sets this to "" when it has no value.
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "royal11"

_storage_key = None  # session-scoped, minted once and reused


def _init_sync(force: bool = False) -> str:
    global _storage_key
    if _storage_key and not force:
        return _storage_key
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": os.environ.get("EMERGENT_LLM_KEY")},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _put_sync(path: str, data: bytes, content_type: str) -> dict:
    key = _init_sync()
    url = f"{STORAGE_URL}/objects/{path}"
    resp = requests.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:  # stale/dead key → force a fresh one and retry once
        key = _init_sync(force=True)
        resp = requests.put(url, headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def _get_sync(path: str) -> tuple[bytes, str]:
    key = _init_sync()
    url = f"{STORAGE_URL}/objects/{path}"
    resp = requests.get(url, headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = _init_sync(force=True)
        resp = requests.get(url, headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def init_storage() -> str:
    return await asyncio.to_thread(_init_sync)


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put_sync, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await asyncio.to_thread(_get_sync, path)
