"""明细表列配置的规范化（key / 列头 / 类型 / 宽度 / 格式 / 颜色 / 行数）.

独立成模块的两个原因：
1. `spec.py` 已经超过 300 行，新增校验放子文件（开发规范 §4.1）；
2. 列配置的默认值与钳制规则集中在一处，编辑器 / 导入 / 模板三处都走它，避免各写一套。
"""

from __future__ import annotations

from typing import Any

# 与前端 TableColumn["type"] 一一对应
COLUMN_TYPES = (
    "text", "number", "percent", "money", "image",
    "badge", "rank", "dual", "tag", "date", "link",
)

# 只有非空才写库的文本型附加键（避免库里出现一堆空字符串）
EXTRA_TEXT_KEYS = ("format", "tag_split", "image", "sub_key", "badge_tone")

# 颜色只接受 #RRGGBB / #RGB，别让任意 CSS 进库
_HEX = set("0123456789abcdefABCDEF")


def _color(raw: Any) -> str:
    text = str(raw or "").strip()
    if len(text) not in (4, 7) or not text.startswith("#"):
        return ""
    return text if all(ch in _HEX for ch in text[1:]) else ""


def _rows(raw: Any) -> int:
    """文本最多显示几行；0 = 不设（单行省略），上限 4 行."""
    try:
        return max(0, min(int(raw or 0), 4))
    except (TypeError, ValueError):
        return 0




def _value_colors(raw: Any) -> dict[str, str]:
    """标签列「按值配色」：{标签文本: #RRGGBB}；最多 20 条，非法颜色 / 空键直接丢."""
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in list(raw.items())[:20]:
        text = str(key or "").strip()[:20]
        color = _color(value)
        if text and color:
            out[text] = color
    return out


def normalize_columns(raw: Any) -> list[dict]:
    out: list[dict] = []
    for col in (raw or [])[:20]:
        if not isinstance(col, dict) or not col.get("key"):
            continue
        item: dict = {
            "key": str(col["key"])[:40],
            "label": str(col.get("label") or col["key"])[:20],
            "type": col.get("type") if col.get("type") in COLUMN_TYPES else "text",
            "align": col.get("align") if col.get("align") in ("left", "center", "right") else "left",
            "width": max(0, min(int(col.get("width") or 0), 420)),
        }
        for extra in EXTRA_TEXT_KEYS:
            if col.get(extra):
                item[extra] = str(col[extra])[:60]
        color = _color(col.get("color"))
        if color:
            item["color"] = color
        rows = _rows(col.get("rows"))
        if rows:
            item["rows"] = rows
        value_colors = _value_colors(col.get("value_colors"))
        if value_colors:
            item["value_colors"] = value_colors

        out.append(item)
    return out


__all__ = ["normalize_columns", "COLUMN_TYPES", "EXTRA_TEXT_KEYS"]
