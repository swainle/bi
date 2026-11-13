"""dbt / LookML 语义模型导入.

只导两类能精确映射到本站语义层、且能校验的东西：

    · 指标口径 → `bi_dataset_metric`（走版本治理：口径变了自动 +1 版本、取消认证、留快照）
    · 字段说明 → `bi_dataset_field.description`（只补描述，不动角色 / 类型 / 来源列）

不导：dbt 的 tests / exposures / sources、Looker 的 explore / join / dimension_group 分套 ——
本站没有对应概念，硬塞只会造出「看起来有、实际跑不通」的配置。

流程是「文本 → 计划 → 执行」：`plan()` 只读、给出新建 / 更新 / 无变化 / 跳过（带原因），
用户确认后 `apply()` 才写库。这样一次导入不会把别人的指标口径悄悄改掉。
"""

from __future__ import annotations

import json
import re
from typing import Any

import sqlglot
from sqlglot import exp
from sqlalchemy.orm import Session

from app.semantic.models import Dataset, DatasetField, DatasetMetric
from app.semantic.repository import add_metric, update_field, update_metric
from app.semantic.validator import SemanticError, validate_metric_expression

SUPPORTED = ("dbt", "lookml")

# dbt manifest 动辄十几 MB；再大基本是塞了 catalog，直接拒绝比解析到一半崩掉好
MAX_CHARS = 12_000_000


# ── 通用 ────────────────────────────────────────────────────
_AGG_SQL = {
    "sum": "SUM({x})",
    "count": "COUNT({x})",
    "average": "AVG({x})",
    "avg": "AVG({x})",
    "min": "MIN({x})",
    "max": "MAX({x})",
}


def _agg_sql(agg: str | None, expr: str | None) -> str | None:
    """聚合方式 + 表达式 → SQL 片段；不支持的聚合返回 None."""
    key = (agg or "").strip().lower()
    value = (expr or "").strip()
    if key in ("count_distinct", "countdistinct", "distinct_count"):
        return f"COUNT(DISTINCT {value})" if value else None
    if key == "count" and value in ("", "*", "1"):
        return "COUNT(*)"
    tpl = _AGG_SQL.get(key)
    if not tpl or not value:
        return None
    return tpl.format(x=value)


def _format_of(value: Any) -> str:
    """dbt meta.format / Looker value_format_name → 本站三种格式."""
    text = str(value or "").strip().lower()
    if text.startswith(("percent", "%")) or text.endswith("_pct"):
        return "percent"
    if text in ("currency", "usd", "cny", "rmb", "money", "eur", "gbp") or text.startswith(
        ("usd", "cny", "eur", "gbp")
    ):
        return "currency"
    return "number"


def _norm(expression: str) -> str:
    return re.sub(r"\s+", "", (expression or "")).lower()


def _unknown_columns(expression: str, known: set[str]) -> list[str]:
    """表达式里引用了数据集没有的列（导入前就指出来，别等取数时才报错）."""
    try:
        root = sqlglot.parse_one(f"SELECT {expression}", read="postgres")
    except Exception:
        return []
    columns = {c.name for c in root.find_all(exp.Column) if c.name}
    return sorted(c for c in columns if c not in known)


def _match_field(name: str, fields: list[DatasetField]) -> DatasetField | None:
    low = (name or "").strip().lower()
    if not low:
        return None
    for f in fields:
        if f.source_column.lower() == low or f.name.lower() == low:
            return f
    return None


# ── 解析：dbt manifest ──────────────────────────────────────
def _as_iter(value: Any) -> list:
    if isinstance(value, dict):
        return list(value.values())
    if isinstance(value, list):
        return value
    return []


