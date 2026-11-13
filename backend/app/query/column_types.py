"""列类型查询（带进程内缓存）.

用途：
    时间粒度需要对非日期列做强制转换（本项目不少业务表把日期存成 text），
    但 builder 不该自己去查库 —— 由 executor 查好传进去。

约束：
    缓存按表名，进程内有效；DDL 变更后需重启（BI 的物理表极少动态改结构）。
"""

from __future__ import annotations

import threading

from sqlalchemy import text
from sqlalchemy.orm import Session

# 视为「已经是时间类型」的数据类型
TEMPORAL_TYPES = frozenset(
    {
        "date",
        "timestamp",
        "timestamp without time zone",
        "timestamp with time zone",
        "timestamptz",
        "datetime",
        "datetime64",
    }
)

_cache: dict[str, dict[str, str]] = {}
_lock = threading.Lock()


def column_types(db: Session, table: str) -> dict[str, str]:
    """返回 {列名: 数据类型}；查询失败返回空字典（不阻断业务）."""
    with _lock:
        cached = _cache.get(table)
    if cached is not None:
        return cached

    try:
        rows = db.execute(
            text(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :t"
            ),
            {"t": table},
        ).fetchall()
        mapping = {r[0]: (r[1] or "").lower() for r in rows}
    except Exception:
        mapping = {}

    if mapping:
        with _lock:
            _cache[table] = mapping
    return mapping


def needs_cast(data_type: str | None) -> bool:
    """非时间类型需要显式 cast 才能做 date_trunc."""
    if not data_type:
        return False
    return data_type.lower() not in TEMPORAL_TYPES


def clear_cache() -> None:
    with _lock:
        _cache.clear()


__all__ = ["column_types", "needs_cast", "clear_cache", "TEMPORAL_TYPES"]
