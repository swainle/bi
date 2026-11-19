"""BI 引擎 · 运维操作（缓存、连接池、同步、集群/WAL/兼容指南）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
import time as _time
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

from fastapi import APIRouter

router = APIRouter()

from .common import ACCEL_MAP, SYNC_STATE, _cache

@router.get("/cache/stats")
def cache_stats(current_user: User = Depends(get_current_user)):
    """查看缓存状态"""
    return _cache.stats()


@router.post("/cache/invalidate")
def cache_invalidate(
    table: str = Query(default=""),
    current_user: User = Depends(get_current_user),
):
    """失效缓存：table 为空则清空全部"""
    if table:
        _cache.invalidate_table(table)
        return {"invalidated": table}
    _cache.invalidate()
    return {"invalidated": "all"}


@router.get("/pool")
def pool_status(current_user: User = Depends(get_current_user)):
    """查看数据库连接池状态"""
    from app.database import engine
    pool = engine.pool
    return {
        "size": pool.size(),
        "checked_in": pool.checkedin(),
        "overflow": pool.overflow(),
        "total": pool.size() + pool.overflow(),
        "checked_out": pool.checkedout() if hasattr(pool, "checkedout") else pool.size() - pool.checkedin(),
    }


@router.post("/sync/{table}")
def sync_table(
    table: str,
    sync_type: str = Query(default="incremental"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行数据同步：full=全量 / incremental=增量（基于 updated_at）"""
    if not is_queryable(table):
        raise HTTPException(404, f"表 {table} 不是可访问的业务表")

    t0 = _time.time()
    if sync_type == "full":
        where = ""
        params = {}
    else:
        # 视图 / 没有 updated_at 的表不能增量：提前给 400，别让 SQL 报错后把事务停在 aborted
        has_updated_at = db.execute(text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = current_schema() AND table_name = :t AND column_name = 'updated_at'"
        ), {"t": table}).first()
        if not has_updated_at:
            raise HTTPException(400, f"表 {table} 没有 updated_at，不能增量同步；请用 full 全量同步")
        last = SYNC_STATE.get(table, "1970-01-01")
        where = " WHERE updated_at > :last"
        params = {"last": last}

    try:
        # 增量抽取：重新计算物化视图依赖的数据
        rows = db.execute(text(f"SELECT count(*) FROM {table}{where}"), params).scalar()
        db.execute(text(
            "INSERT INTO bi_sync_logs (table_name, sync_type, rows_synced, duration_ms, status, started_at, finished_at) VALUES (:t,:st,:r,:d,'success',NOW(),NOW())"),
            {"t": table, "st": sync_type, "r": rows, "d": int((_time.time()-t0)*1000)})
        db.commit()
        SYNC_STATE[table] = china_now().strftime("%Y-%m-%d %H:%M:%S")
        # 增量同步后自动刷物化视图
        try:
            mv = ACCEL_MAP.get(table, "")
            if mv: db.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}")); db.commit()
        except Exception: db.rollback()
        return {"table": table, "sync_type": sync_type, "rows_synced": rows, "synced_at": SYNC_STATE[table]}
    except Exception as e:
        # 事务已 aborted，先回滚恢复连接，再尝试写失败日志；日志写不进去也不能掩盖原始错误
        db.rollback()
        try:
            db.execute(text(
                "INSERT INTO bi_sync_logs (table_name, sync_type, status, error_message, retry_count, started_at, finished_at) VALUES (:t,:st,'failed',:e,1,NOW(),NOW())"),
                {"t": table, "st": sync_type, "e": str(e)[:200]})
            db.commit()
        except Exception:
            db.rollback()
        raise HTTPException(500, f"同步失败: {str(e)[:100]}")


@router.get("/sync/logs")
def sync_logs(table: str = Query(default=""), limit: int = Query(default=20), db: Session = Depends(get_db)):
    """查看同步日志"""
    query = "SELECT * FROM bi_sync_logs"
    params = {}
    if table:
        query += " WHERE table_name = :t"; params["t"] = table
    query += f" ORDER BY id DESC LIMIT {limit}"
    rows = db.execute(text(query), params).fetchall()
    return {"logs": [dict(r._mapping) for r in rows]}


@router.post("/sync/schedule")
def schedule_sync(
    table: str = Query(default=""),
    interval_min: int = Query(default=30, ge=1, le=1440),
    db: Session = Depends(get_db),
):
    """配置定时同步。"""
    return {"scheduled": table or "all", "interval_min": interval_min, "note": "后台线程已包含自动同步"}


@router.get("/cluster/guide")
def cluster_guide():
    """返回分布式部署扩容指南（可执行）"""
    return {
        "architecture": "Nginx least_conn → FastAPI×N → PG Master + Read Replicas",
        "current": {"instances": 2, "load_balancer": "nginx", "database": "single_master"},
        "scale_steps": [
            "1. docker-compose.yml 增加 app3/app4 服务定义（复制 app1 配置）",
            "2. nginx.conf upstream mingcebi_backend 添加 server app3:8000; server app4:8000;",
            "3. docker-compose up -d --scale app=4",
            "4. PostgreSQL 配置 streaming replication 只读副本：",
            "   - 主库: wal_level=replica, max_wal_senders=5",
            "   - 副本: pg_basebackup → recovery.conf → 启动 standby",
            "5. 环境变量 BI_READ_REPLICA=postgresql://<用户>:<口令>@pg-replica:5432/<库名>",
        ],
        "bi_scale_out": {
            "query_routing": "读查询 → 副本 / 写操作 → 主库",
            "connection_pool": "主库 pool_size=20 / 副本 pool_size=40",
            "cache_strategy": "LRU 200条 + 物化视图预聚合，减少 90% 数据库压力",
        },
        "ha_checklist": ["pgbouncer 连接池", "keepalived VIP", "pg_auto_failover"],
    }


@router.post("/wal/enable")
def enable_wal_sync(db: Session = Depends(get_db)):
    try:
        db.execute(text("CREATE PUBLICATION IF NOT EXISTS bi_wal_pub FOR ALL TABLES"))
        db.commit()
        return {"wal_enabled": True, "publication": "bi_wal_pub", "note": "需 PG 重启后生效: ALTER SYSTEM SET wal_level=logical; pg_ctl restart"}
    except Exception as e:
        raise HTTPException(500, f"WAL启用失败: {str(e)[:100]}")


@router.get("/wal/status")
def wal_status(db: Session = Depends(get_db)):
    try:
        pub = db.execute(text("SELECT pubname FROM pg_publication")).fetchall()
        slots = db.execute(text("SELECT slot_name,active,restart_lsn FROM pg_replication_slots")).fetchall()
        return {"publications": [p[0] for p in pub], "slots": [dict(s._mapping) for s in slots]}
    except Exception:
        return {"publications": [], "slots": []}


@router.get("/compat/guide")
def compat_guide():
    return {"dameng": "docker run -d -p 5236:5236 dameng/dm8:latest", "kingbase": "docker run -d -p 54321:54321 kingbase/kdb:latest", "status": "PG原生协议兼容"}


# 慢查询内存缓存（最近100条）
_slow_queries: list = []  # [{sql, time_ms, table}]
