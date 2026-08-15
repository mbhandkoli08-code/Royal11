"""Bank payout templates + company remittance account + format-aware bulk
payout CSV export (Super Admin).

Indian bank bulk-upload formats vary by bank; we keep a library of fully-editable
templates (column order + header text + field mapping) so no code change is
needed when a bank tweaks its format. Starter templates for common banks are
seeded and flagged as "verify before first real use" — they follow the common
pattern but were NOT validated against live bank documentation.
"""
import csv
import io
import uuid
from datetime import datetime, timezone
from typing import Optional

from .db import db
from .audit import log_action

# Canonical payout fields a template column can map to.
FIELD_OPTIONS = ["beneficiary_name", "account_number", "ifsc", "amount", "mode", "remarks"]

COMPANY_BANK_ID = "company_bank"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cols(headers: list[tuple[str, str]]) -> list[dict]:
    return [{"header": h, "field": f} for h, f in headers]


# Common pattern shared by the starter templates.
_COMMON = [
    ("Beneficiary Name", "beneficiary_name"),
    ("Account Number", "account_number"),
    ("IFSC Code", "ifsc"),
    ("Amount", "amount"),
    ("Payment Mode", "mode"),
    ("Remarks", "remarks"),
]

STARTERS = [
    {"name": "Universal (generic)", "bank_code": "UNIVERSAL", "columns": _cols(_COMMON)},
    {"name": "HDFC Bank", "bank_code": "HDFC", "columns": _cols(_COMMON)},
    {"name": "ICICI Bank", "bank_code": "ICICI", "columns": _cols(_COMMON)},
    {"name": "State Bank of India (SBI)", "bank_code": "SBI", "columns": _cols(_COMMON)},
    {"name": "Axis Bank", "bank_code": "AXIS", "columns": _cols(_COMMON)},
    {"name": "Union Bank", "bank_code": "UNION", "columns": _cols(_COMMON)},
]


async def ensure_indexes() -> None:
    await db.bank_payout_templates.create_index("id", unique=True)


async def seed_starter_templates() -> None:
    """Idempotent — only inserts a starter if no template with that bank_code exists."""
    for t in STARTERS:
        exists = await db.bank_payout_templates.find_one({"bank_code": t["bank_code"]}, {"_id": 0, "id": 1})
        if exists:
            continue
        await db.bank_payout_templates.insert_one({
            "id": uuid.uuid4().hex, "name": t["name"], "bank_code": t["bank_code"],
            "columns": t["columns"], "is_starter": True,
            "created_at": _now(), "updated_at": _now(),
        })


# ---------------- template CRUD ----------------
async def list_templates() -> list[dict]:
    return [t async for t in db.bank_payout_templates.find({}, {"_id": 0}).sort("name", 1)]


async def create_template(name: str, bank_code: str, columns: list[dict]) -> dict:
    doc = {
        "id": uuid.uuid4().hex, "name": name.strip()[:80],
        "bank_code": (bank_code or "").strip()[:20].upper() or "CUSTOM",
        "columns": _validate_columns(columns), "is_starter": False,
        "created_at": _now(), "updated_at": _now(),
    }
    await db.bank_payout_templates.insert_one(dict(doc))
    return doc


async def update_template(template_id: str, patch: dict) -> dict:
    upd = {}
    if patch.get("name"):
        upd["name"] = patch["name"].strip()[:80]
    if patch.get("bank_code"):
        upd["bank_code"] = patch["bank_code"].strip()[:20].upper()
    if patch.get("columns") is not None:
        upd["columns"] = _validate_columns(patch["columns"])
    upd["updated_at"] = _now()
    upd["is_starter"] = False  # once edited it's no longer a pristine starter
    res = await db.bank_payout_templates.update_one({"id": template_id}, {"$set": upd})
    if res.matched_count == 0:
        raise ValueError("Template not found")
    return await db.bank_payout_templates.find_one({"id": template_id}, {"_id": 0})


async def delete_template(template_id: str) -> None:
    await db.bank_payout_templates.delete_one({"id": template_id})
    # Un-assign from any admins pointing at it.
    await db.admin_allocations.update_many(
        {"bank_template_id": template_id}, {"$unset": {"bank_template_id": ""}})


