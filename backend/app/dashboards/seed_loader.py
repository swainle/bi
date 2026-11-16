"""看板成品种子 —— 从 docs JSON 载入两个业务看板（幂等，不覆盖已有）."""

from __future__ import annotations

import json
import os

from sqlalchemy.orm import Session

from app.dashboards import repository as repo
from app.dashboards.models import validate_doc

DOCS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_docs")


def ensure_docs(db: Session) -> dict[str, int]:
    out: dict[str, int] = {}
    if not os.path.isdir(DOCS_DIR):
        return out
    for filename in sorted(os.listdir(DOCS_DIR)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(DOCS_DIR, filename), encoding="utf-8") as fh:
            payload = json.load(fh)
        code = payload.get("code") or filename[:-5]
        existing = repo.get_by_code(db, code)
        if existing:
            out[code] = existing.id
            continue
        doc = validate_doc(payload.get("doc") or {})
        row = repo.create(db, name=payload.get("name") or code, code=code, doc=doc, owner_id=None)
        out[code] = row.id
    return out


__all__ = ["ensure_docs"]
