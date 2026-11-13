"""异步任务队列（Redis 列表）—— 供独立 worker 消费.

设计取舍：
    * 队列里放完整提交参数（job_id + QueryObject + user_id/role + attempts），
      worker 拿到就能执行，不用再回查 API 进程；
    * 任务状态仍由 `store.STORE`（Redis）统一维护，队列只负责「排队」；
    * 队列、取消标记、worker 心跳都只是 Redis key，连不上就返回 False，
      调用方（runner）自动退回 inline 执行 —— 永远不会出现「任务永远排队」。

key：
    bi:jobq                 队列（LPUSH / BRPOP）
    bi:jobcancel:<job_id>   取消标记（TTL 30 分钟）
    bi:jobworker:<uuid>     worker 心跳（10 秒刷新，30 秒过期）
"""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from app.query import redis_bus

QUEUE_KEY = "bi:jobq"
CANCEL_PREFIX = "bi:jobcancel:"
WORKER_PREFIX = "bi:jobworker:"
_CANCEL_TTL = 30 * 60
_WORKER_TTL = 30


def available() -> bool:
    return redis_bus.client() is not None


def push(payload: dict) -> bool:
    client = redis_bus.client()
    if client is None:
        return False
    try:
        client.lpush(QUEUE_KEY, json.dumps(payload, default=str))
        return True
    except Exception:
        redis_bus.disable()
        return False


def pop(timeout_seconds: int = 5) -> dict | None:
    """阻塞取一个任务；超时返回 None."""
    client = redis_bus.client()
    if client is None:
        return None
    try:
        item = client.brpop(QUEUE_KEY, timeout=max(1, int(timeout_seconds)))
    except Exception:
        redis_bus.disable()
        return None
    if not item:
        return None
    try:
        return json.loads(item[1])
    except (ValueError, TypeError):
        return None


def length() -> int:
    client = redis_bus.client()
    if client is None:
        return 0
    try:
        return int(client.llen(QUEUE_KEY))
    except Exception:
        redis_bus.disable()
        return 0


def mark_cancel(job_id: str) -> bool:
    client = redis_bus.client()
    if client is None:
        return False
    try:
        client.set(f"{CANCEL_PREFIX}{job_id}", "1", ex=_CANCEL_TTL)
        return True
    except Exception:
        redis_bus.disable()
        return False


def is_cancelled(job_id: str) -> bool:
    client = redis_bus.client()
    if client is None:
        return False
    try:
        return bool(client.exists(f"{CANCEL_PREFIX}{job_id}"))
    except Exception:
        redis_bus.disable()
        return False


def clear_cancel(job_id: str) -> None:
    client = redis_bus.client()
    if client is None:
        return
    try:
        client.delete(f"{CANCEL_PREFIX}{job_id}")
    except Exception:
        redis_bus.disable()


def heartbeat(worker_id: str) -> None:
    client = redis_bus.client()
    if client is None:
        return
    try:
        client.set(f"{WORKER_PREFIX}{worker_id}", str(int(time.time())), ex=_WORKER_TTL)
    except Exception:
        redis_bus.disable()


def workers() -> int:
    client = redis_bus.client()
    if client is None:
        return 0
    try:
        return sum(1 for _ in client.scan_iter(match=f"{WORKER_PREFIX}*", count=50))
    except Exception:
        redis_bus.disable()
        return 0


def new_worker_id() -> str:
    return f"{uuid.uuid4().hex[:8]}"


__all__ = ["available", "push", "pop", "length", "mark_cancel", "is_cancelled",
           "clear_cancel", "heartbeat", "workers", "new_worker_id", "QUEUE_KEY"]
