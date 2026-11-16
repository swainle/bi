"""组件解析器 —— 组件定义 + 语义层 + 查询引擎 → 可直接渲染的数据.

链路：
    spec.binding(dataset_id + 语义字段)
      → 展开看板参数 / 动作参数（valueFrom）
      → semantic.compile_query 生成 QueryObject
      → query.executor 执行（含行级权限 / 脱敏 / 参数绑定）
      → compute 按计算规则汇总
      → 渲染 payload

三条约定（口径只有一处实现）：
    1. 派生统计（机会分 / 四象限 / 占比 / 指数）都在这里算，渲染端只画
    2. 组件里只出现语义名，物理列只在语义层
    3. 参数只经 valueFrom 进筛选条件，绝不拼 SQL
"""

from __future__ import annotations

import datetime as _dt
from typing import Any

from sqlalchemy.orm import Session

from app.components.compute import (
    build_combo,
    build_content,
    build_payload,
    build_rank,
    build_scatter,
    build_table,
)
from app.components.spec import ComponentSpec, ComponentSpecError
from app.query.executor import run as execute_query
from app.query.live import LiveQueryError, run_live
from app.query.whitelist import ALLOWED_TABLES
from app.semantic.compiler import compile_query
from app.security.errors import SecurityError
from app.semantic.repository import get_dataset, list_fields
from app.sources.repository import get_source as get_source_row

KIND_CONTENT = ("section", "insight", "filter", "banner", "nav")


def _execute_dataset(db: Session, dataset, query, user):
    """按数据集的取数方式执行：抽取读本地库，直连打源库（口径/权限都在内核里）."""
    if (getattr(dataset, "conn_mode", "extract") or "extract") == "live":
        if not getattr(dataset, "source_id", None):
            raise ComponentSpecError(f"直连数据集未绑定数据源：{dataset.name}")
        src = get_source_row(db, int(dataset.source_id))
        if src is None:
            raise ComponentSpecError(f"直连数据集绑定的数据源不存在：{dataset.source_id}")
        try:
            return run_live(db, query, user, src, dataset_id=dataset.id)
        except LiveQueryError as exc:
            message = str(exc)
            # 「数据源连接失败：host:port」本身已经说清是哪台库，别再叠一层数据集名（卡片上放不下）
            if message.startswith("数据源"):
                raise ComponentSpecError(message) from exc
            raise ComponentSpecError(f"{dataset.name}：{message}") from exc
    return execute_query(db, query, user, allowed_tables=ALLOWED_TABLES, dataset_id=dataset.id)


def _metric_items(spec: ComponentSpec) -> list[dict]:
    """binding.metric + binding.metrics → [{name, agg, fmt}]（去重、保序）."""
    out: list[dict] = []
    if spec.binding.metric:
        out.append({"name": spec.binding.metric, "agg": spec.binding.agg, "fmt": spec.compute.format})
    for item in spec.binding.metrics or []:
        if isinstance(item, dict):
            name = item.get("name")
            agg = str(item.get("agg") or "MAX").upper()
            fmt = item.get("fmt") or ""
        else:
            name, agg, fmt = item, "MAX", ""
        if name and all(x["name"] != name for x in out):
            out.append({"name": name, "agg": agg, "fmt": fmt})
    return out


# SUM / AVG 只对数值列成立；这里用语义名报错，用户看得懂
NUMERIC_AGGS = frozenset({"SUM", "AVG"})
NUMERIC_TYPES = frozenset({
    "smallint", "integer", "bigint", "numeric", "decimal",
    "real", "double precision", "float4", "float8", "money", "number",
})


