"""把看板文档从 12 栏流式布局转成自由画布坐标（x/y/w/h）.

设计宽度 1440：外留 12，列宽按 12 栏 + 16 间距计算。
幂等：已有 layout 的元素保持不动（只补缺失的）。
"""

from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.dashboards import repository as repo  # noqa: E402
from app.dashboards.models import validate_doc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from sqlalchemy import text  # noqa: E402

DESIGN_W = 1440
PAD = 12
GAP = 16
COLS = 12
COL_W = (DESIGN_W - PAD * 2 - GAP * (COLS - 1)) / COLS


def place(items: list[dict]) -> None:
    y = PAD
    row_span = 0
    row_h = 0

    def flush() -> None:
        nonlocal y, row_span, row_h
        if row_span:
            y += row_h + GAP
            row_span = 0
            row_h = 0

    for item in items:
        if item.get("layout"):
            continue
        span = max(1, min(12, int(item.get("span") or 4)))
        h = max(30, int(item.get("h") or 260))
        if span >= COLS:
            flush()
            item["layout"] = {"x": PAD, "y": y, "w": DESIGN_W - PAD * 2, "h": h}
            y += h + GAP
            continue
        if row_span + span > COLS:
            flush()
        w = round(span * COL_W + (span - 1) * GAP)
        x = round(PAD + row_span * (COL_W + GAP))
        item["layout"] = {"x": x, "y": y, "w": w, "h": h}
        row_span += span
        row_h = max(row_h, h)
        if row_span >= COLS:
            flush()
    flush()


def main() -> int:
    db = SessionLocal()
    try:
        docs = db.execute(text(
            "SELECT id, name, code, doc FROM bi_canvas WHERE doc IS NOT NULL"
        )).fetchall()
        for _id, name, code, doc in docs:
            if isinstance(doc, str):
                doc = json.loads(doc)
            changed = 0
            for view in (doc or {}).get("views", []):
                before = sum(1 for i in view.get("items", []) if i.get("layout"))
                place(view.get("items", []))
                changed += sum(1 for i in view.get("items", []) if i.get("layout")) - before
            repo.save(db, _id, validate_doc(doc))
            print(f"{name} ({code}): 补坐标 {changed} 个元素")
        # 同步种子文档，保证新环境也是自由画布
        for code in ("board.rank", "board.demand"):
            row = repo.get_by_code(db, code)
            if not row:
                continue
            path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                "app", "dashboards", "seed_docs", f"{code}.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"code": code, "name": row.name, "doc": row.doc},
                          fh, ensure_ascii=False, indent=2)
            print(f"seed 更新：{path}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
