"""报表生成 —— 看板渲染结果 → 自包含 HTML + Excel + PDF.

说明：
    * 数据与看板完全同口径（render_dashboard，含筛选默认值 / 平台默认值 / 创建者 RLS）；
    * HTML 不依赖前端与网络（内联样式），打开即可读；PDF / PNG 由 `browser.py` 用无头 Chrome 从这份 HTML 渲染；
    * Excel 每个卡片一个 sheet，指标卡 / 榜单 / 明细表 / 图表序列都转成表格；
    * 文件写在 backend/var/reports（不挂静态目录），只能通过带签名的接口下载。
"""

from __future__ import annotations

from app.timezone import china_now

import os
import secrets
from typing import Any

from jinja2 import Template
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy.orm import Session

from app.config import settings
from app.dashboards import render as renderer
from app.dashboards import repository as dash_repo
from app.dashboards.models import validate_doc
from app.reports import browser
from app.security import watermark

REPORT_DIR = os.getenv("BI_REPORT_DIR") or os.path.join(settings.project_root, "var", "reports")
EXPORT_DIR = os.getenv("BI_EXPORT_DIR") or os.path.join(settings.project_root, "var", "exports")

_CSS = """
* { box-sizing: border-box; }
body { margin: 0; padding: 32px 40px 48px; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1D1D1F; background: #F5F7FB; }
.page { max-width: 1180px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 6px; font-weight: 700; }
.meta { font-size: 12px; color: #64748B; margin-bottom: 6px; }
.params { font-size: 12px; color: #94A3B8; margin-bottom: 20px; }
.grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.card { background: #fff; border: 1px solid #EEF3FB; border-radius: 12px; padding: 16px 18px; break-inside: avoid; }
.card.wide { grid-column: 1 / -1; }
.card h2 { font-size: 14px; margin: 0; font-weight: 600; }
.card .sub { font-size: 11.5px; color: #94A3B8; margin-top: 2px; }
.kpi { font-size: 30px; font-weight: 700; margin: 10px 0 4px; font-variant-numeric: tabular-nums; }
.kpi .unit { font-size: 13px; font-weight: 500; color: #64748B; margin-left: 4px; }
.hint { font-size: 11.5px; color: #94A3B8; }
table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
th { background: #F5F8FF; color: #475569; font-weight: 600; text-align: left; padding: 7px 8px; border-bottom: 1px solid #EEF3FB; }
td { padding: 6px 8px; border-bottom: 1px solid #F5F7FB; font-variant-numeric: tabular-nums; }
td.num, th.num { text-align: right; }
.bar { height: 8px; background: #E8EDFB; border-radius: 999px; overflow: hidden; min-width: 80px; }
.bar i { display: block; height: 100%; background: #4F46E5; border-radius: 999px; }
.error { color: #DC2626; font-size: 12px; background: #FEF2F2; border: 1px solid #FEE2E2; border-radius: 8px; padding: 10px 12px; }
.foot { margin-top: 22px; font-size: 11px; color: #B0B8C4; }
@media print { body { background: #fff; padding: 0; } .card { border-color: #E5E9F2; } }
"""

