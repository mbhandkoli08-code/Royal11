"""One-off helper: reset demo Fantasy contests + player teams to OPEN so
we can re-run E2E tests. Also refreshes lock_at (which may have gone stale)."""
import asyncio
from datetime import datetime, timedelta, timezone

from app.db import db


async def main():
    now = datetime.now(timezone.utc)
    fresh_lock = (now + timedelta(hours=6)).isoformat()
    ids = ["demo-contest-mega", "demo-contest-h2h", "demo-contest-free"]
    res = await db.fantasy_teams.delete_many({"contest_id": {"$in": ids}})
    print("teams deleted:", res.deleted_count)
    r2 = await db.fantasy_contests.update_many(
        {"id": {"$in": ids}},
        {"$set": {"status": "OPEN", "participant_count": 0, "lock_at": fresh_lock,
                  "settled_at": None}},
    )
    print("contests reset:", r2.modified_count)


if __name__ == "__main__":
    asyncio.run(main())
