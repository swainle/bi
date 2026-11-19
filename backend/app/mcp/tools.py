"""MCP 只读工具（S2）：查询 / 渲染 / 指标 / AI 解读.

硬规矩：
    * 一律走服务层，不绕 HTTP（参数、缓存、限流都用与 UI 同一套逻辑）；
    * 取数必须把 `dataset_id` 传给执行器，否则数据集行列权限不生效；
    * 不在这里做鉴权 —— 权限、客户端策略、授权在 gateway 里统一判。
"""

from __future__ import annotations

import os
from typing import Any, Callable

from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.ai.layout import DEFAULT_GAP, DEFAULT_WIDTH, GRID, MAX_H, MIN_H, MIN_W
from app.ai.layout import plan_layout
from app.components import catalog as chart_catalog
from app.components import repository as component_repo
from app.dashboards import render_cache
from app.dashboards import repository as dash_repo
from app.dashboards import sources as dash_sources
from app.dashboards.items import (
    ItemBuildError,
    append_item,
    bottom_y,
    build_from_catalog,
    build_from_component,
    next_key,
)
from app.dashboards.models import DashboardDoc, validate_doc
from app.dashboards.render import render_dashboard
from app.dashboards.router import _blank_doc, _can_read
from app.middleware.audit import log_audit
from app.query.executor import run as execute_query
from app.query.live import run_live
from app.query.table_catalog import BUILTIN_TABLES, is_queryable
from app.semantic import repository as sem_repo
from app.semantic.compiler import compile_query
from app.security.errors import RlsBlockedError, SecurityError

# 每用户每日新建草稿额度（环境变量可调；0 = 不限制）
DAILY_LIMIT_ENV = "BI_MCP_DAILY_DASHBOARD_LIMIT"
# 版面归一时的整宽元素（与前端 FULL_WIDTH_KINDS 一致）
FULL_WIDTH_KINDS = ("filter", "table", "banner", "nav")