_TEMPLATE = Template(
    """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>{{ board_name }} · {{ title }}</title>
<style>{{ css }}</style></head>
<body><div class="page">
<h1>{{ board_name }}</h1>
<div class="meta">{{ title }} · 生成时间 {{ generated_at }}</div>
{% if params %}<div class="params">筛选：{{ params }}</div>{% endif %}
<div class="grid">
{% for card in cards %}
  <div class="card{% if card.wide %} wide{% endif %}">
    <h2>{{ card.title }}</h2>
    {% if card.subtitle %}<div class="sub">{{ card.subtitle }}</div>{% endif %}
    {% if card.type == 'kpi' %}
      <div class="kpi">{{ card.value }}{% if card.unit %}<span class="unit">{{ card.unit }}</span>{% endif %}</div>
      {% if card.hint %}<div class="hint">{{ card.hint }}</div>{% endif %}
    {% elif card.type == 'error' %}
      <div class="error">{{ card.error }}</div>
    {% elif card.type == 'text' %}
      <div class="hint">{{ card.text }}</div>
    {% else %}
      {% if card.count %}<div class="hint">共 {{ card.count }} 行{% if card.total %} · 合计 {{ card.total }}{% endif %}</div>{% endif %}
      <table><thead><tr>
        {% for col in card.columns %}<th class="{{ 'num' if col.num else '' }}">{{ col.label }}</th>{% endfor %}
      </tr></thead><tbody>
      {% for row in card.rows %}
        <tr>{% for cell in row.cells %}
          <td class="{{ 'num' if cell.num else '' }}">{% if cell.pct is not none %}<div class="bar"><i style="width: {{ cell.pct }}%"></i></div>{% endif %}{{ cell.text }}</td>
        {% endfor %}</tr>
      {% endfor %}
      </tbody></table>
    {% endif %}
  </div>
{% endfor %}
</div>
<div class="foot">由明策BI 自动生成 · {{ generated_at }} · {{ watermark_text }}</div>
</div>{{ watermark_html | safe }}</body></html>"""
)


def _fmt(value: Any) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, bool):
        return "是" if value else "否"
    if isinstance(value, (int, float)):
        if float(value).is_integer():
            return f"{int(value):,}"
        return f"{value:,.2f}"
    return str(value)


