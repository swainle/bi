"""A4 组件推荐（S5）—— 按数据集字段推荐 3~5 个组件.

复用 `app/dashboards/items.py` 的构建逻辑（与 MCP `bi_add_item` 同一套），
只产出「元素定义」；落到空位、进撤销栈由前端完成。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.dashboards.items import ItemBuildError, build_from_catalog

# 顺序 = 推荐优先级；挑不出字段的条目自动跳过
CANDIDATES: list[tuple[str, str]] = [
    ("kpi.value", "{metric}总览"),
    ("table.detail", "明细数据"),
    ("line.time", "{dim}趋势"),
    ("bar.dim", "按{dim}分布"),
    ("pie.share", "{dim}占比"),
    ("hbar.top", "{dim}排行"),
]


def recommend(db: Session, dataset: Any, limit: int = 5) -> list[dict]:
    limit = max(1, min(int(limit or 5), len(CANDIDATES)))
    items: list[dict] = []
    for index, (entry_id, title_tpl) in enumerate(CANDIDATES, start=1):
        try:
            item = build_from_catalog(
                db, int(dataset.id), entry_id, key=f"ai_{index:03d}", title="",
            )
        except (ItemBuildError, ValueError):
            continue
        binding = (item.get("spec") or {}).get("binding") or {}
        title = title_tpl.format(
            metric=binding.get("metric") or "指标",
            dim=binding.get("dimension") or "维度",
        )
        item["title"] = title
        (item.get("spec") or {})["title"] = title
        items.append(item)
        if len(items) >= limit:
            break
    return items


__all__ = ["CANDIDATES", "recommend"]
