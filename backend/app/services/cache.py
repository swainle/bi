"""缓存服务 — 内存缓存（同步安全） + Redis 装饰器（异步端点用）"""

from __future__ import annotations

import json
import logging
import time
from functools import wraps

logger = logging.getLogger("cache")

# ── 内存缓存（同步安全，供 auth 中间件等同步上下文使用）───────────

_mem_cache: dict[str, tuple[float, any]] = {}

def cache_get(key: str) -> dict | None:
    """同步读取内存缓存，TTL 过期自动清理."""
    entry = _mem_cache.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.time() > expires_at:
        del _mem_cache[key]
        return None
    return value


def cache_set(key: str, value: dict, ttl: int = 600):
    """同步写入内存缓存（ttl 秒后过期）."""
    _mem_cache[key] = (time.time() + ttl, value)


def cache_delete(key: str):
    """同步删除内存缓存."""
    _mem_cache.pop(key, None)

# ── Redis 异步（供 async 端点使用）─────────────────────────

async def _get_redis():
    try:
        import redis.asyncio as aioredis
        r = aioredis.Redis.from_url("redis://localhost:6379/1", decode_responses=True)
        await r.ping()
        return r
    except Exception:
        return None


def ttl_cache(ttl: int = 5):
    """Redis 缓存装饰器（仅用于 async 函数）"""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            r = await _get_redis()
            if not r:
                return await func(*args, **kwargs)

            key = f"cache:{func.__name__}:{':'.join(str(a) for a in args)}"
            try:
                cached = await r.get(key)
                if cached:
                    return json.loads(cached)
            except Exception:
                pass

            result = await func(*args, **kwargs)
            try:
                await r.setex(key, ttl, json.dumps(result, ensure_ascii=False))
            except Exception:
                pass
            return result
        return wrapper
    return decorator
