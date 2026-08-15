"""On-chain verification for USDT (TRC-20) purchase requests.

Public, no-key blockchain data via TronScan's REST API — impossible to fake the
way a screenshot can be. The provider call sits behind a single boundary so the
engine can be swapped later. This module ONLY verifies; the decision to credit
lives in crypto_purchase_service (which also handles the replay/reuse check).

verify_usdt_transfer() NEVER raises — on any error it returns a verdict with
verified=False so the request always falls back to manual Super-Admin review.
"""
import asyncio
import logging
import re

import httpx

logger = logging.getLogger(__name__)

# Official Tether USDT TRC-20 contract on TRON mainnet.
USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
USDT_DECIMALS = 6

TRONSCAN_TX_INFO = "https://apilist.tronscanapi.com/api/transaction-info"

# Chain confirmation can lag a few seconds after submit — retry briefly, then
# fall through to manual (we never block the Admin's submission for long).
MAX_ATTEMPTS = 3
RETRY_DELAY = 2.0
# TRON marks a tx fully irreversible (`confirmed`) only after ~19 SR confirmations
# (~1 min). For this internal, trusted Admin↔SA channel we accept a tx once it is
# block-included (>=1 SR confirmation), which the brief retry window can reach.
MIN_CONFIRMATIONS = 1

_HASH_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _is_confirmed(data: dict) -> bool:
    if bool(data.get("confirmed")):
        return True
    try:
        if int(data.get("confirmations") or 0) >= MIN_CONFIRMATIONS:
            return True
    except (TypeError, ValueError):
        pass
    return len(data.get("srConfirmList") or []) >= MIN_CONFIRMATIONS


def _empty(status: str, reason: str) -> dict:
    return {"status": status, "verified": False, "reason": reason,
            "checks": {}, "extracted": {}}


async def _fetch(tx_hash: str) -> dict | None:
    """Single TronScan lookup. Returns the JSON dict, or None on network error."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(TRONSCAN_TX_INFO, params={"hash": tx_hash})
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as exc:
        logger.error(f"TronScan lookup failed: {type(exc).__name__}")
        return None


def _transfers(data: dict) -> list[dict]:
    lst = data.get("trc20TransferInfo")
    if isinstance(lst, list) and lst:
        return lst
    single = data.get("tokenTransferInfo")
    return [single] if isinstance(single, dict) and single else []


def _amount_ok(actual: float, expected: float) -> bool:
    # Small tolerance for rounding: 0.5% relative or 0.01 USDT absolute.
    return abs(actual - expected) <= max(0.01, expected * 0.005)


async def verify_usdt_transfer(tx_id: str, expected_amount: float,
                               expected_to_address: str) -> dict:
    """Verify an on-chain USDT (TRC-20) transfer against the claimed amount and
    the Super Admin's receiving address. Returns a verdict dict (never raises)."""
    tx_id = (tx_id or "").strip()
    if not _HASH_RE.match(tx_id):
        return _empty("failed", "Invalid transaction hash format")
    if not expected_to_address:
        return _empty("failed", "No receiving address configured to verify against")

    data = None
    transfers: list[dict] = []
    confirmed = False
    for attempt in range(MAX_ATTEMPTS):
        data = await _fetch(tx_id)
        if data is not None:
            transfers = _transfers(data)
            confirmed = _is_confirmed(data)
            if transfers and confirmed:
                break
        if attempt < MAX_ATTEMPTS - 1:
            await asyncio.sleep(RETRY_DELAY)

    if data is None:
        return _empty("unavailable", "Could not reach the blockchain lookup service")
    if not transfers:
        return _empty("not_found", "Transaction not found on-chain yet")
    if not confirmed:
        return _empty("unconfirmed", "Transaction is not yet confirmed on-chain")

    success = str(data.get("contractRet") or "").upper() == "SUCCESS"

    # Only USDT TRC-20 transfers count; prefer one addressed to our wallet.
    usdt = [t for t in transfers if t.get("contract_address") == USDT_TRC20_CONTRACT]
    to_ours = [t for t in usdt if (t.get("to_address") or "") == expected_to_address]
    chosen = to_ours[0] if to_ours else (usdt[0] if usdt else transfers[0])

    def _amt(t: dict) -> float | None:
        try:
            dec = int(t.get("decimals", USDT_DECIMALS))
            return int(t.get("amount_str")) / (10 ** dec)
        except (TypeError, ValueError):
            return None

    actual_amount = _amt(chosen)
    is_usdt = bool(usdt)
    to_match = bool(to_ours)
    amount_match = actual_amount is not None and _amount_ok(actual_amount, float(expected_amount))

    checks = {
        "exists": True,
        "success": success,
        "confirmed": confirmed,
        "is_usdt_trc20": is_usdt,
        "to_address_match": to_match,
        "amount_match": amount_match,
    }
    verified = all([success, confirmed, is_usdt, to_match, amount_match])

    if verified:
        reason = "On-chain USDT transfer verified"
    elif not is_usdt:
        reason = "Transaction is not a USDT (TRC-20) transfer"
    elif not to_match:
        reason = "Receiving address does not match the configured wallet"
    elif not amount_match:
        reason = f"On-chain amount ({actual_amount}) does not match claimed ({expected_amount})"
    elif not success:
        reason = "On-chain contract execution did not succeed"
    else:
        reason = "Verification failed"

    return {
        "status": "ok",
        "verified": verified,
        "reason": reason,
        "checks": checks,
        "extracted": {
            "amount_usdt": actual_amount,
            "to_address": chosen.get("to_address"),
            "from_address": chosen.get("from_address"),
            "contract_address": chosen.get("contract_address"),
            "symbol": chosen.get("symbol"),
            "confirmations": data.get("confirmations"),
        },
    }
