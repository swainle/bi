"""错误日志仓储 —— 前端上报 + 后端未处理异常（纯 SQL）.

约定：
    * 只存排障必需的信息，message / stack / url 都截断，避免把大对象写进表；
    * 保留天数 `BI_ERROR_RETAIN_DAYS`（默认 30），每小时最多清理一次；
    * 写失败绝不影响主流程（调用方负责 try/except）。
"""

from __future__ import annotations

from app.timezone import time_text

import json
import os
import time
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

_last_prune = 0.0


def _clip(value: Any, size: int) -> str:
    return str(value or "")[:size]


def retain_days() -> int:
    try:
        return max(1, int(os.getenv("BI_ERROR_RETAIN_DAYS", "30") or "30"))
    except ValueError:
        return 30


def insert(db: Session, payload: dict) -> dict:
    """写一条错误记录；返回落库后的行."""
    row = db.execute(
        text(
            "INSERT INTO bi_error_log "
            "(source, level, message, stack, url, user_id, username, user_agent, extra) "
            "VALUES (:source, :level, :message, :stack, :url, :user_id, :username, :user_agent, "
            "        CAST(:extra AS jsonb)) RETURNING *"
        ),
        {
            "source": _clip(payload.get("source") or "frontend", 20),
            "level": _clip(payload.get("level") or "error", 16),
            "message": _clip(payload.get("message"), 2000),
            "stack": _clip(payload.get("stack"), 8000),
            "url": _clip(payload.get("url"), 1000),
            "user_id": payload.get("user_id"),
            "username": _clip(payload.get("username"), 120),
            "user_agent": _clip(payload.get("user_agent"), 500),
            "extra": json.dumps(payload.get("extra") or {}, ensure_ascii=False)[:4000],
        },
    ).fetchone()
    db.commit()
    return _row_dict(row)


def _row_dict(row) -> dict:
    m = row._mapping
    extra = m["extra"]
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except ValueError:
            extra = {}
    return {
        "id": int(m["id"]),
        "source": m["source"],
        "level": m["level"],
        "message": m["message"],
        "stack": m["stack"],
        "url": m["url"],
        "user_id": m["user_id"],
        "username": m["username"],
        "user_agent": m["user_agent"],
        "extra": extra or {},
        "created_at": time_text(m["created_at"] or ""),
    }


def list_errors(db: Session, *, source: str | None = None, level: str | None = None,
                limit: int = 100, offset: int = 0) -> list[dict]:
    sql = "SELECT * FROM bi_error_log WHERE 1 = 1"
    params: dict = {"limit": max(1, min(limit, 200)), "offset": max(0, offset)}
    if source:
        sql += " AND source = :source"
        params["source"] = source
    if level:
        sql += " AND level = :level"
        params["level"] = level
    sql += " ORDER BY created_at DESC, id DESC LIMIT :limit OFFSET :offset"
    return [_row_dict(row) for row in db.execute(text(sql), params).fetchall()]


def counts(db: Session) -> dict:
    total = db.execute(text("SELECT count(*) FROM bi_error_log")).scalar() or 0
    last24 = db.execute(
        text("SELECT count(*) FROM bi_error_log WHERE created_at >= now() - interval '24 hours'")
    ).scalar() or 0
    by_source = {
        str(row[0]): int(row[1])
        for row in db.execute(
            text("SELECT source, count(*) FROM bi_error_log GROUP BY source")
        ).fetchall()
    }
    return {"total": int(total), "last24h": int(last24), "by_source": by_source}


def prune(db: Session, days: int | None = None) -> int:
    """清理超过保留天数的记录（每小时最多执行一次，调用方不必控制频率）."""
    global _last_prune
    now = time.time()
    if now - _last_prune < 3600:
        return 0
    _last_prune = now
    result = db.execute(
        text("DELETE FROM bi_error_log WHERE created_at < now() - make_interval(days => :days)"),
        {"days": days or retain_days()},
    )
    db.commit()
    return int(result.rowcount or 0)


__all__ = ["insert", "list_errors", "counts", "prune", "retain_days"]