def _is_num(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _keys(rows: list[dict]) -> list[str]:
    return list(rows[0].keys()) if rows else []


def _table_block(title: str, subtitle: str, rows: list[dict], keys: list[str] | None = None,
                 labels: dict[str, str] | None = None, bar_key: str | None = None,
                 count: int | None = None, total: Any = None) -> dict:
    keys = keys or _keys(rows)
    labels = labels or {}
    numeric_max = 0.0
    for row in rows:
        if bar_key and _is_num(row.get(bar_key)):
            numeric_max = max(numeric_max, abs(float(row[bar_key])))
    cells_rows = []
    for row in rows:
        cells = []
        for key in keys:
            value = row.get(key)
            pct = None
            if bar_key == key and numeric_max and _is_num(value):
                pct = max(2.0, round(abs(float(value)) / numeric_max * 100.0, 1))
            cells.append({"text": _fmt(value), "num": _is_num(value), "pct": pct})
        cells_rows.append({"cells": cells})
    columns = [{"label": labels.get(key, key), "num": any(
        _is_num(row.get(key)) for row in rows[:20]
    )} for key in keys]
    return {
        "type": "table",
        "title": title,
        "subtitle": subtitle,
        "columns": columns,
        "rows": cells_rows,
        "keys": keys,
        "raw_rows": rows,
        "wide": len(keys) > 4,
        "count": count if count is not None else len(rows),
        "total": _fmt(total) if total not in (None, 0) else "",
    }


def card_block(item_key: str, payload: dict) -> dict:
    """单张卡片 → 报表块（HTML 与 Excel 共用同一份结构化数据）."""
    kind = payload.get("kind") or ""
    title = payload.get("title") or item_key
    subtitle = payload.get("subtitle") or ""
    if payload.get("error"):
        return {"type": "error", "title": title, "subtitle": subtitle,
                "error": str(payload["error"]), "wide": False}

    if kind == "kpi":
        return {"type": "kpi", "title": title, "subtitle": subtitle,
                "value": _fmt(payload.get("value")) if payload.get("value") not in (None, "") else "—",
                "unit": payload.get("unit") or "",
                "hint": payload.get("hint") or "", "wide": False}

    if payload.get("columns"):
        columns = payload.get("columns") or []
        keys = [str(col.get("key")) for col in columns if col.get("key")]
        labels = {str(col.get("key")): str(col.get("label") or col.get("key")) for col in columns}
        rows = payload.get("rows") or []
        block = _table_block(title, subtitle, rows, keys=keys, labels=labels,
                             count=payload.get("count"), total=None)
        block["wide"] = True
        return block

    if kind == "nav":
        # 导航菜单卡是纯内容组件（items 是菜单项，不是榜单数据），报表里列成一行文字
        labels = [str(item.get("label") or "").strip()
                  for item in (payload.get("items") or []) if str(item.get("label") or "").strip()]
        return {"type": "text", "title": title, "subtitle": subtitle,
                "text": " · ".join(labels) or "（未配置菜单项）", "wide": True}

    if kind == "rank_list" or "items" in payload:
        items = payload.get("items") or []
        keys = ["name", "value", "tags"]
        labels = {"name": "名称", "value": "数值", "tags": "标签"}
        rows = [{"name": item.get("name"), "value": item.get("value"),
                 "tags": " / ".join(item.get("tags") or [])} for item in items]
        block = _table_block(title, subtitle, rows, keys=keys, labels=labels,
                             bar_key="value", count=payload.get("count"))
        block["wide"] = True
        return block

    if payload.get("series"):
        series = payload.get("series") or []
        keys = _keys(series)
        labels = {"name": "名称", "value": "数值", "bar": payload.get("bar_label") or "柱",
                  "line": payload.get("line_label") or "线", "x": payload.get("x_label") or "X",
                  "y": payload.get("y_label") or "Y", "size": "规模", "score": "机会分",
                  "quad": "象限"}
        bar_key = "value" if "value" in keys else ("bar" if "bar" in keys else None)
        return _table_block(title, subtitle, series, keys=keys, labels=labels,
                            bar_key=bar_key, count=payload.get("count"),
                            total=payload.get("total"))

    if payload.get("rows"):
        rows = payload.get("rows") or []
        return _table_block(title, subtitle, rows,
                            count=payload.get("count"), total=payload.get("total"))

    text = payload.get("text") or payload.get("value")
    return {"type": "text", "title": title, "subtitle": subtitle,
            "text": _fmt(text), "wide": False}


def _safe_title(value: str, fallback: str) -> str:
    text = str(value or fallback).replace("/", "-").replace("\\", "-")
    text = "".join(ch for ch in text if ch not in '[]:*?"<>|').strip()
    return (text or fallback)[:31]


def build_report(db: Session, subscription: dict, user: Any, board_name: str,
                 doc, params: dict | None = None,
                 cross_filters: list[dict] | None = None) -> tuple[list[dict], dict]:
    view_key = subscription.get("view_key") or ""
    payload = renderer.render_dashboard(db, doc, user, view_key=view_key or None,
                                        params=params or None,
                                        cross_filters=cross_filters or None)
    cards = payload.get("cards") or {}
    # 筛选栏不是数据卡片，报表里不占位
    cards = {key: card for key, card in cards.items() if (card.get("kind") or "") != "filter"}
    blocks = [card_block(key, card) for key, card in cards.items()]
    errors = [{"item_key": key, "error": str(card.get("error"))}
              for key, card in cards.items() if card.get("error")]
    params = payload.get("params") or {}
    used = {k: v for k, v in params.items() if v not in (None, "", [], {})}
    summary = {
        "view": payload.get("view") or "",
        "cards": len(blocks),
        "errors": errors,
        "params": {str(k): str(v) for k, v in used.items()},
        "platform": payload.get("platform") or "",
    }
    return blocks, summary


def _write_html(path: str, board_name: str, title: str, blocks: list[dict], summary: dict,
                generated_at: str, info: dict) -> None:
    params_text = "、".join(f"{key} = {value}" for key, value in (summary.get("params") or {}).items())
    html = _TEMPLATE.render(
        css=_CSS,
        board_name=board_name,
        title=title,
        generated_at=generated_at,
        params=params_text,
        cards=blocks,
        watermark_text=info.get("text") or "",
        watermark_html=watermark.overlay_html(info.get("text") or ""),
    )
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)


