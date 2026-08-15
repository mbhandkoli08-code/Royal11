"""Admin -> Super Admin USDT (TRC-20) coin-purchase channel.

An INTERNAL B2B top-up: an Admin buys coin allocation from the Super Admin by
sending USDT to ONE static, Super-Admin-controlled receiving address (a KYC/AML
exchange business account managed off-platform). This mirrors the manual
proof-submit + verify trust model of the INR `deposit_service`, but is kept in
its OWN collection (`crypto_purchase_requests`) so the three coin-inflow
channels stay distinguishable in reporting:
  1. Super Admin "Fund"  -> mint (credit-from-nothing)
  2. Player INR deposit  -> `deposits`
  3. Admin USDT purchase -> `crypto_purchase_requests` (this module)

No live rate API and no on-chain verification: the Admin manually enters the
INR-equivalent of the USDT they sent; on Super-Admin confirm, coins are credited
as `inr_equivalent * coin_rate` (both Super-Admin-configurable). There is NO
per-admin wallet generation — one static address only.
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import db
from .models import Role, TxnType
from . import wallet_service, storage_service, tron_service
from .audit import log_action

logger = logging.getLogger(__name__)

CONFIG_ID = "crypto_purchase"
AUTO_CHAIN_ACTOR = "SYSTEM_AUTO_CHAIN"
DEFAULTS = {
    "usdt_address": "",          # set by Super Admin (static receiving address)
    "network": "TRC-20",
    "coin_rate": 1.5,            # coins per 1 INR-equivalent (100000 INR -> 150000 coins)
    "min_inr": 100000,           # minimum INR-equivalent per request
    "qr_path": None,             # storage path to the uploaded QR image (optional)
    "auto_approve_max_usdt": None,  # SA-configurable cap; None/0 = unlimited (on-chain gated)
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class DomainError(Exception):
    """User-facing rule violation -> HTTP 400."""


async def ensure_indexes() -> None:
    await db.crypto_purchase_requests.create_index("id", unique=True)
    await db.crypto_purchase_requests.create_index([("admin_id", 1), ("created_at", -1)])
    await db.crypto_purchase_requests.create_index([("status", 1), ("created_at", -1)])


# ---------------- config (Super-Admin-configurable) ----------------
async def get_config() -> dict:
    doc = await db.crypto_config.find_one({"_id": CONFIG_ID}, {"_id": 0})
    cfg = {**DEFAULTS, **(doc or {})}
    cfg["has_qr"] = bool(cfg.get("qr_path"))
    return cfg


async def set_qr(image_bytes: bytes, content_type: Optional[str]) -> dict:
    """Store/replace the Super Admin's receiving-wallet QR image."""
    path = "crypto_config/qr"
    result = await storage_service.put_object(path, image_bytes, content_type or "image/png")
    await db.crypto_config.update_one(
        {"_id": CONFIG_ID}, {"$set": {"qr_path": result["path"]}}, upsert=True)
    return await get_config()


async def get_qr_path() -> Optional[str]:
    cfg = await get_config()
    return cfg.get("qr_path")


async def set_config(patch: dict) -> dict:
    allowed = {}
    if "usdt_address" in patch and patch["usdt_address"] is not None:
        allowed["usdt_address"] = str(patch["usdt_address"]).strip()[:120]
    if "network" in patch and patch["network"]:
        allowed["network"] = str(patch["network"]).strip()[:20]
    if patch.get("coin_rate") is not None:
        rate = float(patch["coin_rate"])
        if rate <= 0:
            raise DomainError("Coin rate must be greater than 0")
        allowed["coin_rate"] = rate
    if patch.get("min_inr") is not None:
        m = int(patch["min_inr"])
        if m < 0:
            raise DomainError("Minimum must be 0 or more")
        allowed["min_inr"] = m
    if "auto_approve_max_usdt" in patch:
        v = patch["auto_approve_max_usdt"]
        # None or 0 (or negative) => unlimited (store None). Positive => a real cap.
        allowed["auto_approve_max_usdt"] = None if (v is None or float(v) <= 0) else float(v)
    await db.crypto_config.update_one({"_id": CONFIG_ID}, {"$set": allowed}, upsert=True)
    return await get_config()


