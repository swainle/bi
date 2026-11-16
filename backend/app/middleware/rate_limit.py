"""企业级限流中间件 — Redis 分布式滑动窗口（双实例共享状态）.

架构：
  - 优先使用 Redis（生产环境 app1+app2 共享限流计数）
  - Redis 不可用时自动回退到内存滑动窗口（单实例限流）
  - GET/HEAD/OPTIONS 请求免限流
  - 认证/健康检查/WebSocket 路径免限流

Redis 滑动窗口实现：
  使用 Sorted Set（ZSET），score 为时间戳，member 为请求唯一 ID。
  每次请求：移除窗口外旧记录 → 计数 → 未超限则写入新记录。
"""

import os
import time
import uuid
from collections import defaultdict
from typing import Optional

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# ── Redis 连接（复用 cache.py 逻辑）──────────────────────
_redis_url = os.getenv("REDIS_URL", "")
_redis_client = None

if _redis_url:
    try:
        import redis as redis_lib
        _redis_client = redis_lib.from_url(_redis_url, socket_connect_timeout=2, decode_responses=True)
        _redis_client.ping()
    except Exception:
        _redis_client = None

# ── 限流配置 ──────────────────────────────────────────────
# default 可用 RATE_LIMIT_DEFAULT 调整：压测（k6）与高并发大屏场景需要更高的每分钟上限，
# 不改默认值（300）时行为与原来完全一致。
def _env_limit(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


LIMITS = {
    "/api/mindmap/team/ws/": 10,
    "/api/mindmap/team/.*/sync": 120,
    "/api/mindmap/team/.*/data": 300,
    "default": _env_limit("RATE_LIMIT_DEFAULT", 300),
}

_WINDOW = 60  # 60 秒滑动窗口


# ── 内存回退（单实例）─────────────────────────────────────
_counts: dict[str, list[float]] = defaultdict(list)


def _check_redis(ip: str, limit: int) -> bool:
    """Redis 滑动窗口限流 — 返回 True 表示允许，False 表示超限."""
    key = f"rate_limit:{ip}"
    now = time.time()
    window_start = now - _WINDOW

    pipe = _redis_client.pipeline()
    # 1. 移除窗口外的旧记录
    pipe.zremrangebyscore(key, 0, window_start)
    # 2. 获取当前窗口内请求数
    pipe.zcard(key)
    # 3. 设置 key 过期时间（自动清理）
    pipe.expire(key, _WINDOW + 1)

    results = pipe.execute()
    current_count = results[1]

    if current_count >= limit:
        return False

    # 4. 写入新请求记录（使用 uuid 保证 member 唯一）
    _redis_client.zadd(key, {str(uuid.uuid4()): now})
    return True


def _check_memory(ip: str, limit: int) -> bool:
    """内存滑动窗口限流（回退方案）— 返回 True 表示允许."""
    now = time.time()
    counts = _counts[ip]
    _counts[ip] = [t for t in counts if now - t < _WINDOW]

    if len(_counts[ip]) >= limit:
        return False

    _counts[ip].append(now)
    return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    """分布式滑动窗口限流 — Redis 优先，内存回退."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # 认证、健康检查、站点信息、GET 读取端不限流
        if any(path.startswith(p) for p in ("/api/auth/", "/api/health", "/metrics", "/api/site-info")):
            return await call_next(request)
        if request.method == "GET":
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"

        # WebSocket 连接不限流
        if "/ws/" in path:
            return await call_next(request)

        # 确定限流级别
        limit = LIMITS["default"]
        for pattern, l in LIMITS.items():
            if pattern != "default" and pattern in path:
                limit = l
                break

        # 滑动窗口检查
        if _redis_client:
            allowed = _check_redis(client_ip, limit)
        else:
            allowed = _check_memory(client_ip, limit)

        if not allowed:
            return JSONResponse(status_code=429, content={"detail": "请求过于频繁，请稍后再试"})

        return await call_next(request)


# 供 main.py 注册
__all__ = ["RateLimitMiddleware"]
