"""系统指标端点 —— 给监控 / 排障用.

只返回进程内聚合数字（不返回 SQL、不返回业务数据）：
    query      查询总量 / 成功 / 失败 / 超时 / 取消 / 配额拒绝 / 并发中
    render_cache  整页缓存命中率
    jobs       异步任务执行方式、队列长度、worker 进程数、任务状态分布
    database   连接池使用情况
    slow_queries  慢查询采样量（最近 1 小时 / 24 小时）

注意：多 worker 部署时，这些是「当前进程」的数字；要全局趋势请接 Prometheus / 日志系统。
"""

from __future__ import annotations

import time

from fastapi import APIRouter

from app.config import settings
from app.dashboards import render_cache
from app.database import get_pool_status
from app.observability import metrics, slowlog
from app.query import async_jobs, redis_bus

router = APIRouter(tags=["系统指标"])

_STARTED_AT = time.time()


def _slow_counts() -> dict:
    """慢查询采样量（表不存在 / 未迁移时返回 0，不影响端点）."""
    from sqlalchemy import text

    from app.database import SessionLocal

    db = SessionLocal()
    try:
        row = db.execute(
            text(
                "SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour'), "
                "       count(*) FILTER (WHERE created_at > now() - interval '24 hours') "
                "FROM bi_query_slow"
            )
        ).fetchone()
        return {"last_hour": int(row[0] or 0), "last_day": int(row[1] or 0)}
    except Exception:
        return {"last_hour": 0, "last_day": 0}
    finally:
        db.close()


def collect() -> dict:
    counters = metrics.snapshot()
    lookups = int(counters.get("render_cache.lookups", 0))
    hits = int(counters.get("render_cache.hits", 0))
    return {
        "app": {
            "name": settings.app_name,
            "version": settings.app_version,
            "uptime_seconds": int(time.time() - _STARTED_AT),
        },
        "database": {**get_pool_status(), "pool_timeouts": int(counters.get("pool_timeout", 0))},
        "redis": {"enabled": redis_bus.client() is not None},
        "query": {
            "in_flight": max(0, int(counters.get("query.in_flight", 0))),
            "total": int(counters.get("query.total", 0)),
            "ok": int(counters.get("query.ok", 0)),
            "failed": int(counters.get("query.failed", 0)),
            "timeout": int(counters.get("query.timeout", 0)),
            "cancelled": int(counters.get("query.cancelled", 0)),
            "quota_rejected": int(counters.get("query.quota_rejected", 0)),
            # 直连源库（Superset 式 Live Query）走另一条执行路径，单独计数
            "live_total": int(counters.get("query.live_total", 0)),
            "live_ok": int(counters.get("query.live_ok", 0)),
            "live_failed": int(counters.get("query.live_failed", 0)),
        },
        "render_cache": {
            "ttl_seconds": render_cache.ttl(),
            "lookups": lookups,
            "hits": hits,
            "hit_rate": round(hits / lookups, 3) if lookups else None,
            "stores": int(counters.get("render_cache.stores", 0)),
            "invalidations": int(counters.get("render_cache.invalidations", 0)),
        },
        "slow_queries": {
            "threshold_ms": slowlog.threshold_ms(),
            "sampled": int(counters.get("slow.sampled", 0)),
            **_slow_counts(),
        },
        "jobs": async_jobs.stats(),
    }


@router.get("/metrics")
def metrics_endpoint():
    return collect()


__all__ = ["router", "collect"]
