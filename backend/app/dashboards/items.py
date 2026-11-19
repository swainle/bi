"""往看板文档里插元素（S5）—— MCP 写工具与编辑器「AI 推荐组件」共用.

硬规矩（docs/MCP与Agent权限接入方案.md §13）：
    * 字段一律从目标数据集的 `bi_dataset_field` / 指标里选，禁止编造字段名；
    * 元素先过 `ItemDef` 校验，key 由这里统一生成（不信任调用方）；
    * 不写库 —— 调用方拿到新文档后自己走 `repo.save` / 乐观锁流程。
"""

from __future__ import annotations

import copy
from typing import Any

from sqlalchemy.orm import Session

from app.components import catalog as chart_catalog
from app.components import repository as component_repo
from app.dashboards.models import DashboardDoc, ItemDef, validate_doc
from app.semantic import repository as sem_repo

GRID = 8
DEFAULT_ROW_W = 464          # 464 × 3 + 16 × 2 = 1424，右侧留 16
DEFAULT_GAP = 16
# 整版块：x=0、宽 1440（与前端 FULL_WIDTH_KINDS 一致）
FULL_WIDTH_KINDS = {"banner", "nav", "filter", "table"}
FULL_WIDTH = 1440


class ItemBuildError(ValueError):
    """元素构建失败（参数/字段问题，调用方按 400 返回）."""


def _kind_height(kind: str, spec: dict | None) -> int:
    try:
        height = int(((spec or {}).get("ui") or {}).get("min_height") or 0)
    except (TypeError, ValueError):
        height = 0
    if height:
        return max(68, min(900, height))
    return 104 if kind == "kpi" else 64 if kind == "nav" else 320 if kind == "table" else 260


def default_size(kind: str, spec: dict | None = None) -> tuple[int, int]:
    """默认尺寸：整版块 1440 宽，普通卡片 464 宽（一排 3 张）."""
    h = _kind_height(kind, spec)
    if kind in FULL_WIDTH_KINDS:
        return FULL_WIDTH, h
    return DEFAULT_ROW_W, h


def dataset_schema(db: Session, dataset_id: int) -> dict:
    """可用字段 / 指标（维度优先取可分组字段，指标优先取已认证指标）."""
    fields = sem_repo.list_fields(db, dataset_id)
    metrics = sem_repo.list_metrics(db, dataset_id)
    dims = [f for f in fields if f.role in ("dimension", "time") and f.is_groupable]
    times = [f for f in dims if f.role == "time"]
    measures = [f for f in fields if f.role == "measure"]
    plain_dims = [f for f in dims if f.role == "dimension"]
    return {
        "fields": fields,
        "metrics": metrics,
        "dims": dims,
        "plain_dims": plain_dims,
        "times": times,
        "measures": measures,
        "metric_names": [m.name for m in metrics],
        "allowed": {f.name for f in fields} | {m.name for m in metrics},
    }


def _pick_metric(schema: dict) -> str | None:
    if schema["metric_names"]:
        return schema["metric_names"][0]
    if schema["measures"]:
        return schema["measures"][0].name
    return None


def _pick_dim(schema: dict, prefer_time: bool = False) -> str | None:
    if prefer_time and schema["times"]:
        return schema["times"][0].name
    if schema["plain_dims"]:
        return schema["plain_dims"][0].name
    if schema["times"]:
        return schema["times"][0].name
    return None


