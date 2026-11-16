"""看板渲染 —— 文档 → 每个数据元素的 payload.

原则：
    * 组件库只有「类型」，页面元素自带 spec；这里优先用内联 spec（兼容旧的 component 引用）
    * 筛选栏元素定义参数，参数在这里汇总成默认值，再注入所有数据组件
    * 动作（弹窗/抽屉）= 目标 spec + 覆盖参数，走同一个 resolve
    * 单卡出错不影响整页（返回 error 卡）
"""

from __future__ import annotations

import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from types import SimpleNamespace
from typing import Any

from sqlalchemy.orm import Session

from app.components import repository as component_repo
from app.components.resolver import apply_dataset_switch, resolve
from app.components.spec import ComponentSpec, ComponentSpecError, validate_spec
from app.dashboards.models import ActionDef, DashboardDoc, ItemDef, view_items_for
from app.database import SessionLocal
from app.security.errors import SecurityError

BASE_PREFIX = "base."


def _kind_from_code(code: str) -> str:
    return code[len(BASE_PREFIX):] if code and code.startswith(BASE_PREFIX) else ""


def _kind_of(db: Session, code: str) -> str:
    """元素类型：base.kpi → kpi；旧的业务组件 code → 查库拿 kind."""
    kind = _kind_from_code(code)
    if kind:
        return kind
    component = component_repo.get_by_code(db, code) if code else None
    return component.kind if component else ""


def _filter_fields_from(spec: ComponentSpec) -> list[dict]:
    return [field.model_dump() for field in spec.filter.fields]


def _is_split(field) -> bool:
    """分套依据：勾了 split（新）或带 dataset_map（旧）都算."""
    return bool(getattr(field, "split", False)) or bool(getattr(field, "dataset_map", None))


def _switcher_value(pairs: list, params: dict | None) -> str:
    """当前平台：请求参数优先，其次切换器字段的默认值."""
    requested = params or {}
    for _item, spec in pairs:
        for field in spec.filter.fields:
            if not _is_split(field):
                continue
            value = requested.get(field.id)
            if value in (None, "", [], {}, "all", "全部"):
                value = field.default
            if value in (None, "", [], {}, "all", "全部"):
                continue
            return str(value)
    return ""


def resolved_fields(filter_spec, platform: str) -> list:
    """该平台下这套筛选栏的字段：平台入口（切换器）永远取通用那份，
    其余字段按平台各取一套；某平台**没配**才回落到通用。

    配了就按它来 —— 通用里那些没出现在这套里的字段不再补回来，
    否则在面板里删掉的字段会从通用那份回落出来，看着像「删了没生效」。
    """
    shared = list(filter_spec.fields or [])
    per_platform = (filter_spec.fields_map or {}).get(platform) if platform else None
    if per_platform is None:
        return shared
    per_by_id = {f.id: f for f in per_platform if not _is_split(f)}
    # 顺序永远跟通用那份（= 配置页面的字段顺序）一致；分套字段留在原位，不再被提到最前
    out = []
    for field in shared:
        if _is_split(field):
            out.append(field)
        elif field.id in per_by_id:
            out.append(per_by_id[field.id])
    shared_ids = {f.id for f in shared}
    for field in per_platform:
        if field.id not in shared_ids and not _is_split(field):
            out.append(field)
    return out


def is_filter_item(item: Any) -> bool:
    """这条元素是不是筛选栏 —— 只看 type 不够：历史文档 / 组件库拖进来的筛选栏，
    type 可能存成 chart、component 是 base.filter（前端 isFilterBarItem 已按同一口径兜底）。
    后端漏判的后果是「整条筛选栏的参数都不算数」，卡片怎么点都不变。"""
    if getattr(item, "type", "") == "filter":
        return True
    code = str(getattr(item, "component", "") or "")
    return code == "base.filter" or code.endswith(".filter")


