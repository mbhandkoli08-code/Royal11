"""Weekly INR settlement (Admin ↔ Super Admin) + bank payout templates/export.

Reuses the existing revenue_service settlement engine; adds the Admin "Settle
Now" proof flow, the company remittance account, and the format-aware bulk
payout export driven by editable per-bank templates.
"""
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from ..deps import get_current_user, require_roles
from ..models import Role
from ..audit import log_action
from .. import revenue_service, bank_template_service as bt

router = APIRouter(tags=["settlement"])


# ================= Admin-facing settlement =================
@router.get("/admin/settlement/my", dependencies=[Depends(require_roles(Role.ADMIN))])
async def my_settlements(caller: dict = Depends(get_current_user)):
    return await revenue_service.list_admin_settlements(caller["id"])


@router.get("/admin/settlement/company-bank", dependencies=[Depends(require_roles(Role.ADMIN))])
async def admin_company_bank():
    return await bt.get_company_bank()


@router.post("/admin/settlement/{settlement_id}/pay",
             dependencies=[Depends(require_roles(Role.ADMIN))])
async def submit_payment(
    settlement_id: str,
    reference: Optional[str] = Form(None),
    screenshot: Optional[UploadFile] = File(None),
    caller: dict = Depends(get_current_user),
):
    # NOTE: intentionally NOT require_not_suspended — an Admin suspended for an
    # overdue settlement must still be able to submit the payment that clears it.
    image_bytes, content_type = None, None
    if screenshot is not None:
        image_bytes = await screenshot.read()
        content_type = screenshot.content_type
    if not (reference and reference.strip()) and not image_bytes:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a payment reference or a screenshot as proof")
    try:
        return await revenue_service.submit_settlement_payment(
            settlement_id, caller["id"], reference=reference,
            image_bytes=image_bytes, content_type=content_type)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


# ================= Super-Admin settlement review =================
@router.get("/superadmin/settlement/proof/{settlement_id}",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def settlement_proof(settlement_id: str):
    path = await revenue_service.get_settlement_proof_path(settlement_id)
    if not path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No proof image for this settlement")
    from .. import storage_service
    try:
        data, content_type = await storage_service.get_object(path)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Proof image unavailable")
    return Response(content=data, media_type=content_type)


class CompanyBankRequest(BaseModel):
    account_name: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    ifsc: Optional[str] = None
    upi_id: Optional[str] = None
    notes: Optional[str] = None


@router.get("/superadmin/settlement/company-bank",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def get_company_bank():
    return await bt.get_company_bank()


@router.put("/superadmin/settlement/company-bank",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def set_company_bank(payload: CompanyBankRequest):
    return await bt.set_company_bank(payload.model_dump(exclude_none=True))


# ================= Bank payout templates =================
@router.get("/superadmin/payouts/fields", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def payout_fields():
    return {"fields": bt.FIELD_OPTIONS}


@router.get("/superadmin/payouts/templates", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def list_templates():
    return await bt.list_templates()


class TemplateColumn(BaseModel):
    header: str
    field: str


class TemplateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    bank_code: Optional[str] = ""
    columns: list[TemplateColumn]


@router.post("/superadmin/payouts/templates", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def create_template(payload: TemplateRequest, caller: dict = Depends(get_current_user)):
    try:
        t = await bt.create_template(payload.name, payload.bank_code or "",
                                     [c.model_dump() for c in payload.columns])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "payout_template.create", target_id=t["id"], metadata={"name": t["name"]})
    return t


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = None
    bank_code: Optional[str] = None
    columns: Optional[list[TemplateColumn]] = None


@router.put("/superadmin/payouts/templates/{template_id}",
            dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def update_template(template_id: str, payload: TemplateUpdateRequest,
                          caller: dict = Depends(get_current_user)):
    patch = payload.model_dump(exclude_none=True)
    try:
        t = await bt.update_template(template_id, patch)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "payout_template.update", target_id=template_id)
    return t


@router.delete("/superadmin/payouts/templates/{template_id}",
               dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def delete_template(template_id: str, caller: dict = Depends(get_current_user)):
    await bt.delete_template(template_id)
    await log_action(caller["id"], "payout_template.delete", target_id=template_id)
    return {"deleted": True}


class AssignTemplateRequest(BaseModel):
    admin_id: str
    template_id: Optional[str] = None


@router.post("/superadmin/payouts/assign", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def assign_template(payload: AssignTemplateRequest):
    try:
        return await bt.assign_template(payload.admin_id, payload.template_id)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.get("/superadmin/payouts/admins", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def payout_admins():
    """Admins with their assigned template + resolved beneficiary details, for the
    bulk-export builder."""
    from ..db import db
    out = []
    async for a in db.admin_allocations.find({}, {"_id": 0, "user_id": 1, "bank_template_id": 1}):
        aid = a["user_id"]
        u = await db.users.find_one({"id": aid}, {"_id": 0, "display_name": 1, "status": 1})
        det = await bt._beneficiary_details(aid)
        out.append({
            "admin_id": aid, "name": (u or {}).get("display_name", "—"),
            "status": (u or {}).get("status"),
            "bank_template_id": a.get("bank_template_id"),
            "beneficiary_name": det["beneficiary_name"],
            "account_number": det["account_number"], "ifsc": det["ifsc"],
        })
    out.sort(key=lambda r: r["name"].lower())
    return out


class ExportBeneficiary(BaseModel):
    admin_id: str
    amount: float
    remarks: Optional[str] = ""
    mode: Optional[str] = None


class ExportRequest(BaseModel):
    template_id: Optional[str] = None
    beneficiaries: list[ExportBeneficiary]


@router.post("/superadmin/payouts/export", dependencies=[Depends(require_roles(Role.SUPER_ADMIN))])
async def export_payouts(payload: ExportRequest, caller: dict = Depends(get_current_user)):
    if not payload.beneficiaries:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select at least one beneficiary")
    try:
        fname, csv_text = await bt.export_payout_csv(
            payload.template_id, [b.model_dump() for b in payload.beneficiaries])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    await log_action(caller["id"], "payout.export",
                     metadata={"count": len(payload.beneficiaries), "template_id": payload.template_id})
    return Response(content=csv_text, media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename={fname}"})