def _validate_columns(columns: list[dict]) -> list[dict]:
    out = []
    for c in columns or []:
        field = c.get("field")
        header = (c.get("header") or "").strip()
        if field not in FIELD_OPTIONS or not header:
            continue
        out.append({"header": header[:60], "field": field})
    if not out:
        raise ValueError("A template needs at least one valid column")
    return out


# ---------------- per-admin template assignment ----------------
async def assign_template(admin_id: str, template_id: Optional[str]) -> dict:
    if template_id:
        t = await db.bank_payout_templates.find_one({"id": template_id}, {"_id": 0, "id": 1})
        if not t:
            raise ValueError("Template not found")
        await db.admin_allocations.update_one(
            {"user_id": admin_id}, {"$set": {"bank_template_id": template_id}})
    else:
        await db.admin_allocations.update_one(
            {"user_id": admin_id}, {"$unset": {"bank_template_id": ""}})
    return {"admin_id": admin_id, "bank_template_id": template_id}


async def _beneficiary_details(admin_id: str) -> dict:
    """Resolve an Admin's payout beneficiary details from their active bank account."""
    acc = await db.admin_bank_accounts.find_one(
        {"admin_id": admin_id, "is_active": True}, {"_id": 0}) or \
        await db.admin_bank_accounts.find_one({"admin_id": admin_id}, {"_id": 0})
    acc = acc or {}
    u = await db.users.find_one({"id": admin_id}, {"_id": 0, "display_name": 1})
    return {
        "beneficiary_name": acc.get("account_name") or (u or {}).get("display_name") or "",
        "account_number": acc.get("account_number") or "",
        "ifsc": acc.get("ifsc") or acc.get("ifsc_code") or "",
    }


# ---------------- bulk payout export ----------------
async def export_payout_csv(template_id: Optional[str], beneficiaries: list[dict],
                            default_mode: str = "NEFT", fmt: str = "csv") -> tuple[str, bytes, str]:
    """Render a bulk payout file for the chosen bank template. `beneficiaries` is
    a list of {admin_id, amount, remarks}. `fmt` is 'csv' or 'xlsx'. Returns
    (filename, file_bytes, content_type)."""
    template = None
    if template_id:
        template = await db.bank_payout_templates.find_one({"id": template_id}, {"_id": 0})
    if not template:
        template = await db.bank_payout_templates.find_one({"bank_code": "UNIVERSAL"}, {"_id": 0})
    if not template:
        raise ValueError("No payout template available")

    columns = template["columns"]
    # Resolve + validate beneficiaries once.
    missing = []
    rendered = []
    for b in beneficiaries:
        det = await _beneficiary_details(b["admin_id"])
        if not det["account_number"] or not det["beneficiary_name"]:
            missing.append(det["beneficiary_name"] or b["admin_id"])
            continue
        rendered.append((b, det))
    if missing:
        raise ValueError(
            "These beneficiaries have no bank account on file — add it before exporting: "
            + ", ".join(missing))

    def _row(b, det):
        vals = {
            "beneficiary_name": det["beneficiary_name"],
            "account_number": det["account_number"],
            "ifsc": det["ifsc"],
            "amount": b.get("amount", 0),
            "mode": b.get("mode") or default_mode,
            "remarks": b.get("remarks") or "",
        }
        return [vals.get(c["field"], "") for c in columns]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    base = f"payout_{template['bank_code'].lower()}_{stamp}"
    header = [c["header"] for c in columns]

    if fmt == "xlsx":
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "Payouts"
        ws.append(header)
        for b, det in rendered:
            ws.append(_row(b, det))
        bio = io.BytesIO()
        wb.save(bio)
        return (f"{base}.xlsx", bio.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for b, det in rendered:
        w.writerow(_row(b, det))
    return f"{base}.csv", buf.getvalue().encode("utf-8"), "text/csv"


# ---------------- company remittance bank account ----------------
async def get_company_bank() -> dict:
    doc = await db.settlement_config.find_one({"_id": COMPANY_BANK_ID}, {"_id": 0})
    return doc or {"account_name": "", "bank_name": "", "account_number": "", "ifsc": "",
                   "upi_id": "", "notes": ""}


async def set_company_bank(data: dict) -> dict:
    allowed = {k: (str(data.get(k) or "").strip()[:120])
               for k in ("account_name", "bank_name", "account_number", "ifsc", "upi_id", "notes")}
    await db.settlement_config.update_one({"_id": COMPANY_BANK_ID}, {"$set": allowed}, upsert=True)
    return await get_company_bank()
