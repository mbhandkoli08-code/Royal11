"""Create the first Super Admin account (and, optionally, a demo
Manager/Admin/Player chain) so there's a way into the admin hierarchy on a
fresh database — there is no other way to create a Super Admin, by design (the
public /auth/register endpoint only ever creates Players).

Usage:
    cd backend
    python seed.py                # Super Admin only
    python seed.py --demo-chain   # + Manager -> Admin -> Player
"""
import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone

from app.db import db
from app.models import Role, TxnType, UserStatus
from app.security import hash_password
from app.wallet_service import credit, ensure_indexes, get_or_create_wallet
from app.assignment_service import assign_player

SUPER_ADMIN_EMAIL = "superadmin@royal11.com"
SUPER_ADMIN_PASSWORD = "ChangeMe123!"


async def _create_user(email: str, password: str, display_name: str, role: Role,
                       created_by=None) -> dict:
    existing = await db.users.find_one({"email": email})
    if existing:
        print(f"  (already exists) {email}")
        return existing
    user = {
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(password),
        "display_name": display_name,
        "role": role.value,
        "status": UserStatus.ACTIVE.value,
        "created_by": created_by,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    await get_or_create_wallet(user["id"])
    print(f"  created {role.value}: {email} / {password}")
    return user


async def main(demo_chain: bool):
    await ensure_indexes()

    super_admin = await _create_user(SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, "Super Admin",
                                     Role.SUPER_ADMIN)

    if not demo_chain:
        print("\nDone. Log in with the Super Admin account above.")
        return

    manager = await _create_user("manager1@royal11.com", "ChangeMe123!", "Manager One",
                                 Role.MANAGER, created_by=super_admin["id"])
    if not await db.manager_allocations.find_one({"user_id": manager["id"]}):
        await db.manager_allocations.insert_one({
            "id": str(uuid.uuid4()), "user_id": manager["id"],
            "authorized_quota": 1_000_000, "allocated_out": 0,
            "zonal_manager_id": None, "max_admins_allowed": None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        await credit(manager["id"], TxnType.SUPER_ADMIN_TO_MANAGER, 1_000_000,
                     actor_id=super_admin["id"], reason="Seed funding",
                     request_id=f"seed-fund:{manager['id']}")

    # Zonal Manager demo (the new tier). manager1 above intentionally has NO
    # zone (backward-compat case); zonal1 owns its own funded wallet + quota so
    # it can create/fund Managers in its zone via the API.
    zonal = await _create_user("zonal1@royal11.com", "ChangeMe123!", "Zonal One",
                               Role.ZONAL_MANAGER, created_by=super_admin["id"])
    if not await db.zonal_manager_allocations.find_one({"user_id": zonal["id"]}):
        await db.zonal_manager_allocations.insert_one({
            "id": str(uuid.uuid4()), "user_id": zonal["id"],
            "authorized_quota": 2_000_000, "allocated_out": 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        await credit(zonal["id"], TxnType.SUPER_ADMIN_TO_ZONAL, 2_000_000,
                     actor_id=super_admin["id"], reason="Seed funding (zonal)",
                     request_id=f"seed-fund-zonal:{zonal['id']}")

    admin = await _create_user("admin1@royal11.com", "ChangeMe123!", "Admin One",
                               Role.ADMIN, created_by=manager["id"])
    if not await db.admin_allocations.find_one({"user_id": admin["id"]}):
        await db.admin_allocations.insert_one({
            "id": str(uuid.uuid4()), "user_id": admin["id"], "manager_id": manager["id"],
            "player_capacity": 20, "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        await credit(admin["id"], TxnType.MANAGER_TO_ADMIN, 200_000, actor_id=manager["id"],
                     reason="Seed allocation", request_id=f"seed-alloc:{admin['id']}")

    player = await _create_user("player1@royal11.com", "ChangeMe123!", "Rahul Sharma",
                                Role.PLAYER, created_by=admin["id"])
    await assign_player(player["id"], admin["id"], changed_by_id=super_admin["id"], reason="Seed data")
    await credit(player["id"], TxnType.WELCOME_BONUS, 1000, reason="Welcome bonus",
                 request_id=f"welcome:{player['id']}")

    print("\nDone. Seeded accounts (password for all: ChangeMe123!):")
    print(f"  Super Admin:    {SUPER_ADMIN_EMAIL}")
    print(f"  Zonal Manager:  zonal1@royal11.com")
    print(f"  Manager:        manager1@royal11.com  (no zone — backward-compat)")
    print(f"  Admin:          admin1@royal11.com")
    print(f"  Player:         player1@royal11.com")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo-chain", action="store_true",
                        help="Also create a Manager -> Admin -> Player chain with funded wallets")
    args = parser.parse_args()
    try:
        asyncio.run(main(args.demo_chain))
    except KeyError as e:
        print(f"Missing required env var {e} — is backend/.env set up? See README.md.", file=sys.stderr)
        sys.exit(1)
