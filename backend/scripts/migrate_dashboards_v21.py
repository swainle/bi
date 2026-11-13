"""把看板文档升级到 v2.1（按池导出 / inline 化）.

背景（2026-11-10 用户定的模型）：
    * 组件库只保留「类型」——同类组件不在库里重复
    * 页面上的每张卡是类型组件的实例，自带 spec
    * 标题 / 文字 / 分割线是页面元素，不是组件

本脚本做三件事（幂等）：
    1. 建 15 个基础组件（base.*）
    2. 把现有看板里的业务组件实例转成「内联 spec + base code」，分节转标题元素
    3. 归档所有非 base 组件（不删除，避免数据丢失）

用法：
    cd backend && ./.venv/bin/python -m scripts.migrate_dashboards_v21
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.components import repository as component_repo  # noqa: E402
from app.components.seed_base import BASE_CODES, ensure_base  # noqa: E402
from app.dashboards import repository as dash_repo  # noqa: E402
from app.dashboards.models import validate_doc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.schema_migrations import run_all  # noqa: E402

BACKUP_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)


def _load_spec(db, code: str) -> tuple[str, dict] | None:
    component = component_repo.get_by_code(db, code) if code else None
    if component is None:
        return None
    return component.kind, component.spec


def _action_inline(db, action: dict) -> dict:
    code = action.get("component") or ""
    loaded = _load_spec(db, code)
    if loaded:
        kind, spec = loaded
        action = {**action, "component": f"base.{kind}", "spec": spec}
    return action


def _item_to_v21(db, item: dict) -> dict:
    code = item.get("component") or ""
    loaded = _load_spec(db, code)
    if not loaded:
        return item
    kind, spec = loaded

    # 分节 → 标题元素（不占组件库）
    if kind == "section":
        content = spec.get("content") or {}
        return {
            "key": item["key"],
            "type": "heading",
            "span": item.get("span", 12),
            "h": item.get("h", 56),
            "text": item.get("title") or spec.get("title") or "",
            "note": spec.get("subtitle") or "",
            "index": content.get("index") or "",
            "icon": content.get("icon") or "",
        }

    out = {
        **item,
        "type": "filter" if kind == "filter" else "chart",
        "component": f"base.{kind}",
        "spec": spec,
    }
    for trigger in ("action", "row_action"):
        if out.get(trigger):
            out[trigger] = _action_inline(db, out[trigger])
    return out


def main() -> int:
    executed = run_all()
    if executed:
        print(f"[migrate] 迁移：{', '.join(executed)}")

    db = SessionLocal()
    try:
        print(f"[migrate] 基础组件：{ensure_base(db)} 个")

        rows = db.execute(text("SELECT id, name, doc FROM bi_canvas WHERE doc IS NOT NULL")).fetchall()
        os.makedirs(BACKUP_DIR, exist_ok=True)
        backup_path = os.path.join(BACKUP_DIR, f"dashboard-docs-{time.strftime('%Y%m%d-%H%M%S')}.json")
        backup = [{"id": r[0], "name": r[1], "doc": r[2]} for r in rows]
        with open(backup_path, "w", encoding="utf-8") as fh:
            json.dump(backup, fh, ensure_ascii=False, indent=2, default=str)
        print(f"[migrate] 已备份 {len(backup)} 份文档 → {backup_path}")

        for _id, name, doc in rows:
            if isinstance(doc, str):
                doc = json.loads(doc)
            doc = doc or {}
            if float(doc.get("version") or 2) >= 2.1 and all(
                (item.get("type") or "chart") != "chart" or item.get("spec")
                for view in doc.get("views", [])
                for item in view.get("items", [])
            ):
                print(f"[migrate] {name}: 已是 v2.1，跳过")
                continue

            views = []
            for view in doc.get("views", []):
                items = [_item_to_v21(db, item) for item in view.get("items", [])]
                views.append({**view, "items": items})

            header = dict(doc.get("header") or {})
            stats = []
            for stat in header.get("stats", []) or []:
                loaded = _load_spec(db, stat.get("component") or "")
                if loaded:
                    kind, spec = loaded
                    stats.append({"label": stat.get("label") or spec.get("title") or "", "component": f"base.{kind}", "spec": spec})
                else:
                    stats.append(stat)
            header["stats"] = stats

            new_doc = validate_doc({**doc, "version": 2.1, "header": header, "views": views}).model_dump()
            dash_repo.save(db, _id, new_doc, name=None)
            charts = sum(1 for v in views for i in v["items"] if i.get("type") == "chart")
            headings = sum(1 for v in views for i in v["items"] if i.get("type") == "heading")
            print(f"[migrate] {name}: {len(views)} 视图 / {charts} 数据元素 / {headings} 标题元素")

        archived = db.execute(text(
            "UPDATE bi_component SET archived = true "
            "WHERE archived = false AND code NOT LIKE 'base.%'"
        ))
        db.commit()
        print(f"[migrate] 归档业务变体：{archived.rowcount} 个（保留 base.* 共 {len(BASE_CODES)} 个）")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