def _check_metric_aggs(db: Session, dataset, spec: ComponentSpec) -> None:
    """把「文本列求和」这类口径错误挡在查库之前，报中文语义名."""
    fields = {f.name: f for f in list_fields(db, dataset.id)}
    for item in _metric_items(spec):
        if item["agg"] not in NUMERIC_AGGS:
            continue
        field = fields.get(item["name"])
        if field is None:
            continue
        data_type = (field.data_type or "").lower()
        if not data_type or data_type in NUMERIC_TYPES:
            continue
        if data_type in ("text", "character varying", "varchar", "char", "character"):
            label = "文本列"
        elif "date" in data_type or "time" in data_type:
            label = "时间列"
        else:
            label = f"{data_type} 类型"
        raise ComponentSpecError(
            f"字段「{item['name']}」是{label}，{item['agg']} 用不了；"
            f"改用 COUNT / COUNT_DISTINCT，或换成数值列"
        )


def _prune_aux_refs(spec: ComponentSpec, allowed: set[str]) -> ComponentSpec:
    """清掉指向「当前数据集里不存在」的辅助列引用（缩略图 / 图表轴 / 排行取值 / 表格列配置）.

    这些列是「挂载用」的：缩略图只是多挂一列取图、图表轴是画法参数。换绑数据集
    （平台分套切表）后旧名残留很常见，缺了应当降级（少一列 / 轴回落），不能抛「未知字段」
    把整张卡打成一条报错 —— 2026-11-15 用户实测：明细表缩略图字段 `主图ID`（直连表才有）
    残留在「测试-01」上，整张明细表只显示「天猫：未知字段：主图ID」。
    """
    if not allowed:
        return spec
    missing = lambda name: bool(name) and name not in allowed  # noqa: E731
    view, chart, rank = spec.table_view, spec.chart, spec.rank
    touched = False
    if view.thumb and view.thumb_key and missing(view.thumb_key):
        view = view.model_copy(update={"thumb_key": ""})
        touched = True
    if view.columns and any(missing(str((c or {}).get("key") or "")) for c in view.columns):
        view = view.model_copy(update={"columns": [
            c for c in view.columns if not missing(str((c or {}).get("key") or ""))
        ]})
        touched = True
    chart_patch = {key: "" for key in ("x_key", "y_key", "size_key", "hbar_threshold_key")
                   if missing(getattr(chart, key, ""))}
    if chart_patch:
        chart = chart.model_copy(update=chart_patch)
        touched = True
    rank_patch = {key: "" for key in ("value_key", "x_key", "y_key", "cvr_key", "tags_key")
                  if missing(getattr(rank, key, ""))}
    if rank_patch:
        rank = rank.model_copy(update=rank_patch)
        touched = True
    if not touched:
        return spec
    return spec.model_copy(update={"table_view": view, "chart": chart, "rank": rank})


def _extra_metric_names(spec: ComponentSpec) -> list[str]:
    """rank_list / scatter 会额外引用几个字段，按需并入查询."""
    names: list[str] = []
    if spec.binding.series:
        names.append(spec.binding.series)
    rank, chart = spec.rank, spec.chart
    for key in (rank.value_key, rank.x_key, rank.y_key, rank.cvr_key):
        if key:
            names.append(key)
    for key in (chart.x_key, chart.y_key, chart.size_key):
        if key:
            names.append(key)
    return [n for n in dict.fromkeys(names) if n]


