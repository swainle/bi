"""规则指纹 —— 缓存键的一部分.

为什么必须做：
    /data/{table} 有查询缓存，若不把行级规则算进 key，
    A 用户查过的结果会被 B 用户直接命中（越权）。
"""

from __future__ import annotations

import hashlib
from typing import Iterable


def fingerprint(conditions: Iterable[str]) -> str:
    """稳定指纹：同样一组条件 → 同样字符串."""
    items = sorted(c.strip() for c in conditions if c and c.strip())
    if not items:
        return "-"
    raw = "\x1f".join(items).encode("utf-8")
    return hashlib.sha1(raw).hexdigest()[:16]


__all__ = ["fingerprint"]