def _pick_binding(entry: dict, schema: dict) -> dict | None:
    """按图表类型挑维度 / 指标；挑不出来（数据集没这类字段）就返回 None."""
    entry_id = str(entry.get("id") or "")
    kind = str(entry.get("kind") or "")
    metric = _pick_metric(schema)
    if metric is None:
        return None

    if entry_id == "kpi.value":
        return {"dimension": None, "metric": metric, "metrics": []}
    if entry_id == "kpi.latest":
        dim = _pick_dim(schema, prefer_time=True)
        if dim is None:
            return None
        return {"dimension": dim, "metric": None, "metrics": []}
    if entry_id in ("kpi.top", "kpi.rank"):
        dim = _pick_dim(schema)
        if dim is None:
            return None
        return {"dimension": dim, "metric": metric, "metrics": []}
    if kind == "table":
        dim = _pick_dim(schema)
        if dim is None:
            return None
        pool = schema["metric_names"] + [f.name for f in schema["measures"]]
        picked = list(dict.fromkeys(pool))[:3]
        return {"dimension": dim, "metric": metric,
                "metrics": [{"name": name, "agg": "SUM"} for name in picked]}
    dim = _pick_dim(schema, prefer_time=kind in ("line", "area"))
    if dim is None:
        return None
    return {"dimension": dim, "metric": metric, "metrics": [], "series": None, "split": None}


def build_from_catalog(
    db: Session, dataset_id: int, entry_id: str, *,
    key: str, title: str = "", spec_patch: dict | None = None,
    layout: dict | None = None,
) -> dict:
    """按图表目录条目构建一个元素（字段自动落到目标数据集）."""
    entry = chart_catalog.find(entry_id)
    if entry is None:
        raise ItemBuildError(f"图表类型不存在：{entry_id}")
    schema = dataset_schema(db, dataset_id)
    binding = _pick_binding(entry, schema)
    if binding is None:
        raise ItemBuildError(f"数据集缺少「{entry.get('label')}」需要的字段（维度或指标）")

    spec = copy.deepcopy(entry.get("defaults") or {})
    spec["title"] = title or entry.get("label") or "组件"
    spec["binding"] = {**(spec.get("binding") or {}), "dataset_id": int(dataset_id), **binding}
    # 目录默认里带演示字段的图表轴/拆列一律清掉，避免引用不存在的字段
    chart = spec.setdefault("chart", {})
    for name in ("x_key", "y_key", "size_key", "hbar_threshold_key"):
        chart[name] = ""
    if spec_patch:
        spec = deep_merge(spec, spec_patch)
        spec.setdefault("binding", {})["dataset_id"] = int(dataset_id)
    _assert_fields(spec, schema["allowed"])

    kind = str(entry.get("kind") or "kpi")
    w, h = default_size(kind, spec)
    return _item(key, kind, spec, title or spec["title"], layout, w, h)


def build_from_component(
    db: Session, dataset_id: int, component_code: str, *,
    key: str, title: str = "", spec_patch: dict | None = None,
    layout: dict | None = None,
) -> dict:
    """按组件库条目构建元素（组件库里的 spec 直接复用，字段仍需存在于数据集）."""
    component = component_repo.get_by_code(db, component_code)
    if component is None:
        raise ItemBuildError(f"组件库条目不存在：{component_code}")
    schema = dataset_schema(db, dataset_id)
    spec = copy.deepcopy(component.spec or {})
    spec["title"] = title or component.name
    spec.setdefault("binding", {})["dataset_id"] = int(dataset_id)
    if spec_patch:
        spec = deep_merge(spec, spec_patch)
        spec.setdefault("binding", {})["dataset_id"] = int(dataset_id)
    _assert_fields(spec, schema["allowed"])

    kind = str(component.kind or "kpi")
    w, h = default_size(kind, spec)
    return _item(key, kind, spec, title or component.name, layout, w, h)


def _item(key: str, kind: str, spec: dict, title: str,
          layout: dict | None, w: int, h: int) -> dict:
    box = layout or {}
    raw = {
        "key": key,
        "type": "filter" if kind == "filter" else "chart",
        "component": f"base.{kind}",
        "title": title[:80],
        "spec": spec,
        "h": int(box.get("h") or h),
        "span": 12 if kind in FULL_WIDTH_KINDS else 4,
        "layout": {
            "x": int(box.get("x") or 0),
            "y": int(box.get("y") or 0),
            "w": int(box.get("w") or w),
            "h": int(box.get("h") or h),
        },
    }
    ItemDef(**raw)  # 校验不过直接抛（ValueError）
    return raw