def _request_for(spec: ComponentSpec, kind: str) -> dict:
    """把 binding 翻译成语义层请求."""
    b = spec.binding
    dims: list[dict] = []
    # 指标卡 / 结论卡 / 分节标题 / 仪表盘 = 一个数，不按维度分组（与编辑面板一致；残留维度不再生效）
    if b.dimension and kind not in ("kpi", "insight", "section", "gauge"):
        dim = {"name": b.dimension}
        grain = getattr(b, "grain", None)
        if grain:
            dim["grain"] = grain
        dims.append(dim)
    raw_columns: list[dict] = []
    for name in getattr(b, "dimensions", None) or []:
        if not name or name == b.dimension:
            continue
        if kind == "table":
            # 明细表：这些是「列」，原样 SELECT，不分组也不聚合
            raw_columns.append({"name": name})
        else:
            dims.append({"name": name, "grain": None})

    # 缩略图的图片字段是「底层挂载用」，不进字段列表，但查询必须带出这一列
    if kind == "table":
        thumb_key = str((spec.table_view.thumb_key or "").strip()) if spec.table_view.thumb else ""
        if thumb_key and all(col["name"] != thumb_key for col in raw_columns):
            raw_columns.append({"name": thumb_key}) 
    if b.series and kind != "rank_list":
        # 词云的「颜色（分类）」允许选跟词同一列（帆软也是这么给的）：同一个字段不重复分组，
        # 前端看到「颜色 == 词」就给每个词一个固定颜色（按词名散列），换权重也不变色
        if not (kind == "wordcloud" and b.series == b.dimension):
            dims.append({"name": b.series})

    tags_key = spec.rank.tags_key if kind == "rank_list" else ""
    if tags_key and tags_key not in (b.dimension, b.series):
        dims.append({"name": tags_key})

    metrics = _metric_items(spec)
    if kind in ("rank_list", "scatter"):
        for name in _extra_metric_names(spec):
            if all(m["name"] != name for m in metrics) and name != b.dimension:
                metrics.append({"name": name, "agg": "MAX"})

    order_by: list[dict] = []
    if getattr(b, "order_by_dimension", False) and b.dimension:
        order_by = [{"name": b.dimension, "desc": False}]
    elif spec.compute.headline == "latest" and b.dimension:
        order_by = [{"name": b.dimension, "desc": True}]
    elif metrics and dims:
        order_by = [{"name": metrics[0]["name"], "desc": b.sort == "desc"}]

    limit = b.limit
    if kind in ("rank_list", "scatter", "table"):
        limit = max(limit, 2000)
    elif spec.compute.headline in ("max", "min"):
        limit = max(b.top_n * 5, 50)

    return {
        "columns": raw_columns,
        "dimensions": dims,
        "metrics": [{"name": m["name"], "agg": m["agg"]} for m in metrics],
        "filters": [],
        "order_by": order_by,
        "limit": limit,
    }


def _resolve_value(source: str, params: dict, action_params: dict) -> Any:
    if source.startswith("param:"):
        return params.get(source[6:])
    if source.startswith("action:"):
        return action_params.get(source[7:])
    return None


def _expand_filters(spec: ComponentSpec, params: dict, action_params: dict) -> list[dict]:
    """binding.filters → 查询条件；valueFrom 从这里解析（参数进 SQL 的唯一入口）."""
    out: list[dict] = []
    for item in spec.binding.filters or []:
        if not isinstance(item, dict):
            continue
        column = item.get("column") or item.get("name")
        if not column:
            continue
        op = str(item.get("op") or "=")
        value = item.get("value")

        source = item.get("valueFrom")
        if source:
            value = _resolve_value(str(source), params, action_params)
            if value in (None, "", [], {}):
                continue  # 参数没选 = 不过滤
            if isinstance(value, str) and value in ("all", "全部"):
                continue  # 下拉的「全部」= 不过滤
            ranges = item.get("ranges")
            if isinstance(ranges, dict):          # 档位 → 区间（人气档 / 点击率档 …）
                if not isinstance(value, str) or value not in ranges:
                    continue
                value = ranges[value]
                if value is None:
                    continue
            if isinstance(value, list) and op in ("=", "IN"):
                op = "IN"

        if op in ("LIKE", "ILIKE"):
            text = str(value).strip()
            if text and "%" not in text:
                value = f"%{text}%"
        out.append({"name": column, "op": op, "value": value})
    return out


def _fix_filter_columns(dataset, filters: list[dict]) -> list[dict]:
    """行过滤的列名与数据集里的大小写不一致时，按数据集里的真实列名纠正（「链接id」→「链接ID」）."""
    names = [f.name for f in (getattr(dataset, "fields", None) or [])]
    if not names:
        return filters
    lower = {name.lower(): name for name in names}
    out: list[dict] = []
    for item in filters:
        name = str(item.get("name") or "")
        if name and name not in names:
            fixed = lower.get(name.lower())
            if fixed:
                item = {**item, "name": fixed}
        out.append(item)
    return out


