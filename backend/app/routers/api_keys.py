"""Super Admin: third-party API-key management.

Keys are encrypted at rest (see crypto_utils). The plaintext key is only ever
held transiently to run a liveness test and is never returned to the client,
written to logs, or placed in audit metadata — only provider + last-4.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from ..api_keys_service import detect_provider, test_key
from ..audit import log_action
from ..crypto_utils import decrypt_secret, encrypt_secret
from ..db import db
from ..deps import get_current_user, require_roles
from ..models import (
    ApiKeyCreate,
    ApiKeyOut,
    ApiKeyTestRequest,
    ApiKeyTestResult,
    Role,
)

router = APIRouter(
    prefix="/admin/api-keys",
    tags=["admin:api-keys"],
    dependencies=[Depends(require_roles(Role.SUPER_ADMIN))],
)


def _to_out(doc: dict) -> ApiKeyOut:
    # Never expose key_encrypted / any plaintext.
    return ApiKeyOut(**doc)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@router.post("", response_model=ApiKeyOut)
async def add_api_key(payload: ApiKeyCreate, caller: dict = Depends(get_current_user)):
    key = payload.key.strip()
    provider = (payload.provider or "").strip().lower() or detect_provider(key)
    doc = {
        "id": str(uuid.uuid4()),
        "provider": provider,
        "key_encrypted": encrypt_secret(key),
        "key_last4": key[-4:],
        "added_by": caller["id"],
        "created_at": _now(),
        "last_tested_at": None,
        "last_test_status": "untested",
        "last_test_message": None,
        "balance_info": None,
    }
    await db.api_keys.insert_one({**doc})
    await log_action(caller["id"], "API_KEY_ADDED", target_type="api_key", target_id=doc["id"],
                     metadata={"provider": provider, "key_last4": doc["key_last4"]})
    return _to_out(doc)


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys():
    cursor = db.api_keys.find({}, {"_id": 0, "key_encrypted": 0}).sort("created_at", -1)
    return [_to_out(d) async for d in cursor]


@router.post("/test", response_model=ApiKeyTestResult)
async def test_unsaved_key(payload: ApiKeyTestRequest, caller: dict = Depends(get_current_user)):
    """Test a raw key BEFORE saving it. The key is used once and discarded."""
    key = payload.key.strip()
    provider = (payload.provider or "").strip().lower() or detect_provider(key)
    result = await test_key(provider, key)
    await log_action(caller["id"], "API_KEY_TESTED_ADHOC", target_type="api_key",
                     metadata={"provider": provider, "status": result["status"]})
    return ApiKeyTestResult(provider=provider, **result)


@router.post("/{key_id}/test", response_model=ApiKeyOut)
async def test_saved_key(key_id: str, caller: dict = Depends(get_current_user)):
    doc = await db.api_keys.find_one({"id": key_id})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    plaintext = decrypt_secret(doc["key_encrypted"])
    result = await test_key(doc["provider"], plaintext)
    del plaintext  # don't keep it around

    update = {
        "last_tested_at": _now(),
        "last_test_status": result["status"],
        "last_test_message": result["message"],
        "balance_info": result["balance_info"],
    }
    await db.api_keys.update_one({"id": key_id}, {"$set": update})
    await log_action(caller["id"], "API_KEY_TESTED", target_type="api_key", target_id=key_id,
                     metadata={"provider": doc["provider"], "status": result["status"]})
    doc.pop("_id", None)
    doc.pop("key_encrypted", None)
    doc.update(update)
    return _to_out(doc)


@router.delete("/{key_id}")
async def delete_api_key(key_id: str, caller: dict = Depends(get_current_user)):
    doc = await db.api_keys.find_one({"id": key_id}, {"_id": 0, "key_encrypted": 0})
    if not doc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")
    await db.api_keys.delete_one({"id": key_id})
    await log_action(caller["id"], "API_KEY_DELETED", target_type="api_key", target_id=key_id,
                     metadata={"provider": doc.get("provider"), "key_last4": doc.get("key_last4")})
    return {"deleted": True, "id": key_id}
