"""组件计算规则 —— 输入分组后的行，输出面板要展示的结构.

纯函数、不碰数据库，方便单测。
输入统一为：[{"dim": "...", "value": 123, ...}]（已按 sort 排好）
输出：
    KPI  → {"value": "...", "unit": "", "hint": "前10合计 1,234"}
    图表 → {"series": [{"name": ..., "value": ...}], "matrix": ..., "rows": ...}
"""

from __future__ import annotations

from decimal import Decimal

import math
import re
from typing import Any

from app.components.spec import ComponentSpec


def fmt_number(value: Any, fmt: str = "int", *, decimals: int = 0,
               prefix: str = "", suffix: str = "") -> str:
    """按格式渲染数值（中文习惯：万 / % / 金额）. decimals/prefix/suffix 都真的生效."""
    if value is None or value == "":
        return "-"
    if fmt in ("text", "date"):
        text = str(value)
        return f"{prefix}{text}{suffix}" if text not in ("-", "") else text
    try:
        num = float(value)
    except (TypeError, ValueError):
        return str(value)
    dec = max(0, int(decimals or 0))
    if fmt == "w":
        text = f"{num / 10000:.1f}万" if abs(num) >= 10000 else f"{num:,.{dec or 0}f}"
    elif fmt == "pct":
        text = f"{num * 100:.{dec or 1}f}%" if abs(num) <= 1 else f"{num:.{dec or 1}f}%"
    elif fmt == "money":
        text = f"¥{num:,.2f}" if abs(num) < 10000 else f"¥{num / 10000:.2f}万"
    else:
        text = f"{num:,.{dec}f}"
    return f"{prefix}{text}{suffix}"


def _pct(part: float, whole: float) -> float:
    return part / whole if whole else 0.0