def _grain_label(value: "_dt.date | _dt.datetime", grain: str) -> str:
    """时间维度按粒度转成人看的字符串（月 → 2026-05、日 → 2026-05-04、小时 → … 13:00）."""
    if isinstance(value, _dt.datetime):
        local = value
    else:
        local = _dt.datetime(value.year, value.month, value.day)
    g = (grain or "day").lower()
    if g == "hour":
        return local.strftime("%Y-%m-%d %H:00")
    if g == "month":
        return local.strftime("%Y-%m")
    if g == "quarter":
        return f"{local.year}-Q{(local.month - 1) // 3 + 1}"
    if g == "year":
        return local.strftime("%Y")
    return local.strftime("%Y-%m-%d")


def _format_time_dimension(rows: list[dict], dataset: Any, spec: ComponentSpec) -> list[dict]:
    """把时间维度列格式化成可读字符串：`datetime` 直接丢给前端会显示成
    `2026-05-01T00:00:00+08:00`（月粒度折线图的横轴就变成一长串 ISO 串）。"""
    name = spec.binding.dimension
    if not name or not rows:
        return rows
    field = getattr(dataset, "field_by_name", lambda _n: None)(name) if hasattr(dataset, "field_by_name") else None
    if field is None or getattr(field, "role", "") != "time":
        return rows
    grain = spec.binding.grain or getattr(field, "default_grain", None) or "day"
    for row in rows:
        value = row.get(name)
        if isinstance(value, (_dt.date, _dt.datetime)):
            row[name] = _grain_label(value, grain)
    return rows


def _normalize(kind: str, rows: list[dict], spec: ComponentSpec) -> list[dict]:
    """把查询结果规范成 [{name, value, ...}]（老图表走这条）."""
    b = spec.binding
    if kind == "heatmap":
        out = []
        for row in rows:
            keys = list(row.keys())
            if len(keys) < 3:
                continue
            out.append({"x": row[keys[0]], "y": row[keys[1]], "value": row[keys[2]]})
        return out

    if not rows:
        return []

    keys = list(rows[0].keys())

    if kind == "scatter":
        # 老行为：y = 主指标，x = 第二个指标（没有就退回主指标）
        out = []
        for row in rows:
            if len(keys) < 2:
                continue
            y_value = row.get(keys[1])
            x_value = row.get(keys[2]) if len(keys) > 2 else y_value
            out.append({"name": row.get(keys[0]), "x": x_value, "y": y_value, "value": y_value})
        return out
    if kind == "table":
        return list(rows)

    # 词云带「颜色（分类）」= 两个维度 + 权重（+ 可能出现次数）：词 / 分类 / 权重 分开取
    # 颜色选了跟词同一列时（b.series == b.dimension）SQL 里只有一列词，按普通词云处理
    if kind == "wordcloud" and b.series and b.series != b.dimension and len(keys) >= 3:
        grouped = []
        for row in rows:
            item = {"name": row.get(keys[0]), "value": row.get(keys[2]), "group": row.get(keys[1])}
            for extra in keys[3:]:
                item[extra] = row.get(extra)
            grouped.append(item)
        return grouped

    name_key = keys[0] if len(keys) > 1 else None
    value_key = keys[-1] if len(keys) > 1 else keys[0]
    if b.metric and len(keys) > 1:
        value_key = keys[1]

    out = []
    for row in rows:
        item = {"name": row.get(name_key) if name_key else None,
                "value": row.get(value_key)}
        for extra in keys[2:]:
            item[extra] = row.get(extra)
        out.append(item)

    # 时间序列 / 有序类目（order_by_dimension）：保留 SQL 里「按维度升序」的顺序，
    # 不能再按指标值重排 —— 否则折线图是「值最大的几个点」、时间轴乱跳（2026-11-13 踩过）
    if not getattr(b, "order_by_dimension", False):
        out.sort(key=lambda r: r.get("value") or 0, reverse=(b.sort == "desc"))
    return out


