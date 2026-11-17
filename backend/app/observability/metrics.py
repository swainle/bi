"""进程内指标计数器（给 `/api/metrics` 用）.

只做「累加 + 快照」，不做聚合与存储：
    * 进程重启就归零（要长期趋势请接 Prometheus / 日志系统）；
    * 多 worker 时每个进程各一份，端点返回的是当前进程的数字；
    * 所有操作都是内存 + 锁，开销可忽略，不碰数据库、不碰 Redis。
"""

from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_counters: dict[str, float] = {}


def incr(name: str, amount: float = 1) -> None:
    with _lock:
        _counters[name] = _counters.get(name, 0) + amount


def decr(name: str, amount: float = 1) -> None:
    incr(name, -amount)


def set_value(name: str, value: float) -> None:
    with _lock:
        _counters[name] = value


def get(name: str, default: float = 0) -> float:
    with _lock:
        return _counters.get(name, default)


def snapshot(prefix: str | None = None) -> dict[str, Any]:
    with _lock:
        items = list(_counters.items())
    if prefix:
        items = [(k, v) for k, v in items if k.startswith(prefix)]
    return {k: (int(v) if float(v).is_integer() else round(v, 3)) for k, v in sorted(items)}


def reset() -> None:
    """测试用：清空计数器."""
    with _lock:
        _counters.clear()


__all__ = ["incr", "decr", "set_value", "get", "snapshot", "reset"]