def bucket_series(
    rows: list[dict],
    size: float,
    start: float | None,
    count: int,
) -> list[dict]:
    """把数值列等宽分档（榜单排名分段 / 霸榜时长分布都靠它）."""
    if size <= 0 or count <= 0:
        return []
    base = start if start is not None else 0.0
    buckets = [0] * count
    for row in rows:
        try:
            value = float(row.get("value") or 0)
        except (TypeError, ValueError):
            continue
        idx = int((value - base) // size)
        if idx < 0:
            idx = 0
        if idx >= count:
            idx = count - 1
        buckets[idx] += 1
    return [
        {"name": _bucket_label(base + i * size, base + (i + 1) * size, i == count - 1), "value": n}
        for i, n in enumerate(buckets)
    ]


def _bucket_label(lo: float, hi: float, last: bool) -> str:
    if last:
        return f"≥{lo:g}"
    return f"{lo:g}-{hi - 1:g}" if float(hi - 1).is_integer() else f"{lo:g}-{hi:g}"


def explode_tokens(rows: list[dict], split: str) -> list[dict]:
    """把「a / b/c」这类标签列拆成词频（卖点云 / 痛点云）."""
    if not split:
        return rows
    seps = [s for s in split if s.strip()] or ["/"]
    counter: dict[str, float] = {}
    for row in rows:
        text = str(row.get("name") or "")
        tokens: list[str] = []
        for chunk in text.replace("／", "/").split("/"):
            tokens.extend(part.strip() for part in chunk.split("、") if part.strip())
        weight = float(row.get("value") or 1)
        for token in set(tokens):
            counter[token] = counter.get(token, 0) + weight
    ordered = sorted(counter.items(), key=lambda kv: kv[1], reverse=True)
    return [{"name": k, "value": v} for k, v in ordered]


def headline_value(rows: list[dict], spec: ComponentSpec) -> Any:
    """大数字：按 headline 规则取一条."""
    if not rows:
        return None
    head = spec.compute.headline
    if head == "first":
        return rows[0].get("value")
    if head == "max":
        return max((r.get("value") or 0) for r in rows)
    if head == "min":
        return min((r.get("value") or 0) for r in rows)
    if head == "total":
        return sum((r.get("value") or 0) for r in rows)
    if head == "mode":
        return rows[0].get("name")
    if head == "latest":
        dates = [str(r.get("name") or r.get("value") or "") for r in rows]
        dates = [d for d in dates if d]
        return max(dates) if dates else None
    return rows[0].get("value")


def hint_text(rows: list[dict], spec: ComponentSpec) -> str:
    """副标题：按 hint 规则算."""
    hint = spec.compute.hint
    top_n = spec.binding.top_n
    subset = rows[:top_n] if spec.binding.sort == "desc" else rows[-top_n:]
    if hint == "none" or not rows:
        return ""
    if hint == "sum_topn":
        return f"前{top_n}合计 {fmt_number(sum(r.get('value') or 0 for r in subset), spec.compute.format)}"
    if hint == "avg_topn":
        values = [r.get("value") or 0 for r in subset]
        avg = sum(values) / len(values) if values else 0
        return f"前{top_n}平均 {fmt_number(avg, spec.compute.format)}"
    if hint == "count_topn":
        count = sum(1 for r in rows if (r.get("value") or 0) <= top_n)
        return f"前{top_n}名 SKU {count} 个"
    if hint == "total":
        return f"合计 {fmt_number(sum(r.get('value') or 0 for r in rows), spec.compute.format)}"
    if hint == "top_label":
        label = rows[0].get("name")
        return str(label)[:24] if label not in (None, "") else ""
    return ""


def build_payload(kind: str, rows: list[dict], spec: ComponentSpec) -> dict:
    """按组件类型组装渲染 payload."""
    payload: dict = {"kind": kind, "rows": rows[: spec.binding.limit]}

    if kind == "kpi":
        value = headline_value(rows, spec)
        # 原始数值（未格式化）—— 告警评估按它比阈值；前端仍用 value 展示
        payload["raw_value"] = value
        payload["value"] = fmt_number(value, spec.compute.format,
                                      decimals=spec.compute.decimals,
                                      prefix=spec.compute.prefix,
                                      suffix=spec.compute.suffix)
        payload["unit"] = spec.unit
        payload["hint"] = hint_text(rows, spec)
        return payload

    if kind == "gauge":
        value = headline_value(rows, spec)
        number = _num(value)
        maximum = spec.chart.y_max
        if not maximum or maximum <= 0:
            maximum = _nice_ceiling(number)
        payload["gauge_value"] = number
        payload["value"] = fmt_number(number, spec.compute.format,
                                      decimals=spec.compute.decimals,
                                      prefix=spec.compute.prefix,
                                      suffix=spec.compute.suffix)
        payload["max"] = maximum
        payload["unit"] = spec.unit
        return payload

    if kind == "funnel":
        # 漏斗只画正数层级，按值从大到小逐层收窄
        series = [row for row in rows if _num(row.get("value")) > 0]
        series.sort(key=lambda row: _num(row.get("value")), reverse=True)
        series = series[: spec.binding.top_n]
        payload["series"] = series
        payload["total"] = sum(_num(row.get("value")) for row in series)
        return payload

    if kind == "table":
        payload["rows"] = rows[: spec.binding.top_n]
        payload["count"] = len(rows)
        return payload

    if kind == "map":
        # 地图要铺满所有省份，不受「前 N 项」裁剪；0 / 负值不上色
        series = [row for row in rows if _num(row.get("value")) > 0][:34]
        payload["series"] = series
        payload["total"] = sum(_num(row.get("value")) for row in series)
        return payload

    if spec.compute.bucket_count > 0 and spec.compute.bucket_size:
        series = bucket_series(rows, spec.compute.bucket_size,
                               spec.compute.bucket_start, spec.compute.bucket_count)
        payload["series"] = series
        payload["total"] = sum(item["value"] for item in series)
        return payload

    series = rows
    if kind == "wordcloud" and spec.binding.split:
        series = explode_tokens(rows, spec.binding.split)

    payload["series"] = series[: spec.binding.top_n]
    total = sum(item.get("value") or 0 for item in series)
    payload["total"] = total
    payload["top_share"] = _pct(series[0].get("value") or 0, total) if series else 0
    return payload


# ═══════════════════════════════════════════════════════════
# v2：组合图 / 榜卡 / 洞察 / 分节 / 筛选 / 四象限散点
# ═══════════════════════════════════════════════════════════

def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _nice_ceiling(value: float) -> float:
    """仪表盘最大值：取一个好看的整数刻度（26 → 30，126033 → 150000）."""
    if value <= 0:
        return 100.0
    exp = 10 ** math.floor(math.log10(value))
    for step in (1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10):
        candidate = step * exp
        if candidate >= value:
            return float(candidate)
    return float(10 * exp)


def _metric_names(spec: ComponentSpec) -> list[str]:
    names = [spec.binding.metric] if spec.binding.metric else []
    for item in spec.binding.metrics or []:
        name = item.get("name") if isinstance(item, dict) else item
        if name and name not in names:
            names.append(name)
    return names


def build_combo(rows: list[dict], spec: ComponentSpec) -> dict:
    """柱 = binding.metric，线 = binding.metrics[0]（同名同聚合，走同一张结果集）."""
    names = _metric_names(spec)
    bar_key = names[0] if names else None
    line_key = names[1] if len(names) > 1 else None
    dim = spec.binding.dimension
    series = []
    for row in rows:
        series.append({
            "name": str(row.get(dim) or ""),
            "bar": _num(row.get(bar_key)) if bar_key else 0.0,
            "line": _num(row.get(line_key)) if line_key else 0.0,
        })
    return {
        "series": series[: spec.binding.top_n],
        "bar_label": spec.combo.bar_name or (bar_key or "柱"),
        "line_label": spec.combo.line_name or (line_key or "线"),
        "total": len(series),
        "count": len(rows),
    }


def _median(values: list[float]) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    mid = len(ordered) // 2
    return float(ordered[mid]) if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def quadrant_of(v: float, ds: float, med_v: float, med_ds: float) -> str:
    """与模板一致：需求高·缺口大=蓝海；需求高·供给足=红海；需求小·缺口大=潜力；双低=放弃."""
    if v >= med_v and ds >= med_ds:
        return "blue"
    if v >= med_v:
        return "red"
    if ds >= med_ds:
        return "pot"
    return "drop"


QUAD_RANK = {"blue": 0, "pot": 1, "red": 2, "drop": 3}
DEFAULT_WEIGHTS = {"v": 0.45, "cvr": 0.30, "ds": 0.25}


def opportunity_scores(rows: list[dict], spec: ComponentSpec) -> dict:
    """机会分 + 象限：只在当前筛选范围内归一化（与模板 renderDmAll 一致）."""
    rank = spec.rank
    chart = spec.chart
    x_key = rank.x_key or chart.x_key or spec.binding.metric
    y_key = rank.y_key or chart.y_key or ""
    cvr_key = rank.cvr_key or chart.size_key or ""
    weights = {**DEFAULT_WEIGHTS, **{k: float(v) for k, v in (rank.weights or {}).items()}}
    xs = [_num(r.get(x_key)) for r in rows]
    ys = [_num(r.get(y_key)) for r in rows] if y_key else [0.0] * len(rows)
    med_x, med_y = _median(xs), _median(ys)
    max_x = max(xs) if xs else 1
    max_y = max(ys) if ys else 1
    out = []
    for row, v, ds in zip(rows, xs, ys):
        cvr = _num(row.get(cvr_key)) if cvr_key else 0.0
        score = 100 * (
            weights["v"] * ((v / max_x) ** 0.5 if max_x else 0)
            + weights["cvr"] * min(1.0, cvr / 40)
            + weights["ds"] * (math.log10(1 + ds) / math.log10(1 + max_y) if max_y else 0)
        )
        out.append({"score": round(score), "quad": quadrant_of(v, ds, med_x, med_y)})
    return {"scores": out, "med_x": med_x, "med_y": med_y,
            "counts": {q: sum(1 for x in out if x["quad"] == q) for q in QUAD_RANK}}


def build_rank(rows: list[dict], spec: ComponentSpec) -> dict:
    rank = spec.rank
    dim = spec.binding.dimension
    value_key = rank.value_key or spec.binding.metric
    stats = opportunity_scores(rows, spec) if rank.order in ("score", "opportunity") else None
    items = []
    for index, row in enumerate(rows):
        item = {"name": str(row.get(dim) or ""), "value": _num(row.get(value_key))}
        if rank.tags_key and row.get(rank.tags_key):
            item["tags"] = [t for t in str(row.get(rank.tags_key)).replace("·", "/").split("/") if t][:3]
        if stats:
            item["score"] = stats["scores"][index]["score"]
            item["quad"] = stats["scores"][index]["quad"]
        items.append(item)

    if rank.order == "score":
        items.sort(key=lambda x: x.get("score", 0), reverse=True)
    elif rank.order == "opportunity":
        items.sort(key=lambda x: (QUAD_RANK.get(x.get("quad", "drop"), 3), -x.get("score", 0)))
    else:
        items.sort(key=lambda x: x["value"], reverse=(spec.binding.sort == "desc"))

    return {"items": items[: rank.max_items], "count": len(rows), "order": rank.order,
            # 三个显示开关必须带给渲染端，否则面板上的开关是死按钮
            "show_rank": rank.show_rank, "show_score": rank.show_score, "show_tags": rank.show_tags,
            "quads": stats["counts"] if stats else {}}


def build_scatter(rows: list[dict], spec: ComponentSpec) -> dict:
    chart = spec.chart
    names = _metric_names(spec)
    x_key = chart.x_key or (names[1] if len(names) > 1 else (names[0] if names else None))
    y_key = chart.y_key or (names[0] if names else None)
    size_key = chart.size_key or (names[2] if len(names) > 2 else "")
    points = []
    for row in rows:
        point = {
            "name": str(row.get(spec.binding.dimension) or ""),
            "x": _num(row.get(x_key)) if x_key else 0.0,
            "y": _num(row.get(y_key)) if y_key else 0.0,
        }
        if size_key:
            point["size"] = _num(row.get(size_key))
        points.append(point)

    payload: dict = {"series": points, "x_label": x_key, "y_label": y_key,
                     "mode": chart.scatter_mode, "log_x": chart.log_x, "log_y": chart.log_y}
    if chart.scatter_mode == "quadrant" and points:
        stats = opportunity_scores(rows, spec)
        payload["medians"] = {"x": stats["med_x"], "y": stats["med_y"]}
        payload["quads"] = stats["counts"]
        for point, scored in zip(points, stats["scores"]):
            point["quad"] = scored["quad"]
            point["score"] = scored["score"]
    return payload


_DATE_LIKE = re.compile(r"^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}")


def _looks_numeric(value: Any) -> bool:
    """NUMERIC 列 psycopg 给的是 Decimal，别一眼当成文本.

    注意：2025-10-18 这种日期字符串的字符也全是数字和横线，必须先排除，
    否则会被当成数值列 → 前端 Number() 得 NaN → 显示成「—」。
    """
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float, Decimal)):
        return True
    text = str(value if value is not None else "").strip()
    if not text or _DATE_LIKE.match(text):
        return False
    return all(ch in "0123456789.,-" for ch in text)


