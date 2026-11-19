"""管理后台 · 运维（/ops）。"""

from __future__ import annotations

from app.timezone import time_text, utc_now

import os
import time
from fastapi import Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import require
from app.database import get_db
from app.errors import repository as errors_repo
from app.middleware.audit import log_audit
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import _env_int

@router.get("/ops")
def ops_status(
    current_user: User = Depends(require("bi:ops:manage")),
    db: Session = Depends(get_db),
):
    from app.routers.metrics import collect

    data = collect()

    started = time.monotonic()
    db_ok = True
    db_error = ""
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        db_error = str(exc)[:200]
    latency_ms = round((time.monotonic() - started) * 1000, 1)

    stats = {"total": 0, "last24h": 0}
    try:
        stats = errors_repo.counts(db)
    except Exception:
        pass

    slow: list[dict] = []
    try:
        rows = db.execute(
            text(
                "SELECT table_name, elapsed_ms, source, created_at FROM bi_query_slow "
                "ORDER BY created_at DESC LIMIT 8"
            )
        ).fetchall()
        slow = [
            {
                "table_name": r[0] or "—",
                "elapsed_ms": float(r[1] or 0),
                "source": r[2] or "internal",
                "created_at": time_text(r[3] or ""),
            }
            for r in rows
        ]
    except Exception:
        slow = []

    return {
        **data,
        "database": {
            **data.get("database", {}),
            "ok": db_ok,
            "latency_ms": latency_ms,
            "error": db_error,
        },
        "errors": {
            "total": int(stats.get("total", 0)),
            "last24h": int(stats.get("last24h", 0)),
            "retain_days": errors_repo.retain_days(),
        },
        "top_slow": slow,
        "settings": {
            "render_cache_ttl": _env_int("BI_RENDER_CACHE_TTL", 15),
            "job_executor": os.getenv("BI_JOB_EXECUTOR", "inline"),
            "job_store": os.getenv("BI_JOB_STORE", "auto"),
            "alerts_seconds": _env_int("BI_ALERT_INTERVAL_SECONDS", 60),
            "reports_seconds": _env_int("BI_REPORT_INTERVAL_SECONDS", 60),
            "sync_seconds": _env_int("BI_SYNC_INTERVAL_SECONDS", 60),
            "sync_max_per_run": _env_int("BI_SYNC_MAX_PER_RUN", 3),
            "rate_limit_per_min": _env_int("RATE_LIMIT_DEFAULT", 300),
            "query_timeout_ms": _env_int("BI_QUERY_TIMEOUT_MS", 15000),
            "user_max_concurrent": _env_int("BI_USER_MAX_CONCURRENT", 16),
            "render_workers": _env_int("BI_RENDER_WORKERS", 4),
        },
    }


@router.post("/ops/prune-errors")
def prune_errors(
    payload: dict = Body(default={}),
    current_user: User = Depends(require("bi:ops:manage")),
    db: Session = Depends(get_db),
):
    """按天清理错误日志（默认按保留天数）；返回实际删除条数."""
    raw_days = payload.get("days")
    try:
        days = errors_repo.retain_days() if raw_days in (None, "") else int(raw_days)
    except (TypeError, ValueError):
        raise HTTPException(400, "days 必须是整数")
    if days < 1 or days > 3650:
        raise HTTPException(400, "保留天数需要在 1-3650 之间")
    result = db.execute(
        text("DELETE FROM bi_error_log WHERE created_at < now() - make_interval(days => :days)"),
        {"days": days},
    )
    deleted = int(result.rowcount or 0)
    db.commit()
    log_audit(current_user.id, "admin.ops.prune_errors", "error_log", 0, {"days": days, "deleted": deleted})
    return {"deleted": deleted, "days": days, "message": f"已清理 {deleted} 条错误日志"}


@router.post("/ops/clear-cache")
def clear_render_cache(
    current_user: User = Depends(require("bi:ops:manage")),
):
    from app import cache

    cache.invalidate_prefix("render")
    log_audit(current_user.id, "admin.ops.clear_cache", "render_cache", 0, {})
    return {"message": "渲染缓存已清空"}