def collect_param_defs(db: Session, doc: DashboardDoc, view_key: str | None = None,
                       params: dict | None = None) -> list[dict]:
    """汇总当前视图筛选栏字段（已按当前平台解析）；同 id 后者覆盖前者."""
    pairs: list[tuple[object, ComponentSpec]] = []
    for view, item in doc.all_items():
        if view_key and view.key != view_key:
            continue
        if not is_filter_item(item):
            continue
        try:
            if item.spec:
                kind = _kind_of(db, item.component) or "filter"
                spec = validate_spec(kind, item.spec)
            elif item.component:
                component = component_repo.get_by_code(db, item.component)
                if component is None:
                    continue
                spec = validate_spec(component.kind, component.spec)
            else:
                continue
        except Exception:
            continue
        pairs.append((item, spec))

    platform = _switcher_value(pairs, params)
    defs: dict[str, dict] = {}
    for item, spec in pairs:
        for field in resolved_fields(spec.filter, platform):
            merge_param_def(defs, field.model_dump(), item.component)
    return list(defs.values())


def merge_param_def(defs: dict[str, dict], data: dict, component: str | None = None) -> None:
    """把一个筛选字段并进 defs（同 id 后者覆盖前者，但**空壳不能顶掉绑了列的那条**）.

    同一个 id 出现两次很常见：页面上留了两条筛选栏、旧筛选栏没删、复制文档留下的副本。
    如果后一条还没绑字段（column 空），它会把前一条已经配好的过滤条件整页顶掉 ——
    现象就是「筛选栏上明明选着值，卡片纹丝不动」（2026-11-15 用户实测）。
    """
    existing = defs.get(data.get("id"))
    if existing is not None \
            and str(existing.get("column") or "").strip() \
            and not str(data.get("column") or "").strip():
        return
    defs[data["id"]] = {**data, "component": component}


def effective_params(defs: list[dict], requested: dict | None) -> dict:
    params = {d["id"]: d.get("default") for d in defs}
    for key, value in (requested or {}).items():
        if key in params:
            params[key] = value
    return params


def dataset_switches(defs: list[dict]) -> dict[str, dict[str, int]]:
    """筛选栏里的「数据集切换器」→ {参数 id: {选项值: 数据集 id}}.

    字段配了 dataset_map（拼多多 → 表A、天猫 → 表B）才算切换器；
    没配的字段只做行过滤，不进这里。
    """
    out: dict[str, dict[str, int]] = {}
    for field in defs:
        mapping = field.get("dataset_map") or {}
        if not isinstance(mapping, dict) or not mapping:
            continue
        cleaned: dict[str, int] = {}
        for key, value in mapping.items():
            try:
                cleaned[str(key)] = int(value)
            except (TypeError, ValueError):
                continue
        if cleaned:
            out[str(field.get("id"))] = cleaned
    return out


def _error(kind: str, title: str, exc: Exception) -> dict:
    message = exc.message if isinstance(exc, SecurityError) else str(exc)
    return {"kind": kind, "title": title, "error": message[:200], "value": None}


def _dataset_fields(db: Session, dataset_id: int | None) -> set[str]:
    """数据集里可用的语义字段名（页面参数按这个匹配）."""
    if not dataset_id:
        return set()
    from app.semantic.repository import get_dataset
    dataset = get_dataset(db, dataset_id)
    if dataset is None:
        return set()
    return {field.name for field in dataset.fields}


def _num(text: str):
    try:
        value = float(str(text))
        return int(value) if value.is_integer() else value
    except (TypeError, ValueError):
        return str(text)


def _date_bounds(value: Any) -> tuple[str, str] | None:
    """日期控件 → (开始日, 结束日)；单日 / [开始, 结束] / "a~b" 都认。"""
    raw = value if isinstance(value, (list, tuple)) else [value]
    days: list[str] = []
    for item in list(raw)[:2]:
        for part in re.split(r"[~～,，]", str(item or "")):
            try:
                days.append(date.fromisoformat(part.strip()[:10]).isoformat())
            except ValueError:
                continue
    if not days:
        return None
    return min(days), max(days)


def _parse_range(expr: str):
    """">=80000" / "<5000" / "5000..10000" → (op, value)."""
    text = str(expr or "").strip()
    if not text:
        return None
    for prefix, op in ((">=", ">="), ("<=", "<="), (">", ">"), ("<", "<")):
        if text.startswith(prefix):
            return op, _num(text[len(prefix):])
    if ".." in text:
        low, high = text.split("..", 1)
        return "BETWEEN", [_num(low), _num(high)]
    return "=", _num(text)


