"""Server-authoritative wallet ledger — spec Section 6.

Every coin movement goes through credit()/debit() here. Nothing else in the
codebase should touch a wallet's balance field directly, and no endpoint should
ever accept a client-supplied balance.

MongoDB note: this app runs against a standalone mongod, not a replica set, so
multi-document ACID transactions aren't available here. Correctness instead
comes from single-document atomicity, applied in this order:

1. Insert the ledger transaction row FIRST, with a unique request_id. A
   duplicate request_id raises DuplicateKeyError, which we treat as an
   idempotent replay — the original result is returned untouched, so a retried
   request (double-click, network retry) can never double-apply.
2. Only once that insert succeeds do we mutate the wallet's balance, using $inc
   for credits (always safe) or a conditional
   find_one_and_update(..., balance: {"$gte": amount}) for debits, which
   atomically rejects the update if funds are insufficient.
3. The transaction row is then patched with the resulting status/balance.

A crash between steps 1 and 2 leaves a PENDING row with no balance effect — safe
to inspect and retry with the same request_id. Moving Mongo to a replica set and
wrapping this in a real session transaction is a Part 8 hardening item; the
current approach is correct, just not "textbook ACID".
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from .db import db
from .models import TxnType


class InsufficientFunds(Exception):
    pass


async def ensure_indexes() -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.wallets.create_index("user_id", unique=True)
    await db.wallets.create_index("id", unique=True)
    await db.ledger_transactions.create_index("request_id", unique=True)
    await db.ledger_transactions.create_index([("wallet_id", 1), ("created_at", -1)])
    await db.player_assignments.create_index("player_id", unique=True)
    await db.manager_allocations.create_index("user_id", unique=True)
    await db.admin_allocations.create_index("user_id", unique=True)


async def get_or_create_wallet(user_id: str) -> dict:
    wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    if wallet:
        return wallet
    wallet = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "balance": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.wallets.insert_one(wallet)
    except DuplicateKeyError:
        wallet = await db.wallets.find_one({"user_id": user_id}, {"_id": 0})
    return wallet


async def record_pending(wallet_id: str, user_id: str, type_: TxnType, signed_amount: int,
                         actor_id: Optional[str], reason: Optional[str], request_id: str,
                         reversal_of_id: Optional[str]) -> tuple[dict, bool]:
    txn = {
        "id": str(uuid.uuid4()),
        "wallet_id": wallet_id,
        "user_id": user_id,
        "type": type_.value,
        "amount": signed_amount,
        "balance_after": None,
        "actor_id": actor_id,
        "reason": reason,
        "request_id": request_id,
        "reversal_of_id": reversal_of_id,
        "status": "PENDING",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        await db.ledger_transactions.insert_one(txn)
        return txn, True
    except DuplicateKeyError:
        existing = await db.ledger_transactions.find_one({"request_id": request_id}, {"_id": 0})
        return existing, False


async def credit(user_id: str, type_: TxnType, amount: int, *,
                 actor_id: Optional[str] = None, reason: Optional[str] = None,
                 request_id: Optional[str] = None, reversal_of_id: Optional[str] = None) -> dict:
    if amount <= 0:
        raise ValueError("credit amount must be positive")
    request_id = request_id or str(uuid.uuid4())
    wallet = await get_or_create_wallet(user_id)
    txn, is_new = await record_pending(wallet["id"], user_id, type_, amount, actor_id, reason,
                                       request_id, reversal_of_id)
    if not is_new:
        return txn  # idempotent replay

    updated = await db.wallets.find_one_and_update(
        {"id": wallet["id"]},
        {"$inc": {"balance": amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
    )
    await db.ledger_transactions.update_one(
        {"id": txn["id"]}, {"$set": {"balance_after": updated["balance"], "status": "COMPLETED"}}
    )
    txn["balance_after"] = updated["balance"]
    txn["status"] = "COMPLETED"
    return txn


async def debit(user_id: str, type_: TxnType, amount: int, *,
                actor_id: Optional[str] = None, reason: Optional[str] = None,
                request_id: Optional[str] = None, reversal_of_id: Optional[str] = None) -> dict:
    if amount <= 0:
        raise ValueError("debit amount must be positive")
    request_id = request_id or str(uuid.uuid4())
    wallet = await get_or_create_wallet(user_id)
    txn, is_new = await record_pending(wallet["id"], user_id, type_, -amount, actor_id, reason,
                                       request_id, reversal_of_id)
    if not is_new:
        if txn["status"] == "FAILED":
            raise InsufficientFunds(f"Transaction {request_id} previously failed: insufficient funds")
        return txn

    updated = await db.wallets.find_one_and_update(
        {"id": wallet["id"], "balance": {"$gte": amount}},
        {"$inc": {"balance": -amount}, "$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        await db.ledger_transactions.update_one({"id": txn["id"]}, {"$set": {"status": "FAILED"}})
        raise InsufficientFunds(f"Wallet for user {user_id} has insufficient balance for {amount}")

    await db.ledger_transactions.update_one(
        {"id": txn["id"]}, {"$set": {"balance_after": updated["balance"], "status": "COMPLETED"}}
    )
    txn["balance_after"] = updated["balance"]
    txn["status"] = "COMPLETED"
    return txn


async def transfer(from_user_id: str, to_user_id: str, type_: TxnType, amount: int, *,
                   actor_id: Optional[str] = None, reason: Optional[str] = None,
                   request_id: Optional[str] = None) -> tuple[dict, dict]:
    """Move coins from one wallet to another as two linked ledger rows (a debit
    and a credit). Used for MANAGER_TO_ADMIN and ADMIN_GRANT — the debit
    naturally fails with InsufficientFunds if the sender doesn't have enough,
    which is what enforces "cannot exceed allocation" without any separate quota
    bookkeeping.
    """
    base = request_id or str(uuid.uuid4())
    debit_txn = await debit(from_user_id, type_, amount, actor_id=actor_id, reason=reason,
                            request_id=f"{base}:debit")
    credit_txn = await credit(to_user_id, type_, amount, actor_id=actor_id, reason=reason,
                              request_id=f"{base}:credit")
    return debit_txn, credit_txn


async def reverse(transaction_id: str, *, actor_id: str, reason: Optional[str] = None) -> dict:
    """Corrections use a REVERSAL transaction — history is never deleted."""
    original = await db.ledger_transactions.find_one({"id": transaction_id}, {"_id": 0})
    if not original:
        raise ValueError("Transaction not found")
    if original["status"] != "COMPLETED":
        raise ValueError("Can only reverse a completed transaction")

    already = await db.ledger_transactions.find_one({"reversal_of_id": transaction_id}, {"_id": 0})
    if already:
        return already  # idempotent — already reversed

    reversal_request_id = f"reversal:{transaction_id}"
    amount = original["amount"]
    user_id = original["user_id"]
    if amount > 0:
        return await debit(user_id, TxnType.REVERSAL, amount, actor_id=actor_id,
                           reason=reason or f"Reversal of {transaction_id}",
                           request_id=reversal_request_id, reversal_of_id=transaction_id)
    return await credit(user_id, TxnType.REVERSAL, -amount, actor_id=actor_id,
                        reason=reason or f"Reversal of {transaction_id}",
                        request_id=reversal_request_id, reversal_of_id=transaction_id)
