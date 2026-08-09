from fastapi import APIRouter, Depends, Query

from .. import wallet_service
from ..db import db
from ..deps import get_current_user
from ..models import TransactionOut, WalletOut, WalletWithHistory

router = APIRouter(prefix="/wallet", tags=["wallet"])


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