def deep_merge(base: dict, patch: dict) -> dict:
    for name, value in (patch or {}).items():
        if isinstance(value, dict) and isinstance(base.get(name), dict):
            base[name] = deep_merge(base[name], value)
        else:
            base[name] = value
    return base


def _spec_refs(spec: dict) -> list[tuple[str, str]]:
    """spec 里引用字段的位置 → [(路径, 名称)]，用于「字段必须存在」校验."""
    binding = spec.get("binding") or {}
    refs: list[tuple[str, str]] = []
    for name in ("dimension", "metric", "series", "split"):
        value = binding.get(name)
        if isinstance(value, str) and value:
            refs.append((f"binding.{name}", value))
    for name in ("dimensions", "metrics"):
        for index, item in enumerate(binding.get(name) or []):
            value = item.get("name") if isinstance(item, dict) else item
            if isinstance(value, str) and value:
                refs.append((f"binding.{name}[{index}]", value))
    for index, item in enumerate(((spec.get("filter") or {}).get("fields") or [])):
        value = item.get("column") if isinstance(item, dict) else None
        if isinstance(value, str) and value:
            refs.append((f"filter.fields[{index}].column", value))
    return refs


def _assert_fields(spec: dict, allowed: set[str]) -> None:
    missing = [f"{path}={name}" for path, name in _spec_refs(spec) if name not in allowed]
    if missing:
        raise ItemBuildError("数据集里不存在这些字段/指标：" + "、".join(missing))


def next_key(doc: DashboardDoc | dict, prefix: str = "c") -> str:
    raw = doc.model_dump() if isinstance(doc, DashboardDoc) else doc
    existing = {str(item.get("key") or "") for view in (raw.get("views") or [])
                for item in (view.get("items") or [])}
    existing |= {str(item.get("key") or "") for view in (raw.get("views") or [])
                 for items in (view.get("items_map") or {}).values()
                 for item in (items or [])}
    number = 1
    while f"{prefix}_{number:03d}" in existing:
        number += 1
    return f"{prefix}_{number:03d}"


def append_item(doc: DashboardDoc | dict, item: dict, view_key: str | None = None) -> DashboardDoc:
    """把元素追加到指定视图，返回校验后的新文档（不写库）."""
    raw = doc.model_dump() if isinstance(doc, DashboardDoc) else copy.deepcopy(doc)
    views = raw.get("views") or []
    if not views:
        raise ItemBuildError("看板没有视图，无法添加元素")
    view = next((v for v in views if v.get("key") == view_key), None) or views[0]
    view["items"] = list(view.get("items") or []) + [item]
    return validate_doc(raw)


def bottom_y(doc: DashboardDoc | dict, view_key: str | None = None) -> int:
    """当前视图最低点（新元素默认接在下面，间距 16）."""
    raw = doc.model_dump() if isinstance(doc, DashboardDoc) else doc
    views = raw.get("views") or []
    view = next((v for v in views if v.get("key") == view_key), None) or (views[0] if views else None)
    if view is None:
        return 0
    bottom = 0
    for item in view.get("items") or []:
        layout = item.get("layout") or {}
        bottom = max(bottom, int(layout.get("y") or 0) + int(layout.get("h") or item.get("h") or 0))
    return (bottom + DEFAULT_GAP) if bottom else 0


__all__ = [
    "DEFAULT_GAP", "DEFAULT_ROW_W", "FULL_WIDTH", "FULL_WIDTH_KINDS", "GRID",
    "ItemBuildError", "append_item", "bottom_y", "build_from_catalog",
    "build_from_component", "dataset_schema", "deep_merge", "default_size", "next_key",
]
