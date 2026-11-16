"""把现有业务看板标记为已发布（幂等）."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.dashboards import repository as repo  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from sqlalchemy import text  # noqa: E402


def main() -> int:
    db = SessionLocal()
    try:
        rows = db.execute(text("SELECT id, doc FROM bi_canvas WHERE doc IS NOT NULL")).fetchall()
        for _id, doc in rows:
            import json
            if isinstance(doc, str):
                doc = json.loads(doc)
            doc["published"] = True
            doc.setdefault("published_at", "2026-11-10T00:00:00")
            repo.save(db, _id, doc)
        print(f"已标记 {len(rows)} 个看板为已发布")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
