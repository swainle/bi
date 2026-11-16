"""看板可追溯性审计：页面上的每个块，必须对应组件库里的一个组件.

校验：
    1. item.component 必须存在于 bi_component
    2. 组件的 kind 必须有渲染器（spec.KINDS）
    3. 动作目标组件必须存在
    4. 输出「页面块 → 组件 → kind」映射表 + 汇总

用法：
    cd backend && ./.venv/bin/python -m scripts.audit_dashboards
"""

from __future__ import annotations

import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.components.spec import KINDS  # noqa: E402
from app.database import SessionLocal  # noqa: E402


def main() -> int:
    db = SessionLocal()
    failures: list[str] = []
    try:
        components = {
            r[0]: {"kind": r[1], "name": r[2]}
            for r in db.execute(text(
                "SELECT code, kind, name FROM bi_component WHERE archived = false"
            )).fetchall()
        }
        rows = db.execute(text(
            "SELECT id, name, code, doc FROM bi_canvas WHERE doc IS NOT NULL ORDER BY id"
        )).fetchall()

        total_items = 0
        kind_counter: Counter[str] = Counter()
        usage: dict[str, int] = defaultdict(int)

        for row in rows:
            _id, name, code, doc = row
            if isinstance(doc, str):
                doc = json.loads(doc)
            views = (doc or {}).get("views") or []
            # 页面头的统计也占组件引用，别误报成"未被引用"
            for stat in (doc or {}).get("header", {}).get("stats", []) or []:
                if stat.get("component"):
                    usage[stat["component"]] += 1
            items = [(v, i) for v in views for i in (v.get("items") or [])]
            total_items += len(items)

            print(f"\n== {name}  (id={_id}, code={code or '-'})")
            print(f"   {len(views)} 个视图 / {len(items)} 个组件实例")

            for view, item in items:
                etype = item.get("type") or "chart"
                comp = item.get("component")
                info = components.get(comp)
                if etype in ("heading", "text", "divider"):
                    kind_counter[etype] += 1
                    continue
                if info is None:
                    failures.append(f"{name} / {item.get('key')}: 基础组件不存在 {comp}")
                    continue
                if info["kind"] not in KINDS:
                    failures.append(f"{name} / {item.get('key')}: kind 未注册 {info['kind']}")
                kind_counter[info["kind"]] += 1
                usage[comp] = usage.get(comp, 0) + 1

                for trigger in ("action", "row_action"):
                    action = item.get(trigger)
                    if action and not action.get("spec") and action.get("component") not in components:
                        failures.append(
                            f"{name} / {item.get('key')}: {trigger} 目标不存在 {action.get('component')}"
                        )

            # 逐视图打印映射（块 → 组件 → kind）
            for view in views:
                print(f"   · {view.get('key'):<9} {view.get('title') or ''}")
                for item in view.get("items") or []:
                    etype = item.get("type") or "chart"
                    info = components.get(item.get("component")) or {}
                    label = "标题" if etype == "heading" else "文字" if etype == "text" else "分割线" if etype == "divider" else info.get("kind", "?")
                    print(f"       {item.get('key'):<16} {(item.get('component') or etype):<20} "
                          f"{label:<8} span={item.get('span')}")

        print("\n== 汇总")
        print(f"   页面实例 {total_items} · 引用组件 {len(usage)} · kind {len(kind_counter)}")
        for kind, count in kind_counter.most_common():
            print(f"   {kind:<10} {count}")

        # 组件库中没被任何页面引用的组件（信息项，不算失败）
        unused = [code for code in components if code not in usage]
        print(f"\n   未被页面引用：{len(unused)} 个（{', '.join(unused[:8])}{'…' if len(unused) > 8 else ''}）")

        if failures:
            print("\n[FAIL]")
            for item in failures:
                print("  -", item)
            return 1
        print("\n[PASS] 页面上的每个块都能对应到组件库里的组件")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
