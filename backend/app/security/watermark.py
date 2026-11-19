"""水印身份化（R3）—— 把「谁在什么时候导出了什么」写进页面与文件.

约定：
    * 页面水印 = 用户名 · 部门 · 时间 · 请求号（前端 Canvas 叠加层也用同一份口径）；
    * 导出 HTML / PDF / PNG 用同一段 SVG 平铺水印，打印时每页重复（position: fixed）；
    * Excel 在「概览 / 表头」写导出人、部门、时间、请求号，并设置打印页眉；
      明细导出在最上面插一行身份说明，不影响数据列本身；
    * 不同用户 / 不同请求的文本不同，截图或文件外传后可按请求号回溯审计。
"""

from __future__ import annotations

import base64
import html
from datetime import datetime
from typing import Any

from sqlalchemy import text

SYSTEM_DEPT = "未分配部门"


def department_name(db: Any, user: Any) -> str:
    """取用户部门名：优先已加载的关系，其次按 department_id 查库."""
    dept = getattr(user, "department", None)
    if dept is not None:
        name = getattr(dept, "name", "") or ""
        if name:
            return str(name)
    dept_id = getattr(user, "department_id", None)
    if not dept_id:
        return SYSTEM_DEPT
    try:
        row = db.execute(
            text("SELECT name FROM departments WHERE id = :i"), {"i": int(dept_id)}
        ).fetchone()
        return str(row[0]) if row and row[0] else SYSTEM_DEPT
    except Exception:
        return SYSTEM_DEPT


def identity(db: Any, user: Any, request_id: str = "", source: str = "") -> dict:
    """生成水印身份信息（页面 / 导出共用）."""
    user_name = str(getattr(user, "username", "") or "匿名")
    dept = department_name(db, user)
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    rid = (request_id or "")[:12]
    parts = [user_name, dept, stamp]
    if source:
        parts.append(source)
    if rid:
        parts.append(f"#{rid}")
    return {
        "user": user_name,
        "department": dept,
        "time": stamp,
        "request_id": rid,
        "source": source,
        "text": " · ".join(parts),
    }


def overlay_html(text: str) -> str:
    """平铺水印层（SVG data-uri，打印 / PDF / PNG 都生效）."""
    safe = html.escape(text or "", quote=True)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="240">'
        '<g transform="rotate(-22 230 120)">'
        f'<text x="8" y="128" font-size="13" fill="#0F172A" fill-opacity="0.10" '
        f'font-family="PingFang SC, Microsoft YaHei, sans-serif">{safe}</text>'
        "</g></svg>"
    )
    uri = "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return (
        '<div class="mz-wm" aria-hidden="true" style="position:fixed;inset:0;'
        "pointer-events:none;z-index:2147483000;background-image:url(" + uri + ");"
        'background-repeat:repeat;"></div>'
    )


def xlsx_stamp(ws: Any, info: dict, start_row: int = 1, span: int = 1) -> int:
    """在 Excel 工作表顶部写一行身份说明，返回下一可用行号."""
    line = (
        f"导出人：{info.get('user') or '—'} · 部门：{info.get('department') or '—'} · "
        f"时间：{info.get('time') or '—'} · 请求号：#{info.get('request_id') or '—'}"
    )
    cell = ws.cell(row=start_row, column=1, value=line)
    try:
        from openpyxl.styles import Font

        cell.font = Font(size=9, color="86868B")
    except Exception:
        pass
    if span > 1:
        try:
            ws.merge_cells(start_row=start_row, start_column=1,
                           end_row=start_row, end_column=span)
        except Exception:
            pass
    return start_row + 1


def xlsx_header(ws: Any, info: dict) -> None:
    """Excel 打印页眉（打印 / 转 PDF 时可见）."""
    try:
        text_value = (
            f"{info.get('user') or ''} · {info.get('department') or ''} · "
            f"{info.get('time') or ''} · #{info.get('request_id') or ''}"
        )
        ws.oddHeader.center.text = text_value
        ws.oddHeader.center.size = 9
        ws.oddHeader.center.color = "86868B"
    except Exception:
        pass


__all__ = ["identity", "department_name", "overlay_html", "xlsx_stamp", "xlsx_header"]
