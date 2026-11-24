"""组件导出 / 导入（JSON 文件）：把一个组件搬到另一个环境.

导出文件只带两样东西：
- **组件本身**：name / kind / category / description / spec；
- **数据集引用**：`id`（同环境可直接用）+ `name` / `physical_table`（跨环境按这两项找回本地数据集）。

导入时按 `physical_table` → `name` 顺序在本环境找数据集：找到就把 spec 里所有 `dataset_id`
重写到本地 id；找不到就**清掉 dataset_id** 并在返回里提示，避免组件带着一个不存在的 id 落地。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.timezone import china_now

EXPORT_FORMAT = "mcbi.component"
EXPORT_VERSION = 1


def build_payload(component: dict, dataset: dict | None = None) -> dict:
    """组装导出文件内容（前端拿到后自己存成 .json）."""
    return {
        "format": EXPORT_FORMAT,
        "version": EXPORT_VERSION,
        "exported_at": china_now().isoformat(timespec="seconds"),
        "component": {
            "name": str(component.get("name") or component.get("code") or "组件"),
            "kind": str(component.get("kind") or ""),
            "category": str(component.get("category") or "通用"),
            "description": str(component.get("description") or ""),
            "spec": component.get("spec") or {},
        },
        "dataset": dataset,
    }


def first_dataset_id(node: Any) -> int | None:
    """递找到第一个 dataset_id（binding / 明细块 / 字段映射都在用这个键）."""
    if isinstance(node, dict):
        value = node.get("dataset_id")
        if isinstance(value, (int, float)) and int(value) > 0:
            return int(value)
        for child in node.values():
            found = first_dataset_id(child)
            if found:
                return found
    elif isinstance(node, list):
        for child in node:
            found = first_dataset_id(child)
            if found:
                return found
    return None


def remap_dataset_ids(node: Any, dataset_id: int | None) -> Any:
    """把 spec 里所有 dataset_id 换成新值；`None` = 本地没有这份数据，直接把这个键去掉."""
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for key, value in node.items():
            if key == "dataset_id":
                if dataset_id:
                    out[key] = dataset_id
                continue
            out[key] = remap_dataset_ids(value, dataset_id)
        return out
    if isinstance(node, list):
        return [remap_dataset_ids(item, dataset_id) for item in node]
    return node


def normalize_payload(raw: Any) -> tuple[dict, dict | None]:
    """校验导入文件，返回 (组件字段, 数据集引用)；不合法抛 ValueError（路由转 400）."""
    if not isinstance(raw, dict):
        raise ValueError("文件内容不是有效的组件 JSON")
    if raw.get("format") != EXPORT_FORMAT:
        raise ValueError("这不是明策BI 组件文件")
    try:
        version = int(raw.get("version") or 0)
    except (TypeError, ValueError):
        version = 0
    if version > EXPORT_VERSION:
        raise ValueError("文件版本比当前系统新，请先升级系统")
    component = raw.get("component")
    if not isinstance(component, dict):
        raise ValueError("文件里没有组件内容")
    spec = component.get("spec")
    if not isinstance(spec, dict) or not spec:
        raise ValueError("文件里没有组件配置")
    kind = str(component.get("kind") or "").strip()
    if not kind:
        raise ValueError("文件里缺少组件类型")
    dataset = raw.get("dataset")
    return {
        "name": str(component.get("name") or "导入的组件")[:60],
        "kind": kind,
        "category": str(component.get("category") or "通用")[:20],
        "description": str(component.get("description") or "")[:200],
        "spec": spec,
    }, (dataset if isinstance(dataset, dict) else None)


def dataset_ref(db: Session, dataset_id: int | None) -> dict | None:
    if not dataset_id:
        return None
    row = db.execute(
        text("SELECT id, name, physical_table FROM bi_dataset WHERE id = :id"),
        {"id": dataset_id},
    ).first()
    if row is None:
        return None
    return {"id": int(row[0]), "name": row[1] or "", "physical_table": row[2] or ""}


def find_dataset_id(db: Session, ref: dict | None) -> int | None:
    """按物理表 → 名称找本环境的数据集（同 id 只作参考，不做信任）."""
    if not ref:
        return None
    physical = str(ref.get("physical_table") or "").strip()
    if physical:
        row = db.execute(
            text("SELECT id FROM bi_dataset WHERE physical_table = :t ORDER BY id LIMIT 1"),
            {"t": physical},
        ).first()
        if row:
            return int(row[0])
    name = str(ref.get("name") or "").strip()
    if name:
        row = db.execute(
            text("SELECT id FROM bi_dataset WHERE name = :n ORDER BY id LIMIT 1"),
            {"n": name},
        ).first()
        if row:
            return int(row[0])
    return None


__all__ = [
    "EXPORT_FORMAT", "EXPORT_VERSION", "build_payload", "first_dataset_id",
    "remap_dataset_ids", "normalize_payload", "dataset_ref", "find_dataset_id",
]