def _apply_transform(rows: list[dict], compute) -> list[dict]:
    """对 series 做运算自定义：占比 / 指数化 / 环比 / 累计 / 乘加."""
    if not rows:
        return rows
    values = []
    for r in rows:
        try:
            values.append(float(r.get("value") or 0))
        except (TypeError, ValueError):
            values.append(0.0)

    mode = getattr(compute, "transform", "raw")
    total = sum(values)
    out: list[dict] = []
    running = 0.0
    for index, row in enumerate(rows):
        value = values[index]
        if mode == "share":
            value = (value / total * 100) if total else 0.0
        elif mode == "index":
            base = values[0] or 1
            value = value / base * 100
        elif mode == "delta":
            prev = values[index - 1] if index > 0 else None
            value = (value - prev) if prev not in (None, 0) else 0.0
        elif mode == "cumsum":
            running += value
            value = running
        value = value * float(getattr(compute, "scale", 1) or 1) + float(getattr(compute, "offset", 0) or 0)
        out.append({**row, "value": round(value, 4)})
    return out


def _fmt_insight(value: Any, fmt: str) -> str:
    if value is None:
        return "—"
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)
    if fmt == "w":
        return f"{num / 10000:.1f}万" if abs(num) >= 10000 else f"{num:,.0f}"
    if fmt == "pct":
        return f"{num:.1f}%"
    if fmt == "x":
        return f"{num:.1f}×"
    return f"{num:,.0f}"


def _summary_values(db: Session, dataset, spec: ComponentSpec, filters: list[dict],
                    user: Any) -> dict[str, str]:
    """insight 的占位符取值：无维度聚合，一次查询拿到所有指标."""
    metrics = _metric_items(spec)
    if not metrics:
        return {}
    request = {
        "dimensions": [],
        "metrics": [{"name": m["name"], "agg": m["agg"]} for m in metrics],
        "filters": filters,
        "order_by": [],
        "limit": 1,
    }
    result = _execute_dataset(db, dataset, compile_query(dataset, request), user)
    row = result.rows[0] if result.rows else {}
    return {m["name"]: _fmt_insight(row.get(m["name"]), m["fmt"]) for m in metrics}


def _banner_values(db: Session, dataset, spec: ComponentSpec, filters: list[dict],
                   user: Any) -> dict[str, str]:
    """头标卡右侧统计：绑了 metric 的按数据集实时聚合（同一口径，一次查询）. """
    stats = spec.banner.stats
    wanted = [(index, stat) for index, stat in enumerate(stats) if stat.metric]
    if not wanted:
        return {}
    metrics = [{"name": stat.metric, "agg": stat.agg or "SUM"} for _index, stat in wanted]
    request = {
        "dimensions": [],
        "metrics": metrics,
        "filters": filters,
        "order_by": [],
        "limit": 1,
    }
    result = _execute_dataset(db, dataset, compile_query(dataset, request), user)
    row = result.rows[0] if result.rows else {}
    out: dict[str, str] = {}
    for index, stat in wanted:
        raw = row.get(stat.metric)
        out[str(index)] = _fmt_stat(raw, stat)
    return out


def _fmt_stat(value: Any, stat: Any) -> str:
    """统计值格式化：先按「运算」换算（乘数/加数/小数位），再套格式与前后缀."""
    if value in (None, ""):
        return "—"
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)

    num = num * float(getattr(stat, "scale", 1) or 1) + float(getattr(stat, "offset", 0) or 0)
    fmt = str(getattr(stat, "format", "number") or "number")
    decimals = max(0, min(int(getattr(stat, "decimals", 0) or 0), 4))
    if fmt == "percent":
        text = f"{num:.{decimals if decimals else 1}f}%"
    elif decimals:
        text = f"{num:,.{decimals}f}"
    elif fmt in ("integer", "currency") or float(num).is_integer():
        text = f"{num:,.0f}"
    else:
        text = f"{num:,.1f}"
    prefix = str(getattr(stat, "prefix", "") or "")
    suffix = str(getattr(stat, "suffix", "") or "")
    return f"{prefix}{text}{suffix}"


