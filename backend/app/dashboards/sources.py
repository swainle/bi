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

from app.timezone import time_text

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
            "dataset_name": r[8] or "", "updated_at": time_text(r[9] or ""),
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


def field_hits_in_doc(
    doc: dict,
    dataset_id: int,
    field_names: Iterable[str],
    dashboard_id: int = 0,
    dashboard_name: str = "",
) -> dict[str, list[dict]]:
    """在一份看板文档里找字段使用点（纯函数，便于回归）.

    使用点包括：绑定了该数据集的元素里，字段出现在 `binding.dimension / dimensions / split / metric`，
    以及筛选栏 `filter.fields[].column`（筛选栏通过 dataset_map 或元素自身绑定挂到该数据集）。
    """
    wanted = {str(n) for n in field_names if n}
    out: dict[str, list[dict]] = {name: [] for name in wanted}
    if not wanted or not isinstance(doc, dict):
        return out

    for view in doc.get("views") or []:
        if not isinstance(view, dict):
            continue
        view_key = str(view.get("key") or "")
        for item in _view_items(view):
            spec = _spec_of(item)
            binding = spec.get("binding") if isinstance(spec.get("binding"), dict) else {}
            item_key = str(item.get("key") or "")
            kind = str(spec.get("kind") or item.get("component") or "").replace("base.", "")[:32]
            bound_here = _as_int(binding.get("dataset_id")) == dataset_id

            if bound_here:
                dims: list[str] = []
                for key in ("dimension", "split"):
                    value = binding.get(key)
                    if isinstance(value, str) and value:
                        dims.append(value)
                for value in binding.get("dimensions") or []:
                    if isinstance(value, str) and value:
                        dims.append(value)
                metric = str(binding.get("metric") or "")
                for name in wanted:
                    if name in dims or metric == name:
                        out[name].append({
                            "dashboard_id": dashboard_id, "dashboard_name": dashboard_name,
                            "view_key": view_key, "item_key": item_key, "item_kind": kind,
                            "role": "metric" if metric == name else "dimension",
                        })

            for field in (spec.get("filter") or {}).get("fields") or []:
                if not isinstance(field, dict):
                    continue
                column = str(field.get("column") or "")
                if column not in wanted:
                    continue
                mapping = field.get("dataset_map") or {}
                mapped = {_as_int(v) for v in mapping.values()} if isinstance(mapping, dict) else set()
                if not bound_here and dataset_id not in mapped:
                    continue
                out[column].append({
                    "dashboard_id": dashboard_id, "dashboard_name": dashboard_name,
                    "view_key": view_key, "item_key": item_key, "item_kind": "filter",
                    "role": f"filter:{str(field.get('label') or field.get('id') or '')[:32]}",
                })
    return out


def usages_of_field(
    db: Session,
    dataset_id: int,
    field_names: Iterable[str],
) -> dict[str, list[dict]]:
    """字段级血缘：这个数据集的字段被哪些看板 / 页面元素当维度、指标或筛选用到.

    为什么要扫文档而不是只读账本：账本只记了 element → dataset（含 dimension/metric 摘要），
    筛选栏用的是哪个字段（`filter.fields[].column`）没有单独落表；字段级要准，这里直接按文档解析。
    数据量是「在用看板数」，量级很小；返回 `{字段名: [使用点…]}`。
    """
    wanted = {str(n) for n in field_names if n}
    if not wanted:
        return {}

    rows = db.execute(
        text("SELECT id, name, doc FROM bi_canvas WHERE deleted_at IS NULL")
    ).fetchall()
    out: dict[str, list[dict]] = {name: [] for name in wanted}

    for dashboard_id, dashboard_name, doc in rows:
        if isinstance(doc, str):
            try:
                import json

                doc = json.loads(doc)
            except ValueError:
                continue
        for name, items in field_hits_in_doc(
            doc, dataset_id, wanted, dashboard_id, dashboard_name or ""
        ).items():
            out[name].extend(items)

    # 同一使用点去重（筛选栏按平台映射可能命中多次）
    for name, items in out.items():
        seen = set()
        unique = []
        for item in items:
            key = (item["dashboard_id"], item["view_key"], item["item_key"], item["role"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(item)
        out[name] = unique
    return out


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