def _write_xlsx(path: str, board_name: str, title: str, blocks: list[dict], summary: dict,
                generated_at: str, info: dict) -> None:
    wb = Workbook()
    head_font = Font(bold=True, color="1D1D1F")
    head_fill = PatternFill("solid", fgColor="F5F8FF")

    overview = wb.active
    overview.title = "概览"
    overview_rows = [
        ("看板", board_name), ("报表", title), ("生成时间", generated_at),
        ("导出人", info.get("user") or ""), ("部门", info.get("department") or ""),
        ("请求号", f"#{info.get('request_id') or ''}"),
        ("卡片数", summary.get("cards") or 0), ("取数失败", len(summary.get("errors") or [])),
    ]
    for key, value in (summary.get("params") or {}).items():
        overview_rows.append((f"筛选 · {key}", value))
    for index, (key, value) in enumerate(overview_rows, start=1):
        overview.cell(row=index, column=1, value=key).font = head_font
        overview.cell(row=index, column=2, value=str(value))
    overview.column_dimensions["A"].width = 18
    overview.column_dimensions["B"].width = 52
    watermark.xlsx_header(overview, info)

    used: set[str] = {"概览"}
    for index, block in enumerate(blocks, start=1):
        name = _safe_title(block.get("title") or "", f"卡片{index}")
        while name in used:
            name = name[:29] + f"~{index}"
        used.add(name)
        ws = wb.create_sheet(name)
        watermark.xlsx_header(ws, info)
        ws.cell(row=1, column=1, value=block.get("title") or name).font = Font(bold=True, size=13)
        if block.get("subtitle"):
            ws.cell(row=2, column=1, value=block["subtitle"])

        if block["type"] in ("kpi", "text", "error"):
            ws.cell(row=4, column=1, value="内容")
            value = (block.get("value") if block["type"] == "kpi" else
                     (block.get("error") if block["type"] == "error" else block.get("text")))
            ws.cell(row=4, column=2, value=str(value or ""))
            if block.get("unit"):
                ws.cell(row=5, column=1, value="单位")
                ws.cell(row=5, column=2, value=block["unit"])
            if block.get("hint"):
                ws.cell(row=6, column=1, value="说明")
                ws.cell(row=6, column=2, value=block["hint"])
            ws.column_dimensions["A"].width = 14
            ws.column_dimensions["B"].width = 48
            continue

        keys = block.get("keys") or []
        labels = [col.get("label") for col in block.get("columns") or []]
        raw_rows = block.get("raw_rows") or []
        header_row = 4
        for col_index, label in enumerate(labels, start=1):
            cell = ws.cell(row=header_row, column=col_index, value=label)
            cell.font = head_font
            cell.fill = head_fill
            cell.alignment = Alignment(horizontal="center")
        widths = [max(10, len(str(label or "")) + 4) for label in labels]
        for row_index, row in enumerate(raw_rows, start=header_row + 1):
            for col_index, key in enumerate(keys, start=1):
                value = row.get(key)
                cell = ws.cell(row=row_index, column=col_index, value=value if _is_num(value) else _fmt(value))
                if _is_num(value):
                    cell.alignment = Alignment(horizontal="right")
                    widths[col_index - 1] = max(widths[col_index - 1], 14)
                else:
                    widths[col_index - 1] = max(widths[col_index - 1], min(40, len(str(value or "")) + 4))
        for col_index, width in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(col_index)].width = width
        ws.freeze_panes = f"A{header_row + 1}"

    wb.save(path)


