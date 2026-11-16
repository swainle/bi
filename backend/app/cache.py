"""缓存层 — Redis（生产）/ 内存（开发回退）.

通过 REDIS_URL 环境变量配置 Redis 连接。
未配置时自动回退到内存缓存（基于 dict + TTL）。
"""

import os
import time
import json
import functools
from typing import Any, Callable, Optional

import redis as redis_lib

# ── Redis 连接 ───────────────────────────────────────────────
_redis_url = os.getenv("REDIS_URL", "")
_redis: Optional[redis_lib.Redis] = None

if _redis_url:
    try:
        _redis = redis_lib.from_url(_redis_url, socket_connect_timeout=2)
        _redis.ping()
    except Exception:
        _redis = None  # 回退到内存

# ── 内存缓存（回退）───────────────────────────────────────────
_memory_cache: dict[str, tuple[float, Any]] = {}
# 进程内缓存条数上限：key 会带用户/参数指纹，不设限长期运行会慢慢涨
_MEMORY_MAX_KEYS = 4000


def _prune_memory() -> None:
    if len(_memory_cache) < _MEMORY_MAX_KEYS:
        return
    now = time.time()
    for key in [k for k, (expires_at, _v) in _memory_cache.items() if expires_at <= now]:
        _memory_cache.pop(key, None)
    if len(_memory_cache) >= _MEMORY_MAX_KEYS:  # 还满就丢掉最早到期的一半
        overflow = len(_memory_cache) - _MEMORY_MAX_KEYS // 2
        for key in sorted(_memory_cache, key=lambda k: _memory_cache[k][0])[:overflow]:
            _memory_cache.pop(key, None)


def get(key: str) -> Optional[Any]:
    """获取缓存值（Redis 掉线 / 值损坏 → 当作未命中）."""
    if _redis:
        try:
            raw = _redis.get(key)
            return json.loads(raw) if raw else None
        except Exception:
            return None

    entry = _memory_cache.get(key)
    if entry:
        expires_at, value = entry
        if time.time() < expires_at:
            return value
        del _memory_cache[key]
    return None


def set(key: str, value: Any, ttl: int = 300) -> None:
    """设置缓存（默认 TTL 5 分钟）；缓存不可用时静默跳过."""
    if _redis:
        try:
            _redis.setex(key, ttl, json.dumps(value, default=str))
        except Exception:
            return
        return

    _prune_memory()
    _memory_cache[key] = (time.time() + ttl, value)


def delete(key: str) -> None:
    """删除缓存."""
    if _redis:
        try:
            _redis.delete(key)
        except Exception:
            return
    else:
        _memory_cache.pop(key, None)


def cached(ttl: int = 300, key_prefix: str = "cache"):
    """装饰器：缓存函数返回值.

    Usage:
        @cached(ttl=60, key_prefix="articles")
        def get_articles(...): ...
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            cache_key = f"{key_prefix}:{func.__name__}:{hash(str(args) + str(kwargs))}"
            result = get(cache_key)
            if result is not None:
                return result
            result = func(*args, **kwargs)
            set(cache_key, result, ttl)
            return result
        return wrapper
    return decorator


def invalidate_prefix(prefix: str) -> None:
    """按前缀批量失效缓存：删掉 `prefix:*`（Redis / 内存同一口径）."""
    if not _redis:
        keys = [k for k in _memory_cache if k.startswith(f"{prefix}:")]
        for k in keys:
            del _memory_cache[k]
        return

    try:
        cursor = 0
        while True:
            cursor, keys = _redis.scan(cursor, match=f"{prefix}:*", count=100)
            if keys:
                _redis.delete(*keys)
            if cursor == 0:
                break
    except Exception:
        return
