"""Redis 客户端 — 可选。未配置 REDIS_URL 时返回 None，调用方自行降级。"""
from __future__ import annotations

import os
from typing import Optional

_client = None
_tried = False


def get_redis():
    """返回 Redis 客户端；未配置/不可用时返回 None。"""
    global _client, _tried
    if _tried:
        return _client
    _tried = True
    url = os.getenv("REDIS_URL", "").strip()
    if not url:
        return None
    try:
        import redis

        _client = redis.from_url(url, socket_connect_timeout=2, decode_responses=True)
        _client.ping()
    except Exception:
        _client = None
    return _client
