"""组件 → 数据源账本 —— 每个元素用了哪个数据集，落在 bi_dash_item_source 里.

为什么要有这张表：数据源只服务「读取」，绑定关系原来只埋在 `bi_canvas.doc` 的 JSON 里，
想回答「这个数据集被哪几个看板 / 哪一页 / 哪个元素在用」得把整份文档捞出来解析 —— 无法索引、无法关联。
保存 / 发布时按文档整体重建这张表，于是：

    dashboard_id → view_key（页面 ID）→ item_key（元素 ID）→ dataset_id

四个维度都能单独查，颗粒度和画布上的 ID 一致。

约定：
* 只有真正取数的元素才记（`spec.binding.dataset_id` 或筛选栏 `fields[].dataset_map`）；
* 标题 / 文字 / 形状这类页面元素不记（它们不读数据）；
* 一个元素绑多个数据集（筛选栏按平台映射）就多行，`role` 说明是哪一个绑定。
"""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import text
from sqlalchemy.orm import Session


def _as_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _spec_of(item: dict) -> dict:
    spec = item.get("spec")
    return spec if isinstance(spec, dict) else {}


def _view_items(view: dict) -> Iterable[dict]:
    for item in view.get("items") or []:
        if isinstance(item, dict):
            yield item
    for group in (view.get("items_map") or {}).values():
        for item in group or []:
            if isinstance(item, dict):
                yield item


def collect(doc: dict) -> list[dict]:
    """从一份看板文档里抽出「元素 → 数据集」清单（去重，按页面 ID + 元素 ID + 数据集）."""
    rows: dict[tuple[str, str, int], dict] = {}

    def add(view_key: str, item: dict, dataset_id: int | None, role: str) -> None:
        if not dataset_id:
            return
        spec = _spec_of(item)
        binding = spec.get("binding") if isinstance(spec.get("binding"), dict) else {}
        dims = []
        for key in ("dimension", "split"):
            value = binding.get(key)
            if isinstance(value, str) and value:
                dims.append(value)
        for value in binding.get("dimensions") or []:
            if isinstance(value, str) and value not in dims:
                dims.append(value)
        row = {
            "dashboard_id": 0,  # 由调用方补
            "view_key": view_key[:120],
            "item_key": str(item.get("key") or "")[:120],
            "item_kind": str(spec.get("kind") or item.get("component") or "").replace("base.", "")[:32],
            "item_type": str(item.get("type") or "chart")[:16],
            "dataset_id": dataset_id,
            "role": role[:40],
            "metric": str(binding.get("metric") or "")[:120],
            "dimension": ",".join(dims)[:200],
        }
        rows[(row["view_key"], row["item_key"], dataset_id)] = row

    for view in doc.get("views") or []:
        if not isinstance(view, dict):
            continue
        view_key = str(view.get("key") or "")
        for item in _view_items(view):
            spec = _spec_of(item)
            binding = spec.get("binding") if isinstance(spec.get("binding"), dict) else {}
            add(view_key, item, _as_int(binding.get("dataset_id")), "primary")
            # 筛选栏按平台挂不同数据集：每个映射都记一行，删数据集前能查到
            fields = (spec.get("filter") or {}).get("fields") or []
            for field in fields:
                mapping = (field or {}).get("dataset_map") or {}
                if not isinstance(mapping, dict):
                    continue
                for platform, mapped in mapping.items():
                    add(view_key, item, _as_int(mapped), f"platform:{platform}"[:40])
    return list(rows.values())


def rebuild(db: Session, dashboard_id: int, doc: dict) -> int:
    """按文档重建这个看板的账本（保存 / 发布时调用），返回行数."""
    rows = collect(doc or {})
    db.execute(text("DELETE FROM bi_dash_item_source WHERE dashboard_id = :id"), {"id": dashboard_id})
    if rows:
        db.execute(
            text(
                """
                INSERT INTO bi_dash_item_source
                    (dashboard_id, view_key, item_key, item_kind, item_type, dataset_id, role, metric, dimension)
                VALUES
                    (:dashboard_id, :view_key, :item_key, :item_kind, :item_type, :dataset_id, :role, :metric, :dimension)
                """
            ),
            [{**row, "dashboard_id": dashboard_id} for row in rows],
        )
    db.commit()
    return len(rows)


def list_for(db: Session, dashboard_id: int) -> list[dict]:
    """这个看板的「元素 → 数据集」账本（带数据集名，方便直接看）."""
    result = db.execute(
        text(
            """
            SELECT s.view_key, s.item_key, s.item_kind, s.item_type, s.dataset_id,
                   s.role, s.metric, s.dimension, d.name AS dataset_name, s.updated_at
            FROM bi_dash_item_source s
            LEFT JOIN bi_dataset d ON d.id = s.dataset_id
            WHERE s.dashboard_id = :id
            ORDER BY s.view_key, s.item_key, s.dataset_id
            """
        ),
        {"id": dashboard_id},
    )
    return [
        {
            "view_key": r[0], "item_key": r[1], "item_kind": r[2], "item_type": r[3],
            "dataset_id": r[4], "role": r[5], "metric": r[6], "dimension": r[7],
            "dataset_name": r[8] or "", "updated_at": str(r[9] or ""),
        }
        for r in result.fetchall()
    ]


def usages_of_dataset(db: Session, dataset_id: int) -> list[dict]:
    """哪些看板 / 页面 / 元素在用这个数据集（删数据源前的安全查询）."""
    result = db.execute(
        text(
            """
            SELECT s.dashboard_id, c.name, s.view_key, s.item_key, s.item_kind, s.role
            FROM bi_dash_item_source s
            LEFT JOIN bi_canvas c ON c.id = s.dashboard_id
            WHERE s.dataset_id = :id AND c.deleted_at IS NULL
            ORDER BY s.dashboard_id, s.view_key, s.item_key
            """
        ),
        {"id": dataset_id},
    )
    return [
        {
            "dashboard_id": r[0], "dashboard_name": r[1] or "",
            "view_key": r[2], "item_key": r[3], "item_kind": r[4], "role": r[5],
        }
        for r in result.fetchall()
    ]


def drop_for(db: Session, dashboard_id: int) -> None:
    """看板删除时清掉它的账本行（软删的看板不再算「在用」）."""
    db.execute(text("DELETE FROM bi_dash_item_source WHERE dashboard_id = :id"), {"id": dashboard_id})
    db.commit()


def backfill(db: Session) -> int:
    """启动时按现有文档重建一遍（幂等；文档可能由手工 SQL 改过）."""
    rows = db.execute(text("SELECT id, doc FROM bi_canvas WHERE deleted_at IS NULL")).fetchall()
    total = 0
    for r in rows:
        doc = r[1]
        if isinstance(doc, str):
            import json
            try:
                doc = json.loads(doc)
            except ValueError:
                continue
        if not isinstance(doc, dict):
            continue
        total += rebuild(db, int(r[0]), doc)
    return total