class McpToolError(Exception):
    """工具层可读错误（返回给 Agent，不是 500）."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class McpPermissionError(McpToolError):
    """权限类拒绝（HTTP 403；与「参数写错」区分开）."""


class McpValidationError(McpToolError):
    """参数 / 版面不合规（HTTP 400）."""


class McpConflictError(McpToolError):
    """乐观锁冲突（HTTP 409，看板已被别人改过）."""


class McpQuotaError(McpToolError):
    """每日额度用尽（HTTP 429）."""


def _require_dataset(db: Session, args: dict, user: Any = None):
    dataset_id = int(args.get("dataset_id") or 0)
    if not dataset_id:
        raise McpValidationError("缺少 dataset_id")
    dataset = sem_repo.get_dataset(db, dataset_id)
    if dataset is None:
        raise McpValidationError(f"数据集不存在：{dataset_id}")
    if user is not None:
        from app.semantic.access import can_access_dataset

        if not can_access_dataset(db, dataset, user):
            raise McpPermissionError("没有该数据集的权限（归属部门不匹配）")
    return dataset


def _query_payload(args: dict) -> dict:
    keys = ("dimensions", "metrics", "columns", "filters", "order_by", "limit", "offset")
    payload = {key: args[key] for key in keys if key in args}
    # R11：所有查询工具统一行数预算，避免一次拉爆内存
    try:
        if "limit" in payload:
            payload["limit"] = max(1, min(int(payload["limit"]), 5000))
        if "offset" in payload:
            payload["offset"] = max(0, min(int(payload["offset"]), 1_000_000))
    except (TypeError, ValueError) as exc:
        raise McpValidationError("limit / offset 必须是整数") from exc
    return payload


def _live_source(db: Session, dataset):
    from app.sources import repository as sources_repo

    if dataset.source_id is None:
        raise McpToolError(f"直连数据集未绑定数据源：{dataset.name}")
    src = sources_repo.get_source(db, int(dataset.source_id))
    if src is None:
        raise McpToolError(f"数据集绑定的数据源不存在：{dataset.source_id}")
    return src


def _run_dataset_query(db: Session, dataset, payload: dict, user: Any) -> dict:
    try:
        query = compile_query(dataset, payload)
        if (dataset.conn_mode or "extract") == "live":
            result = run_live(db, query, user, _live_source(db, dataset), dataset_id=dataset.id)
        else:
            result = execute_query(db, query, user, dataset_id=dataset.id)
    except RlsBlockedError as exc:
        raise McpToolError(f"数据权限校验失败：{exc.message}") from exc
    except SecurityError as exc:
        raise McpToolError(exc.message) from exc
    except ValueError as exc:
        raise McpToolError(str(exc)) from exc
    return {
        # 与 HTTP 响应同一套编码（Decimal → float），保证 MCP 结果 = UI 结果
        "columns": result.columns,
        "rows": jsonable_encoder(result.rows),
        "row_count": result.count,
        "rls_applied": bool(result.rls),
        "elapsed_ms": round(float(result.elapsed_ms or 0), 1),
    }


# ── 看板 ──────────────────────────────────────────────────────
def list_dashboards(db: Session, ctx, args: dict) -> dict:
    rows = dash_repo.list_dashboards(db, owner_id=ctx.user.id, published_only=False)
    return {"dashboards": [
        {"id": r.id, "name": r.name, "published": (r.doc or {}).get("published") is not False,
         "charts": r.chart_count, "updated_at": str(r.updated_at or "")}
        for r in rows
    ]}


def get_dashboard(db: Session, ctx, args: dict) -> dict:
    dashboard_id = int(args.get("dashboard_id") or 0)
    row = dash_repo.get(db, dashboard_id) if dashboard_id else None
    if row is None:
        raise McpToolError("看板不存在")
    if not _can_read(row, ctx.user, db):
        raise McpToolError("没有这个看板的查看权限")
    return row.to_dict()


def render_dashboard_tool(db: Session, ctx, args: dict) -> dict:
    dashboard_id = int(args.get("dashboard_id") or 0)
    row = dash_repo.get(db, dashboard_id) if dashboard_id else None
    if row is None:
        raise McpToolError("看板不存在")
    if not _can_read(row, ctx.user, db):
        raise McpToolError("没有这个看板的查看权限")
    doc = validate_doc(row.doc or {}, heal=True)
    return render_dashboard(
        db, doc, ctx.user,
        view_key=(args.get("view") or None),
        params=args.get("params") or None,
        cross_filters=args.get("cross_filters") or None,
    )


# ── 数据集 / 指标 ─────────────────────────────────────────────
def list_datasets(db: Session, ctx, args: dict) -> dict:
    from app.admin.permissions import scoped_department_ids

    scoped = scoped_department_ids(db, ctx.user)
    items = sem_repo.list_datasets(
        db, owner_id=ctx.user.id, dept_ids=scoped or [], all_departments=scoped is None,
    )
    return {"datasets": [
        {"id": d.id, "name": d.name, "description": d.description,
         "conn_mode": d.conn_mode, "fields": d.field_count, "metrics": d.metric_count}
        for d in items
    ]}


def get_dataset_schema(db: Session, ctx, args: dict) -> dict:
    dataset = _require_dataset(db, args, ctx.user)
    fields = sem_repo.list_fields(db, dataset.id)
    metrics = sem_repo.list_metrics(db, dataset.id)
    return {
        "dataset": {"id": dataset.id, "name": dataset.name, "description": dataset.description,
                    "conn_mode": dataset.conn_mode},
        "fields": [f.to_dict() for f in fields],
        "metrics": [m.to_dict() for m in metrics],
    }


def query_dataset(db: Session, ctx, args: dict) -> dict:
    dataset = _require_dataset(db, args, ctx.user)
    return _run_dataset_query(db, dataset, _query_payload(args), ctx.user)


def list_metrics(db: Session, ctx, args: dict) -> dict:
    dataset = _require_dataset(db, args, ctx.user)
    return {"dataset_id": dataset.id, "metrics": [m.to_dict() for m in sem_repo.list_metrics(db, dataset.id)]}


def get_metric(db: Session, ctx, args: dict) -> dict:
    dataset = _require_dataset(db, args, ctx.user)
    name = str(args.get("metric") or args.get("name") or "").strip()
    if not name:
        raise McpToolError("缺少 metric 名称")
    for metric in sem_repo.list_metrics(db, dataset.id):
        if metric.name == name:
            return {"dataset_id": dataset.id, **metric.to_dict()}
    raise McpToolError(f"指标不存在：{name}")


def query_metric(db: Session, ctx, args: dict) -> dict:
    dataset = _require_dataset(db, args, ctx.user)
    name = str(args.get("metric") or args.get("name") or "").strip()
    if not name:
        raise McpToolError("缺少 metric 名称")
    payload = _query_payload(args)
    payload["metrics"] = [name]
    return _run_dataset_query(db, dataset, payload, ctx.user)


# ── AI 解读 ───────────────────────────────────────────────────
def ai_analyze(db: Session, ctx, args: dict) -> dict:
    question = str(args.get("question") or "").strip()
    if not question:
        raise McpToolError("缺少 question")
    context = str(args.get("context") or "")[:4000]
    from app.services.bi_ai_engine import _call_llm

    prompt = f"数据上下文：\n{context}\n\n问题：{question}" if context else question
    answer = _call_llm(prompt, system="你是电商经营数据分析专家，回答简洁、给可执行建议。", max_tokens=1200)
    return {"answer": answer}


# ── 看板写工具（S5，P3 风险级）─────────────────────────────────
def _daily_limit() -> int:
    try:
        return max(0, int(os.getenv(DAILY_LIMIT_ENV, "20")))
    except ValueError:
        return 20


def _created_today(db: Session, user_id: int) -> int:
    row = db.execute(
        text("SELECT count(*) FROM bi_mcp_dashboard "
             "WHERE user_id = :u AND created_at >= date_trunc('day', now())"),
        {"u": int(user_id)},
    ).fetchone()
    return int(row[0] or 0) if row else 0


def _owned_draft(db: Session, ctx, args: dict) -> dash_repo.DashboardRow:
    """写工具的唯一入口：必须是自己通过本客户端建的草稿（归属登记 + owner 双校验）."""
    dashboard_id = int(args.get("dashboard_id") or 0)
    if not dashboard_id:
        raise McpValidationError("缺少 dashboard_id")
    row = dash_repo.get(db, dashboard_id)
    if row is None:
        raise McpValidationError(f"看板不存在：{dashboard_id}")
    record = db.execute(
        text("SELECT user_id FROM bi_mcp_dashboard WHERE client_id = :c AND dashboard_id = :d"),
        {"c": ctx.client_id, "d": dashboard_id},
    ).fetchone()
    if record is None:
        raise McpPermissionError("只能修改 Agent 新建的草稿；用户手工看板请在前端编辑")
    if int(record[0] or 0) != int(ctx.user.id):
        raise McpPermissionError("这个草稿属于其他用户")
    if row.owner_id != ctx.user.id:
        raise McpPermissionError("只能修改自己创建的草稿")
    return row


def _view_key(doc: DashboardDoc, args: dict) -> str:
    wanted = str(args.get("view") or "").strip()
    keys = [view.key for view in doc.views]
    if wanted and wanted not in keys:
        raise McpValidationError(f"视图不存在：{wanted}")
    if not keys:
        raise McpValidationError("看板没有视图")
    return wanted or keys[0]


def _preview(db: Session, doc: DashboardDoc, user: Any,
             view_key: str | None = None, params: dict | None = None) -> dict:
    return render_dashboard(db, doc, user, view_key=view_key or None, params=params or None)


def _card_errors(result: dict) -> dict[str, str]:
    return {
        key: str(payload.get("error") or "")
        for key, payload in (result.get("cards") or {}).items()
        if payload.get("error")
    }


def _render_guard(db: Session, doc: DashboardDoc, user: Any,
                  view_key: str | None = None, params: dict | None = None) -> dict:
    """保存前强制渲染自检：任一卡片 error 就拒绝，不交付「整页红条」."""
    result = _preview(db, doc, user, view_key, params)
    errors = _card_errors(result)
    if errors:
        detail = "；".join(f"{key}: {message[:80]}" for key, message in list(errors.items())[:5])
        raise McpValidationError(f"渲染未通过（{len(errors)} 张卡报错），拒绝保存：{detail}")
    return result


def _save_doc(db: Session, row: dash_repo.DashboardRow, doc: DashboardDoc,
              expected: str | None = None, name: str | None = None) -> dash_repo.DashboardRow:
    saved = dash_repo.save(db, row.id, doc, name=name, expected_updated_at=expected)
    if saved is None:
        if dash_repo.get(db, row.id) is None:
            raise McpValidationError("看板不存在或已删除")
        raise McpConflictError("看板已被修改，请重新预览后再保存")
    render_cache.invalidate(row.id)
    try:  # 组件 → 数据源账本，与前端保存同一条
        dash_sources.rebuild(db, row.id, saved.doc)
    except Exception as exc:
        print(f"[mcp] 数据源账本重建失败：{exc}")
    return saved


def _log_write(ctx, action: str, dashboard_id: int, detail: dict | None = None) -> None:
    try:
        log_audit(ctx.user.id, f"mcp.{action}", "canvas", dashboard_id,
                  {"client_id": ctx.client_id, **(detail or {})})
    except Exception as exc:  # 审计失败不影响写操作本身
        print(f"[mcp] 写操作审计失败：{exc}")


def _assert_exact_gaps(ops: list[dict]) -> None:
    rows: dict[int, list[dict]] = {}
    for op in ops:
        rows.setdefault(int(op["y"]), []).append(op)
    for y, row in rows.items():
        row.sort(key=lambda item: item["x"])
        for left, right in zip(row, row[1:]):
            gap = right["x"] - (left["x"] + left["w"])
            if gap != DEFAULT_GAP:
                raise McpValidationError(
                    f"间距必须为 {DEFAULT_GAP}（y={y}：{left['key']} → {right['key']} 实际 {gap}）；"
                    "可用 mode=auto 让后端归一"
                )


def list_components(db: Session, ctx, args: dict) -> dict:
    from app.ai import recommend as recommend_mod

    catalog = chart_catalog.catalog()
    entries = [
        {name: entry.get(name) for name in ("id", "kind", "label", "category", "desc")}
        for entry in catalog["charts"]
    ]
    library = [
        {name: item.get(name) for name in ("id", "code", "name", "kind", "category", "description")}
        for item in (component.to_dict() for component in component_repo.list_components(db, limit=200))
    ]
    payload: dict = {"categories": catalog["categories"], "catalog": entries, "components": library}
    if int(args.get("dataset_id") or 0):
        dataset = _require_dataset(db, args, ctx.user)
        payload["dataset_id"] = dataset.id
        payload["recommended"] = recommend_mod.recommend(db, dataset, int(args.get("limit") or 5))
    return payload


def create_dashboard(db: Session, ctx, args: dict) -> dict:
    limit = _daily_limit()
    used = _created_today(db, ctx.user.id)
    if limit and used >= limit:
        raise McpQuotaError(f"今日新建草稿额度已用完（{used}/{limit}），明天再试")
    name = str(args.get("name") or "").strip()[:120] or dash_repo.next_untitled_name(db)
    doc = _blank_doc()
    view_title = str(args.get("view_title") or "").strip()
    if view_title:
        doc["views"][0]["title"] = view_title[:40]
    row = dash_repo.create(db, name=name, code=None, doc=doc, owner_id=ctx.user.id)
    db.execute(
        text("INSERT INTO bi_mcp_dashboard (client_id, dashboard_id, user_id) "
             "VALUES (:c, :d, :u) ON CONFLICT (client_id, dashboard_id) DO NOTHING"),
        {"c": ctx.client_id, "d": row.id, "u": ctx.user.id},
    )
    db.commit()
    _log_write(ctx, "dashboard.create", row.id, {"name": name})
    return {"dashboard_id": row.id, "name": row.name, "published": False,
            "view": doc["views"][0]["key"],
            "updated_at": str(row.updated_at or ""), "daily_used": used + 1, "daily_limit": limit}


def add_item(db: Session, ctx, args: dict) -> dict:
    row = _owned_draft(db, ctx, args)
    component = str(args.get("component") or "").strip()
    if not component:
        raise McpValidationError("缺少 component（图表目录 id 如 bar.dim，或组件库 code）")
    dataset = _require_dataset(db, args, ctx.user)
    doc = validate_doc(row.doc or {}, heal=False)
    if len(list(doc.all_items())) >= 40:
        raise McpValidationError("一个看板最多 40 个元素，请精简后再加")
    view_key = _view_key(doc, args)
    key = next_key(doc)
    layout = args.get("layout")
    if layout is not None and not isinstance(layout, dict):
        raise McpValidationError("layout 必须是 {x,y,w,h}")
    if not layout:
        layout = {"x": 0, "y": bottom_y(doc, view_key)}
    patch = args.get("spec") if isinstance(args.get("spec"), dict) else None
    title = str(args.get("title") or "").strip()
    try:
        if chart_catalog.find(component) is not None:
            item = build_from_catalog(db, dataset.id, component, key=key, title=title,
                                      spec_patch=patch, layout=layout)
        else:
            item = build_from_component(db, dataset.id, component, key=key, title=title,
                                        spec_patch=patch, layout=layout)
    except ItemBuildError as exc:
        raise McpValidationError(str(exc)) from exc
    except ValueError as exc:
        raise McpValidationError(f"元素不合法：{exc}") from exc

    new_doc = append_item(doc, item, view_key)
    saved = _save_doc(db, row, new_doc, args.get("expected_updated_at"))
    _log_write(ctx, "dashboard.add_item", row.id,
               {"item": key, "component": component, "dataset_id": dataset.id})
    return {"dashboard_id": row.id, "view": view_key, "item_key": key, "item": item,
            "updated_at": str(saved.updated_at or "")}


def set_layout(db: Session, ctx, args: dict) -> dict:
    row = _owned_draft(db, ctx, args)
    doc = validate_doc(row.doc or {}, heal=False)
    view_key = _view_key(doc, args)
    view = next((item for item in doc.views if item.key == view_key), None)
    if view is None:
        raise McpValidationError(f"视图不存在：{view_key}")
    by_key = {item.key: item for item in view.items}

    raw_ops = args.get("items")
    if not isinstance(raw_ops, list) or not raw_ops:
        raise McpValidationError("items 不能为空（[{key,x,y,w,h}]）")
    if len(raw_ops) > 100:
        raise McpValidationError("一次最多写 100 个元素的版面")
    mode = str(args.get("mode") or "auto").strip().lower()
    if mode not in ("auto", "exact"):
        raise McpValidationError("mode 只能是 auto（归一）或 exact（按原坐标校验写入）")
    width = int(args.get("width") or DEFAULT_WIDTH)
    if width < 320 or width > 4000:
        raise McpValidationError("画布宽度不合法")

    ops: list[dict] = []
    seen: set[str] = set()
    for raw in raw_ops:
        if not isinstance(raw, dict):
            raise McpValidationError("items 里每项必须是对象")
        key = str(raw.get("key") or "").strip()
        if not key:
            raise McpValidationError("items 里有元素缺 key")
        if key in seen:
            raise McpValidationError(f"元素重复：{key}")
        item = by_key.get(key)
        if item is None:
            raise McpValidationError(f"视图里没有这个元素：{key}")
        seen.add(key)
        try:
            x, y, w, h = (int(round(float(raw.get(name) or 0))) for name in ("x", "y", "w", "h"))
        except (TypeError, ValueError) as exc:
            raise McpValidationError(f"{key} 的坐标必须是数字") from exc
        if x < 0 or y < 0:
            raise McpValidationError(f"{key} 越界：x/y 不能为负（{x},{y}）")
        if w < MIN_W or h < MIN_H or h > MAX_H:
            raise McpValidationError(
                f"{key} 尺寸不合法：w≥{MIN_W}、{MIN_H}≤h≤{MAX_H}（实际 {w}×{h}）"
            )
        if x + w > width:
            raise McpValidationError(f"{key} 越界：x+w={x + w} 超过画布宽 {width}")
        if mode == "exact" and any(value % GRID for value in (x, y, w, h)):
            raise McpValidationError(f"{key} 坐标/尺寸必须是 {GRID} 的倍数（{x},{y},{w},{h}）")
        ops.append({"key": key, "type": item.type,
                    "kind": (item.component or "").replace("base.", ""),
                    "x": x, "y": y, "w": w, "h": h})

    if mode == "exact":
        _assert_exact_gaps(ops)
        final = ops
        summary = f"已按原坐标写入 {len(ops)} 个元素（间距 {DEFAULT_GAP}）"
        row_count = len({op["y"] for op in ops})
    else:
        plan = plan_layout(ops, width=width, gap=DEFAULT_GAP,
                           full_width_types=FULL_WIDTH_KINDS)
        final = plan["ops"]
        summary = plan["summary"]
        row_count = plan["rows"]

    patch = {op["key"]: op for op in final}
    data = doc.model_dump()
    target = next(item for item in data["views"] if item["key"] == view_key)
    for item in target["items"]:
        op = patch.get(item["key"])
        if op:
            item["layout"] = {"x": op["x"], "y": op["y"], "w": op["w"], "h": op["h"]}
            item["h"] = op["h"]
    new_doc = validate_doc(data)
    saved = _save_doc(db, row, new_doc, args.get("expected_updated_at"))
    _log_write(ctx, "dashboard.set_layout", row.id, {"items": len(final), "mode": mode})
    return {"dashboard_id": row.id, "view": view_key, "ops": final, "rows": row_count,
            "summary": summary, "updated_at": str(saved.updated_at or "")}


def preview_dashboard(db: Session, ctx, args: dict) -> dict:
    row = _owned_draft(db, ctx, args)
    doc = validate_doc(row.doc or {}, heal=False)
    result = _preview(db, doc, ctx.user, _view_key(doc, args), args.get("params"))
    cards = {
        key: {"title": str(payload.get("title") or key),
              "status": "error" if payload.get("error") else "ok",
              "error": str(payload.get("error") or "")}
        for key, payload in (result.get("cards") or {}).items()
    }
    errors = [f"{key}: {card['error']}" for key, card in cards.items() if card["status"] == "error"]
    return {"dashboard_id": row.id, "view": result.get("view"), "cards": cards,
            "cards_total": len(cards), "cards_error": len(errors),
            "errors": errors[:10], "ok": not errors}


def save_dashboard(db: Session, ctx, args: dict) -> dict:
    row = _owned_draft(db, ctx, args)
    expected = str(args.get("expected_updated_at") or "").strip()
    if not expected:
        raise McpValidationError("缺少 expected_updated_at（用上一次写操作返回的 updated_at）")
    doc = validate_doc(row.doc or {}, heal=True)
    if not list(doc.all_items()):
        raise McpValidationError("草稿是空的，先用 bi_add_item 加元素")
    view_key = _view_key(doc, args)
    result = _render_guard(db, doc, ctx.user, view_key)
    name = str(args.get("name") or "").strip()[:120] or None
    saved = _save_doc(db, row, doc, expected, name=name)
    _log_write(ctx, "dashboard.save", row.id, {"cards": len(result.get("cards") or {})})
    return {"dashboard_id": row.id, "name": saved.name,
            "published": (saved.doc or {}).get("published") is not False,
            "updated_at": str(saved.updated_at or ""),
            "cards": len(result.get("cards") or {}), "errors": 0}


def publish_dashboard(db: Session, ctx, args: dict) -> dict:
    """发布必须用户在前端确认；Agent 单独调用一律 403（§13.2）."""
    row = _owned_draft(db, ctx, args)
    _log_write(ctx, "dashboard.publish_denied", row.id, {})
    raise McpPermissionError("发布必须由用户在前端二次确认；Agent 不能直接发布草稿")


Handler = Callable[[Session, Any, dict], dict]

# 工具 schema（tools/list 下发；参数与 handler 严格对应）
TOOLS: dict[str, dict] = {
    "bi_list_dashboards": {
        "description": "列出当前用户可见的看板（我的看板 + 公共看板）",
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": list_dashboards,
    },
    "bi_get_dashboard": {
        "description": "读取看板文档与元信息",
        "inputSchema": {
            "type": "object",
            "properties": {"dashboard_id": {"type": "integer"}},
            "required": ["dashboard_id"],
        },
        "handler": get_dashboard,
    },
    "bi_render_dashboard": {
        "description": "按看板展示配置渲染整页看板，返回每个组件的结果（KPI 数值、图表 rows、表格 rows、筛选栏配置）。"
                       "表格行数受看板 page_size 限制（通常每页 10 行）；要全量明细请改用 bi_query_dataset。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "view": {"type": "string"},
                "params": {"type": "object"},
                "cross_filters": {"type": "array"},
            },
            "required": ["dashboard_id"],
        },
        "handler": render_dashboard_tool,
    },
    "bi_list_datasets": {
        "description": "列出有权限的数据集",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": list_datasets,
    },
    "bi_get_dataset_schema": {
        "description": "数据集字段、指标口径",
        "inputSchema": {
            "type": "object",
            "properties": {"dataset_id": {"type": "integer"}},
            "required": ["dataset_id"],
        },
        "handler": get_dataset_schema,
    },
    "bi_query_dataset": {
        "description": "按维度/指标取数（禁裸 SQL；数据集行列权限、分级与每日行数预算自动生效）。"
                       "查明细用 dimensions=[字段...]（可加 filters），limit 控制返回行数；"
                       "这是拿“原始颗粒度”的正确工具，不需要也不支持传 SQL。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_id": {"type": "integer"},
                "dimensions": {"type": "array", "items": {"type": "string"}},
                "metrics": {"type": "array"},
                "filters": {"type": "array"},
                "order_by": {"type": "array"},
                "limit": {"type": "integer", "maximum": 5000},
            },
            "required": ["dataset_id"],
        },
        "handler": query_dataset,
    },
    "bi_list_metrics": {
        "description": "列出数据集下的指标",
        "inputSchema": {
            "type": "object",
            "properties": {"dataset_id": {"type": "integer"}},
            "required": ["dataset_id"],
        },
        "handler": list_metrics,
    },
    "bi_get_metric": {
        "description": "单个指标的口径与格式",
        "inputSchema": {
            "type": "object",
            "properties": {"dataset_id": {"type": "integer"}, "metric": {"type": "string"}},
            "required": ["dataset_id", "metric"],
        },
        "handler": get_metric,
    },
    "bi_query_metric": {
        "description": "按指标取数（可带维度与筛选）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_id": {"type": "integer"},
                "metric": {"type": "string"},
                "dimensions": {"type": "array", "items": {"type": "string"}},
                "filters": {"type": "array"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 5000},
            },
            "required": ["dataset_id", "metric"],
        },
        "handler": query_metric,
    },
    "bi_ai_analyze": {
        "description": "AI 解读：只做文本推理，不直接取数。请先把 bi_render_dashboard / bi_query_dataset 的结果放进 context 再提问。",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {"type": "string"},
                "context": {"type": "string"},
            },
            "required": ["question"],
        },
        "handler": ai_analyze,
    },
    # ── S5：组件库 + 看板写工具（默认全关，需 bi:mcp:write）──
    "bi_list_components": {
        "description": "组件库与图表类型目录；带 dataset_id 时按字段给出推荐组件",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dataset_id": {"type": "integer"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 8},
            },
        },
        "handler": list_components,
    },
    "bi_create_dashboard": {
        "description": "新建空草稿（owner=当前用户，published=false，计入每日额度）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "view_title": {"type": "string"},
            },
        },
        "handler": create_dashboard,
    },
    "bi_add_item": {
        "description": "从图表目录 / 组件库加一个元素到草稿（key 由后端生成，字段自动落到数据集）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "component": {"type": "string", "description": "目录 id（如 bar.dim）或组件库 code"},
                "dataset_id": {"type": "integer"},
                "view": {"type": "string"},
                "title": {"type": "string"},
                "spec": {"type": "object"},
                "layout": {"type": "object"},
                "expected_updated_at": {"type": "string"},
            },
            "required": ["dashboard_id", "component", "dataset_id"],
        },
        "handler": add_item,
    },
    "bi_set_layout": {
        "description": "批量写元素版面（auto=按版面算式归一；exact=按原坐标校验，越界/间距错返回 400）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "view": {"type": "string"},
                "mode": {"type": "string", "enum": ["auto", "exact"]},
                "width": {"type": "integer"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "key": {"type": "string"},
                            "x": {"type": "integer"},
                            "y": {"type": "integer"},
                            "w": {"type": "integer"},
                            "h": {"type": "integer"},
                        },
                        "required": ["key", "x", "y", "w", "h"],
                    },
                },
                "expected_updated_at": {"type": "string"},
            },
            "required": ["dashboard_id", "items"],
        },
        "handler": set_layout,
    },
    "bi_preview_dashboard": {
        "description": "渲染草稿并返回每张卡状态（ok / error + 错误原因）",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "view": {"type": "string"},
                "params": {"type": "object"},
            },
            "required": ["dashboard_id"],
        },
        "handler": preview_dashboard,
    },
    "bi_save_dashboard": {
        "description": "保存草稿（不发布）；渲染有错拒绝保存，updated_at 不一致返回 409",
        "inputSchema": {
            "type": "object",
            "properties": {
                "dashboard_id": {"type": "integer"},
                "expected_updated_at": {"type": "string"},
                "view": {"type": "string"},
                "name": {"type": "string"},
            },
            "required": ["dashboard_id", "expected_updated_at"],
        },
        "handler": save_dashboard,
    },
    "bi_publish_dashboard": {
        "description": "发布草稿；必须由用户在前端二次确认，Agent 调用一律 403",
        "inputSchema": {
            "type": "object",
            "properties": {"dashboard_id": {"type": "integer"}},
            "required": ["dashboard_id"],
        },
        "handler": publish_dashboard,
    },
}
