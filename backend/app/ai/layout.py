"""编辑器 AI 排版（S4）—— 确定性版面算法.

硬原则（见 docs/MCP与Agent权限接入方案.md §12）：
    * 这里只产出「布局操作」，不改文档、不写库；
    * 坐标一律用算法算（可测试、可复现），LLM 最多把一句话翻译成「每行几张」；
    * 输出永远不越界、不重叠（整宽元素除外），前端应用前还会再兜一次。

版面算式（AGENTS.md §4）：
    一排 N 张：宽 = floor((width − (N−1)×gap) / N / 8) × 8
    例：1440 宽、gap 16、6 张 → 224，x = 0/240/480/720/960/1200（右侧余 16）
"""

from __future__ import annotations

from typing import Any

GRID = 8
MIN_W = 100
MIN_H = 68
MAX_H = 900
DEFAULT_WIDTH = 1440
DEFAULT_GAP = 16
# 这些类型的元素永远整宽（筛选栏）
FULL_WIDTH_TYPES = ("filter",)


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def _snap_down(value: float) -> int:
    return int(value // GRID) * GRID


def _snap_up(value: float) -> int:
    return int(-(-value // GRID) * GRID)


def _rect(item: dict) -> dict:
    return {
        "key": str(item.get("key") or ""),
        "type": str(item.get("type") or "chart"),
        "kind": str(item.get("kind") or item.get("component") or ""),
        "x": max(0, _int(item.get("x"))),
        "y": max(0, _int(item.get("y"))),
        "w": max(MIN_W, _int(item.get("w"), 240)),
        "h": min(MAX_H, max(MIN_H, _int(item.get("h"), 104))),
    }


def _is_full_width(item: dict, full_width_types: tuple[str, ...]) -> bool:
    if item["type"] in full_width_types:
        return True
    kind = item["kind"].lower()
    return kind in full_width_types or "filter" in kind


def _rows_by_position(items: list[dict]) -> list[list[dict]]:
    """按纵向重叠把元素归行（原 y 越接近越可能在同一行）."""
    rows: list[list[dict]] = []
    for item in sorted(items, key=lambda i: (i["y"], i["x"])):
        placed = False
        for row in rows:
            top = min(i["y"] for i in row)
            bottom = max(i["y"] + i["h"] for i in row)
            overlap = min(bottom, item["y"] + item["h"]) - max(top, item["y"])
            if overlap >= min(item["h"], bottom - top) * 0.5:
                row.append(item)
                placed = True
                break
        if not placed:
            rows.append([item])
    return rows


def _row_widths(count: int, width: int, gap: int) -> tuple[int, int]:
    """一排 count 张：返回 (每张宽, 总占宽)，宽度取 8 的倍数且不溢出."""
    if count <= 0:
        return 0, 0
    raw = (width - gap * (count - 1)) / count
    size = _snap_down(raw)
    while size > MIN_W and size * count + gap * (count - 1) > width:
        size -= GRID
    size = max(MIN_W, size)
    return size, size * count + gap * (count - 1)


def plan_layout(
    items: list[dict],
    *,
    width: int = DEFAULT_WIDTH,
    gap: int = DEFAULT_GAP,
    scope: str = "all",
    bounds: dict | None = None,
    full_width_types: tuple[str, ...] = FULL_WIDTH_TYPES,
    forced_rows: list[int] | None = None,
) -> dict:
    """算出一组布局操作。

    items   : [{key,type,kind,x,y,w,h}]
    scope   : "all" 整页 / "selection" 只整理选区（bounds 为选区外接矩形）
    forced_rows : 每行几张（A3 由 LLM 产出）；不传则按原位置自动归行
    """
    rects = [_rect(item) for item in items if item.get("key")]
    if not rects:
        return {"ops": [], "rows": 0, "summary": "没有可整理的元素"}

    area_x = 0
    area_w = width
    area_y = 0
    if scope == "selection" and bounds:
        area_x = max(0, _int(bounds.get("x")))
        area_w = max(MIN_W, _int(bounds.get("w"), width))
        area_y = max(0, _int(bounds.get("y")))

    full = [i for i in rects if _is_full_width(i, full_width_types)]
    full_keys = {i["key"] for i in full}
    rest = [i for i in rects if i["key"] not in full_keys]

    if forced_rows:
        ordered = sorted(rest, key=lambda i: (i["y"], i["x"]))
        rows: list[list[dict]] = []
        cursor = 0
        for count in forced_rows:
            chunk = ordered[cursor:cursor + max(1, int(count))]
            if chunk:
                rows.append(chunk)
            cursor += max(1, int(count))
        if cursor < len(ordered):
            rows.append(ordered[cursor:])
    else:
        rows = _rows_by_position(rest)

    ops: list[dict] = []
    cursor_y = area_y
    for row in rows:
        row.sort(key=lambda i: i["x"])
        if len(row) == 1 and row[0]["w"] <= area_w and not forced_rows:
            item = row[0]
            h = min(MAX_H, max(MIN_H, _snap_up(item["h"])))
            ops.append({"key": item["key"], "x": area_x, "y": cursor_y,
                        "w": min(area_w, _snap_up(item["w"])), "h": h})
            cursor_y += h + gap
            continue
        size, _ = _row_widths(len(row), area_w, gap)
        row_h = min(MAX_H, max(MIN_H, max(_snap_up(i["h"]) for i in row)))
        for index, item in enumerate(row):
            ops.append({"key": item["key"], "x": area_x + index * (size + gap),
                        "y": cursor_y, "w": size, "h": row_h})
        cursor_y += row_h + gap

    # 整宽元素：各自一行，x 固定、宽度等于画布宽
    for item in sorted(full, key=lambda i: (i["y"], i["x"])):
        h = min(MAX_H, max(MIN_H, _snap_up(item["h"])))
        ops.append({"key": item["key"], "x": 0, "y": cursor_y, "w": width, "h": h})
        cursor_y += h + gap

    total_rows = len(rows) + (1 if full else 0)
    return {
        "ops": ops,
        "rows": total_rows,
        "summary": f"整理为 {total_rows} 行，间距 {gap}，宽度取 8 的倍数",
    }


def bounds_of(items: list[dict]) -> dict:
    """选区外接矩形（A2 用）."""
    rects = [_rect(item) for item in items if item.get("key")]
    if not rects:
        return {"x": 0, "y": 0, "w": 0, "h": 0}
    x = min(i["x"] for i in rects)
    y = min(i["y"] for i in rects)
    right = max(i["x"] + i["w"] for i in rects)
    bottom = max(i["y"] + i["h"] for i in rects)
    return {"x": x, "y": y, "w": right - x, "h": bottom - y}


# ── A3：把一句话翻译成「每行几张」（LLM 只出结构，不碰坐标）──
def rows_from_instruction(instruction: str, count: int) -> list[int] | None:
    if not instruction.strip() or count <= 0:
        return None
    try:
        import json
        import re

        from app.services.bi_ai_engine import _call_llm

        prompt = (
            f"总共有 {count} 个元素。用户要求：{instruction}\n"
            f'只返回 JSON：{{"rows":[每行元素个数]}}，数组长度不限，数字之和必须等于 {count}。'
        )
        text = _call_llm(prompt, system="你是版面规划助手，只输出 JSON，不要解释。", max_tokens=200)
        match = re.search(r"\{[\s\S]*\}", text or "")
        if not match:
            return None
        data = json.loads(match.group(0))
        rows = [int(n) for n in (data.get("rows") or []) if int(n) > 0]
        if not rows or sum(rows) != count:
            return None
        return rows
    except Exception:
        return None


__all__ = [
    "DEFAULT_GAP", "DEFAULT_WIDTH", "GRID", "MIN_H", "MIN_W",
    "bounds_of", "plan_layout", "rows_from_instruction",
]