def _field_names(db: Session, dataset_id: int) -> set[str]:
    return {field.name for field in list_fields(db, dataset_id)}


def apply_dataset_switch(
    db: Session,
    spec: ComponentSpec,
    params: dict | None,
    switches: dict[str, dict[str, int]] | None,
) -> tuple[ComponentSpec, str]:
    """数据集切换器：卡片绑的是切换集合里的表 → 换成当前选项对应的表.

    switches = {参数 id: {选项值: 数据集 id}}，由筛选栏字段的 dataset_map 汇总而来。
    返回 (spec, 当前选项名)；没切换时选项名为空。

    约定（用户口径）：
        * 字段同名 → 自动匹配到新表的同名字段；
        * 字段不同名 → 后面查库时报错（错误信息带上平台名，看得懂是哪张表缺）；
        * 卡片里写死的行过滤（如 platform=拼多多）在新表没有这一列 → 直接丢掉，不当错误。
    """
    current = spec.binding.dataset_id
    if not current or not switches:
        return spec, ""

    for param_id, mapping in switches.items():
        if current not in mapping.values():
            continue
        value = (params or {}).get(param_id)
        if value in (None, "", [], {}, "all", "全部"):
            return spec, ""          # 没选 = 用卡片自己的表
        label = str(value).strip()
        target = mapping.get(label)
        if not target:
            return spec, ""
        if target == current:
            return spec, label   # 已经在这张表上：不改 spec，但报错时仍要带平台名

        switched = spec.model_copy(deep=True)
        switched.binding.dataset_id = target
        columns = _field_names(db, target)
        if columns and switched.binding.filters:
            switched.binding.filters = [
                item for item in switched.binding.filters
                if not isinstance(item, dict)
                or not (item.get("column") or item.get("name"))
                or (item.get("column") or item.get("name")) in columns
            ]
        return switched, label
    return spec, ""


def resolve(
    db: Session,
    spec: ComponentSpec,
    kind: str,
    user: Any,
    *,
    extra_filters: list[dict] | None = None,
    params: dict | None = None,
    action_params: dict | None = None,
    keywords: list[str] | None = None,
    switches: dict[str, dict[str, int]] | None = None,
) -> dict:
    """执行组件并返回渲染 payload."""
    params = params or {}
    action_params = action_params or {}
    spec, switched_to = apply_dataset_switch(db, spec, params, switches)

    try:
        return _resolve_bound(
            db, spec, kind, user, params=params, action_params=action_params,
            keywords=keywords, extra_filters=extra_filters,
        )
    except SecurityError as exc:
        # 切换到别的平台后取数失败：把平台名放在最前面，一眼看出是哪套表的问题。
        # 就地改消息再抛（不新建异常），保留原异常类型与 http_status。
        if switched_to and not str(exc.message).startswith(switched_to):
            exc.message = f"{switched_to}：{exc.message}"
            exc.args = (exc.message,)
        raise