def _parse_dbt(content: str) -> tuple[list[dict], dict[str, str], list[dict]]:
    """→ (指标定义, 列说明, 跳过项)."""
    try:
        manifest = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SemanticError(f"dbt manifest 不是合法 JSON：{exc.msg}（第 {exc.lineno} 行）") from exc
    if not isinstance(manifest, dict):
        raise SemanticError("dbt manifest 顶层必须是对象")

    measures: dict[str, dict] = {}
    for model in _as_iter(manifest.get("semantic_models")):
        for measure in _as_iter(model.get("measures")):
            name = str(measure.get("name") or "").strip()
            if name:
                measures[name] = measure

    raw_metrics: dict[str, dict] = {}
    for item in _as_iter(manifest.get("metrics")):
        name = str(item.get("name") or "").strip()
        if name:
            raw_metrics[name] = item

    def simple_expression(item: dict) -> str | None:
        params = item.get("type_params") or {}
        measure_param = params.get("measure")
        if isinstance(measure_param, dict):
            measure_ref = str(measure_param.get("name") or "")
        else:
            measure_ref = str(measure_param or "")
        measure_ref = measure_ref or str(item.get("measure") or item.get("expression") or "").strip()
        measure = measures.get(measure_ref) or {}
        agg = measure.get("agg") or (measure_param.get("agg") if isinstance(measure_param, dict) else None) or item.get("agg")
        expr = measure.get("expr") or measure_ref
        return _agg_sql(agg, expr)

    defs: list[dict] = []
    skipped: list[dict] = []

    for name, item in raw_metrics.items():
        description = str(item.get("description") or item.get("label") or "").strip()
        fmt = _format_of((item.get("meta") or {}).get("format"))
        metric_type = str(item.get("type") or "").lower()

        if metric_type == "ratio":
            params = item.get("type_params") or {}
            parts: list[str] = []
            for side in ("numerator", "denominator"):
                ref = params.get(side)
                if isinstance(ref, dict):
                    ref = ref.get("name")
                ref = str(ref or "").strip()
                target = raw_metrics.get(ref)
                piece = simple_expression(target) if target and str(target.get("type") or "").lower() == "simple" else None
                if not piece:
                    parts = []
                    break
                parts.append(piece)
            if not parts:
                skipped.append({"name": name, "reason": "ratio 指标的分母 / 分子不是可解析的 simple 指标"})
                continue
            defs.append({
                "name": name,
                "expression": f"{parts[0]} / NULLIF({parts[1]}, 0)",
                "format": fmt, "description": description,
            })
            continue

        if metric_type == "simple" or (not metric_type and item.get("calculation_method")):
            if metric_type == "simple":
                measure_param = (item.get("type_params") or {}).get("measure")
                if isinstance(measure_param, dict) and measure_param.get("filter"):
                    skipped.append({"name": name, "reason": "指标带 measure filter，转换会改变口径，请手工建"})
                    continue
                expression = simple_expression(item)
            else:
                # dbt <= 1.5：calculation_method + expression
                calc = str(item.get("calculation_method") or "").lower()
                if calc == "derived":
                    skipped.append({"name": name, "reason": "derived 指标引用其它指标，需手工改写"})
                    continue
                if item.get("filters"):
                    skipped.append({"name": name, "reason": "带 filters 的指标暂不支持（口径会变）"})
                    continue
                expression = _agg_sql(calc, str(item.get("expression") or item.get("sql") or ""))
            if not expression:
                skipped.append({"name": name, "reason": "无法解析聚合方式（measure 未定义或聚合不支持）"})
                continue
            defs.append({
                "name": name, "expression": expression,
                "format": fmt, "description": description,
            })
            continue

        skipped.append({"name": name, "reason": f"不支持的指标类型：{metric_type or '未知'}"})

    # 列说明：取 model 节点上带描述的列
    columns: dict[str, str] = {}
    for node in _as_iter(manifest.get("nodes")):
        if str(node.get("resource_type") or "") != "model":
            continue
        for key, col in (node.get("columns") or {}).items():
            desc = str((col or {}).get("description") or "").strip()
            if desc:
                columns[str((col or {}).get("name") or key)] = desc
    return defs, columns, skipped


