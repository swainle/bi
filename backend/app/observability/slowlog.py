"""慢查询采样（落库，供「慢查询」面板与排查用）.

原则：
    * 只记超过 `BI_SLOW_SAMPLE_MS`（默认 1000ms）的查询，避免把库写爆；
    * 查询路径上只往内存环形缓冲里塞一条（不阻塞、不碰数据库），
      由后台线程每 5 秒批量写一次（独立 Session，绝不递归进查询路径）；
    * 只保留 `BI_SLOW_RETAIN_DAYS`（默认 7 天），每次批量写入时顺手清一次老数据；
    * 表不存在 / 写入失败 → 自动停用（打一条日志），不影响查询本身。
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from typing import Any

_MAX_BUFFER = 500
_FLUSH_INTERVAL_SECONDS = 5.0
_FLUSH_BATCH = 100
_CLEAN_INTERVAL_SECONDS = 600
_SQL_MAX = 500

_buffer: deque[dict] = deque(maxlen=_MAX_BUFFER)
_lock = threading.Lock()
_flusher: threading.Thread | None = None
_disabled = False
_last_clean = 0.0


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def threshold_ms() -> int:
    return _env_int("BI_SLOW_SAMPLE_MS", 1000)


def retention_days() -> int:
    return max(1, _env_int("BI_SLOW_RETAIN_DAYS", 7))


def record(*, table: str, user_id: Any, elapsed_ms: float, sql: str, source: str = "internal") -> None:
    """把一次慢查询塞进缓冲（超阈值才记）；任何异常都不外抛."""
    if _disabled:
        return
    limit = threshold_ms()
    if limit <= 0 or elapsed_ms < limit:
        return
    try:
        with _lock:
            _buffer.append({
                "user_id": int(user_id or 0) or None,
                "table_name": (table or "")[:200],
                "elapsed_ms": round(float(elapsed_ms), 1),
                "source": source[:20],
                "sql_text": (sql or "")[:_SQL_MAX],
            })
        from app.observability import metrics

        metrics.incr("slow.sampled")
        _ensure_flusher()
    except Exception:
        return


def _ensure_flusher() -> None:
    global _flusher
    if _flusher is not None:
        return
    with _lock:
        if _flusher is not None:
            return
        _flusher = threading.Thread(target=_loop, name="slow-query-flush", daemon=True)
        _flusher.start()


def _loop() -> None:
    while True:
        time.sleep(_FLUSH_INTERVAL_SECONDS)
        try:
            _flush_once()
        except Exception:
            pass


def _flush_once() -> int:
    """把缓冲里的样本批量写库；返回写入条数."""
    global _disabled, _last_clean
    with _lock:
        if not _buffer:
            return 0
        batch = [_buffer.popleft() for _ in range(min(_FLUSH_BATCH, len(_buffer)))]

    from sqlalchemy import text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        db.execute(
            text(
                "INSERT INTO bi_query_slow (user_id, table_name, elapsed_ms, source, sql_text) "
                "VALUES (:user_id, :table_name, :elapsed_ms, :source, :sql_text)"
            ),
            batch,
        )
        now = time.time()
        if now - _last_clean > _CLEAN_INTERVAL_SECONDS:
            db.execute(
                text("DELETE FROM bi_query_slow WHERE created_at < now() - make_interval(days => :days)"),
                {"days": retention_days()},
            )
            _last_clean = now
        db.commit()
        return len(batch)
    except Exception:
        db.rollback()
        _disabled = True  # 表不存在 / 权限不足：停用，不影响查询
        print("[slowlog] 慢查询采样写入失败，已停用（检查 019_query_slow 迁移）")
        return 0
    finally:
        db.close()


def recent(limit: int = 50, user_id: int | None = None) -> list[dict]:
    """最近的慢查询（给管理端点用）."""
    from sqlalchemy import text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        sql = "SELECT created_at, user_id, table_name, elapsed_ms, source, sql_text FROM bi_query_slow"
        params: dict = {"limit": max(1, min(int(limit or 50), 200))}
        if user_id is not None:
            sql += " WHERE user_id = :user_id"
            params["user_id"] = user_id
        sql += " ORDER BY created_at DESC LIMIT :limit"
        rows = db.execute(text(sql), params).fetchall()
        return [
            {
                "created_at": str(r[0] or ""),
                "user_id": r[1],
                "table": r[2],
                "elapsed_ms": float(r[3] or 0),
                "source": r[4],
                "sql": r[5],
            }
            for r in rows
        ]
    except Exception:
        return []
    finally:
        db.close()


__all__ = ["record", "recent", "threshold_ms", "retention_days"]