def build_table(rows: list[dict], spec: ComponentSpec) -> dict:
    view = spec.table_view
    columns = list(view.columns)
    if not columns and rows:
        for key in rows[0].keys():
            text = str(key)
            # ID 一类的列保持原样，别加千分位
            is_id = text.lower().endswith("id")
            numeric = (not is_id) and _looks_numeric(rows[0].get(key))
            if "率" in text or "占比" in text:
                kind = "percent"
            elif numeric:
                kind = "number"
            else:
                kind = "text"
            columns.append({"key": text, "label": text, "type": kind, "align": "right" if numeric else "left", "width": 0})
    # 缩略图的图片字段只用于取图，不占表格列
    if view.thumb and view.thumb_key:
        columns = [col for col in columns if str(col.get("key")) != view.thumb_key]

    # 行限制就是「显示多少行」，别再被 page_size 顶掉
    limit = max(1, spec.binding.top_n or len(rows))
    return {
        "rows": rows[:limit],
        "columns": columns,
        "count": len(rows),
        "page_size": view.page_size,
        "more": view.more,
        "more_label": view.more_label,
        "sortable": view.sortable,
        "index_column": view.index_column,
        "thumb": view.thumb,
        "thumb_key": view.thumb_key,
        # 行详情面板（开启时前端点行才滑出）
        "detail": view.detail.model_dump(),
    }