def _platform_value(defs: list[dict], effective: dict) -> str:
    """当前选中的平台 —— 取自第一个「数据集切换器」的值."""
    for field in defs:
        if not (field.get("split") or (field.get("dataset_map") or {})):
            continue
        value = effective.get(field.get("id"))
        if value in (None, "", [], {}, "all", "全部"):
            continue
        return str(value)
    return ""


def _field_slice(field: dict, platform: str) -> tuple[list, dict]:
    """这个字段在当前平台下该用的选项 / 档位；没单独配的平台回落到通用那份."""
    mapping = field.get("options_map") or {}
    if platform and isinstance(mapping, dict):
        hit = mapping.get(platform)
        if isinstance(hit, dict):
            return hit.get("options") or [], hit.get("ranges") or {}
    return field.get("options") or [], field.get("ranges") or {}


def normalize_cross_filters(raw: Any) -> list[dict]:
    """图表联动的交叉筛选条件：最多 10 条，只认 {column/name, value} 的标量或数组."""
    out: list[dict] = []
    if not isinstance(raw, list):
        return out
    for item in raw[:10]:
        if not isinstance(item, dict):
            continue
        column = str(item.get("column") or item.get("name") or "").strip()[:64]
        value = item.get("value")
        if not column or value in (None, "", [], {}):
            continue
        if isinstance(value, dict):
            continue
        if isinstance(value, list):
            value = [str(entry)[:80] for entry in value[:20]]
        out.append({"name": column, "op": "=", "value": value})
    return out


def _page_filters(defs: list[dict], effective: dict) -> tuple[list[dict], list[str]]:
    """筛选栏 → (页面级过滤条件, 搜索关键词)。

    · 绑了 column 的字段 → 精确 / 区间过滤；
    · 「搜索」控件没绑列 → 关键词，交给明细表在它挂载的列里做 OR 模糊匹配。
    """
    out: list[dict] = []
    keywords: list[str] = []
    platform = _platform_value(defs, effective)
    for field in defs:
        column = str(field.get("column") or "").strip()
        value = effective.get(field.get("id"))
        if not column:
            if str(field.get("type") or "") == "search" and value not in (None, "", [], {}):
                text = str(value).strip()
                if text and text not in ("all", "全部"):
                    keywords.append(text)
            continue
        if value in (None, "", "all", "全部", [], {}):
            continue
        # 日期控件：选中的那一天 / 起止区间 → 开始日 00:00 ~ 结束日 23:59:59
        # （时间戳列不会被漏掉，date 列 / 文本日期列也照样匹配）
        if str(field.get("type") or "") == "date":
            bounds = _date_bounds(value)
            if bounds is None:
                continue
            start, end = bounds
            out.append({"name": column, "op": "BETWEEN", "value": [start, f"{end} 23:59:59"]})
            continue
        if isinstance(value, (list, dict)):
            continue
        ranges = _field_slice(field, platform)[1]
        expr = ranges.get(str(value)) if isinstance(ranges, dict) else None
        parsed = _parse_range(expr) if expr else None
        if parsed:
            op, resolved = parsed
            if resolved is None:
                continue
            out.append({"name": column, "op": op, "value": resolved})
        elif str(field.get("type") or "") == "search":
            # 搜索框是模糊匹配，别当精确等于用
            text = str(value).strip()
            if text:
                out.append({"name": column, "op": "ILIKE", "value": text})
        else:
            out.append({"name": column, "op": "=", "value": value})
    return out, keywords


def _resolve_spec(db: Session, kind: str, spec: ComponentSpec, user: Any,
                  params: dict, action_params: dict | None = None,
                  keywords: list[str] | None = None,
                  switches: dict[str, dict[str, int]] | None = None) -> dict:
    payload = resolve(db, spec, kind, user, params=params, action_params=action_params,
                      keywords=keywords, switches=switches)
    payload["kind"] = kind
    # 头标卡的 payload.title 是「大标题」内容（banner.title），不是卡片名；
    # 这里统一覆盖会把大标题顶成「头标卡」（2026-11-12 用户实测：预览与编辑器不一致）
    if kind != "banner":
        payload["title"] = spec.title
    return payload


