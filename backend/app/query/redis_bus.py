"""查询治理用的 Redis 连接（惰性建连、可失败）.

配额计数、正在执行的查询登记都需要 Redis；拿不到就返回 None，
调用方自行回退进程内实现 —— 治理能力不能成为查询的硬依赖。
"""

from __future__ import annotations

import os
import threading
from typing import Any

_client: Any = None
_checked = False
_lock = threading.Lock()


def client() -> Any:
    global _client, _checked
    if _checked:
        return _client
    with _lock:
        if _checked:
            return _client
        _checked = True
        url = (os.getenv("REDIS_URL") or "").strip()
        if not url:
            return None
        try:
            import redis as redis_lib

            candidate = redis_lib.from_url(url, socket_connect_timeout=1, decode_responses=True)
            candidate.ping()
            _client = candidate
        except Exception:
            _client = None
    return _client


def reset() -> None:
    """清掉缓存的客户端，下次调用重新探测（测试 / 配置变更用）."""
    global _client, _checked
    with _lock:
        _client = None
        _checked = False


def disable() -> None:
    """本进程不再尝试 Redis（中途连不上时用，避免每条查询都等一次连接超时）."""
    global _client, _checked
    with _lock:
        _client = None
        _checked = True


__all__ = ["client", "reset", "disable"]
