"""Admin -> Super Admin USDT (TRC-20) coin-purchase channel API.

Admin-facing endpoints under /admin/crypto/*; Super-Admin review + settings
under /superadmin/crypto/*. Mirrors the INR deposit confirm/reject pattern.
"""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field

from ..deps import get_current_user, require_roles, require_not_suspended
from ..models import Role
from .. import crypto_purchase_service as svc, storage_service

router = APIRouter(tags=["crypto-purchase"])


def _err(e: svc.DomainError) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


# ---------------- Admin-facing ----------------
@router.get("/admin/crypto/config", dependencies=[Depends(require_roles(Role.ADMIN))])
async def admin_crypto_config():
    """Buy screen needs the static receiving address, network, rate + minimum."""
    cfg = await svc.get_config()
    return {"usdt_address": cfg["usdt_address"], "network": cfg["network"],
            "coin_rate": cfg["coin_rate"], "min_inr": cfg["min_inr"],
            "has_qr": cfg["has_qr"]}


@router.get("/admin/crypto/qr", dependencies=[Depends(require_roles(Role.ADMIN, Role.SUPER_ADMIN))])
async def crypto_qr():
    """Streams the Super Admin's receiving-wallet QR image (shown on the Admin
    buy screen alongside the copy-paste address)."""
    path = await svc.get_qr_path()
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No QR image set")
    try:
        data, content_type = await storage_service.get_object(path)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "QR image unavailable")
    return Response(content=data, media_type=content_type)


@router.post("/admin/crypto/purchase-request",
             dependencies=[Depends(require_roles(Role.ADMIN)), Depends(require_not_suspended)])
async def create_purchase(
    usdt_amount: float = Form(...),
    inr_equivalent: int = Form(...),
    sender_wallet: Optional[str] = Form(None),
    tx_id: Optional[str] = Form(None),
    screenshot: Optional[UploadFile] = File(None),
    caller: dict = Depends(get_current_user),
):
    image_bytes, content_type = None, None
    if screenshot is not None:
        image_bytes = await screenshot.read()
        content_type = screenshot.content_type
    try:
        return await svc.create_purchase_request(
            caller, usdt_amount=usdt_amount, inr_equivalent=inr_equivalent,
            sender_wallet=sender_wallet, tx_id=tx_id,
            image_bytes=image_bytes, content_type=content_type)
    except svc.DomainError as e:
        raise _err(e)


@router.get("/admin/crypto/my-purchases", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_purchases(caller: dict = Depends(get_current_user)):
    return await svc.list_my_purchases(caller["id"])


# ---------------- Super-Admin-facing ----------------
class CryptoConfigRequest(BaseModel):
    usdt_address: Optional[str] = None
    network: Optional[str] = None
    coin_rate: Optional[float] = Field(default=None, gt=0)
    min_inr: Optional[int] = Field(default=None, ge=0)
    # SA-configurable auto-approve ceiling (USDT). Send 0 to mean unlimited.
    auto_approve_max_usdt: Optional[float] = Field(default=None, ge=0)


@router.get("/superadmin/crypto/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_crypto_config():
    return await svc.get_config()


@router.put("/superadmin/crypto/config", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def update_crypto_config(payload: CryptoConfigRequest):
    try:
        return await svc.set_config(payload.model_dump(exclude_none=True))
    except svc.DomainError as e:
        raise _err(e)


@router.post("/superadmin/crypto/config/qr", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def upload_crypto_qr(qr: UploadFile = File(...)):
    """Upload/replace the receiving-wallet QR image."""
    data = await qr.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    return await svc.set_qr(data, qr.content_type)


@router.get("/superadmin/crypto/requests", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_crypto_requests(
    req_status: Optional[str] = Query(None, alias="status"),
    admin_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 200,
):
    return await svc.list_requests(status=req_status, admin_id=admin_id,
                                   date_from=date_from, date_to=date_to,
                                   limit=min(max(limit, 1), 1000))


@router.get("/superadmin/crypto/admins", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_crypto_admin_options():
    """Distinct Admins who have submitted USDT purchases — for the report filter."""
    return await svc.list_admin_options()


@router.get("/superadmin/crypto/requests.csv", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def export_crypto_csv(
    req_status: Optional[str] = Query(None, alias="status"),
    admin_id: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
):
    csv_text = await svc.export_csv(status=req_status, admin_id=admin_id,
                                    date_from=date_from, date_to=date_to)
    return Response(
        content=csv_text, media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=usdt_purchases.csv"})


@router.get("/superadmin/crypto/requests/{req_id}/screenshot",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def crypto_screenshot(req_id: str):
    req = await svc.get_request_raw(req_id)
    if not req or not req.get("screenshot_path"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No proof image for this request")
    try:
        data, content_type = await storage_service.get_object(req["screenshot_path"])
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proof image unavailable")
    return Response(content=data, media_type=content_type)


class RejectCryptoRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=280)


@router.post("/superadmin/crypto/requests/{req_id}/confirm",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def confirm_crypto(req_id: str, caller: dict = Depends(get_current_user)):
    try:
        return await svc.confirm(req_id, caller["id"])
    except svc.DomainError as e:
        raise _err(e)


@router.post("/superadmin/crypto/requests/{req_id}/reject",
             dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def reject_crypto(req_id: str, payload: RejectCryptoRequest, caller: dict = Depends(get_current_user)):
    try:
        return await svc.reject(req_id, caller["id"], payload.reason)
    except svc.DomainError as e:
        raise _err(e)
