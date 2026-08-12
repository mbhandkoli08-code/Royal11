"""Per-Admin login branding (display-only layer over the standard login page).

An Admin can set a `brand_name` + `brand_logo` and gets a unique public slug at
`/login/<slug>`. That URL shows the normal ROYAL11 login form but swaps the top
branding for the Admin's. Auth itself is unchanged — this only moves bytes and
stores three fields on the Admin's user document.
"""
import re
import uuid

from .db import db
from .models import Role, UserStatus
from . import storage_service

_SLUG_RE = re.compile(r"[^a-z0-9]+")
LOGO_MAX_BYTES = 4 * 1024 * 1024  # 4 MB


def slugify(name: str) -> str:
    base = _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-")
    return base[:40] or "brand"


async def _unique_slug(base: str, exclude_user_id: str) -> str:
    slug = base
    n = 1
    while True:
        clash = await db.users.find_one(
            {"brand_slug": slug, "id": {"$ne": exclude_user_id}}, {"_id": 0, "id": 1})
        if not clash:
            return slug
        n += 1
        slug = f"{base}-{n}"


def _branding_out(user: dict) -> dict:
    return {
        "admin_id": user["id"],
        "brand_name": user.get("brand_name"),
        "brand_slug": user.get("brand_slug"),
        "has_logo": bool(user.get("brand_logo_path")),
        "login_path": f"/login/{user['brand_slug']}" if user.get("brand_slug") else None,
    }


async def _require_admin(admin_id: str) -> dict:
    user = await db.users.find_one({"id": admin_id})
    if not user or user.get("role") != Role.ADMIN.value:
        raise ValueError("Admin not found")
    return user


async def get_branding(admin_id: str) -> dict:
    user = await _require_admin(admin_id)
    return _branding_out(user)


async def set_branding(admin_id: str, brand_name: str, slug: str | None = None) -> dict:
    user = await _require_admin(admin_id)
    name = (brand_name or "").strip()
    if not name:
        raise ValueError("Brand name can't be empty")
    base = slugify(slug) if slug else slugify(name)
    unique = await _unique_slug(base, admin_id)
    await db.users.update_one(
        {"id": admin_id},
        {"$set": {"brand_name": name[:80], "brand_slug": unique}})
    user["brand_name"], user["brand_slug"] = name[:80], unique
    return _branding_out(user)


async def set_logo(admin_id: str, image_bytes: bytes, content_type: str, filename: str) -> dict:
    user = await _require_admin(admin_id)
    ext = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else "png"
    path = f"{storage_service.APP_NAME}/branding/{admin_id}/{uuid.uuid4()}.{ext}"
    result = await storage_service.put_object(path, image_bytes, content_type or "image/png")
    await db.users.update_one({"id": admin_id}, {"$set": {"brand_logo_path": result["path"]}})
    user["brand_logo_path"] = result["path"]
    return _branding_out(user)


# --------------------------- Public (no auth) ---------------------------
async def _active_admin_by_slug(slug: str) -> dict | None:
    if not slug:
        return None
    user = await db.users.find_one({
        "brand_slug": slug,
        "role": Role.ADMIN.value,
        "status": UserStatus.ACTIVE.value,
    })
    # Branding must be set up (name present) to be shown publicly.
    if not user or not user.get("brand_name"):
        return None
    return user


async def get_public_branding(slug: str) -> dict | None:
    """What the public login page needs — never leaks storage paths/emails."""
    user = await _active_admin_by_slug(slug)
    if not user:
        return None
    return {
        "brand_name": user["brand_name"],
        "brand_slug": user["brand_slug"],
        "has_logo": bool(user.get("brand_logo_path")),
    }


async def get_public_logo(slug: str) -> tuple[bytes, str] | None:
    user = await _active_admin_by_slug(slug)
    if not user or not user.get("brand_logo_path"):
        return None
    try:
        return await storage_service.get_object(user["brand_logo_path"])
    except Exception:
        return None
