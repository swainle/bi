"""下钻明细 —— 按某个维度值取卡片数据集里的原始行（最多 200 行）.

纯构造部分（drill_columns / build_request）便于单测；执行复用语义层 + 查询内核，
口径与看板一致（含行级权限）。
"""

from __future__ import annotations

from typing import Any

MAX_ROWS = 200
MAX_COLUMNS = 12


def drill_columns(fields: list[Any], limit: int = MAX_COLUMNS) -> list[str]:
    """明细里展示的列：只取维度字段（跳过指标 / 图片 / 长文本 ID 由调用方再筛）."""
    names: list[str] = []
    for field in fields:
        if getattr(field, "role", "") != "dimension":
            continue
        name = str(getattr(field, "name", "") or "")
        if name and name not in names:
            names.append(name)
        if len(names) >= limit:
            break
    return names


def build_request(columns: list[str], column: str, value: Any, limit: int = MAX_ROWS) -> dict:
    """下钻查询：原始列 SELECT，不分组不聚合，只按这一列过滤."""
    return {
        "columns": [{"name": name} for name in columns],
        "dimensions": [],
        "metrics": [],
        "filters": [{"name": column, "op": "=", "value": value}],
        "order_by": [],
        "limit": max(1, min(int(limit or MAX_ROWS), MAX_ROWS)),
    }


__all__ = ["MAX_ROWS", "MAX_COLUMNS", "drill_columns", "build_request"]