# ---------------- Admin: submit a purchase request ----------------
def _public(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_id", None)
    d["has_proof"] = bool(d.get("screenshot_path"))
    d.pop("screenshot_path", None)
    return d


async def create_purchase_request(admin: dict, *, usdt_amount: float, inr_equivalent: int,
                                   sender_wallet: Optional[str], tx_id: Optional[str],
                                   image_bytes: Optional[bytes], content_type: Optional[str]) -> dict:
    cfg = await get_config()
    usdt_amount = float(usdt_amount)
    inr_equivalent = int(inr_equivalent)
    if usdt_amount <= 0:
        raise DomainError("Enter the USDT amount you sent")
    if inr_equivalent < cfg["min_inr"]:
        raise DomainError(f"Minimum purchase is ₹{cfg['min_inr']:,} INR-equivalent per request")
    if not (tx_id and tx_id.strip()) and not image_bytes:
        raise DomainError("Attach a transaction ID or a screenshot as proof")

    req_id = str(uuid.uuid4())
    coins_preview = int(round(inr_equivalent * cfg["coin_rate"]))
    doc = {
        "id": req_id,
        "admin_id": admin["id"],
        "admin_name": admin.get("display_name"),
        "sender_wallet": (sender_wallet or "").strip()[:120] or None,
        "usdt_amount": usdt_amount,
        "inr_equivalent": inr_equivalent,
        "coin_rate_at_submit": cfg["coin_rate"],
        "coins_preview": coins_preview,
        "coins_credited": None,
        "tx_id": (tx_id or "").strip()[:120] or None,
        "usdt_address": cfg["usdt_address"],
        "network": cfg["network"],
        "screenshot_path": None,
        "status": "PENDING",
        "reason": None,
        "auto_approved": False,
        "chain_verification": None,
        "created_at": _now(),
        "decided_at": None,
        "decided_by": None,
        "decided_by_name": None,
    }
    if image_bytes:
        path = f"crypto_purchases/{req_id}"
        try:
            result = await storage_service.put_object(path, image_bytes, content_type or "image/png")
            doc["screenshot_path"] = result["path"]
        except Exception:
            pass
    await db.crypto_purchase_requests.insert_one(dict(doc))
    await log_action(actor_id=admin["id"], action="crypto_purchase.request",
                     target_id=req_id, metadata={"usdt": usdt_amount, "inr": inr_equivalent,
                                                  "sender_wallet": doc["sender_wallet"]})
    doc.pop("_id", None)
    # Blockchain-verified auto-approval. On any miss/failure this returns None and
    # the request stays PENDING for the existing manual Super-Admin review flow.
    approved = await _maybe_auto_approve_chain(doc, cfg)
    if approved:
        return approved
    # Re-read so the response reflects any stored chain_verification verdict.
    fresh = await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0})
    return _public(fresh or doc)


async def _tx_already_credited(tx_id: str, exclude_req_id: str) -> bool:
    """Replay guard: has this exact tx_id already produced a CONFIRMED credit?"""
    existing = await db.crypto_purchase_requests.find_one(
        {"tx_id": tx_id, "status": "CONFIRMED", "id": {"$ne": exclude_req_id}},
        {"_id": 0, "id": 1})
    return bool(existing)


async def _store_chain_result(req_id: str, verdict: dict) -> None:
    await db.crypto_purchase_requests.update_one(
        {"id": req_id}, {"$set": {"chain_verification": verdict}})