# ── 解析：LookML ───────────────────────────────────────────
def _strip_comments(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.lstrip().startswith(("#", "--")):
            continue
        lines.append(line)
    return "\n".join(lines)


def _scan_blocks(text: str, kinds: set[str]) -> list[tuple[str, str, str]]:
    """扫描 `kind: name { ... }` 块（支持嵌套大括号，也兼容单行写法）."""
    found: list[tuple[str, str, str]] = []
    pattern = re.compile(r"([a-z_]+)\s*:\s*([\w.]+)\s*\{")
    for match in pattern.finditer(text):
        kind = match.group(1)
        if kind not in kinds:
            continue
        depth = 0
        start = match.end() - 1
        for idx in range(start, len(text)):
            char = text[idx]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                if depth == 0:
                    found.append((kind, match.group(2), text[start + 1:idx]))
                    break
    return found


def _lookml_sql(body: str) -> str | None:
    match = re.search(r"(?s)\bsql\s*:\s*(.+?);;", body)
    return match.group(1).strip() if match else None


def _lookml_description(body: str) -> str:
    match = re.search(r'\bdescription\s*:\s*"([^"]*)"', body)
    return match.group(1).strip() if match else ""


def _lookml_filters(body: str) -> dict[str, str] | None:
    """`filters: [status: "paid", channel: "app"]` → {列: 值}；解析不了返回 None."""
    match = re.search(r"(?s)\bfilters\s*:\s*\[(.*?)\]", body)
    if not match:
        return {}
    pairs: dict[str, str] = {}
    for item in re.finditer(r'([\w.]+)\s*:\s*"([^"]*)"', match.group(1)):
        value = item.group(2)
        if "," in value:  # Looker 里逗号是 OR，翻成 CASE 语义就变了
            return None
        pairs[item.group(1)] = value
    return pairs or None


def _resolve_refs(sql: str, dims: dict[str, str]) -> str | None:
    """把 `${TABLE}.col` / `${dimension}` 解析成列名；解不了返回 None."""
    text = sql.replace("${TABLE}.", "").replace("${table}.", "")
    for _ in range(3):
        if "${" not in text:
            return text.strip()
        match = re.search(r"\$\{([^}]+)\}", text)
        if not match:
            return None
        ref = match.group(1).strip()
        target = dims.get(ref)
        if target is None:
            return None
        text = text.replace(match.group(0), target)
    return None if "${" in text else text.strip()


def _parse_lookml(content: str) -> tuple[list[dict], dict[str, str], list[dict]]:
    text = _strip_comments(content)
    views = _scan_blocks(text, {"view"})
    if not views:
        raise SemanticError("没有找到 LookML 的 view 块（文件里需要 `view: xxx { ... }`）")

    defs: list[dict] = []
    columns: dict[str, str] = {}
    skipped: list[dict] = []

    for _kind, view_name, body in views:
        dims: dict[str, str] = {}
        for _k, dim_name, dim_body in _scan_blocks(body, {"dimension"}):
            raw_sql = _lookml_sql(dim_body)
            resolved = _resolve_refs(raw_sql, dims) if raw_sql else None
            if resolved:
                dims[dim_name] = resolved
            desc = _lookml_description(dim_body)
            if resolved and desc:
                columns[resolved.split(".")[-1]] = desc

        for _k, measure_name, measure_body in _scan_blocks(body, {"measure"}):
            label = f"{view_name}.{measure_name}"
            measure_type = ""
            match = re.search(r"\btype\s*:\s*([\w_]+)", measure_body)
            if match:
                measure_type = match.group(1).lower()
            raw_sql = _lookml_sql(measure_body)
            resolved = _resolve_refs(raw_sql, dims) if raw_sql else None

            filters = _lookml_filters(measure_body)
            if filters is None:
                skipped.append({"name": label, "reason": "filters 含多个值（OR），转换会改变口径"})
                continue
            if filters and resolved and resolved != "*":
                conditions = []
                for col, value in filters.items():
                    escaped = value.replace("'", "''")
                    conditions.append('"' + col + '" = ' + "'" + escaped + "'")
                resolved = f"CASE WHEN {' AND '.join(conditions)} THEN {resolved} END"

            expression = _agg_sql(measure_type, resolved or ("*" if measure_type == "count" else None))
            if not expression:
                skipped.append({"name": label, "reason": f"不支持的 measure 类型：{measure_type or '未知'}"})
                continue
            value_format = ""
            for key in ("value_format_name", "value_format"):
                fmt_match = re.search(rf"\b{key}\s*:\s*([\w.]+)", measure_body)
                if fmt_match:
                    value_format = fmt_match.group(1)
                    break
            defs.append({
                "name": measure_name,
                "expression": expression,
                # Looker 允许 measure 覆盖 label；本站 description 优先用 description
                "format": _format_of(value_format),
                "description": _lookml_description(measure_body),
            })

    return defs, columns, skipped


# ── 计划 / 执行 ────────────────────────────────────────────
def plan(
    fmt: str,
    content: str,
    existing_metrics: list[DatasetMetric],
    existing_fields: list[DatasetField],
) -> dict:
    """只读：给出导入计划（不写库）."""
    key = (fmt or "").strip().lower()
    if key not in SUPPORTED:
        raise SemanticError(f"不支持的模型格式：{fmt}（可选 {', '.join(SUPPORTED)}）")
    if not (content or "").strip():
        raise SemanticError("导入内容为空")
    if len(content) > MAX_CHARS:
        raise SemanticError(f"内容过大（{len(content)} 字符），请只上传 manifest.json 本身")

    defs, columns, skipped = _parse_dbt(content) if key == "dbt" else _parse_lookml(content)

    known_columns = {f.source_column for f in existing_fields} | {f.name for f in existing_fields}
    by_name = {m.name: m for m in existing_metrics}
    metrics: list[dict] = []
    seen: set[str] = set()

    for item in defs:
        name = item["name"]
        if name in seen:
            skipped.append({"name": name, "reason": "同名指标重复，只取第一个"})
            continue
        seen.add(name)
        expression = item["expression"].strip()
        try:
            validate_metric_expression(expression)
        except SemanticError as exc:
            skipped.append({"name": name, "reason": str(exc)})
            continue
        missing = _unknown_columns(expression, known_columns)
        if missing:
            skipped.append({"name": name, "reason": f"列不在数据集里：{', '.join(missing)}"})
            continue

        current = by_name.get(name)
        if current is None:
            action, note = "new", ""
        elif _norm(current.expression) == _norm(expression) and current.format == item["format"]:
            action, note = "unchanged", ""
        else:
            action, note = "update", "口径变更 → 版本 +1、自动取消认证"
        metrics.append({
            "name": name,
            "expression": expression,
            "format": item["format"],
            "description": item["description"],
            "action": action,
            "note": note,
            "metric_id": current.id if current else None,
        })

    fields: list[dict] = []
    for column, desc in columns.items():
        target = _match_field(column, existing_fields)
        if target is None:
            continue  # 说明按列名匹配，匹配不上就静默跳过（dbt 一个 manifest 里有全库的列）
        if (target.description or "").strip() == desc:
            action = "unchanged"
        else:
            action = "update"
        fields.append({
            "field_id": target.id,
            "name": target.name,
            "description": desc,
            "action": action,
        })

    summary = {
        "new": sum(1 for m in metrics if m["action"] == "new"),
        "update": sum(1 for m in metrics if m["action"] == "update"),
        "unchanged": sum(1 for m in metrics if m["action"] == "unchanged"),
        "fields": sum(1 for f in fields if f["action"] == "update"),
        "skipped": len(skipped),
    }
    return {
        "format": key,
        "metrics": metrics,
        "fields": fields,
        "skipped": skipped,
        "summary": summary,
    }


def apply_plan(
    db: Session,
    dataset: Dataset,
    result: dict,
    *,
    user_id: int | None = None,
    user_name: str = "",
) -> dict:
    """执行计划（只处理 new / update；unchanged 跳过）."""
    created = updated = fields_updated = 0
    for item in result.get("metrics") or []:
        if item["action"] == "new":
            add_metric(
                db, dataset, item["name"], item["expression"], item["format"],
                item["description"], changed_by=user_id, changed_by_name=user_name,
            )
            created += 1
        elif item["action"] == "update" and item.get("metric_id"):
            update_metric(
                db, dataset, int(item["metric_id"]),
                {
                    "expression": item["expression"],
                    "format": item["format"],
                    "description": item["description"],
                },
                changed_by=user_id, changed_by_name=user_name,
            )
            updated += 1
    for item in result.get("fields") or []:
        if item["action"] == "update" and item.get("field_id"):
            update_field(db, dataset, int(item["field_id"]), {"description": item["description"]})
            fields_updated += 1
    return {
        "created": created,
        "updated": updated,
        "fields_updated": fields_updated,
        "plan": result,
    }


__all__ = ["SUPPORTED", "plan", "apply_plan"]