def _item_spec(db: Session, item: ItemDef) -> tuple[str, ComponentSpec]:
    kind = _kind_of(db, item.component)
    if item.spec:
        if not kind:
            kind = "kpi"
        return kind, validate_spec(kind, item.spec)
    component = component_repo.get_by_code(db, item.component)
    if component is None:
        raise ComponentSpecError(f"组件不存在：{item.component}")
    return component.kind, validate_spec(component.kind, component.spec)


# 并发渲染的全局线程上限：避免大看板 × 多用户把 DB 连接池打满
_RENDER_THREADS = int(os.getenv("BI_RENDER_MAX_THREADS", "16") or "16")
_RENDER_SLOTS = threading.Semaphore(max(1, _RENDER_THREADS))


def _user_view(user: Any) -> Any:
    """只带 RLS 需要的字段，避免跨线程触碰 ORM 的 lazy load."""
    return SimpleNamespace(
        id=getattr(user, "id", None),
        role=getattr(user, "role", "") or "",
        username=getattr(user, "username", "") or "",
    )


def _render_card(
    item: ItemDef,
    user: Any,
    effective: dict,
    keywords: list,
    switches: dict,
    page_filters: list,
) -> dict:
    """渲染单张卡片（线程内独立 Session；单卡失败只影响自己）."""
    with _RENDER_SLOTS:
        db = SessionLocal()
        try:
            kind, spec = _item_spec(db, item)
            # 先按平台切数据集，再拿新表的字段判断页面筛选能不能挂上去
            spec, _switched = apply_dataset_switch(db, spec, effective, switches)
            if page_filters and spec.binding and spec.binding.dataset_id:
                columns = _dataset_fields(db, spec.binding.dataset_id)
                extra = [f for f in page_filters if f["name"] in columns]
                if extra:
                    existing = {(f.get("column") or f.get("name")) for f in (spec.binding.filters or [])}
                    extra = [f for f in extra if f["name"] not in existing]
                    if extra:
                        spec = spec.model_copy(deep=True)
                        spec.binding.filters = list(spec.binding.filters or []) + extra
            payload = _resolve_spec(db, kind, spec, user, effective,
                                    keywords=keywords, switches=switches)
            payload["component"] = {"code": item.component or f"{BASE_PREFIX}{kind}",
                                    "name": spec.title, "kind": kind}
            # 头标卡的 payload.title 是「大标题」内容（banner.title），不是卡片名；
            # 用卡片名覆盖会把大标题顶成「头标卡」（2026-11-12 用户实测：预览和编辑器不一致）
            if item.title and kind != "banner":
                payload["title"] = item.title
            return payload
        except Exception as exc:  # 单卡失败不影响整页
            return _error(item.component or "kpi", item.title or item.key, exc)
        finally:
            db.close()