async def _maybe_auto_approve_chain(doc: dict, cfg: dict) -> Optional[dict]:
    """Auto-confirm + auto-credit ONLY when on-chain verification passes AND the
    tx_id hasn't been used before AND (if the SA set a cap) the amount is within
    it. Any miss -> None (falls back to manual review)."""
    tx_id = (doc.get("tx_id") or "").strip()
    to_addr = cfg.get("usdt_address")
    if not tx_id or not to_addr:
        return None  # nothing to verify against -> manual

    cap = cfg.get("auto_approve_max_usdt")
    if cap is not None and float(doc["usdt_amount"]) > float(cap):
        await _store_chain_result(doc["id"], {
            "status": "skipped", "verified": False,
            "reason": f"Above the auto-approve cap ({cap} USDT) — manual review required"})
        return None

    if await _tx_already_credited(tx_id, doc["id"]):
        await _store_chain_result(doc["id"], {
            "status": "failed", "verified": False,
            "reason": "This transaction ID was already credited"})
        return None

    verdict = await tron_service.verify_usdt_transfer(tx_id, float(doc["usdt_amount"]), to_addr)
    await _store_chain_result(doc["id"], verdict)
    if not verdict.get("verified"):
        return None

    try:
        return await _auto_confirm(doc["id"])
    except Exception as e:  # noqa: BLE001 — auto-approve must never break submission
        logger.error(f"Crypto auto-approve failed for {doc['id']}: {type(e).__name__}")
        return None


async def _auto_confirm(req_id: str) -> Optional[dict]:
    req = await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0})
    if not req or req["status"] != "PENDING":
        return None
    coins = await _apply_confirm(req, decided_by=AUTO_CHAIN_ACTOR,
                                 decided_by_name="System · on-chain verified",
                                 auto_approved=True)
    await log_action(actor_id=AUTO_CHAIN_ACTOR, action="crypto_purchase.auto_confirm",
                     target_id=req_id, metadata={"coins": coins, "admin_id": req["admin_id"],
                                                 "inr": req["inr_equivalent"], "tx_id": req.get("tx_id")})
    return _public(await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0}))


async def list_my_purchases(admin_id: str, limit: int = 50) -> list[dict]:
    rows = await db.crypto_purchase_requests.find(
        {"admin_id": admin_id}).sort("created_at", -1).to_list(limit)
    return [_public(r) for r in rows]


# ---------------- Super Admin: review queue + history/report ----------------
def _build_query(status: Optional[str], admin_id: Optional[str],
                 date_from: Optional[str], date_to: Optional[str]) -> dict:
    q: dict = {}
    if status:
        q["status"] = status
    if admin_id:
        q["admin_id"] = admin_id
    created = {}
    if date_from:
        created["$gte"] = date_from
    if date_to:
        # inclusive end-of-day if a bare date is passed
        created["$lte"] = f"{date_to}T23:59:59.999999+00:00" if len(date_to) == 10 else date_to
    if created:
        q["created_at"] = created
    return q


async def list_requests(status: Optional[str] = None, admin_id: Optional[str] = None,
                        date_from: Optional[str] = None, date_to: Optional[str] = None,
                        limit: int = 200) -> list[dict]:
    q = _build_query(status, admin_id, date_from, date_to)
    rows = await db.crypto_purchase_requests.find(q).sort("created_at", -1).to_list(limit)
    return [_public(r) for r in rows]


async def list_admin_options() -> list[dict]:
    """Distinct {id, name} of Admins who have ever submitted — for the report filter."""
    rows = await db.crypto_purchase_requests.aggregate([
        {"$group": {"_id": "$admin_id", "name": {"$last": "$admin_name"}}},
        {"$sort": {"name": 1}},
    ]).to_list(500)
    return [{"id": r["_id"], "name": r.get("name") or "—"} for r in rows if r["_id"]]


