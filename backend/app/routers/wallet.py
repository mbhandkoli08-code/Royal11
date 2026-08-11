from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status

from .. import deposit_service, wallet_service
from ..db import db
from ..deps import get_current_user
from ..models import TransactionOut, WalletOut, WalletWithHistory

router = APIRouter(prefix="/wallet", tags=["wallet"])

MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024  # 8 MB


@router.get("/me", response_model=WalletWithHistory)
async def my_wallet(user: dict = Depends(get_current_user), limit: int = Query(default=20, le=100)):
    """The player's own balance + recent history. This is the only wallet read
    the frontend should ever trust — never a locally-computed number."""
    wallet = await wallet_service.get_or_create_wallet(user["id"])
    cursor = (
        db.ledger_transactions.find({"wallet_id": wallet["id"], "status": "COMPLETED"}, {"_id": 0})
        .sort("created_at", -1)
        .limit(limit)
    )
    transactions = [TransactionOut(**t) async for t in cursor]
    return WalletWithHistory(wallet=WalletOut(**wallet), transactions=transactions)


# ---------------------------------------------------------------------------
# Coin top-up / deposits (Part 1) — player side
# ---------------------------------------------------------------------------
@router.get("/deposit-info")
async def deposit_info(user: dict = Depends(get_current_user)):
    """Where to pay: the player's collection Admin + that Admin's bank account
    (if entered) + the current INR→coin ratio."""
    return await deposit_service.deposit_info(user["id"])


@router.get("/my-agent")
async def my_agent(user: dict = Depends(get_current_user)):
    """The player's assigned Admin + contact (used at signup + for help)."""
    return await deposit_service.my_agent(user["id"])


@router.post("/deposit-request")
async def create_deposit_request(
    amount_inr: int = Form(..., gt=0),
    reference_note: str = Form(..., min_length=1, max_length=200),
    screenshot: Optional[UploadFile] = File(default=None),
    user: dict = Depends(get_current_user),
):
    """Creates a PENDING top-up request. Coins are NOT credited here — the
    assigned Admin must confirm receipt first. An optional payment screenshot is
    stored and OCR-verified (advisory only)."""
    image_bytes = content_type = filename = None
    if screenshot is not None:
        if not (screenshot.content_type or "").startswith("image/"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Screenshot must be an image")
        image_bytes = await screenshot.read()
        if len(image_bytes) > MAX_SCREENSHOT_BYTES:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Screenshot exceeds 8 MB limit")
        content_type = screenshot.content_type
        filename = screenshot.filename
    try:
        return await deposit_service.create_deposit_request(
            user["id"], amount_inr, reference_note.strip(),
            image_bytes=image_bytes, content_type=content_type, filename=filename,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.get("/deposits")
async def my_deposits(user: dict = Depends(get_current_user), limit: int = Query(default=50, le=100)):
    cursor = db.deposits.find({"player_id": user["id"]}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return [d async for d in cursor]