def generate_files(db: Session, subscription: dict, user: Any,
                   params: dict | None = None,
                   cross_filters: list[dict] | None = None) -> dict:
    """生成一份报表，返回 {html_path, xlsx_path, summary}（路径相对 REPORT_DIR）."""
    board = dash_repo.get(db, subscription["dashboard_id"])
    if board is None:
        raise ValueError("看板不存在或已删除")
    doc = validate_doc(board.doc)
    board_name = board.name
    title = subscription.get("name") or f"{board_name} 报表"
    blocks, summary = build_report(db, subscription, user, board_name, doc, params=params,
                                   cross_filters=cross_filters)
    info = watermark.identity(db, user, source="定时报表")

    folder = os.path.join(REPORT_DIR, str(subscription["dashboard_id"]))
    os.makedirs(folder, exist_ok=True)
    stamp = china_now().strftime("%Y%m%d-%H%M%S")
    token = secrets.token_hex(4)
    html_rel = f"{subscription['dashboard_id']}/{stamp}-{token}.html"
    xlsx_rel = f"{subscription['dashboard_id']}/{stamp}-{token}.xlsx"
    pdf_rel = f"{subscription['dashboard_id']}/{stamp}-{token}.pdf"
    generated_at = china_now().strftime("%Y-%m-%d %H:%M")

    _write_html(os.path.join(REPORT_DIR, html_rel), board_name, title, blocks, summary, generated_at, info)
    _write_xlsx(os.path.join(REPORT_DIR, xlsx_rel), board_name, title, blocks, summary, generated_at, info)
    pdf_error = browser.print_pdf(os.path.join(REPORT_DIR, html_rel), os.path.join(REPORT_DIR, pdf_rel))
    if pdf_error:
        # 浏览器缺失 / 渲染失败不影响报表本身，下载入口按 has_pdf 自适应
        summary["pdf_error"] = pdf_error
        pdf_rel = ""
    return {"html_path": html_rel, "xlsx_path": xlsx_rel, "pdf_path": pdf_rel, "summary": summary}


def export_dashboard(db: Session, board: Any, user: Any, *, view_key: str = "",
                     params: dict | None = None, title: str = "",
                     cross_filters: list[dict] | None = None,
                     request_id: str = "") -> dict:
    """整页导出（不改数据库）：按当前视图 + 当前筛选参数渲染，写 HTML / Excel 到 var/exports."""
    doc = validate_doc(board.doc)
    subscription = {
        "dashboard_id": board.id,
        "name": title or f"{board.name} 报表",
        "view_key": view_key or "",
    }
    blocks, summary = build_report(db, subscription, user, board.name, doc, params=params,
                                   cross_filters=cross_filters)
    info = watermark.identity(db, user, request_id=request_id, source="页面导出")

    folder = os.path.join(EXPORT_DIR, str(board.id))
    os.makedirs(folder, exist_ok=True)
    stamp = china_now().strftime("%Y%m%d-%H%M%S")
    token = secrets.token_hex(4)
    html_abs = os.path.join(folder, f"{stamp}-{token}.html")
    xlsx_abs = os.path.join(folder, f"{stamp}-{token}.xlsx")
    generated_at = china_now().strftime("%Y-%m-%d %H:%M")
    name = subscription["name"]

    _write_html(html_abs, board.name, name, blocks, summary, generated_at, info)
    _write_xlsx(xlsx_abs, board.name, name, blocks, summary, generated_at, info)
    return {"html_path": html_abs, "xlsx_path": xlsx_abs, "summary": summary}


def absolute_path(relative: str) -> str:
    return os.path.join(REPORT_DIR, relative)


def render_artifact(kind: str, html_abs: str) -> str:
    """把已生成的 HTML 渲染成 PDF / PNG（服务端无头 Chrome），返回目标文件路径."""
    if kind not in ("pdf", "png"):
        raise ValueError(f"不支持的渲染格式：{kind}")
    target = os.path.splitext(html_abs)[0] + f".{kind}"
    error = (browser.print_pdf(html_abs, target) if kind == "pdf"
             else browser.screenshot_png(html_abs, target))
    if error:
        raise RuntimeError(error)
    return target


__all__ = ["REPORT_DIR", "EXPORT_DIR", "card_block", "build_report", "generate_files",
           "export_dashboard", "absolute_path", "render_artifact"]