async def export_csv(status: Optional[str] = None, admin_id: Optional[str] = None,
                     date_from: Optional[str] = None, date_to: Optional[str] = None) -> str:
    import csv
    import io
    q = _build_query(status, admin_id, date_from, date_to)
    rows = await db.crypto_purchase_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(5000)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Request ID", "Admin ID", "Admin Name", "Sender Wallet",
                "Receiving Wallet", "Network", "USDT Amount", "INR Equivalent",
                "Coin Rate", "Coins Credited", "Tx ID", "Status", "Reason",
                "Submitted At", "Decided At", "Decided By"])
    for r in rows:
        w.writerow([
            r.get("id"), r.get("admin_id"), r.get("admin_name"), r.get("sender_wallet") or "",
            r.get("usdt_address") or "", r.get("network") or "", r.get("usdt_amount"),
            r.get("inr_equivalent"), r.get("coin_rate_at_submit"),
            r.get("coins_credited") if r.get("coins_credited") is not None else "",
            r.get("tx_id") or "", r.get("status"), r.get("reason") or "",
            r.get("created_at") or "", r.get("decided_at") or "",
            r.get("decided_by_name") or r.get("decided_by") or "",
        ])
    return buf.getvalue()


async def get_request_raw(req_id: str) -> Optional[dict]:
    return await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0})


async def _actor_name(user_id: str) -> Optional[str]:
    u = await db.users.find_one({"id": user_id}, {"_id": 0, "display_name": 1})
    return (u or {}).get("display_name")


async def confirm(req_id: str, super_admin_id: str) -> dict:
    req = await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise DomainError("Purchase request not found")
    if req["status"] != "PENDING":
        raise DomainError(f"Request already {req['status'].lower()}")
    coins = await _apply_confirm(req, decided_by=super_admin_id,
                                 decided_by_name=await _actor_name(super_admin_id),
                                 auto_approved=False)
    await log_action(actor_id=super_admin_id, action="crypto_purchase.confirm",
                     target_id=req_id, metadata={"coins": coins, "admin_id": req["admin_id"],
                                                 "inr": req["inr_equivalent"]})
    return _public(await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0}))


async def _apply_confirm(req: dict, *, decided_by: str, decided_by_name: Optional[str],
                         auto_approved: bool) -> int:
    """Shared crediting core for manual confirm and on-chain auto-confirm.
    Idempotent on the request id via the wallet request_id. Returns coins credited."""
    cfg = await get_config()
    # Use the rate captured at submit time for fairness/audit clarity.
    rate = req.get("coin_rate_at_submit") or cfg["coin_rate"]
    coins = int(round(req["inr_equivalent"] * rate))
    await wallet_service.credit(
        req["admin_id"], TxnType.CRYPTO_PURCHASE, coins,
        actor_id=decided_by,
        reason=f"USDT purchase — {req['usdt_amount']} USDT (₹{req['inr_equivalent']:,} @ {rate})",
        request_id=f"crypto_purchase:{req['id']}")
    await db.crypto_purchase_requests.update_one(
        {"id": req["id"], "status": "PENDING"},
        {"$set": {"status": "CONFIRMED", "coins_credited": coins,
                  "decided_at": _now(), "decided_by": decided_by,
                  "decided_by_name": decided_by_name, "auto_approved": auto_approved}})
    return coins


async def reject(req_id: str, super_admin_id: str, reason: Optional[str]) -> dict:
    req = await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0})
    if not req:
        raise DomainError("Purchase request not found")
    if req["status"] != "PENDING":
        raise DomainError(f"Request already {req['status'].lower()}")
    await db.crypto_purchase_requests.update_one(
        {"id": req_id, "status": "PENDING"},
        {"$set": {"status": "REJECTED", "reason": (reason or "").strip()[:280] or None,
                  "decided_at": _now(), "decided_by": super_admin_id,
                  "decided_by_name": await _actor_name(super_admin_id)}})
    await log_action(actor_id=super_admin_id, action="crypto_purchase.reject",
                     target_id=req_id, metadata={"reason": reason, "admin_id": req["admin_id"]})
    return _public(await db.crypto_purchase_requests.find_one({"id": req_id}, {"_id": 0}))


async def total_confirmed_coins() -> int:
    """Total coins credited via confirmed USDT purchases (for coin-supply report)."""
    agg = await db.crypto_purchase_requests.aggregate([
        {"$match": {"status": "CONFIRMED"}},
        {"$group": {"_id": None, "coins": {"$sum": "$coins_credited"}}},
    ]).to_list(1)
    return int(agg[0]["coins"]) if agg else 0
