"""正在执行的查询登记表 —— 支持「取消查询」.

登记：query_id → {pid, user_id, table, started_at, source}
    * Redis（`bi:qrun:<query_id>`，TTL 5 分钟）→ 多 worker 都能看到、都能取消；
    * 进程内 dict → Redis 不可用时的回退（只能取消同进程的查询）。

取消：PostgreSQL 的 `pg_cancel_backend(pid)`，由数据库端真正打断语句；
只能取消自己的查询，管理员不限。直连源库（MySQL / 其它 PG 实例）的 pid 不在本地库上，
这里只处理「本地 Postgres」这条主链路，直连源库靠语句超时兜底。
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from sqlalchemy import text

from app.query import redis_bus

_KEY_PREFIX = "bi:qrun:"
_TTL_SECONDS = 300

_local: dict[str, dict] = {}
_lock = threading.Lock()


def _key(query_id: str) -> str:
    return f"{_KEY_PREFIX}{query_id}"


def register(query_id: str, *, user_id: Any, table: str, pid: int, source: str = "internal") -> None:
    """登记一条正在执行的查询（任何异常都吞掉，绝不影响查询本身）."""
    info = {
        "query_id": query_id,
        "user_id": int(user_id or 0) or None,
        "table": (table or "")[:200],
        "pid": int(pid or 0),
        "source": source,
        "started_at": time.time(),
    }
    with _lock:
        _local[query_id] = info
    client = redis_bus.client()
    if client is None:
        return
    try:
        client.set(_key(query_id), json.dumps(info), ex=_TTL_SECONDS)
    except Exception:
        redis_bus.disable()


def unregister(query_id: str) -> None:
    with _lock:
        _local.pop(query_id, None)
    client = redis_bus.client()
    if client is None:
        return
    try:
        client.delete(_key(query_id))
    except Exception:
        redis_bus.disable()


def lookup(query_id: str) -> dict | None:
    client = redis_bus.client()
    if client is not None:
        try:
            raw = client.get(_key(query_id))
            if raw:
                return json.loads(raw)
        except Exception:
            redis_bus.disable()
    with _lock:
        return _local.get(query_id)


def cancel(query_id: str, user: Any) -> dict:
    """取消一条正在执行的查询。异常：
        LookupError     查询不存在 / 已结束
        PermissionError 不是自己的查询
        ValueError      当前数据库不支持取消
    """
    info = lookup(query_id)
    if info is None:
        raise LookupError("查询不存在或已结束")

    role = getattr(user, "role", "") or ""
    if role not in ("admin", "super_admin") and info.get("user_id") != getattr(user, "id", None):
        raise PermissionError("只能取消自己的查询")
    if info.get("source") != "internal":
        raise ValueError("直连源库的查询暂不支持手动取消，请等待语句超时")

    pid = int(info.get("pid") or 0)
    if pid <= 0:
        raise ValueError("这条查询没有可取消的数据库会话")

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        if db.get_bind().dialect.name != "postgresql":
            raise ValueError("当前数据库不支持取消查询")
        sent = db.execute(text("SELECT pg_cancel_backend(:pid)"), {"pid": pid}).scalar()
        db.commit()
    finally:
        db.close()

    unregister(query_id)
    return {"query_id": query_id, "cancelled": bool(sent), "pid": pid}


__all__ = ["register", "unregister", "lookup", "cancel"]