def _resolve_bound(
    db: Session,
    spec: ComponentSpec,
    kind: str,
    user: Any,
    *,
    extra_filters: list[dict] | None = None,
    params: dict | None = None,
    action_params: dict | None = None,
    keywords: list[str] | None = None,
) -> dict:
    """按（可能已切换过的）spec 真正查库 —— 由 resolve 调用."""
    params = params or {}
    action_params = action_params or {}
    binding = spec.binding

    # 非数据组件：直接产出静态 payload
    if kind in KIND_CONTENT:
        values: dict[str, str] = {}
        if kind == "insight" and binding.dataset_id and _metric_items(spec):
            dataset = get_dataset(db, binding.dataset_id)
            if dataset is None:
                raise ComponentSpecError(f"数据集不存在：{binding.dataset_id}")
            values = _summary_values(db, dataset, spec, _expand_filters(spec, params, action_params), user)
        elif kind == "banner" and binding.dataset_id and any(st.metric for st in spec.banner.stats):
            dataset = get_dataset(db, binding.dataset_id)
            if dataset is None:
                raise ComponentSpecError(f"数据集不存在：{binding.dataset_id}")
            values = _banner_values(db, dataset, spec, _expand_filters(spec, params, action_params), user)
        payload = {"kind": kind, "title": spec.title, **build_content(kind, spec, values)}
        payload.update({"value": None, "unit": spec.unit, "ui": spec.ui.model_dump()})
        return payload

    if not binding.dataset_id:
        raise ComponentSpecError("组件未绑定数据集（spec.binding.dataset_id）")

    dataset = get_dataset(db, binding.dataset_id)
    if dataset is None:
        raise ComponentSpecError(f"数据集不存在：{binding.dataset_id}")

    # 挂了「辅助列」（缩略图 / 图表轴 / 排行取值列）但当前数据集里没有这一列 —— 常见于
    # 平台分套切表、或卡片换绑数据集后旧字段残留。这类列不是用户显式绑定的口径，
    # 缺了就该静默降级（少一列），不能让整张卡变成一条「未知字段」报错。
    # 注意：表格列配置 / 图表轴也可能指向**指标**（如「词数」），候选集合必须带上指标名。
    allowed = {f.name for f in (getattr(dataset, "fields", None) or [])}
    allowed |= {m.name for m in (getattr(dataset, "metrics", None) or [])}
    spec = _prune_aux_refs(spec, allowed)
    binding = spec.binding

    _check_metric_aggs(db, dataset, spec)
    request = _request_for(spec, kind)
    # 词云只绑了指标、没绑维度：自动挑一个「适合当词」的列（跳过标题/链接/ID 这类长文本）
    if kind == "wordcloud" and not request.get("dimensions"):
        dims = [f for f in (getattr(dataset, "fields", None) or []) if getattr(f, "role", "") == "dimension"]
        skip = ("标题", "title", "链接", "url", "图片", "sku", "desc", "备注")
        dim_field = next((f for f in dims if not any(k in str(getattr(f, "name", "")).lower() for k in skip)
                          and not str(getattr(f, "name", "")).lower().endswith("id")), dims[0] if dims else None)
        if dim_field is not None:
            request["dimensions"] = [{"name": dim_field.name}]
            if request.get("metrics"):
                request["order_by"] = [{"name": request["metrics"][0]["name"], "desc": True}]
    # 词云 + 拆词（a/b/c 这种一格多词）：SQL 里额外带一列「出现次数」，
    # 让「选哪些词」按出现次数走（换权重只变字号、不变词集），见 compute.explode_tokens
    if kind == "wordcloud" and spec.binding.split and request.get("metrics") and request.get("dimensions"):
        dim_name = request["dimensions"][0]["name"]
        fields = list(getattr(dataset, "fields", None) or [])
        counter = next((f.name for f in fields if f.name != dim_name and getattr(f, "role", "") in ("measure", "metric")), None) \
            or next((f.name for f in fields if f.name != dim_name and getattr(f, "role", "") in ("dimension", "time", "")), None)
        if counter:
            request["metrics"] = list(request["metrics"]) + [
                {"name": counter, "agg": "COUNT", "alias": "出现次数"},
            ]
    # 词云绑了词、没绑权重：按词出现次数计数（否则行值是字符串，算总和会报类型错）
    if kind == "wordcloud" and not request.get("metrics") and request.get("dimensions"):
        dim_name = request["dimensions"][0]["name"]
        fields = list(getattr(dataset, "fields", None) or [])
        # 换个不重名的列来 COUNT（别名 = 列名，与维度同名会让 SQL 的 ORDER BY 有歧义）
        counter = next((f.name for f in fields if f.name != dim_name and getattr(f, "role", "") in ("measure", "metric")), None) \
            or next((f.name for f in fields if f.name != dim_name and getattr(f, "role", "") in ("dimension", "time", "")), None) \
            or next((f.name for f in fields if f.name != dim_name), None)
        if counter:
            # 词云前端会按 value 自己排序，这里不必给 ORDER BY（避免别名排序校验）
            request["metrics"] = [{"name": counter, "agg": "COUNT", "alias": "词频"}]
            request["order_by"] = []
    request["filters"] = _fix_filter_columns(dataset, _expand_filters(spec, params, action_params))
    # 筛选栏的「搜索」控件：在明细表挂载的列里做 OR 模糊匹配
    search_text = next((str(k).strip() for k in (keywords or []) if str(k or "").strip()), "")
    if search_text and kind == "table":
        table_columns = [c.get("name") for c in (request.get("columns") or []) if c.get("name")]
        if table_columns:
            request["keyword"] = {"columns": table_columns, "value": search_text}
    if extra_filters:
        request["filters"] = request["filters"] + _fix_filter_columns(dataset, list(extra_filters))

    query = compile_query(dataset, request)
    result = _execute_dataset(db, dataset, query, user)
    raw_rows = _format_time_dimension([dict(r) for r in result.rows], dataset, spec)

    if kind == "combo":
        payload = build_combo(raw_rows, spec)
    elif kind == "rank_list":
        payload = build_rank(raw_rows, spec)
    elif kind == "scatter" and spec.chart.scatter_mode in ("bubble", "quadrant"):
        payload = build_scatter(raw_rows, spec)
    elif kind == "table":
        payload = build_table(raw_rows, spec)
    else:
        rows = _normalize(kind, raw_rows, spec)
        if spec.compute.transform != "raw" or spec.compute.scale != 1 or spec.compute.offset:
            rows = _apply_transform(rows, spec.compute)
        payload = build_payload(kind, rows, spec)

    payload.update({
        "kind": kind,
        "dimension_label": binding.dimension,
        "metric_label": binding.metric,
        "series_label": binding.series,
        "component_kind": kind,
        "title": spec.title,
        "subtitle": spec.subtitle,
        "unit": spec.unit,
        "ui": spec.ui.model_dump(),
        "compute": spec.compute.model_dump(),
        "chart": spec.chart.model_dump(),
        "combo": spec.combo.model_dump(),
        "sql": result.sql,
        "elapsed_ms": result.elapsed_ms,
        "rls": result.rls,
        # 指标卡右上角徽标的弹窗配置：前端据此把徽标做成可点（点了按它自己的口径取 TOP N）
        "top": spec.top.model_dump() if kind == "kpi" else None,
        # 这张卡最终读的是哪个数据集（平台分套切换后是目标表）：前端做「逐级筛选」时
        # 要按这些数据集去取候选值，不能拿卡片 spec 里那个（那是切换前的）。
        "dataset_id": dataset.id,
        "params_used": {k: v for k, v in params.items() if v not in (None, "", [])},
    })

    if kind == "heatmap":
        payload["matrix"] = _matrix(payload.pop("rows", []))
    return payload


def _matrix(cells: list[dict]) -> dict:
    xs = sorted({str(c["x"]) for c in cells})
    ys = sorted({str(c["y"]) for c in cells})
    xi = {v: i for i, v in enumerate(xs)}
    yi = {v: i for i, v in enumerate(ys)}
    data = [[xi[str(c["x"])], yi[str(c["y"])], float(c.get("value") or 0)] for c in cells]
    return {
        "xLabels": xs, "yLabels": ys, "cells": data,
        "max": max((c[2] for c in data), default=0),
    }


__all__ = ["resolve", "apply_dataset_switch"]