def render_dashboard(
    db: Session,
    doc: DashboardDoc,
    user: Any,
    *,
    view_key: str | None = None,
    params: dict | None = None,
    cross_filters: list[dict] | None = None,
) -> dict:
    view = next((v for v in doc.views if v.key == view_key), None) or (doc.views[0] if doc.views else None)
    defs = collect_param_defs(db, doc, view.key if view else None, params)
    effective = effective_params(defs, params)
    if view is None:
        return {"view": None, "cards": {}, "param_defs": defs, "params": effective, "views": []}

    page_filters, keywords = _page_filters(defs, effective)
    cross = normalize_cross_filters(cross_filters)
    if cross:
        # 页面筛选优先：同一列已经有筛选栏条件时，联动不再叠加（避免自相矛盾）
        existing = {field.get("name") for field in page_filters}
        page_filters = page_filters + [field for field in cross if field["name"] not in existing]
    switches = dataset_switches(defs)
    # 卡片按平台各一套（筛选栏共用）；没配 items_map 的看板原样返回 items
    platform = _platform_value(defs, effective)
    page_items = view_items_for(view, platform)
    render_items = [
        item for item in page_items
        if item.type not in ("heading", "text", "divider", "board") and not is_filter_item(item)
    ]  # 页面元素由前端直接渲染（画板在成品页是弹窗内容，不直接铺；筛选栏也由前端画）
    user_view = _user_view(user)
    try:
        workers = int(os.getenv("BI_RENDER_WORKERS", "4") or "4")
    except ValueError:
        workers = 4
    workers = max(1, min(workers, len(render_items) or 1))
    cards: dict[str, dict] = {}
    if workers > 1 and len(render_items) > 1:
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="card") as pool:
            payloads = list(pool.map(
                lambda item: _render_card(item, user_view, effective, keywords, switches, page_filters),
                render_items,
            ))
        for item, payload in zip(render_items, payloads):
            cards[item.key] = payload
    else:
        for item in render_items:
            cards[item.key] = _render_card(item, user_view, effective, keywords, switches, page_filters)

    stats = []
    for stat in (doc.header or {}).get("stats", []) or []:
        try:
            if stat.get("spec"):
                kind = _kind_of(db, stat.get("component") or "") or "kpi"
                spec = validate_spec(kind, stat["spec"])
                label = stat.get("label") or spec.title
            else:
                component = component_repo.get_by_code(db, stat.get("component") or "")
                if component is None:
                    continue
                kind = component.kind
                spec = validate_spec(kind, component.spec)
                label = stat.get("label") or component.name
            spec, _switched = apply_dataset_switch(db, spec, effective, switches)
            payload = _resolve_spec(db, kind, spec, user, effective,
                                    keywords=keywords, switches=switches)
            stats.append({"label": label, "value": payload.get("value"),
                          "unit": payload.get("unit") or ""})
        except Exception:
            continue

    return {
        "view": view.key,
        "platform": platform,
        "header": doc.header,
        "stats": stats,
        "cards": cards,
        "param_defs": defs,
        "params": effective,
        "views": [{"key": v.key, "title": v.title, "items": len(v.items)} for v in doc.views],
    }


def find_item(doc: DashboardDoc, item_key: str, view_key: str | None = None) -> tuple[Any, ItemDef] | None:
    for view, item in doc.all_items():
        if item.key == item_key and (view_key is None or view.key == view_key):
            return view, item
    return None


def _action_spec(db: Session, action: ActionDef) -> tuple[str, ComponentSpec]:
    kind = _kind_of(db, action.component)
    if action.spec:
        if not kind:
            kind = "table"
        return kind, validate_spec(kind, action.spec)
    component = component_repo.get_by_code(db, action.component)
    if component is None:
        raise ComponentSpecError(f"动作目标不存在：{action.component}")
    return component.kind, validate_spec(component.kind, component.spec)


def render_overlay(
    db: Session,
    doc: DashboardDoc,
    user: Any,
    *,
    item_key: str,
    params: dict | None = None,
    action_params: dict | None = None,
    view_key: str | None = None,
    trigger: str = "primary",
) -> dict:
    found = find_item(doc, item_key, view_key)
    if found is None:
        raise ComponentSpecError(f"卡片不存在：{item_key}")
    _view, item = found
    action = item.row_action if trigger == "row" else item.action
    if action is None:
        raise ComponentSpecError("这张卡没有配置该动作")

    kind, spec = _action_spec(db, action)

    defs = collect_param_defs(db, doc, view_key, params)
    effective = effective_params(defs, params)
    switches = dataset_switches(defs)

    # 覆盖：浅合并（compute / table_view 这类子对象按字段合并）
    data = spec.model_dump()
    for key, value in (action.overrides or {}).items():
        if key not in data:
            continue
        data[key] = {**data[key], **value} if isinstance(value, dict) and isinstance(data[key], dict) else value
    spec = validate_spec(kind, data)
    spec, _switched = apply_dataset_switch(db, spec, effective, switches)

    merged_action = {k: v for k, v in (action.params or {}).items() if not str(v).startswith("$")}
    merged_action.update(action_params or {})

    payload = resolve(db, spec, kind, user, params=effective,
                      action_params=merged_action, switches=switches)
    payload["component"] = {"code": action.component or f"{BASE_PREFIX}{kind}",
                            "name": spec.title, "kind": kind}
    return {"item_key": item.key, "title": action.title or spec.title,
            "kind": kind, "payload": payload, "params": effective, "action_params": merged_action}


platform_value = _platform_value
field_slice = _field_slice

__all__ = ["render_dashboard", "render_overlay", "collect_param_defs", "resolved_fields",
           "effective_params", "dataset_switches", "find_item",
           "platform_value", "field_slice"]