def build_content(kind: str, spec: ComponentSpec, values: dict | None = None) -> dict:
    if kind == "nav":
        return {
            "brand": spec.nav.brand,
            "brand_accent": spec.nav.brand_accent,
            "brand_tone": spec.nav.brand_tone,
            "items": [item.model_dump() for item in spec.nav.items],
            "meta": spec.nav.meta,
            "badge": spec.nav.badge,
            "actions": [action.model_dump() for action in spec.nav.actions],
            "global_nav": spec.nav.global_nav,
            "export_scope": spec.nav.export_scope,
            "export_dataset_id": spec.nav.export_dataset_id,
        }
    if kind == "banner":
        return {
            "kicker": spec.banner.kicker,
            "title": spec.banner.title or spec.title,
            "accent": spec.banner.accent,
            "subtitle": spec.banner.subtitle,
            "stats": [
                {**stat.model_dump(), "value": (values or {}).get(str(index), stat.value)}
                for index, stat in enumerate(spec.banner.stats)
            ],
            "tone": spec.banner.tone,
        }
    if kind == "section":
        return {"index": spec.content.index, "note": spec.subtitle,
                "icon": spec.content.icon, "title": spec.title}
    if kind == "filter":
        return {"fields": [field.model_dump() for field in spec.filter.fields],
                "inline": spec.filter.inline}
    entries = []
    for item in spec.content.items:
        text = item.get("v") or ""
        for key, value in (values or {}).items():
            text = text.replace("{" + key + "}", str(value))
        entries.append({"k": item.get("k") or "", "v": text})
    return {"entries": entries, "values": values or {}, "text": spec.content.text}


__all__ = [
    "build_payload", "fmt_number", "bucket_series",
    "explode_tokens", "headline_value", "hint_text",
    "build_combo", "build_rank", "build_scatter", "build_table", "build_content",
    "opportunity_scores", "quadrant_of",
]
