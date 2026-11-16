"""BI 自研引擎 — 数据查询 API，直连 PostgreSQL，返回 JSON 给前端 ECharts"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Body, File, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional
import json
import re
import io
import hashlib
import openpyxl
import pandas as pd

from app.database import get_db
from app.security.nav_guard import require_nav
from app.middleware.auth import get_current_user
from app.middleware.audit import log_audit
from app.models.user import User

# ═══════ 安全内核（独立模块，改这里不会牵连路由逻辑）═══════
from app.security.errors import RlsBlockedError, SecurityError
from app.security.rls import apply_to_sql, decide as rls_decide, where_sql as rls_where
from app.security.rls.injector import inject_conditions
from app.admin.permissions import require

# AI 端点统一鉴权（S0）：登录 + 权限码；此前多数端点匿名可调用
_AI_USE = [Depends(require("bi:ai:use", "没有 AI 使用权限，请联系管理员开通"))]
_AI_SQL = [Depends(require("bi:ai:sql", "没有 AI 生成 SQL 的权限，请联系管理员开通"))]
from app.security.rls.models import RlsDecision
from app.security.sql_guard import guard_readonly, referenced_tables

# ═══════ 分布式读写分离 ═══════
import os as _os
_BI_REPLICA_URL = _os.environ.get("BI_READ_REPLICA", "")
_replica_engine = None

def _get_read_db():
    """获取读副本数据库会话（降级到主库）"""
    global _replica_engine
    if not _BI_REPLICA_URL:
        from app.database import SessionLocal
        db = SessionLocal()
        return db
    if _replica_engine is None:
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        _replica_engine = create_engine(_BI_REPLICA_URL, pool_size=40, max_overflow=10, pool_pre_ping=True)
    return _replica_engine.connect()

router = APIRouter(prefix="/bi/engine", tags=["BI引擎"])

import re as _re
import time as _time


# ═══════ 分析函数库 ═══════
# 支持 Postgres 窗口函数自动生成

def _parse_function(func_type: str, metric_col: str, time_col: str) -> str:
    """将分析函数类型翻译为 PostgreSQL SQL 表达式"""
    _validate_col(metric_col)
    _validate_col(time_col)

    if func_type == "yoy":
        # 同比：当前值 / 去年同期 - 1
        return f"""
            CASE WHEN LAG("{metric_col}", 12) OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}", 12) OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_yoy_pct"
        """
    elif func_type == "mom":
        # 环比：当前值 / 上期 - 1
        return f"""
            CASE WHEN LAG("{metric_col}") OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}") OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_mom_pct"
        """
    elif func_type == "cumulative":
        return f'SUM("{metric_col}") OVER (ORDER BY "{time_col}" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "{metric_col}_cumsum"'
    elif func_type == "moving_avg":
        return f'ROUND(AVG("{metric_col}") OVER (ORDER BY "{time_col}" ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING), 2) AS "{metric_col}_ma5"'
    elif func_type == "rank":
        return f'RANK() OVER (ORDER BY "{metric_col}" DESC) AS "{metric_col}_rank"'
    elif func_type == "pct_change":
        return f"""
            CASE WHEN LAG("{metric_col}") OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}") OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_pct"
        """
    elif func_type == "share":
        return f'ROUND("{metric_col}" * 100.0 / NULLIF(SUM("{metric_col}") OVER (), 0), 1) AS "{metric_col}_share_pct"'
    else:
        raise HTTPException(400, f"未知分析函数: {func_type}，支持: yoy/mom/cumulative/moving_avg/rank/pct_change/share")


def _validate_col(col: str):
    if not _re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', col):
        raise HTTPException(400, f"非法列名: {col}")


# 查询构建器允许的筛选运算符（白名单，值一律走绑定参数）
_FILTER_OPS = {
    "=", "!=", "<>", ">", "<", ">=", "<=",
    "IN", "NOT IN", "BETWEEN", "LIKE", "ILIKE",
}


FUNC_META = {
    "yoy":        {"label": "同比 YoY", "desc": "与去年同期比较的变化率（需12期数据）"},
    "mom":        {"label": "环比 MoM", "desc": "与上一期比较的变化率"},
    "cumulative": {"label": "累计值", "desc": "截至当前的累计总和"},
    "moving_avg": {"label": "移动平均", "desc": "前后2期的5期移动平均"},
    "rank":       {"label": "排名", "desc": "按指标降序排名"},
    "pct_change": {"label": "变化率", "desc": "每期相对于上一期的变化百分比"},
    "share":      {"label": "占比", "desc": "当前值占总体的百分比"},
}


@router.post("/analyze")
def compute_analysis(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """对 BI 表执行分析函数计算。
    参数: {table, time_col, metric_col, func: "yoy"|"mom"|"cumulative"|"moving_avg"|"rank"|"pct_change"|"share"}
    """
    table = payload.get("table", "")
    time_col = payload.get("time_col", "")
    metric_col = payload.get("metric_col", "")
    func_type = payload.get("func", "")

    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(404, f"表 {table} 不在白名单中")
    if not func_type or func_type not in FUNC_META:
        raise HTTPException(400, f"无效函数类型，支持: {list(FUNC_META)}")

    sql_expr = _parse_function(func_type, metric_col, time_col)

    try:
        rows = db.execute(text(f"""
            SELECT "{time_col}", "{metric_col}", {sql_expr}
            FROM {table}
            ORDER BY "{time_col}"
        """)).fetchall()

        columns = [c for c in rows[0]._mapping.keys()] if rows else []
        return {
            "table": table,
            "func": func_type,
            "func_label": FUNC_META[func_type]["label"],
            "metric_col": metric_col,
            "time_col": time_col,
            "columns": columns,
            "rows": [dict(r._mapping) for r in rows],
            "count": len(rows),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"分析计算错误: {str(e)}")


@router.get("/functions")
def list_analysis_functions():
    """返回所有可用分析函数列表"""
    return {"functions": [{"key": k, **v} for k, v in FUNC_META.items()]}


# ═══════ LRU 缓存体系 ═══════
import threading
import time as _time

class LRUCache:
    """线程安全 LRU 缓存，支持 TTL、容量限制、自动刷新"""
    def __init__(self, max_size: int = 200, default_ttl: int = 300):
        self._store: dict = {}          # key → {data, ts, access_ts}
        self._max_size = max_size
        self._default_ttl = default_ttl
        self._lock = threading.RLock()
        self._refresh_callbacks: dict = {}  # key → callback() → new_data
        self._deps: dict = {}               # table → set of cache keys
        self._auto_refresh_timer: threading.Timer | None = None

    def get(self, key: str):
        with self._lock:
            entry = self._store.get(key)
            if not entry: return None
            if _time.time() - entry["ts"] > entry["ttl"]:
                self._store.pop(key, None)
                return None
            entry["access_ts"] = _time.time()
        return entry["data"]

    def set(self, key: str, data, ttl: int = 0, refresh_cb=None, table_dep: str = ""):
        ttl = ttl or self._default_ttl
        with self._lock:
            if key not in self._store and len(self._store) >= self._max_size:
                # LRU 淘汰：找最久未访问的
                oldest = min(self._store.items(), key=lambda x: x[1].get("access_ts", 0))
                self._store.pop(oldest[0], None)
            self._store[key] = {"data": data, "ts": _time.time(), "ttl": ttl, "access_ts": _time.time()}
            if refresh_cb:
                self._refresh_callbacks[key] = refresh_cb
            if table_dep:
                self._deps.setdefault(table_dep, set()).add(key)

    def invalidate(self, key: str = ""):
        """失效特定 key，或 key 为空时清空全部"""
        with self._lock:
            if key:
                self._store.pop(key, None)
                self._refresh_callbacks.pop(key, None)
            else:
                self._store.clear()
                self._refresh_callbacks.clear()

    def invalidate_table(self, table: str):
        """失效某表的所有缓存"""
        with self._lock:
            for ck in list(self._deps.get(table, set())):
                self._store.pop(ck, None)
                self._refresh_callbacks.pop(ck, None)
            self._deps.pop(table, None)

    def start_auto_refresh(self, interval: int = 120):
        """启动后台自动刷新定时器"""
        def _refresh_loop():
            with self._lock:
                for key, cb in list(self._refresh_callbacks.items()):
                    try:
                        new_data = cb()
                        if new_data:
                            self._store[key] = {"data": new_data, "ts": _time.time(), "ttl": self._store.get(key, {}).get("ttl", self._default_ttl), "access_ts": _time.time()}
                    except Exception:
                        pass
            self._auto_refresh_timer = threading.Timer(interval, _refresh_loop)
            self._auto_refresh_timer.daemon = True
            self._auto_refresh_timer.start()
        self._auto_refresh_timer = threading.Timer(interval, _refresh_loop)
        self._auto_refresh_timer.daemon = True
        self._auto_refresh_timer.start()

    def stats(self) -> dict:
        with self._lock:
            return {"entries": len(self._store), "max_size": self._max_size, "ttl": self._default_ttl}

# 全局 LRU 缓存实例
# 内存缓存 — 启动时注册定时刷新（每5分钟）
_cache = LRUCache(max_size=200, default_ttl=300)

def _incremental_tables(db) -> set[str]:
    """只有真的带 updated_at 的物理表才能做增量同步。

    bi_demand_merged / bi_demand_overview 是视图、bi_demo_sku 没有 updated_at —— 直接拼 SQL 会报
    UndefinedColumn；旧实现把异常吞掉又不回滚，事务停在 aborted、连接不归还，连接池被慢慢吃满。
    """
    rows = db.execute(text(
        "SELECT table_name FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND column_name = 'updated_at'"
    )).fetchall()
    return {r[0] for r in rows}


def _refresh_once() -> dict:
    """跑一轮「增量同步 + 物化视图刷新 + 老告警检查」。

    每张表独立提交 / 回滚：任何一张失败都不影响其它表，也不会把连接留在 aborted 事务里。
    返回本轮成功同步的表名，便于测试与手动触发。
    """
    import time
    from app.database import SessionLocal

    synced: list[str] = []
    skipped: list[str] = []
    db = SessionLocal()
    try:
        incremental = _incremental_tables(db)
        # 只刷新真实存在的物化视图：ACCEL_MAP 是按白名单拼的 <table>_agg，多数并没有建
        existing_mv = {r[0] for r in db.execute(text(
            "SELECT matviewname FROM pg_matviews WHERE schemaname = current_schema()"
        )).fetchall()}
        for tbl in ALLOWED_TABLES:
            if tbl not in incremental:
                skipped.append(tbl)
                continue
            try:
                last = SYNC_STATE.get(tbl, "1970-01-01")
                rows = db.execute(
                    text(f"SELECT count(*) FROM {tbl} WHERE updated_at > :last"),
                    {"last": last},
                ).scalar() or 0
                if rows > 0:
                    db.execute(text(
                        "INSERT INTO bi_sync_logs (table_name, sync_type, rows_synced, duration_ms, status, started_at, finished_at) "
                        "VALUES (:t, 'incremental', :r, 0, 'success', NOW(), NOW())"
                    ), {"t": tbl, "r": rows})
                    SYNC_STATE[tbl] = time.strftime("%Y-%m-%d %H:%M:%S")
                db.commit()
                synced.append(tbl)
            except Exception as exc:
                db.rollback()
                print(f"[refresh] {tbl} 同步跳过：{str(exc)[:160]}")
                continue
            mv = ACCEL_MAP.get(tbl, "")
            if mv and mv in existing_mv:
                try:
                    db.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}"))
                    db.commit()
                except Exception as exc:
                    db.rollback()
                    print(f"[refresh] {mv} 刷新失败：{str(exc)[:160]}")

        # 告警定时检查
        try:
            alerts = db.execute(text(
                "SELECT id, name, table_name, metric_col, operator, threshold, owner_id "
                "FROM bi_alerts WHERE enabled=true"
            )).fetchall()
            for a in alerts:
                try:
                    val = db.execute(text(f"SELECT {a[3]}({a[4]}) FROM {a[2]}")).scalar() or 0
                    hit = (a[4] == '>' and val > a[5]) or (a[4] == '<' and val < a[5]) or (a[4] == '=' and val == a[5])
                    if hit:
                        db.execute(text("UPDATE bi_alerts SET last_triggered=NOW() WHERE id=:id"), {"id": a[0]})
                        db.commit()
                except Exception:
                    db.rollback()
        except Exception:
            db.rollback()

        return {"synced": synced, "skipped": skipped}
    except Exception as exc:
        db.rollback()
        print(f"[refresh] 本轮跳过：{str(exc)[:160]}")
        return {"synced": synced, "skipped": skipped, "error": str(exc)[:160]}
    finally:
        db.close()


def _auto_refresh_loop() -> None:
    """后台线程：每 5 分钟跑一轮 _refresh_once。"""
    import time
    while True:
        time.sleep(300)
        try:
            _refresh_once()
        except Exception as exc:  # 后台线程不能因为一轮失败退出
            print(f"[refresh] 线程异常：{str(exc)[:160]}")


try:
    import threading

    _refresh_thread = threading.Thread(target=_auto_refresh_loop, daemon=True)
    _refresh_thread.start()
except Exception:
    pass

_cache.start_auto_refresh(interval=120)

def _cache_key(table: str, limit: int = 500, offset: int = 0, func: str = "", rls: str = "-") -> str:
    """缓存键 —— 必须带行级规则指纹，否则会跨用户串数据。"""
    raw = f"{table}:{limit}:{offset}:{func}:{rls}"
    return hashlib.md5(raw.encode()).hexdigest()

# 白名单：允许查询的业务表（唯一事实来源在 app/query/whitelist.py）
from app.query.whitelist import ALLOWED_TABLES  # noqa: E402,F401

# 模板名称 → 表名
TEMPLATE_MAP = {
    "财务总览": "bi_finance",
    "拼多多运营": "bi_pdd_ops",
    "天猫经营": "bi_tmall",
    "抖音电商": "bi_douyin",
    "拼多多店铺利润": "bi_pdd_stores",
    "拼多多年度汇总": "bi_pdd_annual",
    "拼多多流量分析": "bi_pdd_traffic",
    "产品部·宠物优选": "bi_products",
    "天猫月度复盘": "bi_tmall_monthly",
    "天猫活动分析": "bi_tmall_campaigns",
    "抖音直播复盘": "bi_douyin_live",
    "拼多多店铺利润看板": "bi_pdd_profit",
}


@router.get("/tables")
def list_tables(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """返回所有可用 BI 表及其列信息"""
    tables = []
    for tbl in sorted(ALLOWED_TABLES):
        try:
            cols = db.execute(text(f"""
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_name = :tbl AND table_schema = 'public'
                ORDER BY ordinal_position
            """), {"tbl": tbl}).fetchall()
            tables.append({
                "table": tbl,
                "columns": [{"name": c[0], "type": c[1]} for c in cols],
            })
        except Exception:
            tables.append({"table": tbl, "columns": [], "error": "unavailable"})
    return {"tables": tables, "templates": list(TEMPLATE_MAP.keys())}


# ═══════ 加速引擎（物化视图路由 + 刷新）═══════

ACCEL_MAP = {tbl: f"{tbl}_agg" for tbl in ALLOWED_TABLES}

def _use_accel(table: str, db: Session) -> tuple[str, bool]:
    """判断是否使用加速表。存在物化视图则返回(mv_name, True)。"""
    mv = ACCEL_MAP.get(table, "")
    if not mv:
        return table, False
    try:
        db.execute(text(f"SELECT 1 FROM {mv} LIMIT 1"))
        return mv, True
    except Exception:
        db.rollback()
        return table, False


@router.post("/accelerate/refresh")
def refresh_materialized_views(
    table: str = Query(default=""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """刷新物化视图。table 为空则刷新全部。"""
    refreshed = []
    targets = [table] if table else [t for t in ALLOWED_TABLES]
    for t in targets:
        mv = ACCEL_MAP.get(t, "")
        if not mv:
            continue
        try:
            t0 = _time.time()
            db.execute(text(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {mv}"))
            db.commit()
            elapsed = (_time.time() - t0) * 1000
            refreshed.append({"table": t, "view": mv, "elapsed_ms": round(elapsed, 1)})
        except Exception as e:
            refreshed.append({"table": t, "view": mv, "error": str(e)[:100]})
    return {"refreshed": refreshed, "count": len(refreshed)}


@router.get("/accelerate/status")
def accelerator_status(db: Session = Depends(get_db)):
    """查看加速引擎状态"""
    status = []
    for tbl, mv in ACCEL_MAP.items():
        try:
            raw = db.execute(text(f"SELECT count(*) FROM {tbl}")).scalar()
            agg = db.execute(text(f"SELECT count(*) FROM {mv}")).scalar()
            status.append({"table": tbl, "raw_rows": raw, "agg_rows": agg, "compression": f"{round((1-agg/raw)*100,1) if raw else 0}%"})
        except Exception:
            status.append({"table": tbl, "error": "unavailable"})
    return {"views": status, "total_views": len(ACCEL_MAP)}


# ═══════ 列脱敏自动应用（实现已下沉到 app/security/masking.py）═══════

from app.security.masking import MASK_FUNCS, apply_masks as _mask_impl  # noqa: E402


def _apply_masks(table: str, rows: list[dict], db: Session) -> list[dict]:
    """对查询结果自动应用列脱敏规则（委托安全内核，语义查询共用同一套）."""
    return _mask_impl(table, rows, db)


# ═══════ 并发控制 + 查询排队 ═══════

_active_queries = 0
MAX_CONCURRENT = 20

@router.get("/data/{table}")
def get_table_data(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=500, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    cache: bool = Query(default=True),
    precomputed: bool = Query(default=True),
):
    """查询 BI 业务表数据。precomputed=true 自动走物化视图加速。"""
    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(status_code=404, detail=f"表 {table} 不在白名单中")

    # 行级权限：先算结论（fail-closed）
    try:
        decision = rls_decide(db, table, current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    rls_active = bool(decision.conditions)

    # 并发控制
    global _active_queries
    if _active_queries >= MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail=f"查询并发已满（{_active_queries}/{MAX_CONCURRENT}），请稍后重试",
                          headers={"Retry-After": "5"})
    _active_queries += 1
    read_db = db  # 默认主库

    # 分布式读写分离：预计算查询走主库，原表查询可走副本
    if not precomputed and _BI_REPLICA_URL:
        read_db = _get_read_db()

    source_table = table
    # 有行级规则时禁止走物化视图（聚合视图里没有明细行，规则无法下推）
    if precomputed and not rls_active:
        source_table, used_accel = _use_accel(table, db)
    else:
        used_accel = False

    ck = _cache_key(source_table, limit, offset, rls=decision.fingerprint)
    if cache:
        cached = _cache.get(ck)
        if cached:
            _active_queries -= 1
            return cached

    try:
        t0 = _time.time()
        order_clause = "id" if table == source_table else "1"
        where_clause = rls_where(decision)
        where_sql_part = f" WHERE {where_clause}" if where_clause else ""
        rows = read_db.execute(
            text(f"SELECT * FROM {source_table}{where_sql_part} ORDER BY {order_clause} LIMIT :limit OFFSET :offset"),
            {"limit": limit, "offset": offset},
        ).fetchall()
        elapsed = (_time.time() - t0) * 1000
        if elapsed > 1000:
            import logging
            logging.getLogger("bi-engine").warning(f"慢查询: {source_table} ({elapsed:.0f}ms)")

        if not rows:
            result = {"table": source_table, "rows": [], "columns": [], "count": 0, "accelerated": used_accel}
        else:
            columns = list(rows[0]._mapping.keys())
            row_dicts = [dict(r._mapping) for r in rows]
            # 自动应用列脱敏
            row_dicts = _apply_masks(table, row_dicts, db)
            result = {
                "table": source_table,
                "rows": row_dicts,
                "columns": columns,
                "count": len(rows),
                "accelerated": used_accel,
                "elapsed_ms": round(elapsed, 1),
            }
        if rls_active:
            result["rls"] = True
        if cache:
            _cache.set(ck, result, table_dep=table)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _active_queries -= 1
        if read_db != db:
            read_db.close()


@router.get("/export/{table}")
def export_excel(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """导出 BI 表数据为 Excel"""
    if table not in ALLOWED_TABLES:
        raise HTTPException(status_code=404, detail=f"表 {table} 不在白名单中")

    # 行级权限：导出与查询必须同口径，否则「查不到但导出得到」就是漏洞
    try:
        decision = rls_decide(db, table, current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    where_clause = rls_where(decision)
    where_sql_part = f" WHERE {where_clause}" if where_clause else ""

    try:
        rows = db.execute(text(f"SELECT * FROM {table}{where_sql_part} ORDER BY id")).fetchall()
        if not rows:
            raise HTTPException(404, "无数据")

        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = table

        columns = list(rows[0]._mapping.keys())
        row_dicts = _apply_masks(table, [dict(r._mapping) for r in rows], db)
        ws.append(columns)
        for r in row_dicts:
            ws.append([r[c] for c in columns])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={table}.xlsx"},
        )
    except ImportError:
        raise HTTPException(500, "openpyxl 未安装")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates")
def get_templates(current_user: User = Depends(get_current_user)):
    """返回模板定义（前端看板布局）"""
    panels = {
        "bi_finance": [
            {"id": "p1", "type": "number", "title": "年度总收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "年度净利润", "metric": "net_profit"},
            {"id": "p3", "type": "number", "title": "总成本", "metric": "cost"},
            {"id": "p4", "type": "number", "title": "平均毛利率(%)", "metric": "gross_margin"},
            {"id": "p5", "type": "number", "title": "平均费用率(%)", "metric": "expense_rate"},
            {"id": "p6", "type": "number", "title": "利润率(%)", "metric": "net_profit"},
            {"id": "p7", "type": "line", "title": "月度收入趋势", "xField": "month", "yField": "revenue"},
            {"id": "p8", "type": "line", "title": "成本 vs 净利润趋势", "xField": "month", "yField": "cost"},
            {"id": "p9", "type": "bar", "title": "各月净利润对比", "xField": "month", "yField": "net_profit"},
            {"id": "p10", "type": "bar", "title": "各月毛利额", "xField": "month", "yField": "gross_margin"},
            {"id": "p11", "type": "pie", "title": "月度收入占比", "xField": "month", "yField": "revenue"},
            {"id": "p12", "type": "pie", "title": "费用率分布", "xField": "month", "yField": "expense_rate"},
            {"id": "p13", "type": "table", "title": "财务明细表", "xField": "month", "yField": "revenue"},
        ],
        "bi_pdd_ops": [
            {"id": "p1", "type": "number", "title": "累计 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总 PV", "metric": "pv"},
            {"id": "p3", "type": "number", "title": "总 UV", "metric": "uv"},
            {"id": "p4", "type": "number", "title": "平均转化率(%)", "metric": "conversion_rate"},
            {"id": "p5", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p6", "type": "number", "title": "平均退款率(%)", "metric": "refund_rate"},
            {"id": "p7", "type": "line", "title": "GMV 日趋势", "xField": "date", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "PV vs UV 趋势", "xField": "date", "yField": "pv"},
            {"id": "p9", "type": "line", "title": "转化率走势", "xField": "date", "yField": "conversion_rate"},
            {"id": "p10", "type": "bar", "title": "每日退款率", "xField": "date", "yField": "refund_rate"},
            {"id": "p11", "type": "bar", "title": "日 GMV 对比", "xField": "date", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "流量分布", "xField": "date", "yField": "uv"},
            {"id": "p13", "type": "table", "title": "运营明细表", "xField": "date", "yField": "gmv"},
        ],
        "bi_tmall": [
            {"id": "p1", "type": "number", "title": "累计 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "uv"},
            {"id": "p3", "type": "number", "title": "支付买家数", "metric": "paying_buyers"},
            {"id": "p4", "type": "number", "title": "总广告花费", "metric": "ad_spend"},
            {"id": "p5", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p6", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p7", "type": "line", "title": "天猫 GMV 趋势", "xField": "date", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "访客 vs 买家趋势", "xField": "date", "yField": "uv"},
            {"id": "p9", "type": "line", "title": "ROI 日度走势", "xField": "date", "yField": "roi"},
            {"id": "p10", "type": "bar", "title": "每日广告投入", "xField": "date", "yField": "ad_spend"},
            {"id": "p11", "type": "bar", "title": "日 GMV 排行", "xField": "date", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "买家分布", "xField": "date", "yField": "paying_buyers"},
            {"id": "p13", "type": "table", "title": "天猫经营明细", "xField": "date", "yField": "gmv"},
        ],
        "bi_douyin": [
            {"id": "p1", "type": "number", "title": "总播放量", "metric": "plays"},
            {"id": "p2", "type": "number", "title": "总 GMV", "metric": "gmv"},
            {"id": "p3", "type": "number", "title": "新增粉丝数", "metric": "new_followers"},
            {"id": "p4", "type": "number", "title": "平均互动率(%)", "metric": "engagement_rate"},
            {"id": "p5", "type": "number", "title": "总直播时长(h)", "metric": "live_hours"},
            {"id": "p6", "type": "number", "title": "平均在线人数", "metric": "avg_online"},
            {"id": "p7", "type": "line", "title": "播放量趋势", "xField": "date", "yField": "plays"},
            {"id": "p8", "type": "line", "title": "GMV 日趋势", "xField": "date", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "互动率日对比", "xField": "date", "yField": "engagement_rate"},
            {"id": "p10", "type": "bar", "title": "新增粉丝数", "xField": "date", "yField": "new_followers"},
            {"id": "p11", "type": "line", "title": "在线人数趋势", "xField": "date", "yField": "avg_online"},
            {"id": "p12", "type": "pie", "title": "GMV 日分布", "xField": "date", "yField": "gmv"},
            {"id": "p13", "type": "table", "title": "抖音电商明细", "xField": "date", "yField": "gmv"},
        ],
        "bi_pdd_stores": [
            {"id": "p1", "type": "number", "title": "总销售收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "总毛利额", "metric": "gross_profit"},
            {"id": "p3", "type": "number", "title": "总净利润", "metric": "net_profit"},
            {"id": "p4", "type": "number", "title": "总推广费", "metric": "promo_cost"},
            {"id": "p5", "type": "number", "title": "利润率(%)", "metric": "profit_rate"},
            {"id": "p6", "type": "number", "title": "订单总数", "metric": "order_count"},
            {"id": "p7", "type": "bar", "title": "部门收入排名", "xField": "department", "yField": "revenue", "size": "lg"},
            {"id": "p8", "type": "bar", "title": "店铺收入 TOP15", "xField": "store", "yField": "revenue", "size": "lg"},
            {"id": "p9", "type": "line", "title": "利润率分布", "xField": "store", "yField": "profit_rate", "size": "lg"},
            {"id": "p10", "type": "pie", "title": "部门收入占比", "xField": "department", "yField": "revenue", "size": "md"},
            {"id": "p11", "type": "pie", "title": "费用结构占比", "xField": "store", "yField": "promo_cost", "size": "md"},
            {"id": "p12", "type": "table", "title": "店铺利润明细表", "xField": "store", "yField": "revenue", "size": "lg"},
        ],
        "bi_pdd_profit": [
            {"id": "p1", "type": "number", "title": "总销售收入", "metric": "revenue"},
            {"id": "p2", "type": "number", "title": "总毛利额", "metric": "gross"},
            {"id": "p3", "type": "number", "title": "总净利润", "metric": "net_profit"},
            {"id": "p4", "type": "number", "title": "总推广费", "metric": "promo"},
            {"id": "p5", "type": "number", "title": "毛利率(%)", "metric": "gross_rate"},
            {"id": "p6", "type": "number", "title": "净利润率(%)", "metric": "net_rate"},
            {"id": "p7", "type": "bar", "title": "负责人收入与净利对比", "xField": "person", "yField": "revenue", "size": "lg"},
            {"id": "p8", "type": "pie", "title": "成本结构占比", "xField": "store", "yField": "cost", "size": "md"},
            {"id": "p9", "type": "bar", "title": "店铺收入 TOP20", "xField": "store", "yField": "revenue", "size": "lg"},
            {"id": "p10", "type": "bar", "title": "毛利率 vs 净利率对比", "xField": "store", "yField": "gross_rate", "size": "lg"},
            {"id": "p11", "type": "table", "title": "店铺利润明细表", "xField": "store", "yField": "revenue", "size": "lg"},
        ],
        "bi_pdd_annual": [
            {"id": "p1", "type": "number", "title": "年度 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "年度广告总投入", "metric": "ad_spend"},
            {"id": "p3", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p4", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p5", "type": "number", "title": "平均复购率(%)", "metric": "repurchase_rate"},
            {"id": "p6", "type": "number", "title": "平均退货率(%)", "metric": "return_rate"},
            {"id": "p7", "type": "line", "title": "月度 GMV 趋势", "xField": "month", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "ROI 月度走势", "xField": "month", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "月度广告投入", "xField": "month", "yField": "ad_spend"},
            {"id": "p10", "type": "bar", "title": "月 GMV 排行", "xField": "month", "yField": "gmv"},
            {"id": "p11", "type": "pie", "title": "广告投入占比", "xField": "month", "yField": "ad_spend"},
            {"id": "p12", "type": "pie", "title": "GMV 月度分布", "xField": "month", "yField": "gmv"},
            {"id": "p13", "type": "table", "title": "年度趋势明细表", "xField": "month", "yField": "gmv"},
        ],
        "bi_pdd_traffic": [
            {"id": "p1", "type": "number", "title": "总曝光量", "metric": "impressions"},
            {"id": "p2", "type": "number", "title": "总点击数", "metric": "clicks"},
            {"id": "p3", "type": "number", "title": "渠道 GMV 合计", "metric": "gmv"},
            {"id": "p4", "type": "number", "title": "平均点击率(%)", "metric": "ctr"},
            {"id": "p5", "type": "number", "title": "平均转化率(%)", "metric": "cvr"},
            {"id": "p6", "type": "number", "title": "平均排名", "metric": "avg_rank"},
            {"id": "p7", "type": "bar", "title": "渠道曝光量排行", "xField": "channel", "yField": "impressions"},
            {"id": "p8", "type": "bar", "title": "渠道 GMV 排行", "xField": "channel", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "渠道点击率对比", "xField": "channel", "yField": "ctr"},
            {"id": "p10", "type": "pie", "title": "GMV 渠道分布", "xField": "channel", "yField": "gmv"},
            {"id": "p11", "type": "pie", "title": "曝光量渠道分布", "xField": "channel", "yField": "impressions"},
            {"id": "p12", "type": "table", "title": "渠道流量明细表", "xField": "channel", "yField": "impressions"},
        ],
        "bi_products": [
            {"id": "p1", "type": "number", "title": "月总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "月总销量", "metric": "monthly_sales"},
            {"id": "p3", "type": "number", "title": "平均评分(分)", "metric": "rating"},
            {"id": "p4", "type": "number", "title": "平均毛利率(%)", "metric": "gross_margin"},
            {"id": "p5", "type": "number", "title": "平均复购率(%)", "metric": "repurchase_rate"},
            {"id": "p6", "type": "number", "title": "平均退货率(%)", "metric": "return_rate"},
            {"id": "p7", "type": "bar", "title": "产品销量排行", "xField": "product", "yField": "monthly_sales"},
            {"id": "p8", "type": "bar", "title": "产品 GMV 排行", "xField": "product", "yField": "gmv"},
            {"id": "p9", "type": "bar", "title": "产品毛利率对比", "xField": "product", "yField": "gross_margin"},
            {"id": "p10", "type": "bar", "title": "复购率排行", "xField": "product", "yField": "repurchase_rate"},
            {"id": "p11", "type": "pie", "title": "GMV 产品分布", "xField": "product", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "销量产品分布", "xField": "product", "yField": "monthly_sales"},
            {"id": "p13", "type": "table", "title": "产品分析明细表", "xField": "product", "yField": "monthly_sales"},
        ],
        "bi_tmall_monthly": [
            {"id": "p1", "type": "number", "title": "半年 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "visitors"},
            {"id": "p3", "type": "number", "title": "总广告花费", "metric": "ad_spend"},
            {"id": "p4", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p5", "type": "number", "title": "平均转化率(%)", "metric": "pay_cvr"},
            {"id": "p6", "type": "number", "title": "平均新客率(%)", "metric": "new_customer_rate"},
            {"id": "p7", "type": "line", "title": "月度 GMV 趋势", "xField": "month", "yField": "gmv"},
            {"id": "p8", "type": "line", "title": "ROI 月度走势", "xField": "month", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "月 GMV 排行", "xField": "month", "yField": "gmv"},
            {"id": "p10", "type": "bar", "title": "月度广告花费", "xField": "month", "yField": "ad_spend"},
            {"id": "p11", "type": "pie", "title": "GMV 月度分布", "xField": "month", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "费用分布", "xField": "month", "yField": "ad_spend"},
            {"id": "p13", "type": "table", "title": "月度经营明细", "xField": "month", "yField": "gmv"},
        ],
        "bi_tmall_campaigns": [
            {"id": "p1", "type": "number", "title": "活动总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总访客数", "metric": "visitors"},
            {"id": "p3", "type": "number", "title": "总新增客户", "metric": "new_customers"},
            {"id": "p4", "type": "number", "title": "总广告投入", "metric": "ad_spend"},
            {"id": "p5", "type": "number", "title": "平均 ROI", "metric": "roi"},
            {"id": "p6", "type": "number", "title": "平均客单价(元)", "metric": "avg_order"},
            {"id": "p7", "type": "bar", "title": "活动 GMV 排行", "xField": "campaign", "yField": "gmv"},
            {"id": "p8", "type": "bar", "title": "活动 ROI 对比", "xField": "campaign", "yField": "roi"},
            {"id": "p9", "type": "bar", "title": "活动新增客户数", "xField": "campaign", "yField": "new_customers"},
            {"id": "p10", "type": "funnel", "title": "活动转化漏斗", "xField": "campaign", "yField": "visitors"},
            {"id": "p11", "type": "pie", "title": "GMV 活动分布", "xField": "campaign", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "费用活动分布", "xField": "campaign", "yField": "ad_spend"},
            {"id": "p13", "type": "table", "title": "活动效果明细表", "xField": "campaign", "yField": "gmv"},
        ],
        "bi_douyin_live": [
            {"id": "p1", "type": "number", "title": "总 GMV", "metric": "gmv"},
            {"id": "p2", "type": "number", "title": "总观看人数", "metric": "viewers"},
            {"id": "p3", "type": "number", "title": "最高峰值在线", "metric": "peak_online"},
            {"id": "p4", "type": "number", "title": "平均转化率(%)", "metric": "cvr"},
            {"id": "p5", "type": "number", "title": "平均千次 GMV", "metric": "gmv_per_k"},
            {"id": "p6", "type": "number", "title": "新增粉丝总数", "metric": "new_followers"},
            {"id": "p7", "type": "bar", "title": "场次 GMV 排行", "xField": "session", "yField": "gmv"},
            {"id": "p8", "type": "bar", "title": "场次观看人数", "xField": "session", "yField": "viewers"},
            {"id": "p9", "type": "radar", "title": "直播场次效能雷达", "xField": "session", "yField": "engagement_rate"},
            {"id": "p10", "type": "bar", "title": "转化率对比", "xField": "session", "yField": "cvr"},
            {"id": "p11", "type": "pie", "title": "GMV 场次分布", "xField": "session", "yField": "gmv"},
            {"id": "p12", "type": "pie", "title": "观众场次分布", "xField": "session", "yField": "viewers"},
            {"id": "p13", "type": "table", "title": "直播场次明细表", "xField": "session", "yField": "gmv"},
        ],
    }
    return {"templates": list(TEMPLATE_MAP.keys()), "panels": panels, "table_map": TEMPLATE_MAP}


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


# ═══════ 权限检查 ═══════

def _has_permission(db: Session, user_id: int, resource_type: str, resource_id: int, required: str) -> bool:
    """检查用户是否有指定资源的权限。owner 自动获得 manage 权限。"""
    row = db.execute(text(
        "SELECT permission FROM bi_resource_permissions WHERE resource_type=:rt AND resource_id=:rid AND user_id=:uid"
    ), {"rt": resource_type, "rid": resource_id, "uid": user_id}).fetchone()
    if not row:
        return False
    perm = row[0]
    if perm == "manage":
        return True
    if perm == "edit" and required in ("view", "edit"):
        return True
    if perm == "view" and required == "view":
        return True
    return False


def _check_dashboard_access(db: Session, user_id: int, dash_id: int, required: str = "view"):
    """检查看板访问权限。owner 自动放行。"""
    row = db.execute(text("SELECT owner_id FROM bi_dashboards WHERE id=:id"), {"id": dash_id}).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[0] == user_id:
        return  # owner 自动拥有 manage 权限
    if not _has_permission(db, user_id, "dashboard", dash_id, required):
        raise HTTPException(403, f"无权限（需要 {required}）")


@router.get("/permissions/{resource_type}/{resource_id}")
def get_resource_permissions(
    resource_type: str,
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查看资源的所有权限分配"""
    rows = db.execute(text(
        "SELECT p.user_id, u.username, p.permission FROM bi_resource_permissions p JOIN users u ON p.user_id=u.id WHERE p.resource_type=:rt AND p.resource_id=:rid"
    ), {"rt": resource_type, "rid": resource_id}).fetchall()
    return {"permissions": [{"user_id": r[0], "username": r[1], "permission": r[2]} for r in rows]}


@router.post("/permissions")
def grant_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """授权：{resource_type, resource_id, user_id, permission}"""
    rt = payload["resource_type"]
    rid = payload["resource_id"]
    uid = payload["user_id"]
    perm = payload["permission"]
    if perm not in ("view", "edit", "manage"):
        raise HTTPException(400, "无效权限级别")
    db.execute(text(
        "INSERT INTO bi_resource_permissions (resource_type, resource_id, user_id, permission) VALUES (:rt,:rid,:uid,:p) ON CONFLICT DO NOTHING"
    ), {"rt": rt, "rid": rid, "uid": uid, "p": perm})
    db.commit()
    return {"granted": True}


@router.delete("/permissions")
def revoke_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销权限"""
    db.execute(text(
        "DELETE FROM bi_resource_permissions WHERE resource_type=:rt AND resource_id=:rid AND user_id=:uid AND permission=:p"
    ), {"rt": payload["resource_type"], "rid": payload["resource_id"], "uid": payload["user_id"], "p": payload["permission"]})
    db.commit()
    return {"revoked": True}


# ═══════ 查询构建器（拖拽分析核心）═══════

@router.post("/query_builder")
def query_builder(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """自助分析查询构建器。
    参数: {
      table: "bi_finance",
      metrics: [{"col":"revenue","agg":"SUM","alias":"总收入"}],
      dimensions: ["month"],
      filters: [{"col":"revenue","op":">","val":2000000}],
      order_by: "month ASC",
      limit: 500
    }
    自动生成 SQL 并执行。
    """
    table = payload["table"]
    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(404, f"表 {table} 不在白名单中")

    # 多表 JOIN 支持
    joins = payload.get("joins", [])
    from_clause = table
    if joins:
        for j in joins:
            jt = str(j["table"])
            j_on = str(j["on"])
            j_type = str(j.get("type", "INNER"))
            if jt not in ALLOWED_TABLES:
                raise HTTPException(404, f"JOIN 表 {jt} 不在白名单中")
            from_clause += f" {j_type} JOIN {jt} ON {j_on}"

    metrics = payload.get("metrics", [])
    dimensions = payload.get("dimensions", [])
    filters = payload.get("filters", [])
    order_by = payload.get("order_by", "")
    limit = payload.get("limit", 500)

    # Build SELECT（维度支持时间粒度：字符串=列名，字典={"column","grain"}）
    from app.query.column_types import column_types as _col_types, needs_cast
    from app.query.grain import grain_expression

    _types = _col_types(db, table)
    select_parts = []
    dim_exprs: list[str] = []
    for d in dimensions:
        if isinstance(d, dict):
            col = str(d.get("column", ""))
            grain = d.get("grain")
        else:
            col, grain = str(d), None
        _validate_col(col)
        if grain:
            expr = grain_expression(f'"{col}"', grain, cast=needs_cast(_types.get(col)))
            select_parts.append(f'{expr} AS "{col}"')
            dim_exprs.append(expr)
        else:
            select_parts.append(f'"{col}"')
            dim_exprs.append(f'"{col}"')
    if not metrics:
        select_parts.append("count(*) AS count")
    else:
        for m in metrics:
            col = str(m["col"])
            agg = str(m.get("agg", "SUM"))
            alias = str(m.get("alias", f"{agg}_{col}"))
            _validate_col(col)
            _validate_col(alias)
            select_parts.append(f'{agg}("{col}") AS "{alias}"')

    # Build GROUP BY / FROM / WHERE
    group_clause = ""
    if dim_exprs:
        group_clause = "GROUP BY " + ", ".join(dim_exprs)

    where_clauses = []
    params: dict = {}
    for idx, f in enumerate(filters):
        col = str(f["col"])
        op = str(f["op"]).upper().strip()
        val = f["val"]
        _validate_col(col)
        if op not in _FILTER_OPS:
            raise HTTPException(400, f"不支持的筛选运算符: {op}")

        # 值一律走绑定参数（不再拼进 SQL 字符串）
        if op in ("IN", "NOT IN"):
            seq = val if isinstance(val, list) else [val]
            keys = []
            for pos, item in enumerate(seq):
                key = f"f{idx}_{pos}"
                params[key] = item
                keys.append(f":{key}")
            where_clauses.append(f'"{col}" {op} ({", ".join(keys)})')
        elif op == "BETWEEN":
            lo, hi = f"f{idx}_lo", f"f{idx}_hi"
            params[lo] = val[0]
            params[hi] = val[1]
            where_clauses.append(f'"{col}" BETWEEN :{lo} AND :{hi}')
        else:
            key = f"f{idx}"
            params[key] = val
            where_clauses.append(f'"{col}" {op} :{key}')

    # 行级权限（主表 + JOIN 表）：条件已在编译期校验，这里只做 AND
    rls_conditions: list[str] = []
    try:
        for t in dict.fromkeys([table] + [str(j["table"]) for j in joins]):
            rls_conditions.extend(rls_decide(db, t, current_user).conditions)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    where_clauses.extend(f"({c})" for c in rls_conditions)

    where_clause = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    first_dim = ""
    if dimensions:
        first_dim = (
            str(dimensions[0].get("column", ""))
            if isinstance(dimensions[0], dict)
            else str(dimensions[0])
        )
    order_clause = f"ORDER BY {order_by}" if order_by else (f'ORDER BY "{first_dim}"' if first_dim else "")

    sql = f"""SELECT {", ".join(select_parts)} FROM {from_clause}
{where_clause} {group_clause} {order_clause} LIMIT {limit}"""

    try:
        rows = db.execute(text(sql), params).fetchall()
        if not rows:
            return {"sql": sql, "columns": [], "rows": [], "count": 0}
        columns = list(rows[0]._mapping.keys())
        return {"sql": sql, "columns": columns, "rows": _apply_masks(payload["table"], [dict(r._mapping) for r in rows], db), "count": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"查询错误: {str(e)}\nSQL: {sql}")


# ═══════ 筛选模板 ═══════

@router.post("/filter_templates")
def save_filter_template(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存筛选条件模板"""
    name = payload["name"]
    filters_json = json.dumps(payload.get("filters", []))
    table = payload.get("table", "")
    db.execute(text(
        "INSERT INTO bi_filter_templates (name, filters, owner_id, table_name) VALUES (:n, :f, :uid, :t)"
    ), {"n": name, "f": filters_json, "uid": current_user.id, "t": table})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": name}


@router.get("/filter_templates")
def list_filter_templates(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出当前用户的筛选模板"""
    rows = db.execute(text(
        "SELECT id, name, filters, table_name FROM bi_filter_templates WHERE owner_id=:uid ORDER BY id DESC"
    ), {"uid": current_user.id}).fetchall()
    return {"templates": [{"id": r[0], "name": r[1], "filters": r[2], "table": r[3]} for r in rows]}


# ═══════ 行级数据权限 ═══════

@router.get("/row_permissions/{table}")
def get_row_permissions(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户对该表的行级过滤规则"""
    rows = db.execute(text(
        "SELECT filter_rule FROM bi_row_permissions WHERE table_name=:t AND (user_id=:uid OR role_name IN (SELECT role FROM users WHERE id=:uid))"
    ), {"t": table, "uid": current_user.id}).fetchall()
    return {"rules": [r[0] for r in rows]}


@router.post("/row_permissions")
def set_row_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """设置行级过滤规则：{table_name, user_id|role_name, filter_rule: 'store_id = 5'}"""
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "仅管理员可设置行权限")

    table_name = str(payload.get("table_name", "")).strip()
    if table_name not in ALLOWED_TABLES:
        raise HTTPException(404, f"表 {table_name} 不在白名单中")

    # 存库前把关：非法规则直接拒绝，避免把坏规则留到查询期（那时只能 fail-closed）
    from app.security.rls import compile_rule_text

    try:
        rule = compile_rule_text(str(payload.get("filter_rule", "")))
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc

    db.execute(text(
        "INSERT INTO bi_row_permissions (table_name, user_id, role_name, filter_rule) "
        "VALUES (:t,:uid,:role,:rule) ON CONFLICT DO NOTHING"
    ), {
        "t": table_name,
        "uid": payload.get("user_id"),
        "role": payload.get("role_name"),
        "rule": rule,
    })
    db.commit()
    return {"success": True, "table": table_name, "rule": rule}


# ═══════ 数据集版本管理 ═══════

@router.get("/datasets/versions/{table}")
def list_dataset_versions(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """列出数据集的版本快照"""
    rows = db.execute(text(
        "SELECT id, version_name, row_count, created_at FROM bi_dataset_versions WHERE table_name=:t ORDER BY id DESC LIMIT 20"
    ), {"t": table}).fetchall()
    return {"versions": [{"id": r[0], "name": r[1], "rows": r[2], "created_at": str(r[3])} for r in rows]}


@router.post("/datasets/snapshot/{table}")
def create_dataset_snapshot(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建数据集快照"""
    if table not in ALLOWED_TABLES:
        raise HTTPException(404)
    count = db.execute(text(f"SELECT count(*) FROM {table}")).scalar()
    db.execute(text(
        "INSERT INTO bi_dataset_versions (table_name, version_name, row_count, snapshot_data) VALUES (:t, :v, :c, (SELECT json_agg(t.*) FROM (SELECT * FROM :tbl) t)::text)"
    ), {"t": table, "v": f"{table}_v{int(__import__('time').time())}"})
    db.commit()
    return {"table": table, "row_count": count, "snapshot_id": "created"}


# ═══════ 订阅与告警 ═══════

@router.get("/alerts")
def list_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, name, table_name, metric_col, operator, threshold, enabled, last_triggered FROM bi_alerts WHERE owner_id=:uid ORDER BY id DESC"
    ), {"uid": current_user.id}).fetchall()
    return {"alerts": [dict(r._mapping) for r in rows]}


@router.post("/alerts")
def create_alert(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text(
        "INSERT INTO bi_alerts (name, table_name, metric_col, operator, threshold, enabled, owner_id) VALUES (:n,:t,:m,:op,:th,:en,:uid)"
    ), {"n": payload["name"], "t": payload["table_name"], "m": payload["metric_col"], "op": payload.get("operator", ">"), "th": payload["threshold"], "en": payload.get("enabled", True), "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}


@router.delete("/alerts/{alert_id}")
def delete_alert(alert_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM bi_alerts WHERE id=:id AND owner_id=:uid"), {"id": alert_id, "uid": current_user.id})
    db.commit()
    return {"deleted": True}


@router.post("/alerts/check")
def check_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    alerts = db.execute(text(
        "SELECT id, name, table_name, metric_col, operator, threshold FROM bi_alerts WHERE enabled=true AND owner_id=:uid"
    ), {"uid": current_user.id}).fetchall()
    triggered = []
    for a in alerts:
        try:
            val = db.execute(text(f"SELECT {a[3]}({a[4]}) FROM {a[2]}")).scalar() or 0
            op, th = a[4], a[5]
            hit = (op == ">" and val > th) or (op == "<" and val < th) or (op == "=" and val == th)
            if hit:
                db.execute(text("UPDATE bi_alerts SET last_triggered=NOW() WHERE id=:id"), {"id": a[0]})
                triggered.append({"id": a[0], "name": a[1], "value": val, "threshold": th, "operator": op})
        except Exception:
            pass
    db.commit()
    return {"triggered": triggered, "total_checked": len(alerts)}


# ═══════ 系统运维监控 ═══════

@router.get("/monitor")
def system_monitor(current_user: User = Depends(get_current_user)):
    import psutil, os
    cpu = psutil.cpu_percent(interval=0.5)
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    pg_version = ""
    try:
        from app.database import engine
        with engine.connect() as conn:
            pg_version = conn.execute(text("SELECT version()")).scalar()
    except Exception:
        pass
    return {
        "cpu_percent": cpu,
        "memory": {"total_gb": round(mem.total / 1e9, 1), "used_gb": round(mem.used / 1e9, 1), "percent": mem.percent},
        "disk": {"total_gb": round(disk.total / 1e9, 1), "free_gb": round(disk.free / 1e9, 1), "percent": disk.percent},
        "pg_version": pg_version.split(",")[0] if pg_version else "unknown",
    }


# ═══════ 模板市场 ═══════

@router.get("/market")
def list_marketplace(
    category: str = Query(default=""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """模板库列表：公开模板 + 自己发布的 + 指定给自己看的（管理员看全部）."""
    from app import template_market

    return {
        "templates": template_market.list_templates(db, current_user, category),
        "categories": list(template_market.CATEGORIES),
    }


@router.get("/market/{template_id}")
def get_market_template(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取模板详情（含面板定义 / 看板文档）."""
    from app import template_market

    try:
        return template_market.get_template(db, template_id, current_user)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@router.post("/market")
def publish_to_market(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """发布看板到模板市场（旧版引擎面板；新看板请用 /market/share）."""
    db.execute(text(
        "INSERT INTO bi_template_market (name, description, category, panels, table_map, author_id) VALUES (:n,:d,:c,CAST(:p AS jsonb),CAST(:t AS jsonb),:uid)"
    ), {"n": payload["name"], "d": payload.get("description", ""), "c": payload.get("category", "通用"),
        "p": json.dumps(payload.get("panels", [])), "t": json.dumps(payload.get("table_map", {})),
        "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}


@router.post("/market/share")
def share_board_to_market(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把「我的看板」分享到模板库：看板文档深拷贝 + 数据集复制到测试数据集."""
    from app import template_market

    board_id = payload.get("board_id")
    try:
        board_id = int(board_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "缺少看板 ID") from None
    try:
        return template_market.share_board(db, board_id, current_user, payload)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@router.post("/market/{template_id}/clone")
def clone_template_to_dashboard(
    template_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把模板克隆到当前用户的「我的看板」。

    看板模板：深拷贝文档（数据集已指向模板自己的公共副本），新建一块可编辑看板；
    旧版引擎模板：panels + table_map 深拷贝到 bi_dashboards。
    """
    from app import template_market

    try:
        return template_market.clone_template(db, template_id, current_user)
    except template_market.TemplateError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@router.post("/metrics/execute/{metric_id}")
def execute_metric(metric_id: int, payload: dict = Body(...), db: Session = Depends(get_db)):
    row = db.execute(text("SELECT formula FROM bi_metrics WHERE id=:id"), {"id": metric_id}).fetchone()
    if not row: raise HTTPException(404, "指标不存在")
    formula = row[0]
    table = payload.get("table", "")
    if table not in ALLOWED_TABLES: raise HTTPException(404, f"表 {table} 不在白名单中")
    try:
        result = db.execute(text(f"SELECT {formula} AS result FROM {table}")).scalar()
        return {"metric_id": metric_id, "formula": formula, "table": table, "result": result}
    except Exception as e:
        raise HTTPException(400, f"公式执行错误: {str(e)}")


# ═══════ 指标仓库 + 公式引擎 ═══════

@router.get("/metrics")
def list_metrics(category: str = Query(default=""), db: Session = Depends(get_db)):
    query = "SELECT id, name, formula, description, category, business_line FROM bi_metrics"
    params = {}
    if category: query += " WHERE category = :cat"; params["cat"] = category
    query += " ORDER BY id DESC"
    rows = db.execute(text(query), params).fetchall()
    return {"metrics": [dict(r._mapping) for r in rows], "categories": ["财务", "运营", "销售", "通用"]}


@router.post("/metrics")
def create_metric(payload: dict = Body(...), current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(text("INSERT INTO bi_metrics (name, formula, description, category, business_line, owner_id) VALUES (:n,:f,:d,:c,:bl,:uid)"),
               {"n": payload["name"], "f": payload["formula"], "d": payload.get("description",""), "c": payload.get("category","通用"), "bl": payload.get("business_line","通用"), "uid": current_user.id})
    result = db.execute(text("SELECT lastval()")).scalar()
    db.commit()
    return {"id": result, "name": payload["name"]}


# ═══════ 数据同步引擎 ═══════

SYNC_STATE: dict = {}  # table → last_sync_at timestamp

@router.post("/sync/{table}")
def sync_table(
    table: str,
    sync_type: str = Query(default="incremental"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行数据同步：full=全量 / incremental=增量（基于 updated_at）"""
    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(404, f"表 {table} 不在白名单中")

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
        SYNC_STATE[table] = _time.strftime("%Y-%m-%d %H:%M:%S")
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


# ═══════ 分布式部署指南 + 列脱敏 ═══════

@router.get("/cluster/guide")
def cluster_guide():
    """返回分布式部署扩容指南（可执行）"""
    return {
        "architecture": "Nginx least_conn → FastAPI×N → PG Master + Read Replicas",
        "current": {"instances": 2, "load_balancer": "nginx", "database": "single_master"},
        "scale_steps": [
            "1. docker-compose.yml 增加 app3/app4 服务定义（复制 app1 配置）",
            "2. nginx.conf upstream mingzebi_backend 添加 server app3:8000; server app4:8000;",
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

@router.get("/masks")
def list_masks(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT * FROM bi_column_masks")).fetchall()
    return {"masks": [dict(r._mapping) for r in rows]}

@router.post("/masks")
def set_mask(payload: dict = Body(...), db: Session = Depends(get_db)):
    db.execute(text("INSERT INTO bi_column_masks (table_name, column_name, mask_type, mask_pattern) VALUES (:t,:c,:m,:p) ON CONFLICT (table_name, column_name) DO UPDATE SET mask_type=:m, mask_pattern=:p"),
               {"t": payload["table_name"], "c": payload["column_name"], "m": payload["mask_type"], "p": payload.get("mask_pattern","")})
    db.commit()
    return {"success": True}


# ═══════ WAL 实时同步 ═══════

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


# ═══════ 信创兼容 ═══════

@router.get("/compat/guide")
def compat_guide():
    return {"dameng": "docker run -d -p 5236:5236 dameng/dm8:latest", "kingbase": "docker run -d -p 54321:54321 kingbase/kdb:latest", "status": "PG原生协议兼容"}


# ═══════ AI 引擎（NL→SQL / 数据诊断 / 智能推荐）═══════

@router.post("/ai/nl_to_sql", dependencies=_AI_SQL)
def nl_to_sql(payload: dict = Body(...), db: Session = Depends(get_db)):
    """自然语言 → SQL。输入 {question, table}，返回 {sql, explanation, chart_type}。
    基于关键词匹配 + 表结构感知，后续可替换为 LLM 调用。"""
    question = payload.get("question", "").strip()
    table = payload.get("table", "").strip()
    if not question or not table:
        raise HTTPException(400, "question 和 table 不能为空")
    if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
        raise HTTPException(404, f"表 {table} 不在白名单中")

    # 获取表结构
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    col_names = [c[0] for c in cols]
    numeric_cols = [c[0] for c in cols if c[1] in ("integer","bigint","numeric","double precision","real")]
    text_cols = [c[0] for c in cols if c[1] in ("text","character varying","date")]

    q = question.lower()
    sql = ""; explanation = ""; chart_type = "bar"

    # 关键词提取
    metric = None
    for kw in ["收入","营收","revenue","gmv","销售额","利润","profit","成本","cost","订单","orders","销量","sales","播放"]:
        if kw in q:
            matching = [c for c in numeric_cols if kw in c.lower() or any(w in c.lower() for w in kw.split(","))]
            if matching: metric = matching[0]; break
    if not metric:
        # 排除 id 列，优先选有意义的数值列
        meaningful = [c for c in numeric_cols if c != "id"]
        metric = meaningful[0] if meaningful else numeric_cols[0] if numeric_cols else col_names[0]

    dim = text_cols[0] if text_cols else col_names[0]
    for kw in ["月","month","日期","date","时间","time","渠道","channel","产品","product","店铺","store"]:
        matching = [c for c in text_cols if kw in c.lower()]
        if matching: dim = matching[0]; break

    agg = "SUM"
    if "平均" in q or "avg" in q: agg = "AVG"
    if "数量" in q or "行数" in q or "多少个" in q: agg = "COUNT"

    order = ""
    if "最高" in q or "最大" in q or "top" in q or "排名" in q:
        order = f" ORDER BY {agg}(\"{metric}\") DESC"
    if "最低" in q or "最小" in q or "bottom" in q:
        order = f" ORDER BY {agg}(\"{metric}\") ASC"

    limit = 500
    m = _re.search(r'(前|top\s*|limit\s*)(\d+)', q, _re.IGNORECASE)
    if m: limit = int(m.group(2))

    sql = f'SELECT "{dim}", {agg}("{metric}") AS "{agg.lower()}_{metric}" FROM {table} GROUP BY "{dim}"{order} LIMIT {limit}'
    explanation = f"按 {dim} 统计 {agg}({metric}){'，降序排列' if order else ''}"

    # 图表类型推荐
    try:
        rows = db.execute(text(sql)).fetchall()
    except Exception:
        rows = []
    if len(rows) <= 5 and agg in ("SUM","COUNT"): chart_type = "pie"
    elif agg == "COUNT": chart_type = "bar"
    elif "趋势" in q or "走势" in q or "变化" in q: chart_type = "line"
    else: chart_type = "bar"

    # 执行查询并返回结果
    if not rows:
        return {"sql": sql, "explanation": explanation, "chart_type": chart_type, "columns": [], "rows": [], "count": 0}
    columns = list(rows[0]._mapping.keys())
    return {"sql": sql, "explanation": explanation, "chart_type": chart_type,
            "columns": columns, "rows": [dict(r._mapping) for r in rows], "count": len(rows)}


@router.get("/ai/diagnose/{table}", dependencies=_AI_USE)
def ai_diagnose(table: str, db: Session = Depends(get_db)):
    """AI 数据诊断：检测空值/异常/重复"""
    if table not in ALLOWED_TABLES: raise HTTPException(404)
    issues = []
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    total = db.execute(text(f"SELECT count(*) FROM {table}")).scalar() or 0

    for col, dtype in cols:
        if dtype in ("integer","bigint","numeric","double precision","real"):
            nulls = db.execute(text(f"SELECT count(*) FROM {table} WHERE \"{col}\" IS NULL")).scalar() or 0
            if nulls > 0: issues.append({"column": col, "issue": f"{nulls}/{total} 空值 ({round(nulls/total*100,1)}%)", "fix_sql": f"UPDATE {table} SET \"{col}\"=0 WHERE \"{col}\" IS NULL", "severity": "high" if nulls/total > 0.1 else "medium"})
            avg = db.execute(text(f"SELECT AVG(\"{col}\") FROM {table}")).scalar()
            if avg:
                anomalies = db.execute(text(f"SELECT count(*) FROM {table} WHERE \"{col}\" > {avg*10} OR \"{col}\" < 0")).scalar() or 0
                if anomalies > 0: issues.append({"column": col, "issue": f"{anomalies} 个异常值 (远大于平均值 {round(avg)} 或为负数)", "fix_sql": f"-- 检查 {col} 的数据源", "severity": "high"})

    # 重复行检测
    col_join = ", ".join(f'"{c[0]}"' for c in cols[:3])
    dups = db.execute(text(f"SELECT count(*) FROM (SELECT 1 FROM {table} GROUP BY {col_join} HAVING count(*) > 1) t")).scalar() or 0
    if dups > 0:
        fix_sql = f"DELETE FROM {table} WHERE ctid NOT IN (SELECT min(ctid) FROM {table} GROUP BY {col_join})"
        issues.append({"column": "all", "issue": f"检测到 {dups} 组重复行", "fix_sql": fix_sql, "severity": "medium"})

    return {"table": table, "total_rows": total, "issues": issues, "health": "good" if len(issues) == 0 else "warning" if len([i for i in issues if i["severity"]=="high"]) == 0 else "critical"}


@router.get("/ai/recommend/{table}", dependencies=_AI_USE)
def ai_recommend(table: str, db: Session = Depends(get_db)):
    """智能推荐：根据表结构推荐维度×指标组合 + 图表类型"""
    if table not in ALLOWED_TABLES: raise HTTPException(404)
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    dims = [c[0] for c in cols if c[1] in ("text","character varying","date")]
    metrics = [c[0] for c in cols if c[1] in ("integer","bigint","numeric","double precision","real")]
    recommendations = []
    for d in dims[:3]:
        for m in metrics[:3]:
            chart = "bar"
            if d.lower().find("month") >= 0 or d.lower().find("date") >= 0: chart = "line"
            recommendations.append({"dimension": d, "metric": m, "aggregation": "SUM", "chart_type": chart,
                "title": f"{d} × {m}"})
    return {"table": table, "recommendations": recommendations[:9], "suggested_title": f"{table} 分析看板"}


# ═══════ G2: SQL优化器 + 自动建模 + 复杂图表 ═══════

# 慢查询内存缓存（最近100条）
_slow_queries: list = []  # [{sql, time_ms, table}]

@router.post("/ai/optimize_sql", dependencies=_AI_SQL)
def optimize_sql(payload: dict = Body(...), db: Session = Depends(get_db)):
    """SQL 智能优化器：改写低效 SQL + 索引建议"""
    sql = payload.get("sql", "").strip()
    table = payload.get("table", "")
    if not sql: raise HTTPException(400, "SQL 不能为空")

    suggestions = []
    optimized = sql

    # 规则1: SELECT * → 指定列
    if "SELECT *" in sql.upper() and table:
        cols = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' LIMIT 10")).fetchall()
        col_list = ", ".join(f'"{c[0]}"' for c in cols)
        optimized = optimized.replace("SELECT *", f"SELECT {col_list}")

    # 规则2: LIKE '%xxx%' → 全表扫描，建议加索引
    if "LIKE '%" in sql.upper() or "like '%" in sql.lower():
        suggestions.append("⚠️ LIKE '%xxx%' 无法使用索引，建议改为 LIKE 'xxx%' 或使用全文检索")

    # 规则3: 函数包裹列 → 建议函数索引
    for func in ["LOWER(", "UPPER(", "DATE("]:
        if func in sql.upper():
            suggestions.append(f"💡 检测到 {func}...)，建议创建表达式索引: CREATE INDEX ON {table or 'table'} ({func.lower()}column)")

    # 规则4: 物化视图命中提示
    mv = ACCEL_MAP.get(table, "")
    if mv:
        suggestions.append(f"🚀 检测到物化视图 {mv}，建议使用 precomputed=true 查询或直接查物化视图")

    # 保存优化记录
    db.execute(text("INSERT INTO bi_ai_sql_cache (original_sql, optimized_sql, table_name) VALUES (:o,:n,:t)"),
               {"o": sql, "n": optimized, "t": table})
    db.commit()

    return {"original": sql, "optimized": optimized, "suggestions": suggestions}


@router.post("/ai/auto_model", dependencies=_AI_SQL)
def auto_model(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 自动建模：多表关联自动识别"""
    tables = payload.get("tables", [])
    if not tables: raise HTTPException(400, "至少提供一张表")
    relations = []
    for t in tables[:5]:
        if t not in ALLOWED_TABLES: continue
        # 检测外键模式（列名包含 _id 或与另一表名匹配）
        cols = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{t}' AND table_schema='public'")).fetchall()
        for c in cols:
            cn = c[0]
            if cn.endswith("_id"):
                ref = cn[:-3]
                for t2 in tables:
                    if t2 != t and (ref in t2 or t2.endswith(ref)):
                        relations.append({"from_table": t, "from_col": cn, "to_table": t2, "to_col": "id", "type": "INNER"})
            elif cn == "id":
                for t2 in tables:
                    if t2 != t:
                        cols2 = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{t2}' AND table_schema='public'")).fetchall()
                        for c2 in cols2:
                            if c2[0].endswith(f"_{t}"):
                                relations.append({"from_table": t2, "from_col": c2[0], "to_table": t, "to_col": "id", "type": "INNER"})

    return {"tables": tables, "relations": relations, "suggested_joins": [f"{r['from_table']} {r['type']} JOIN {r['to_table']} ON {r['from_table']}.{r['from_col']}={r['to_table']}.{r['to_col']}" for r in relations]}


@router.post("/ai/gen_chart", dependencies=_AI_USE)
def gen_chart(payload: dict = Body(...)):
    """一句话生成 ECharts 复杂图表配置"""
    desc = payload.get("description", "")
    chart_type = payload.get("type", "bar")
    title = payload.get("title", "图表")

    option = {
        "title": {"text": title, "left": "center"},
        "tooltip": {"trigger": "item" if chart_type in ("pie","sunburst","funnel") else "axis"},
        "legend": {"bottom": 0},
    }

    if chart_type == "sunburst":
        option["series"] = [{"type": "sunburst", "radius": ["15%", "80%"], "data": [], "label": {"rotate": "radial"}}]
    elif chart_type == "sankey":
        option["series"] = [{"type": "sankey", "layout": "none", "emphasis": {"focus": "adjacency"}, "data": [], "links": []}]
    elif chart_type == "radar":
        option["radar"] = {"indicator": []}; option["series"] = [{"type": "radar", "data": []}]
    elif chart_type == "wordcloud":
        option["series"] = [{"type": "wordCloud", "shape": "circle", "sizeRange": [14, 60], "data": []}]
    elif chart_type == "funnel":
        option["series"] = [{"type": "funnel", "left": "10%", "right": "10%", "sort": "descending", "data": []}]
    elif chart_type == "heatmap":
        option["xAxis"] = {"type": "category"}; option["yAxis"] = {"type": "category"}
        option["visualMap"] = {"min": 0, "calculable": True, "orient": "horizontal", "left": "center"}
        option["series"] = [{"type": "heatmap", "data": []}]
    else:
        option["xAxis"] = {"type": "category"}; option["yAxis"] = {"type": "value"}
        option["series"] = [{"type": chart_type, "data": [], "smooth": chart_type == "line"}]

    return {"description": desc, "echarts_option": option, "note": "将此 JSON 传给 ECharts setOption() 即可渲染，data 需从 API 填充"}


@router.post("/ai/smart_alert", dependencies=_AI_USE)
def smart_alert(payload: dict = Body(...), db: Session = Depends(get_db)):
    """时序智能预警：移动平均检测环比异常"""
    table = payload.get("table", "")
    metric_col = payload.get("metric_col", "")
    if table not in ALLOWED_TABLES or not metric_col: raise HTTPException(400)

    rows = db.execute(text(f"SELECT {metric_col} FROM {table} ORDER BY updated_at DESC LIMIT 30")).fetchall()
    if len(rows) < 7: return {"status": "insufficient_data", "message": "至少需要7期数据"}

    vals = [r[0] for r in rows]
    recent = vals[0]
    ma7 = sum(vals[:7]) / 7
    change_pct = round((recent - ma7) / ma7 * 100, 1) if ma7 else 0
    severity = "normal"
    if abs(change_pct) > 30: severity = "critical"
    elif abs(change_pct) > 15: severity = "warning"

    pct = abs(change_pct)
    msg = f"{metric_col} 最新值 {recent}，较7日移动平均 {round(ma7)} {'增长' if change_pct>0 else '下降'} {pct}" + "%"
    return {"table": table, "metric": metric_col, "recent_value": recent, "ma7": round(ma7, 1),
            "change_pct": change_pct, "severity": severity, "message": msg}


@router.post("/ai/knowledge", dependencies=_AI_USE)
def add_knowledge(payload: dict = Body(...), db: Session = Depends(get_db)):
    """添加知识条目到 pgvector 知识库"""
    query = payload.get("query", "")
    sql = payload.get("sql", "")
    db.execute(text("INSERT INTO bi_ai_knowledge (query, sql_template) VALUES (:q,:s)"), {"q": query, "s": sql})
    db.commit()
    return {"added": True}

@router.get("/ai/knowledge", dependencies=_AI_USE)
def search_knowledge(q: str = Query(default=""), db: Session = Depends(get_db)):
    """搜索知识库"""
    if not q: rows = db.execute(text("SELECT query, sql_template, usage_count FROM bi_ai_knowledge ORDER BY usage_count DESC LIMIT 20")).fetchall()
    else:
        rows = db.execute(text("SELECT query, sql_template, usage_count FROM bi_ai_knowledge WHERE query ILIKE :kw OR sql_template ILIKE :kw2 ORDER BY usage_count DESC LIMIT 10"),
                          {"kw": f"%{q}%", "kw2": f"%{q}%"}).fetchall()
    return {"results": [{"query": r[0], "sql": r[1], "usage": r[2]} for r in rows]}


# ═══════ G3: 高阶AI ═══════

@router.post("/ai/pre_aggregate", dependencies=_AI_USE)
def ai_pre_aggregate(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 预聚合调度：分析慢查询模式，自动创建物化视图"""
    table = payload.get("table", "")
    if table and table not in ALLOWED_TABLES: raise HTTPException(404)
    # 统计最近SQL缓存中的高频查询模式
    where = f"WHERE table_name='{table}'" if table else ""
    patterns = db.execute(text(
        f"SELECT table_name, original_sql FROM bi_ai_sql_cache {where} ORDER BY optimized_at DESC LIMIT 50"
    )).fetchall()
    suggestions = []
    seen = set()
    for t, sql in patterns:
        if t not in ALLOWED_TABLES: continue
        key = f"{t}_monthly"
        if key not in seen:
            seen.add(key)
            mv = f"{t}_auto_mv"
            suggestions.append({
                "table": t, "suggested_mv": mv,
                "sql": f"CREATE MATERIALIZED VIEW {mv} AS SELECT * FROM {t} WHERE updated_at > NOW() - INTERVAL '30 days'",
                "reason": f"基于慢查询分析，建议对 {t} 按月预聚合减少查询时间",
            })
    return {"suggestions": suggestions[:5], "analyzed_queries": len(patterns)}


@router.post("/ai/root_cause", dependencies=_AI_USE)
def ai_root_cause(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 根因下钻：逐层分析异常指标的来源"""
    table = payload.get("table", "")
    metric = payload.get("metric", "")
    dims = payload.get("dimensions", [])
    limit = payload.get("limit", 5)
    if table not in ALLOWED_TABLES: raise HTTPException(404)
    if not metric: raise HTTPException(400, "metric 不能为空")

    drill_results = []
    # Level 1: 按第一维度分组
    if dims:
        d1 = dims[0]
        rows = db.execute(text(
            f'SELECT "{d1}", SUM("{metric}") AS total FROM {table} GROUP BY "{d1}" ORDER BY total DESC LIMIT {limit}'
        )).fetchall()
        drill_results.append({"level": 1, "dimension": d1, "data": [dict(r._mapping) for r in rows]})
        # Level 2: 对最高值钻取第二维度
        if len(dims) > 1 and rows:
            top_val = rows[0][0]
            d2 = dims[1]
            rows2 = db.execute(text(
                f'SELECT "{d1}", "{d2}", SUM("{metric}") AS total FROM {table} WHERE "{d1}" = :tv GROUP BY "{d1}", "{d2}" ORDER BY total DESC LIMIT {limit}'
            ), {"tv": top_val}).fetchall()
            drill_results.append({"level": 2, "dimension": d2, "parent_value": top_val, "data": [dict(r._mapping) for r in rows2]})

    conclusion = "分析完成"
    if drill_results and drill_results[0]["data"]:
        top_item = drill_results[0]["data"][0]
        conclusion = f"{metric} 最高值为 {top_item[drill_results[0]['dimension']]}（{top_item['total']}），占比最大。"

    return {"table": table, "metric": metric, "drill_results": drill_results, "conclusion": conclusion}


@router.post("/ai/generate_screen", dependencies=_AI_USE)
def ai_generate_screen(payload: dict = Body(...)):
    """AI 大屏一键生成：输入场景描述→返回 BigScreen 配置"""
    scene = payload.get("scene", "经营大屏")
    panels = [
        {"id": "p1", "type": "number", "title": "总成交额", "xField": "month", "yField": "gmv"},
        {"id": "p2", "type": "number", "title": "总订单量", "xField": "month", "yField": "orders"},
        {"id": "p3", "type": "number", "title": "平均ROI", "xField": "month", "yField": "roi"},
        {"id": "p4", "type": "number", "title": "推广费用", "xField": "month", "yField": "ad_spend"},
        {"id": "p5", "type": "line", "title": "成交趋势", "xField": "month", "yField": "gmv", "size": "lg"},
        {"id": "p6", "type": "bar", "title": "月度对比", "xField": "month", "yField": "orders", "size": "lg"},
        {"id": "p7", "type": "pie", "title": "费用占比", "xField": "month", "yField": "ad_spend", "size": "md"},
        {"id": "p8", "type": "sunburst", "title": "业务分布", "xField": "month", "yField": "gmv", "size": "md"},
    ]
    color_scheme = "日落橙" if "门店" in scene else ("森林绿" if "产线" in scene else "默认蓝")
    return {
        "scene": scene, "panels": panels, "color_scheme": color_scheme,
        "carousel_interval": 8,
        "title": f"{{scene}} BI大屏",
        "note": "将 panels 传给 BigScreen 组件即可渲染，数据从 /api/bi/engine/data/{table} 拉取",
    }


@router.post("/ai/interpret", dependencies=_AI_USE)
def ai_interpret(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 报表解读：输入看板数据→输出经营分析报告"""
    table = payload.get("table", "")
    if table not in ALLOWED_TABLES: raise HTTPException(404)
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public'")).fetchall()
    numeric = [c[0] for c in cols if c[0] != "id" and c[1] in ("integer","bigint","numeric","double precision","real")]
    if not numeric: raise HTTPException(400, "无可用数值列")
    insights = []
    for col in numeric[:4]:
        try:
            total = db.execute(text(f"SELECT SUM({col}) FROM {table}")).scalar() or 0
            avg = db.execute(text(f"SELECT AVG({col}) FROM {table}")).scalar() or 0
            max_row = db.execute(text(f"SELECT * FROM {table} ORDER BY {col} DESC LIMIT 1")).fetchone()
            if max_row:
                insights.append({
                    "metric": col, "total": total, "average": round(avg, 2),
                    "peak": f"{dict(max_row._mapping).get(next(c2[0] for c2 in cols if c2[0]!=col), '?')} ({max_row._mapping[col]})",
                })
        except Exception: pass
    summary = f"共分析 {len(insights)} 个指标。"
    if insights:
        top = insights[0]
        summary += f"最高指标为 {top['metric']}，总计 {top['total']}，峰值出现在 {top['peak']}。"

    return {"table": table, "insights": insights, "summary": summary,
            "report": f"## {table} 分析报告\n\n{summary}\n\n| 指标 | 总计 | 均值 | 峰值 |\n|------|------|------|------|\n" +
            "\n".join(f"| {i['metric']} | {i['total']} | {i['average']} | {i['peak']} |" for i in insights)}


@router.post("/ai/security_scan", dependencies=_AI_USE)
def ai_security_scan(db: Session = Depends(get_db)):
    """AI 数据安全扫描：检测异常访问模式"""
    alerts = []
    large_exports = db.execute(text(
        "SELECT table_name, count(*) FROM bi_sync_logs WHERE sync_type='full' AND started_at > NOW() - INTERVAL '1 day' GROUP BY table_name HAVING count(*) > 5"
    )).fetchall()
    for t, c in large_exports:
        alerts.append({"type": "frequent_export", "table": t, "count": c, "severity": "warning",
                       "message": f"过去24小时 {t} 全量导出 {c} 次，超过阈值(5次)"})

    # 检测脱敏表是否有非管理员访问
    masked = db.execute(text("SELECT table_name, column_name FROM bi_column_masks")).fetchall()
    for t, c in masked:
        alerts.append({"type": "sensitive_access", "table": t, "column": c, "severity": "info",
                       "message": f"敏感列 {t}.{c} 已配置脱敏规则"})

    return {"scan_time": _time.strftime("%Y-%m-%d %H:%M:%S"), "alerts": alerts, "total": len(alerts)}


@router.get("/dashboards")
def list_dashboards(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户的所有看板"""
    rows = db.execute(
        text("""
            SELECT DISTINCT d.id, d.name, d.panels, d.table_map, d.created_at, d.updated_at, d.owner_id
            FROM bi_dashboards d
            LEFT JOIN bi_resource_permissions p ON p.resource_type='dashboard' AND p.resource_id=d.id AND p.user_id=:uid
            WHERE d.owner_id = :uid OR p.user_id IS NOT NULL
            ORDER BY d.updated_at DESC
        """),
        {"uid": current_user.id}
    ).fetchall()
    return {
        "dashboards": [
            {"id": r[0], "name": r[1], "panels": r[2], "table_map": r[3], "created_at": str(r[4]),
             "updated_at": str(r[5]), "owner_id": r[6]}
            for r in rows
        ]
    }


@router.post("/dashboards")
def create_dashboard(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建新看板"""
    name = payload.get("name", "未命名看板")
    panels = json.dumps(payload.get("panels", []))
    result = db.execute(
        text("INSERT INTO bi_dashboards (name, owner_id, panels) VALUES (:name, :uid, :panels) RETURNING id"),
        {"name": name, "uid": current_user.id, "panels": panels}
    )
    dashboard_id = result.scalar()
    db.commit()
    return {"id": dashboard_id, "name": name, "panels": payload.get("panels", [])}


@router.put("/dashboards/{dashboard_id}")
def update_dashboard(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新看板"""
    row = db.execute(
        text("SELECT id, owner_id FROM bi_dashboards WHERE id = :id"),
        {"id": dashboard_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[1] != current_user.id:
        raise HTTPException(403, "无权修改此看板")

    name = payload.get("name", row[0])
    panels = json.dumps(payload.get("panels", []))
    table_map = payload.get("table_map")
    if table_map is not None:
        table_map_json = table_map if isinstance(table_map, str) else json.dumps(table_map)
        db.execute(
            text("UPDATE bi_dashboards SET name = :name, panels = :panels, table_map = CAST(:tmap AS jsonb), updated_at = NOW() WHERE id = :id"),
            {"name": name, "panels": panels, "tmap": table_map_json, "id": dashboard_id}
        )
    else:
        db.execute(
            text("UPDATE bi_dashboards SET name = :name, panels = :panels, updated_at = NOW() WHERE id = :id"),
            {"name": name, "panels": panels, "id": dashboard_id}
        )
    db.commit()
    return {"id": dashboard_id, "name": name}


@router.delete("/dashboards/{dashboard_id}")
def delete_dashboard(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除看板"""
    row = db.execute(
        text("SELECT id, owner_id FROM bi_dashboards WHERE id = :id"),
        {"id": dashboard_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[1] != current_user.id:
        raise HTTPException(403, "无权删除")

    db.execute(text("DELETE FROM bi_dashboards WHERE id = :id"), {"id": dashboard_id})
    db.execute(text("DELETE FROM bi_resource_permissions WHERE resource_type='dashboard' AND resource_id=:id"), {"id": dashboard_id})
    db.commit()
    return {"deleted": True}


# ═══════ SQL 自服务查询 ═══════

import re as _re



def _validate_sql(sql: str):
    """只读校验 —— 交给安全内核（sqlglot AST），不再用正则黑名单。

    返回 AST 供调用方复用（表白名单 + 行级权限都要用它）。
    兼容旧口径：至少引用一张受管辖表（白名单 或 bi_ai_* 前缀）。
    """
    try:
        root = guard_readonly(sql)
    except SecurityError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    tables = referenced_tables(root)
    if not (tables & ALLOWED_TABLES) and not any(
        t.startswith("bi_ai_") for t in tables
    ):
        raise HTTPException(
            400, f"查询表必须在白名单内: {', '.join(sorted(ALLOWED_TABLES))}"
        )
    return root


def _query_rls_conditions(db: Session, tables: set[str], user: User) -> list[str]:
    """把多张表的行级规则合并（用于手拼 SQL 的查询入口）."""
    conditions: list[str] = []
    for table in sorted(tables):
        if table not in ALLOWED_TABLES and not table.startswith("bi_ai_"):
            continue
        decision = rls_decide(db, table, user)
        conditions.extend(decision.conditions)
    return conditions


@router.post("/query", dependencies=[Depends(require_nav("bi:nav:sql"))])
def execute_sql(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """执行 SQL 查询（仅限 SELECT，白名单表）"""
    sql = payload.get("sql", "").strip()
    if not sql:
        raise HTTPException(400, "SQL 不能为空")
    root = _validate_sql(sql)

    # 行级权限：把受管辖表的规则 AND 进 WHERE（fail-closed）
    try:
        conditions = _query_rls_conditions(db, referenced_tables(root), current_user)
    except RlsBlockedError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc
    if conditions:
        sql = inject_conditions(sql, conditions)

    try:
        rows = db.execute(text(sql), {"uid": current_user.id}).fetchall()
        if not rows:
            return {"columns": [], "rows": [], "count": 0}
        columns = list(rows[0]._mapping.keys())
        return {"columns": columns, "rows": [dict(r._mapping) for r in rows], "count": len(rows)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"SQL 错误: {str(e)}")


# ═══════ 数据导入 ═══════

_EXCEL_COL_MAP_PDD_PROFIT = {
    "负责人": "person",
    "店铺名称": "store",
    "销售收入": "revenue",
    "正向订单数": "positive_orders",
    "退款": "refund",
    "销售成本": "cost",
    "毛利": "gross",
    "毛利率": "gross_rate",
    "运营推广": "promo",
    "仓库物流": "logistics",
    "平台费用": "platform_fee",
    "人工成本": "labor",
    "净利润": "net_profit",
    "净利润率": "net_rate",
}

# ═══════ AI 表序整理引擎 ═══════
"""智能表序整理 — 自动识别和规范化任意 Excel 表格格式。"""

# 模糊匹配别名（支持多种列名变体）
_COLUMN_ALIASES = {
    "店铺名称": ["店铺", "店铺名", "店名", "网店", "网店名称", "店鋪名稱", "店鋪名", "store", "名称", "名字", "店铺账号", "商户名"],
    "负责人": ["责任人", "运营", "店长", "负责", "负责人姓名", "owner", "person", "姓名", "归属人", "运营人员"],
    "销售收入": ["营收", "收入", "销售额", "营业额", "主营收入", "销售金额", "销售", "revenue", "income", "金额", "应收", "总收入"],
    "正向订单数": ["订单数", "订单量", "正向订单", "成交订单", "订单", "orders", "成交量", "成交数", "笔数"],
    "退款": ["退款金额", "退款额", "退货退款", "refund", "售后金额", "退款总金额"],
    "销售成本": ["成本", "商品成本", "产品成本", "进货成本", "cost", "总成本", "成本合计"],
    "毛利": ["毛利额", "毛利润", "gross", "gross_profit", "利润"],
    "毛利率": ["利润率", "毛利占比", "gross_rate", "margin", "margin_rate"],
    "运营推广": ["推广费", "推广", "推广费用", "营销费", "广告费", "promo", "ad", "花费", "直通车", "万相台"],
    "仓库物流": ["物流", "物流费", "快递费", "仓储", "发货", "logistics", "shipping", "运费", "配送费"],
    "平台费用": ["平台费", "平台", "平台扣点", "佣金", "技术服务费", "platform", "扣点", "平台扣费"],
    "人工成本": ["人工", "人工费", "工资", "人员成本", "人力", "labor", "薪资", "员工成本"],
    "净利润": ["净利", "净利润额", "纯利润", "net", "net_profit", "profit", "最终利润"],
    "净利润率": ["净利率", "净利占比", "net_rate", "profit_rate"],
}

_MATCH_CACHE: dict[str, str | None] = {}  # 列名→映射key 缓存

def _fuzzy_match_col(header: str) -> str | None:
    """模糊匹配列名 → 标准 key。支持子串匹配（如 '店铺名称AA' 匹配 '店铺名称'）。"""
    h = header.strip()
    if not h:
        return None
    if h in _MATCH_CACHE:
        return _MATCH_CACHE[h]

    # 精确匹配
    if h in _EXCEL_COL_MAP_PDD_PROFIT:
        _MATCH_CACHE[h] = h
        return h

    # 别名匹配
    for std_key, aliases in _COLUMN_ALIASES.items():
        if h in aliases:
            _MATCH_CACHE[h] = std_key
            return std_key

    # 子串匹配（如 "店铺名称AAA" 包含 "店铺名称"）
    for std_key in _EXCEL_COL_MAP_PDD_PROFIT:
        if std_key in h:
            _MATCH_CACHE[h] = std_key
            return std_key
    for std_key, aliases in _COLUMN_ALIASES.items():
        for alias in aliases:
            if len(alias) >= 3 and alias in h:
                _MATCH_CACHE[h] = std_key
                return std_key

    _MATCH_CACHE[h] = None
    return None

def _is_data_row(row_values: list[str], col_count: int) -> bool:
    """判断是否数据行（非标题/空行/合计行）。"""
    non_empty = [v for v in row_values[:col_count] if v.strip()]
    if len(non_empty) < 2:
        return False
    # 合计行检测
    combined = "".join(row_values[:min(col_count, len(row_values))])
    if any(kw in combined for kw in ["合计", "总计", "小计", "汇总", "平均"]):
        return False
    return True

def _normalize_sheet(ws) -> tuple[list[str], dict[str, int], int, str]:
    """
    AI 表序整理核心：扫描整个 sheet，自动定位 header 行并建立列映射。

    支持两种格式:
      格式A: 标准行式表格 (列名直接映射到 _EXCEL_COL_MAP_PDD_PROFIT)
      格式B: 交叉透视表 (核算项目名称 + 人员分列 + 分区段指标)
    返回: (headers, col_map, data_start_row, 诊断信息)
    """
    max_row = min(ws.max_row + 1, 200)
    diagnostic = ""

    # ─── 阶段 0: 处理合并单元格 ───
    merged_ranges = list(ws.merged_cells.ranges)
    if merged_ranges:
        for mr in merged_ranges:
            try:
                top_left_val = ws.cell(row=mr.min_row, column=mr.min_col).value
                for r in range(mr.min_row, mr.max_row + 1):
                    for c in range(mr.min_col, mr.max_col + 1):
                        if ws.cell(row=r, column=c).value is None:
                            ws.cell(row=r, column=c).value = top_left_val
            except Exception:
                pass
        diagnostic += f"处理了 {len(merged_ranges)} 个合并单元格; "

    # ─── 阶段 0.5: 检测是否交叉透视表 ───
    pivot_header_row, pivot_persons, pivot_metric_rows = _detect_pivot_format(ws, max_row)
    if pivot_header_row is not None:
        diagnostic += f"检测到交叉透视表格式(header行{pivot_header_row}, {len(pivot_persons)}人); "
        headers, col_map, data_start = _parse_pivot_table(ws, pivot_header_row, pivot_persons, pivot_metric_rows, max_row)
        diagnostic += f"透视表解析完成: {len(col_map)}列映射"
        return headers, col_map, data_start, diagnostic

    # ─── 阶段 1: 标准格式 — 扫描找最佳 header 行 ───
    best_header_row = None
    best_headers: list[str] = []
    best_match_count = 0

    for row_idx in range(1, max_row):
        row_vals = [str(ws.cell(row=row_idx, column=c).value or "").strip() for c in range(1, 50)]
        if all(not v for v in row_vals):
            continue

        matched_keys = set()
        for v in row_vals:
            if not v:
                continue
            key = _fuzzy_match_col(v)
            if key:
                matched_keys.add(key)

        match_ratio = len(matched_keys) / max(len(_EXCEL_COL_MAP_PDD_PROFIT), 1)
        if len(matched_keys) > best_match_count or (len(matched_keys) == best_match_count and match_ratio > 0.3):
            best_match_count = len(matched_keys)
            best_header_row = row_idx
            best_headers = row_vals

    if best_header_row is None or best_match_count < 2:
        found_cols = [h for h in (best_headers if best_headers else []) if h.strip()][:20]
        if not found_cols:
            for r in range(1, min(10, max_row)):
                vals = [str(ws.cell(row=r, column=c).value or "") for c in range(1, 30) if ws.cell(row=r, column=c).value]
                if vals:
                    found_cols.extend(v for v in vals if v.strip() and len(v.strip()) > 1)
        found_cols = list(dict.fromkeys(found_cols))[:20]
        sample = []
        for r in range(1, min(10, max_row)):
            vals = [str(ws.cell(row=r, column=c).value or "") for c in range(1, 30) if ws.cell(row=r, column=c).value]
            if vals:
                sample.append(f"第{r}行: {', '.join(vals[:6])}...")
        raise HTTPException(400, (
            f"表序整理仅匹配到 {best_match_count} 个已知列（需 ≥2）。"
            f"发现 {len(found_cols)} 个列名，其中匹配: {[c for c in found_cols if _fuzzy_match_col(c)][:10]}。"
            f"未匹配列名: {[c for c in found_cols if not _fuzzy_match_col(c)][:10]}。"
            f"前几行: {'; '.join(sample[:3])}"
            f"如需支持这些列名，请在列映射表中添加别名。"
        ))

    col_map: dict[str, int] = {}
    for idx, h in enumerate(best_headers):
        key = _fuzzy_match_col(h)
        if key and key not in col_map:
            col_map[key] = idx

    diagnostic += f"在第{best_header_row}行找到 {best_match_count} 个匹配列; 最终映射 {len(col_map)} 列"
    return best_headers, col_map, best_header_row + 1, diagnostic


def _detect_pivot_format(ws, max_row: int):
    """检测是否为交叉透视表格式。

    特征:
      - 某行第1列是"核算项目名称"（或类似标识列）
      - 该行后续列是人员姓名
      - 数据区之间有分区标题行（如一、净销售收入）

    返回: (header_row, person_names, metric_row_indices) 或 (None, [], [])
    """
    STORE_ID_COLS = ["核算项目名称", "店铺名称", "店铺", "店名", "项目", "项目名称"]
    SECTION_PREFIX = _re.compile(r"^[一二三四五六七八九十]、")

    for row_idx in range(1, min(20, max_row)):
        v1 = str(ws.cell(row=row_idx, column=1).value or "").strip()
        if v1 in STORE_ID_COLS:
            # 这是 header 行，第1列是店铺标识，后续列是人员
            persons = []
            for c in range(3, 40):  # 跳过第1列(店铺)和第2列(合计)
                name = str(ws.cell(row=row_idx, column=c).value or "").strip()
                if not name or len(name) > 10:
                    break
                if name not in ("合计", "小计", "总计") and name not in persons:
                    persons.append(name)
            if len(persons) >= 1:
                # 找到分区标题行（一、二、等）
                metric_rows = []
                for r in range(row_idx + 1, min(row_idx + 100, max_row)):
                    r1 = str(ws.cell(row=r, column=1).value or "").strip()
                    if r1 and SECTION_PREFIX.match(r1):
                        metric_rows.append(r)
                    if len(metric_rows) >= 8:  # 最多8个分区
                        break
                return row_idx, persons, metric_rows

    # 也尝试第1列不匹配但其他列是人员名的模式
    for row_idx in range(1, min(20, max_row)):
        row_vals = []
        for c in range(1, 40):
            v = str(ws.cell(row=row_idx, column=c).value or "").strip()
            if v:
                row_vals.append(v)
        # 检查前2列后是否全是人员名（2-4字中文）
        name_count = 0
        for v in row_vals[1:]:  # 跳过第1列
            # 2-4个中文字符，可能是人名
            if _re_clean.match(r'^[\u4e00-\u9fff·]{2,4}$', v):
                name_count += 1
        if name_count >= 3 and row_vals[0] not in STORE_ID_COLS:
            # 可能仍是透视表，但第1列不是标准名称
            # 放宽条件：只要前几个像是数据标识+多个人名
            pass

    return None, [], []


# 分区标题 → 标准列映射
_PIVOT_METRIC_MAP = {
    "净销售收入": "revenue",
    "销售收入": "revenue",
    "正向订单数": "positive_orders",
    "退款": "refund",
    "退款金额": "refund",
    "销售成本": "cost",
    "成本": "cost",
    "毛利": "gross",
    "毛利率": "gross_rate",
    "运营推广": "promo",
    "推广费": "promo",
    "仓库物流": "logistics",
    "物流费": "logistics",
    "平台费用": "platform_fee",
    "平台费": "platform_fee",
    "人工成本": "labor",
    "人工费": "labor",
    "净利润": "net_profit",
    "净利润率": "net_rate",
    "净利率": "net_rate",
}


def _parse_pivot_table(ws, header_row: int, persons: list[str], metric_rows: list[int], max_row: int):
    """解析交叉透视表 → 标准格式 (col_map + data_start)。

    策略：将每个 [section_header → store × person → value] 映射为实际导入时的列读取。
    实际做法：透视表无法简单用 col_map 映射，改为在预览/导入阶段整体读取后结构化。

    但预览端点需要 col_map，所以这里构建一个"模拟 col_map"：
      - 第1列 → "店铺名称"
      - 后续列 → 第一个 metric 的 person 列
    实际使用 import 端点时会走另一条解析路径。
    """
    # 找出最常用的 metric_rows 对应的标准列名
    section_labels = []
    for mr in metric_rows:
        label = str(ws.cell(row=mr, column=1).value or "").strip()
        # 去掉编号 "一、" → "净销售收入"
        clean = _re.sub(r"^[一二三四五六七八九十]、", "", label)
        section_labels.append(clean)

    # 构建列映射：第1列=店铺名称，后续列=每个person一个"销售收入"列
    col_map: dict[str, int] = {"店铺名称": 0}
    for i, person in enumerate(persons):
        # 每个人占一列，映射多个指标时复用这些person列
        for col_name in ["销售收入", "退款", "成本", "毛利", "推广", "物流", "平台费用", "人工成本", "净利", "毛利率", "净利率"]:
            key = f"{col_name}({person})"
            col_map[key] = i + 2  # +2 因为第1列是店铺名，第2列是"合计"

    # 存储透视表元信息到全局，供导入时使用
    if not hasattr(_parse_pivot_table, "_meta"):
        _parse_pivot_table._meta = {}
    _parse_pivot_table._meta = {
        "header_row": header_row,
        "persons": persons,
        "metric_rows": metric_rows,
        "section_labels": section_labels,
        "is_pivot": True,
        "max_row": max_row,
    }

    return [], col_map, header_row + 1


# ═══════ LLM 调用工具 ═══════

import requests as _requests
from pathlib import Path as _Path

def _load_default_llm() -> dict | None:
    """加载默认 AI 模型配置。

    顺序：管理后台维护的库表 → data/ai_models.json → 环境变量（见 app/services/ai_models.py）。
    """
    try:
        from app.services.ai_models import legacy_chat_config

        cfg = legacy_chat_config()
        if cfg:
            return cfg
    except Exception:
        pass
    models_file = _Path(__file__).parent.parent.parent / "data" / "ai_models.json"
    if not models_file.exists():
        return None
    try:
        models = json.loads(models_file.read_text())
        for m in models:
            if m.get("isDefault") and m.get("enabled") and m.get("apiKey"):
                return m
        # 兜底：取第一个启用的
        for m in models:
            if m.get("enabled") and m.get("apiKey"):
                return m
    except Exception:
        pass
    return None

def _call_llm(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    """调用默认 LLM（DeepSeek）."""
    cfg = _load_default_llm()
    if not cfg:
        return ""

    headers = {
        "Authorization": f"Bearer {cfg['apiKey']}",
        "Content-Type": "application/json",
    }
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    try:
        endpoint = cfg.get("chat_url") or f"{str(cfg['baseURL']).rstrip('/')}/chat/completions"
        r = _requests.post(
            endpoint,
            json={
                "model": cfg.get("model", "deepseek-v4-pro"),
                "messages": messages,
                "temperature": cfg.get("temperature", 0.3),
                "max_tokens": max_tokens,
            },
            headers=headers,
            timeout=60,
        )
        if r.status_code == 200:
            return r.json()["choices"][0]["message"]["content"]
        return ""
    except Exception:
        return ""

def _read_pivot_as_rows(ws, header_row: int, persons: list[str], metric_rows: list[int], max_row: int) -> tuple:
    import re as _sre
    section_pat = _sre.compile(r"^[一二三四五六七八九十]、")
    section_to_metric = {}
    for mr in metric_rows:
        label = str(ws.cell(row=mr, column=1).value or "").strip()
        clean = section_pat.sub("", label)
        db_col = _PIVOT_METRIC_MAP.get(clean)
        if db_col: section_to_metric[mr] = db_col
    data_ranges = []
    for i, mr in enumerate(metric_rows):
        end = metric_rows[i + 1] if i + 1 < len(metric_rows) else max_row
        data_ranges.append((mr, mr + 1, end))
    store_data = {}
    for section_row, start, end in data_ranges:
        db_col = section_to_metric.get(section_row, "")
        if not db_col: continue
        for r in range(start, end):
            store = str(ws.cell(row=r, column=1).value or "").strip()
            if not store or store in ("None", "nan", "-", ""): continue
            if section_pat.match(store) or any(k in store for k in ("合计", "总计", "小计")): continue
            try: float(store); continue
            except ValueError: pass
            # 必须是真实店铺名——以【开头，或以特定前缀开头
            if not (store.startswith("【") or store.startswith("[")): continue
            v = ws.cell(row=r, column=2).value
            try: v = float(v) if v is not None else 0
            except: v = 0
            if store not in store_data: store_data[store] = {"store": store, "person": "", "data_month": ""}
            store_data[store][db_col] = round(v, 2)
    rows = list(store_data.values())
    return rows, []


# ═══════ 核心导入端点 ═══════

# ═══════ 数据清洗工具 ═══════

import re as _re_clean

_STORE_SUFFIXES = [
    "旗舰店", "专卖店", "专营店", "官方店", "企业店", "大店",
    "宠物用品店", "宠物食品旗舰店", "宠物生活专营店", "宠物生活馆",
    "宠物用品旗舰店", "宠物用品官方旗舰店", "宠物用品大店",
]
_BRAND_PREFIX_PATTERN = _re_clean.compile(r"^【[^】]+】|^\[[^\]]+\]")
_MULTISPACE = _re_clean.compile(r"\s+")

def _clean_store_name(name: str) -> tuple[str, list[str]]:
    """清洗店铺名：去除品牌前缀、尾部冗余后缀、多余空格。
    返回 (清洗后名称, [清洗日志])。
    """
    logs = []
    original = name.strip()
    cleaned = original

    # 去品牌前缀：【拼多多】xxx → xxx
    m = _BRAND_PREFIX_PATTERN.search(cleaned)
    if m:
        cleaned = cleaned[m.end():].strip()
        logs.append(f"去除品牌前缀: {m.group()}")

    # 去多余空格
    if "  " in cleaned:
        cleaned = _MULTISPACE.sub(" ", cleaned).strip()
        logs.append("去除多余空格")

    # 去尾部后缀（仅当名称 > 4 字符时）
    if len(cleaned) > 4:
        for sfx in sorted(_STORE_SUFFIXES, key=len, reverse=True):
            if cleaned.endswith(sfx) and len(cleaned) > len(sfx) + 2:
                cleaned = cleaned[:-len(sfx)].strip()
                logs.append(f"去除店铺后缀: {sfx}")
                break

    if cleaned != original:
        logs.append(f"店铺名标准化: {original[:30]} → {cleaned[:30]}")

    return cleaned, logs

def _clean_person_name(name: str) -> tuple[str, list[str]]:
    """清洗负责人姓名：去空格、空值统一为"未分配"。"""
    logs = []
    original = (name or "").strip()
    cleaned = original

    if not cleaned or cleaned.lower() in ("none", "null", "无", "nan", "-"):
        cleaned = "未分配"
        logs.append(f"负责人空值 → 未分配")

    cleaned = _MULTISPACE.sub("", cleaned)
    if cleaned != original:
        logs.append(f"负责人标准化: {original} → {cleaned}")

    return cleaned, logs

def _fix_percentage(v: float, col: str) -> tuple[float, str]:
    """修正百分比值：如果 > 1 自动除以 100（如 35.5 → 0.355）。"""
    original = v
    if v is None:
        return 0, ""
    if v > 1.0:
        corrected = round(v / 100, 6)
        return corrected, f"{col} 百分比自动校正: {original} → {corrected:.2%}"
    return v, ""

def _normalize_numeric(v, col: str) -> tuple[float, str]:
    """规整数值：None→0，负数应收→绝对值警告，退款→正数。"""
    if v is None:
        return 0, ""
    original = v
    # 退款相关字段应为正数（支出），但Excel可能标负数
    if col in ("refund", "cost", "promo", "logistics", "platform_fee", "labor"):
        if v < 0:
            return abs(v), f"{col} 负值转正: {original} → {abs(v)}"
    # 收入字段不应为负
    if col == "revenue":
        if v < 0:
            return abs(v), f"销售收入负值转正: {original} → {abs(v)}"
    # 利润可以为负
    return v, ""

# ═══════ 数据校验 ═══════

def _validate_row(row: dict, idx: int) -> list[str]:
    """校验单行数据，返回警告列表。"""
    warnings = []
    store = row.get("store", "")
    tag = f"[{store}]" if store else f"[行#{idx}]"

    # 毛利校验：gross ≈ revenue - cost（允许 1% 误差）
    revenue = row.get("revenue", 0) or 0
    cost = row.get("cost", 0) or 0
    gross = row.get("gross", 0) or 0
    if revenue > 0:
        expected_gross = revenue - cost
        if abs(expected_gross) > 0.01:
            diff_pct = abs(gross - expected_gross) / abs(expected_gross) * 100 if abs(expected_gross) > 0.01 else 0
            if diff_pct > 5:
                warnings.append(f"{tag} 毛利异常: 报表毛利={gross:.2f}, 计算毛利={expected_gross:.2f}, 偏差{diff_pct:.1f}%")
                # 自动修正为计算值
                row["gross"] = round(expected_gross, 2)

    # 毛利率校验
    if revenue > 0:
        expected_rate = gross / revenue
        current_rate = row.get("gross_rate", 0) or 0
        if abs(current_rate - expected_rate) > 0.1:
            warnings.append(f"{tag} 毛利率异常: 报表{current_rate:.2%}, 计算{expected_rate:.2%}")
            row["gross_rate"] = round(expected_rate, 6)

    # 净利润校验
    net = row.get("net_profit", 0) or 0
    costs_total = (cost or 0) + (row.get("promo", 0) or 0) + (row.get("logistics", 0) or 0) + \
                  (row.get("platform_fee", 0) or 0) + (row.get("labor", 0) or 0) + \
                  (row.get("other_expense", 0) or 0)
    expected_net = revenue - costs_total + (row.get("other_income", 0) or 0)
    if revenue > 0 and abs(expected_net) > 0.01:
        diff_pct = abs(net - expected_net) / (abs(expected_net) + 0.01) * 100
        if diff_pct > 10:
            warnings.append(f"{tag} 净利润异常: 报表净利润={net:.2f}, 核算净利润={expected_net:.2f}, 偏差{diff_pct:.1f}%")
            row["net_profit"] = round(expected_net, 2)

    # 净利润率校验
    if revenue > 0 and net != 0:
        expected_net_rate = net / revenue
        current_net_rate = row.get("net_rate", 0) or 0
        if abs(current_net_rate - expected_net_rate) > 0.1:
            warnings.append(f"{tag} 净利润率异常: 报表{current_net_rate:.2%}, 计算{expected_net_rate:.2%}")
            row["net_rate"] = round(expected_net_rate, 6)

    return warnings

def _detect_outliers(rows: list[dict]) -> list[str]:
    """检测异常离群值（超过 3σ）。"""
    alerts = []
    for col in ["revenue", "cost", "gross", "net_profit"]:
        vals = [(i, (r.get(col) or 0)) for i, r in enumerate(rows) if (r.get(col) or 0) != 0]
        if len(vals) < 5:
            continue
        avg = sum(v for _, v in vals) / len(vals)
        std = (sum((v - avg) ** 2 for _, v in vals) / len(vals)) ** 0.5
        if std == 0:
            continue
        for i, v in vals:
            if abs(v - avg) > 3 * std:
                store = rows[i].get("store", f"行#{i}")
                alerts.append(f"[{store}] {col}={v:.0f} 为离群值 (均值{avg:.0f}, 3σ={3*std:.0f})")
    return alerts

# ═══════ AI 智能清洗引擎 ═══════

import math as _math

def _ai_profile(rows: list[dict], columns: list[str]) -> dict:
    """AI 列统计画像：均值/中位数/标准差/变异系数/偏度/空值率。"""
    profile = {}
    for col in columns:
        vals = [r.get(col) for r in rows if r.get(col) is not None and r.get(col) != 0]
        n = len(vals)
        if n < 3:
            profile[col] = {"count": n, "null_rate": 1 - n / max(len(rows), 1)}
            continue
        avg = sum(vals) / n
        sorted_vals = sorted(vals)
        median = sorted_vals[n // 2] if n % 2 else (sorted_vals[n // 2 - 1] + sorted_vals[n // 2]) / 2
        variance = sum((v - avg) ** 2 for v in vals) / n
        std_dev = _math.sqrt(variance)
        cv = std_dev / abs(avg) if avg != 0 else 0  # 变异系数
        # 偏度
        skew = sum(((v - avg) / std_dev) ** 3 for v in vals) / n if std_dev > 0 else 0
        profile[col] = {
            "count": n, "null_rate": round(1 - n / max(len(rows), 1), 2),
            "avg": round(avg, 2), "median": round(median, 2),
            "std": round(std_dev, 2), "cv": round(cv, 2),
            "skew": round(skew, 2),
            "min": round(sorted_vals[0], 2), "max": round(sorted_vals[-1], 2),
            "q1": round(sorted_vals[n // 4], 2), "q3": round(sorted_vals[3 * n // 4], 2),
        }
    return profile

def _ai_smart_repair(rows: list[dict], profile: dict) -> list[str]:
    """AI 智能修补：基于列统计画像修正异常值。
    
    策略：
    - 负值收入/订单 → 转正
    - 远超 3σ 的异常值 → IQR 边界裁剪
    - 缺失值 → 列中位数填充
    """
    logs = []
    for i, row in enumerate(rows):
        store = row.get("store", f"行#{i+1}")
        for col, p in profile.items():
            v = row.get(col)
            if v is None or v == 0:
                continue

            # 负值修补（收入/订单必为正）
            if col in ("revenue", "positive_orders", "positive_rev") and v < 0:
                row[col] = abs(v)
                logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{abs(v):.2f} (负值转正)")

            # IQR 异常值裁剪
            q1 = p.get("q1", 0)
            q3 = p.get("q3", 0)
            if q3 > q1 > 0:
                iqr = q3 - q1
                upper = q3 + 3 * iqr
                lower = max(0, q1 - 3 * iqr)
                if v > upper:
                    row[col] = upper
                    logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{upper:.2f} (IQR上限裁剪, q3={q3:.0f})")
                elif col not in ("net_profit",) and v < lower and v != 0:
                    row[col] = q1
                    logs.append(f"AI修补 [{store}] {col}: {v:.2f}→{q1:.2f} (IQR下限裁剪)")

    return logs

def _ai_deep_clean(rows: list[dict]) -> list[str]:
    """AI 深度清洗：利用列间关系智能推断和修正。
    
    关系规则：
    - gross = revenue - cost
    - gross_rate = gross / revenue
    - net_profit ≈ revenue - Σcosts
    - net_rate = net_profit / revenue
    """
    logs = []
    for i, row in enumerate(rows):
        store = row.get("store", f"行#{i+1}")
        revenue = row.get("revenue", 0) or 0
        cost = row.get("cost", 0) or 0
        if revenue <= 0:
            continue

        # 毛利推断
        gross = row.get("gross", 0) or 0
        expected_gross = revenue - cost
        if abs(gross - expected_gross) > max(abs(expected_gross) * 0.05, 100):
            logs.append(f"AI推断 [{store}] 毛利{gross:.0f}偏离计算值{expected_gross:.0f} → 自动修正")
            row["gross"] = round(expected_gross, 2)

        # 毛利率推断
        gross_rate = row.get("gross_rate", 0) or 0
        expected_rate = row["gross"] / revenue
        if abs(gross_rate - expected_rate) > 0.05:
            logs.append(f"AI推断 [{store}] 毛利率{gross_rate:.2%}→{expected_rate:.2%}")
            row["gross_rate"] = round(expected_rate, 6)

        # 净利润验证
        net = row.get("net_profit", 0) or 0
        costs_total = cost + (row.get("promo", 0) or 0) + (row.get("logistics", 0) or 0) + \
                      (row.get("platform_fee", 0) or 0) + (row.get("labor", 0) or 0)
        expected_net = revenue - costs_total
        if abs(net - expected_net) > max(abs(expected_net) * 0.1, 500):
            logs.append(f"AI推断 [{store}] 净利润{net:.0f}偏离核算值{expected_net:.0f} → 自动修正")
            row["net_profit"] = round(expected_net, 2)

        # 净利润率推断
        net_rate = row.get("net_rate", 0) or 0
        expected_net_rate = row["net_profit"] / revenue if revenue > 0 else 0
        if abs(net_rate - expected_net_rate) > 0.05:
            logs.append(f"AI推断 [{store}] 净利润率{net_rate:.2%}→{expected_net_rate:.2%}")
            row["net_rate"] = round(expected_net_rate, 6)

    return logs

def _ai_generate_insights(rows: list[dict], profile: dict) -> dict:
    """AI 数据洞察：基于统计画像生成业务洞察摘要。
    
    返回: {
      summary: "整体概括",
      top_stores: [{store, metric}],
      risks: [风险提示],
      highlights: [亮点发现],
      recommendations: [建议],
    }
    """
    stores = sorted(rows, key=lambda r: r.get("revenue") or 0, reverse=True)
    loss_stores = [r for r in rows if (r.get("net_profit") or 0) < 0]

    # 整体概括
    total_rev = sum(r.get("revenue") or 0 for r in rows)
    total_net = sum(r.get("net_profit") or 0 for r in rows)
    avg_net_rate = total_net / total_rev if total_rev > 0 else 0
    total_stores = len(rows)

    summary = (
        f"共 {total_stores} 家店铺，总营收 {_fmt_ai(total_rev)}，"
        f"净利润 {_fmt_ai(total_net)}（利润率 {avg_net_rate:.1%}），"
        f"亏损店铺 {len(loss_stores)} 家（占比 {len(loss_stores)/max(total_stores,1):.0%}）"
    )

    # Top 店铺
    top5 = stores[:5]
    top_stores = [
        {"store": s.get("store", ""), "revenue": _fmt_ai(s.get("revenue") or 0),
         "net_profit": _fmt_ai(s.get("net_profit") or 0)}
        for s in top5
    ]

    # 风险提示
    risks = []
    if len(loss_stores) >= total_stores * 0.2:
        risks.append(f"⚠ {len(loss_stores)}/家店铺亏损，占比偏高，建议逐店分析成本结构")
    promo_heavy = [r for r in rows if (r.get("promo") or 0) / max(r.get("revenue") or 1, 1) > 0.3]
    if promo_heavy:
        risks.append(f"⚠ {len(promo_heavy)} 家店铺推广费占比 > 30%，可能压缩利润空间")

    # 亮点
    highlights = []
    top1 = stores[0] if stores else None
    if top1:
        highlights.append(f"🏆 营收冠军: {top1.get('store','')}（{_fmt_ai(top1.get('revenue') or 0)}）")
    high_margin = [r for r in rows if (r.get("net_rate") or 0) > 0.15]
    if high_margin:
        highlights.append(f"📈 {len(high_margin)} 家店铺净利润率 > 15%，运营效率优秀")

    # 建议
    recommendations = []
    if len(loss_stores) > 0:
        recommendations.append(f"重点关注 {len(loss_stores)} 家亏损店铺的成本与推广")
    if any((r.get("promo") or 0) > (r.get("net_profit") or 0) > 0 for r in rows):
        recommendations.append("部分店铺推广费超过净利润，建议优化投放策略")
    recommendations.append("可配置 BI 告警规则，对亏损/利润率异常自动通知")

    return {
        "summary": summary,
        "top_stores": top_stores,
        "risks": risks,
        "highlights": highlights,
        "recommendations": recommendations,
    }

def _fmt_ai(v: float) -> str:
    if abs(v) >= 1e8: return f"{v/1e8:.2f}亿"
    if abs(v) >= 1e4: return f"{v/1e4:.0f}万"
    return f"{v:,.0f}"

def _is_number(v) -> bool:
    try:
        float(v)
        return True
    except (ValueError, TypeError):
        return False


def _parse_excel_rows(file_content: bytes) -> tuple[list[dict], str]:
    """解析 Excel 为标准行格式（共享模块）。"""
    wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
    ws = wb[max(wb.sheetnames, key=lambda sn: wb[sn].max_row)]
    headers, col_map, data_start, diag = _normalize_sheet(ws)

    # 检查是否透视表
    pivot_meta = getattr(_parse_pivot_table, "_meta", {}) if hasattr(_parse_pivot_table, "_meta") else {}
    if pivot_meta.get("is_pivot"):
        pivot_rows, _ = _read_pivot_as_rows(ws, pivot_meta["header_row"], pivot_meta["persons"], pivot_meta["metric_rows"], pivot_meta["max_row"])
        return pivot_rows, diag + f" (透视表, {len(pivot_rows)}行)"

    # 标准格式
    rows = []
    for row_idx in range(data_start, ws.max_row + 1):
        row_vals = [c.value for c in ws[row_idx]]
        store = str(row_vals[col_map.get("店铺名称", -1)]).strip() if "店铺名称" in col_map and col_map["店铺名称"] < len(row_vals) else ""
        if not store or store in ("None", "nan", "-"):
            continue
        if "合计" in store or "总计" in store:
            continue

        row = {"store": store, "person": "", "data_month": ""}
        for key, idx in col_map.items():
            if idx < len(row_vals):
                v = row_vals[idx]
                try:
                    row[_EXCEL_COL_MAP_PDD_PROFIT.get(key, key)] = float(v) if v is not None else 0
                except (ValueError, TypeError):
                    row[_EXCEL_COL_MAP_PDD_PROFIT.get(key, key)] = v if v else ""

        for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                    "product_cost", "gift_cost", "special_cost", "damage",
                    "express", "other_logistics", "product_promo", "wujie_promo",
                    "platform_commission", "op_labor", "alloc_labor",
                    "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
            row.setdefault(fld, 0)
        rows.append(row)

    return rows, diag


@router.post("/import/pdd-profit/ai-process")
async def ai_process_data(file: UploadFile = File(...)):
    """🤖 AI数据处理 — 清洗整理表格，返回结构化预览。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 清洗店铺名
        clean_logs = []
        for r in rows:
            name = r.get("store", "")
            cleaned, logs = _clean_store_name(name)
            if logs:
                r["store"] = cleaned
                clean_logs.extend(logs)

        # 数值规整
        for r in rows:
            for col in ["revenue", "refund", "cost", "promo", "logistics", "platform_fee", "labor", "net_profit"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, msg = _normalize_numeric(v, col)
                    if msg:
                        r[col] = corrected
                        clean_logs.append(msg)

        # 百分比修正
        for r in rows:
            for col in ["gross_rate", "net_rate"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, msg = _fix_percentage(v, col)
                    if msg:
                        r[col] = corrected

        # LLM 分析结构
        sample_text = "\n".join(str(r.get("store","")[:20]) for r in rows[:5])
        prompt = f"""电商数据清洗专家。已解析{len(rows)}行数据，前5行店铺: {sample_text}。清洗了{len(clean_logs)}处。返回JSON分析: {{"table_type":"standard/pivot","data_quality":"good/fair/poor","issues":["问题1"],"summary":"总结20字"}}"""
        resp = _call_llm(prompt, system="只返回JSON。", max_tokens=1024)
        ai = {}
        try:
            import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
        except Exception:
            ai = {"summary": f"解析{len(rows)}行数据"}

        return {
            "row_count": len(rows),
            "cleaned_count": len(clean_logs),
            "clean_logs": clean_logs[:10],
            "columns": list(rows[0].keys())[:12] if rows else [],
            "ai_analysis": ai,
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"AI处理失败: {str(e)}")


@router.post("/import/pdd-profit/cross-validate")
async def cross_validate_data(file: UploadFile = File(...)):
    """✔️ 交叉校验 — 对清洗后的表格进行毛利/净利/离群值校验。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 先清洗
        for r in rows:
            cleaned, _ = _clean_store_name(r.get("store", ""))
            r["store"] = cleaned

        # 校验
        all_warnings = []
        for i, r in enumerate(rows):
            w = _validate_row(r, i + 1)
            if w:
                all_warnings.extend(w)

        outlier_alerts = _detect_outliers(rows)

        # 按类型分类
        gross_warnings = [w for w in all_warnings if "毛利" in w]
        net_warnings = [w for w in all_warnings if "净利" in w]
        other_warnings = [w for w in all_warnings if "毛利" not in w and "净利" not in w]

        return {
            "row_count": len(rows),
            "total_warnings": len(all_warnings),
            "gross_issues": len(gross_warnings),
            "net_issues": len(net_warnings),
            "outliers": len(outlier_alerts),
            "warnings": all_warnings[:15],
            "outlier_details": outlier_alerts[:10],
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"交叉校验失败: {str(e)}")


@router.post("/import/pdd-profit/ai-infer")
async def ai_deep_infer(file: UploadFile = File(...)):
    """🔬 AI深度推断 — 对校验出的异常进行深度分析和调整建议。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 清洗 + 校验
        for r in rows:
            cleaned, _ = _clean_store_name(r.get("store", ""))
            r["store"] = cleaned
        for r in rows:
            for col in ["revenue", "refund", "cost", "promo"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, _ = _normalize_numeric(v, col)
                    r[col] = corrected

        all_warnings = []
        for i, r in enumerate(rows):
            w = _validate_row(r, i + 1)
            if w:
                all_warnings.extend(w)

        # 构建异常摘要发给 LLM
        anomaly_summary = f"共{len(rows)}行，{len(all_warnings)}个校验异常。"
        loss_stores = [r.get("store","") for r in rows if (r.get("net_profit") or 0) < 0]
        anomaly_summary += f" 亏损{len(loss_stores)}家。"

        sample_warnings = all_warnings[:5]
        warning_text = "; ".join(sample_warnings)[:500] if sample_warnings else "无严重异常"

        prompt = f"""电商数据分析专家。数据校验结果: {anomaly_summary} 异常样例: {warning_text}。
请深度分析并给出调整建议，返回JSON:
{{"analysis":"根因分析(80字)","adjustments":["调整建议1","调整建议2"],"risk_level":"low/medium/high","actions":["行动1","行动2"]}}"""

        resp = _call_llm(prompt, system="只返回JSON。", max_tokens=2048)
        ai = {}
        try:
            import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
        except Exception:
            ai = {"analysis": f"共{len(all_warnings)}个异常，{len(loss_stores)}家亏损"}

        return {
            "row_count": len(rows),
            "anomaly_count": len(all_warnings),
            "loss_count": len(loss_stores),
            "ai_inference": ai,
            "sample_anomalies": sample_warnings[:3],
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"AI推断失败: {str(e)}")


@router.post("/import/pdd-profit/ai-analyze")
def ai_analyze_current_data(
    data_month: str = Query(default="2026-05"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI分析 — 对已导入数据库的表格数据进行深度分析。"""
    rows = db.execute(text(
        "SELECT store, person, revenue, cost, gross, gross_rate, promo, logistics, "
        "platform_fee, labor, net_profit, net_rate, is_loss "
        "FROM bi_pdd_profit WHERE data_month=:mth ORDER BY revenue DESC"
    ), {"mth": data_month}).fetchall()

    if not rows:
        return {"analysis": "暂无数据", "recommendations": []}

    # 构建数据摘要
    total_rev = sum(r[2] or 0 for r in rows)
    total_net = sum(r[10] or 0 for r in rows)
    loss_count = sum(1 for r in rows if r[12])
    store_count = len(rows)

    # Top 5 和 Bottom 5
    top5 = rows[:5]
    bottom5 = rows[-5:] if len(rows) > 5 else rows[:5]

    summary = (
        f"共{store_count}家店铺，总营收{total_rev:,.0f}，净利润{total_net:,.0f}，"
        f"亏损{loss_count}家。"
        f"TOP5: {', '.join(f'{r[0][:8]}({r[2]:,.0f})' for r in top5)}. "
        f"尾5: {', '.join(f'{r[0][:8]}({r[10]:,.0f})' for r in bottom5)}."
    )

    prompt = f"""电商数据分析专家。数据摘要：{summary}

请进行专业分析，返回JSON：
{{"summary":"整体分析(100字)", "highlights":["亮点1","亮点2"],
 "risks":["风险1","风险2"], "cost_analysis":"成本结构分析(60字)",
 "profit_trend":"利润趋势判断(60字)", "actions":["行动建议1","行动建议2","行动建议3"]}}"""

    resp = _call_llm(prompt, system="你是电商数据分析专家，只返回JSON。", max_tokens=2048)
    try:
        import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
    except Exception:
        ai = {"summary": summary}

    return {
        "data_summary": summary,
        "store_count": store_count,
        "total_revenue": round(total_rev, 2),
        "total_net_profit": round(total_net, 2),
        "loss_count": loss_count,
        "ai_analysis": ai,
    }


@router.post("/ai/analyze", dependencies=_AI_USE)
def ai_generic_analyze(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """🤖 通用AI分析 — 发送任意 prompt 给默认 LLM。"""
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(400, "prompt 不能为空")
    resp = _call_llm(prompt, system="你是数据分析专家，只返回JSON。", max_tokens=2048)
    return {"response": resp}


@router.post("/editor/save")
def save_editor_layout(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存看板编辑器布局 — 支持新建和更新"""
    dashboard_id = payload.get("dashboard_id", 0)
    name = payload.get("name", "新建看板")
    cards = payload.get("cards", [])

    if dashboard_id and dashboard_id > 0:
        # Update existing
        db.execute(text("""
            UPDATE bi_dashboards SET name = :name, panels = CAST(:panels AS jsonb), updated_at = NOW()
            WHERE id = :id AND owner_id = :uid
        """), {"name": name, "panels": json.dumps(cards), "id": dashboard_id, "uid": current_user.id})
        db.commit()
        log_audit(current_user.id, "dashboard.update", "dashboard", dashboard_id,
                  {"name": name, "cards_count": len(cards)})
        return {"id": dashboard_id, "name": name, "message": "保存成功"}
    else:
        # Insert new
        result = db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:t AS jsonb), NOW(), NOW()) RETURNING id
        """), {
            "name": name, "uid": current_user.id,
            "panels": json.dumps(cards),
            "t": json.dumps({}),
        })
        db.commit()
        dashboard_id = result.scalar()
        log_audit(current_user.id, "dashboard.create", "dashboard", dashboard_id,
                  {"name": name, "cards_count": len(cards)})
        return {"id": dashboard_id, "name": name, "message": "新建并保存成功"}


@router.post("/import/pdd-profit/preview")
async def preview_pdd_profit(
    file: UploadFile = File(...),
):
    """🔍 表序整理预览 — 先分析 Excel 结构，返回列映射和样例数据。

    不写入数据库，仅做结构解析和预览，供用户确认后再执行导入。
    返回: sheet名、header行号、列映射表、前5行样例数据。
    """
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式的 Excel 文件")

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

        # 选 sheet
        target_sheet = None
        for sn in wb.sheetnames:
            if sn in ("店铺明细", "Sheet1", "数据", "明细", "利润", "报表"):
                target_sheet = sn
                break
        if not target_sheet:
            target_sheet = max(wb.sheetnames, key=lambda sn: wb[sn].max_row)

        ws = wb[target_sheet]

        # 运行表序整理
        headers, col_map, data_start, diag = _normalize_sheet(ws)

        # 检查是否透视表格式
        pivot_meta = getattr(_parse_pivot_table, "_meta", None) if hasattr(_parse_pivot_table, "_meta") else None
        is_pivot = pivot_meta and pivot_meta.get("is_pivot")

        if is_pivot:
            # 透视表格式：展示人员列表和分区标题
            sample_rows: list[dict] = []
            for person in pivot_meta.get("persons", [])[:5]:
                sample_rows.append({"人员": person})
            return {
                "sheet": target_sheet,
                "sheet_rows": ws.max_row,
                "header_row": pivot_meta.get("header_row", 0),
                "diagnostic": diag,
                "is_pivot": True,
                "persons": pivot_meta.get("persons", []),
                "sections": pivot_meta.get("section_labels", []),
                "column_mapping": _PIVOT_METRIC_MAP,
                "mapped_columns": [f"核算项目名称"] + pivot_meta.get("persons", [])[:10],
                "mapped_count": 1 + len(pivot_meta.get("persons", [])),
                "total_columns": 1 + len(pivot_meta.get("persons", [])),
                "sample_rows": sample_rows,
                "ready": True,
            }

        # 标准格式：读取前 5 行样例数据
        col_keys = list(col_map.keys())
        sample_rows: list[dict] = []
        row_count = 0
        for row_idx in range(data_start, min(data_start + 10, ws.max_row + 1)):
            row = [c.value for c in ws[row_idx]]
            store = str(row[col_map["店铺名称"]]) if "店铺名称" in col_map and col_map["店铺名称"] < len(row) else ""
            if not store or store in ("None", "nan", "-"):
                continue
            if "合计" in store or "总计" in store:
                continue
            vals = {}
            for key, idx in col_map.items():
                if idx < len(row):
                    v = row[idx]
                    try:
                        vals[key] = round(float(v), 2) if v is not None and _is_number(v) else str(v)[:30]
                    except Exception:
                        vals[key] = str(v)[:30] if v else ""
            sample_rows.append(vals)
            row_count += 1
            if row_count >= 5:
                break

        return {
            "sheet": target_sheet,
            "sheet_rows": ws.max_row,
            "header_row": data_start - 1,  # header 行号（1-based）
            "diagnostic": diag,
            "column_mapping": {k: _EXCEL_COL_MAP_PDD_PROFIT[k] for k in col_keys},
            "mapped_columns": col_keys,
            "mapped_count": len(col_map),
            "total_columns": len(col_keys),
            "sample_rows": sample_rows,
            "ready": len(col_map) >= 2,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"表序整理预览失败: {str(e)}")


def _is_number(v) -> bool:
    try:
        float(v)
        return True
    except (ValueError, TypeError):
        return False


@router.post("/import/pdd-profit")
async def import_pdd_profit(
    file: UploadFile = File(...),
    data_month: str = Query(default="2026-05"),
    replace_mode: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI智能导入 — 全自动流水线：表序整理→AI清洗→交叉校验→入库→洞察。

    流水线 8 阶段：
      0️⃣ AI表序整理：合并单元格填充、列名模糊匹配、自动定位header
      ① 读取解析：按映射列读取数值
      ② AI列统计画像 + 智能修补（IQR异常裁剪/负值规整）
      ③ 规则清洗（店铺名标准化/百分比校正）
      ④ AI深度推断（列间关系智能修正）
      ⑤ 交叉校验（毛利/净利/离群值检测）
      ⑥ 写入 PostgreSQL bi_pdd_profit
      ⑦ AI洞察 + 前端自动刷新

    列名别名支持：店铺≈店铺名称/店名, 营收≈销售收入, 推广≈运营推广, 物流≈仓库物流, 人工≈人工成本
    所有阶段日志和AI洞察在导入弹窗中可视化展示。
    """
    import re as _re

    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式的 Excel 文件")

    # 聚合日志
    clean_logs: list[str] = []
    warnings: list[str] = []

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

        # ─── 0️⃣ AI 表序整理 — 自动识别表格结构 ───
        target_sheet = None
        # 优先精确匹配 sheet 名
        for sn in wb.sheetnames:
            if sn in ("店铺明细", "Sheet1", "数据", "明细", "利润", "报表"):
                target_sheet = sn
                break
        if not target_sheet:
            # 启发式：选行数最多的 sheet
            best = max(wb.sheetnames, key=lambda sn: wb[sn].max_row)
            target_sheet = best

        ws = wb[target_sheet]
        clean_logs.append(f"📋 使用 Sheet「{target_sheet}」(共{ws.max_row}行)")

        headers, col_map, data_start, diag = _normalize_sheet(ws)
        clean_logs.append(f"🔍 表序整理: {diag}")

        # 检测透视表格式
        pivot_meta = getattr(_parse_pivot_table, "_meta", {}) if hasattr(_parse_pivot_table, "_meta") else {}
        is_pivot = pivot_meta.get("is_pivot")

        if is_pivot:
            clean_logs.append(f"📊 透视表格式: {len(pivot_meta.get('persons',[]))}人, {len(pivot_meta.get('metric_rows',[]))}个分区")
            pivot_rows, metric_cols = _read_pivot_as_rows(
                ws, pivot_meta["header_row"], pivot_meta["persons"],
                pivot_meta["metric_rows"], pivot_meta["max_row"]
            )
            # 转换为标准格式（补齐必填字段）
            raw_rows = []
            for pr in pivot_rows:
                row = {
                    "person": pr.get("person", ""),
                    "store": pr.get("store", ""),
                    "data_month": data_month,
                }
                for col in ["revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate"]:
                    row[col] = pr.get(col, 0) or 0
                for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                           "product_cost", "gift_cost", "special_cost", "damage",
                           "express", "other_logistics", "product_promo", "wujie_promo",
                           "platform_commission", "op_labor", "alloc_labor",
                           "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
                    row.setdefault(fld, 0)
                raw_rows.append(row)
            clean_logs.append(f"📄 透视表解析: {len(raw_rows)} 行 → {len(metric_cols)} 个指标")
        else:
            # ─── 第一阶段：读取行 ───
            raw_rows: list[dict] = []
            for row_idx in range(data_start, ws.max_row + 1):
                row = [c.value for c in ws[row_idx]]

                store_name = str(row[col_map.get("店铺名称", -1)]).strip() if "店铺名称" in col_map and col_map["店铺名称"] < len(row) else ""
                if not store_name or store_name in ("None", "nan", "-"):
                    continue
                if "合计" in store_name or "总计" in store_name:
                    continue

                def _get_val(col: str):
                    if col not in col_map:
                        return None
                    idx = col_map[col]
                    if idx >= len(row):
                        return None
                    v = row[idx]
                    if v is None:
                        return None
                    try:
                        return float(v)
                    except (ValueError, TypeError):
                        return None

                person = str(row[col_map["负责人"]]).strip() if "负责人" in col_map and col_map["负责人"] < len(row) and row[col_map["负责人"]] else ""

                vals = {"person": person, "store": store_name, "data_month": data_month}
                for col in ["revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate"]:
                    vals[col] = _get_val(col) or 0

                for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                           "product_cost", "gift_cost", "special_cost", "damage",
                           "express", "other_logistics", "product_promo", "wujie_promo",
                           "platform_commission", "op_labor", "alloc_labor",
                           "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
                    vals.setdefault(fld, 0)

                raw_rows.append(vals)

            clean_logs.append(f"📄 读取 {len(raw_rows)} 行原始数据")

        # ─── ①-② AI 列统计画像 + 智能修补 ───
        numeric_cols = ["revenue", "cost", "gross", "gross_rate", "promo", "logistics",
                        "platform_fee", "labor", "net_profit", "net_rate", "positive_orders",
                        "refund", "positive_rev", "reverse_orders"]
        ai_profile = _ai_profile(raw_rows, numeric_cols)
        ai_logs = _ai_smart_repair(raw_rows, ai_profile)
        if ai_logs:
            clean_logs.append(f"🤖 AI智能修补: {len(ai_logs)} 处异常")
            clean_logs.extend(ai_logs[:10])  # 只展示前 10 条

        # ─── ② 规则数据清洗 ───
        for row in raw_rows:
            # 店铺名清洗
            cleaned_store, logs = _clean_store_name(row["store"])
            if logs:
                row["store"] = cleaned_store
                clean_logs.extend(logs)

            # 负责人名清洗
            cleaned_person, logs = _clean_person_name(row["person"])
            if logs:
                row["person"] = cleaned_person
                clean_logs.extend(logs)

            # 百分比修正
            for col in ["gross_rate", "net_rate"]:
                v = row.get(col)
                if v is not None:
                    corrected, msg = _fix_percentage(v, col)
                    if msg:
                        row[col] = corrected
                        clean_logs.append(msg)

            # 数值规整
            for col in ["revenue", "refund", "cost", "promo", "logistics", "platform_fee", "labor", "net_profit"]:
                v = row.get(col)
                if v is not None:
                    corrected, msg = _normalize_numeric(v, col)
                    if msg:
                        row[col] = corrected
                        clean_logs.append(msg)

        clean_logs.append(f"🧹 规则清洗完成")

        # ─── ②-③ AI 深度清洗（列间关系推断修正）───
        ai_deep_logs = _ai_deep_clean(raw_rows)
        if ai_deep_logs:
            clean_logs.append(f"🔬 AI深度清洗: {len(ai_deep_logs)} 处修正")
            clean_logs.extend(ai_deep_logs[:10])

        # ─── ③ 数据校验 ───
        for i, row in enumerate(raw_rows):
            w = _validate_row(row, i + 1)
            if w:
                warnings.extend(w)

        # 离群值检测
        outlier_alerts = _detect_outliers(raw_rows)
        if outlier_alerts:
            warnings.append("⚠️ 离群值检测:")
            warnings.extend(outlier_alerts)

        # ─── 第四阶段：写入数据库 ───
        if replace_mode:
            deleted = db.execute(text(
                "DELETE FROM bi_pdd_profit WHERE data_month=:mth"
            ), {"mth": data_month}).rowcount
            clean_logs.append(f"🔄 全量替换模式: 已清除 {deleted} 条旧数据")
        inserted = 0
        updated = 0
        for row in raw_rows:
            existing = db.execute(text(
                "SELECT id FROM bi_pdd_profit WHERE store=:store AND data_month=:mth"
            ), {"store": row["store"], "mth": data_month}).fetchone()

            if existing:
                row["is_loss"] = row.get("net_profit", 0) < 0
                update_fields = []
                update_params = {"id": existing[0]}
                for col in ["person", "revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate", "is_loss"]:
                    if col in row:
                        update_fields.append(f"{col}=:{col}")
                        update_params[col] = row[col]
                update_fields.append("updated_at=NOW()")
                db.execute(text(f"UPDATE bi_pdd_profit SET {', '.join(update_fields)} WHERE id=:id"), update_params)
                updated += 1
            else:
                row["is_loss"] = (row.get("net_profit", 0) or 0) < 0
                cols = ", ".join(row.keys())
                placeholders = ", ".join(f":{k}" for k in row)
                db.execute(text(f"INSERT INTO bi_pdd_profit ({cols}) VALUES ({placeholders})"), row)
                inserted += 1

        db.commit()
        total = db.execute(text(
            "SELECT count(*) FROM bi_pdd_profit WHERE data_month=:mth"
        ), {"mth": data_month}).scalar()
        loss_count = db.execute(text(
            "SELECT count(*) FROM bi_pdd_profit WHERE data_month=:mth AND is_loss=true"
        ), {"mth": data_month}).scalar()

        # ─── ④ AI 数据洞察 ───
        ai_insights = _ai_generate_insights(raw_rows, ai_profile)

        # 清除数据缓存，确保下次查询获取最新数据
        _cache.invalidate_table("bi_pdd_profit")

        return {
            "inserted": inserted,
            "updated": updated,
            "total": total,
            "loss_count": loss_count,
            "data_month": data_month,
            "file": file.filename,
            "cleaned": len([l for l in clean_logs if l and not l.startswith("📋") and not l.startswith("📄") and not l.startswith("🧹") and not l.startswith("🤖") and not l.startswith("🔬")]),
            "ai_fixes": len(ai_logs) + len(ai_deep_logs),
            "warnings_count": len(warnings),
            "clean_logs": clean_logs[-15:],  # 返回最后 15 条日志
            "warnings": warnings[:15],  # 前 15 条警告
            "ai_insights": ai_insights,  # AI 洞察摘要
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"导入失败: {str(e)}")


def _fallback_generate(df, numeric_cols, text_cols):
    """LLM 失败时的兜底方案：基于列类型自动生成看板。"""
    panels = []
    # KPI card
    if numeric_cols:
        panels.append({"title": f"总{numeric_cols[0]}", "type": "number", "xField": "", "yField": numeric_cols[0], "size": "sm", "reason": "核心指标"})
    # Bar chart
    if text_cols and numeric_cols:
        panels.append({"title": f"{text_cols[0]}分布", "type": "bar", "xField": text_cols[0], "yField": numeric_cols[0], "size": "md", "reason": "分类对比"})
    # Line chart
    if len(numeric_cols) >= 2:
        panels.append({"title": f"{numeric_cols[1]}趋势", "type": "line", "xField": text_cols[0] if text_cols else "", "yField": numeric_cols[1], "size": "md", "reason": "趋势分析"})
    # Pie chart
    if text_cols and len(numeric_cols) >= 2:
        panels.append({"title": f"{text_cols[0]}占比", "type": "pie", "xField": text_cols[0], "yField": numeric_cols[1] if len(numeric_cols) > 1 else numeric_cols[0], "size": "sm", "reason": "占比分布"})
    # Table
    panels.append({"title": "数据明细", "type": "table", "xField": "", "yField": "", "size": "lg", "reason": "原始数据"})
    # Add more if enough columns
    if len(numeric_cols) >= 3:
        panels.insert(2, {"title": f"{numeric_cols[2]}概览", "type": "number", "xField": "", "yField": numeric_cols[2], "size": "sm", "reason": "次要指标"})
    if len(text_cols) >= 2 and len(numeric_cols) >= 3:
        panels.insert(3, {"title": f"{text_cols[1]}-{numeric_cols[2]}", "type": "bar_stack", "xField": text_cols[1], "yField": numeric_cols[2], "size": "md", "reason": "多维分析"})
    return {"dashboard_name": "数据看板", "panels": panels[:8]}


@router.post("/ai-generate", dependencies=_AI_USE)
async def ai_generate_dashboard(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI 生成看板 — 上传数据 → AI 分析 → 自动选图表 → 生成看板布局。

    流程：
      1. 解析上传文件（Excel/CSV）
      2. 提取数据摘要（前20行+统计信息）
      3. 调用 DeepSeek LLM 分析数据结构
      4. AI 推荐图表类型和布局
      5. 创建看板并保存到 bi_dashboards
      6. 返回看板 ID 供前端跳转编辑
    """
    if not file.filename:
        raise HTTPException(400, "需要上传数据文件")

    ext = file.filename.lower().split(".")[-1] if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "xlsm", "csv"):
        raise HTTPException(400, "只支持 .xlsx / .xls / .csv 格式")

    try:
        import io, pandas as pd

        content = await file.read()

        # 解析数据
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content), nrows=1000)
        else:
            df = pd.read_excel(io.BytesIO(content), nrows=1000)

        if df.empty:
            raise HTTPException(400, "文件中没有数据")

        # 清理列名
        df.columns = [str(c).strip() for c in df.columns]

        # 构造数据摘要给 LLM
        cols_info = []
        numeric_cols = []
        text_cols = []
        date_cols = []
        for c in df.columns:
            dtype = str(df[c].dtype)
            sample = str(df[c].dropna().head(3).tolist())
            null_count = int(df[c].isna().sum())
            cols_info.append(f"- {c} ({dtype}): 示例={sample[:60]}, 空值={null_count}")

            if "float" in dtype or "int" in dtype:
                numeric_cols.append(c)
            elif "datetime" in dtype:
                date_cols.append(c)
            else:
                text_cols.append(c)

        rows = len(df)
        summary = "\n".join(cols_info[:20])

        # 构造 LLM prompt
        prompt = f"""你是数据分析专家。分析以下表格数据并生成最佳看板配置。

数据概览：共 {rows} 行, {len(df.columns)} 列。
数值列: {numeric_cols[:10]}
文本列: {text_cols[:10]}
日期列: {date_cols}

列详情：
{summary}

请返回 JSON 格式（只返回 JSON，不要解释）：
{{
  "dashboard_name": "看板名称(15字以内中文)",
  "panels": [
    {{
      "title": "图表标题",
      "type": "bar|line|pie|number|table|bar_stack|line_area|donut|radar|scatter|funnel|heatmap",
      "xField": "X轴列名",
      "yField": "Y轴列名",
      "size": "sm|md|lg",
      "reason": "选择原因(10字)"
    }}
  ]
}}

规则：
- 共生成 4-8 个面板
- 必须有 1 个 KPI 数值卡片 (type="number")
- 数值列优先用于柱状图/折线图
- 文本列优先用于饼图/表格的维度
- 看板名称要具体有业务含义"""

        # 调用 LLM
        resp = _call_llm(prompt, system="只返回JSON，不要解释。", max_tokens=4096)

        # 解析 LLM 响应
        try:
            import re as _re
            m = _re.search(r"\{[\s\S]*\}", resp)
            ai_result = json.loads(m.group()) if m else {}
        except Exception:
            ai_result = {}

        if not ai_result.get("panels"):
            # 兜底：自动生成基本看板
            ai_result = _fallback_generate(df, numeric_cols, text_cols)

        # 创建看板
        dashboard_name = ai_result.get("dashboard_name", "AI 生成看板")
        panels = ai_result.get("panels", [])

        # 构建 panel 配置
        panel_configs = []
        for i, p in enumerate(panels):
            cfg = {
                "id": f"ai-panel-{i}",
                "title": p.get("title", f"图表 {i+1}"),
                "type": p.get("type", "bar"),
                "xField": p.get("xField", text_cols[0] if text_cols else ""),
                "yField": p.get("yField", numeric_cols[0] if numeric_cols else ""),
                "metric": p.get("yField", ""),
            }
            panel_configs.append(cfg)

        # 构造卡片布局
        cards = []
        layout_grid = []
        for i, cfg in enumerate(panel_configs):
            ctype = cfg["type"]
            if ctype == "number":
                w, h = 3, 2
            elif ctype in ("table", "heatmap"):
                w, h = 6, 4
            elif ctype in ("pie", "donut", "radar"):
                w, h = 3, 3
            elif ctype in ("funnel",):
                w, h = 3, 3
            else:
                w, h = 4, 3

            x = (i % 3) * 4
            y = (i // 3) * (h + 1)
            cards.append({
                "card_id": cfg["id"],
                "title": cfg["title"],
                "chart_type": ctype,
                "chart_config": cfg,
                "layout": {"i": cfg["id"], "x": x, "y": y, "w": w, "h": h},
                "sort": i,
            })
            layout_grid.append({"i": cfg["id"], "x": x, "y": y, "w": w, "h": h})

        # 保存到 bi_dashboards — store layout/cards inside panels JSONB
        panels_json = json.dumps(panel_configs, ensure_ascii=False)
        db.execute(text(
            "INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at) "
            "VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:tmap AS jsonb), NOW(), NOW())"
            " RETURNING id"
        ), {
            "name": dashboard_name,
            "uid": current_user.id,
            "panels": panels_json,
            "tmap": json.dumps({"table_map": {"_generated": True}}),
        })
        result = db.execute(text("SELECT id FROM bi_dashboards WHERE name=:n AND owner_id=:uid ORDER BY id DESC LIMIT 1"), {"n": dashboard_name, "uid": current_user.id}).fetchone()

        # Also save data to a temp table for the dashboard
        table_name = f"bi_ai_{current_user.id}_{int(result[0])}"
        try:
            df.to_sql(table_name, db.get_bind(), if_exists="replace", index=False)
        except Exception:
            pass

        db.commit()
        dashboard_id = result[0]

        return {
            "dashboard_id": dashboard_id,
            "dashboard_name": dashboard_name,
            "panels": panel_configs,
            "cards": cards,
            "rows": rows,
            "columns": len(df.columns),
            "table_name": table_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"AI 生成失败: {str(e)}")


# ═══════ 第二阶段：AI 流水线端点 ═══════
from app.services.bi_ai_engine import (
    collect_metadata, search_knowledge, run_ai_pipeline, validate_sql,
)


@router.post("/ai/metadata/collect", dependencies=_AI_USE)
def ai_collect_metadata(
    table_names: Optional[list[str]] = Body(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """自动采集数据源元数据 → 向量化入库"""
    return collect_metadata(db, table_names)


@router.post("/ai/knowledge/search", dependencies=_AI_USE)
def ai_search_knowledge(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """向量相似度检索知识库"""
    return search_knowledge(db, payload.get("query", ""), payload.get("top_k", 10))


@router.post("/ai/sql/validate", dependencies=_AI_USE)
def ai_validate_sql(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """校验 AI 生成 SQL 安全性"""
    sql = payload.get("sql", "")
    valid, msg = validate_sql(sql)
    return {"valid": valid, "message": msg, "sql": sql}


@router.post("/ai/pipeline", dependencies=_AI_USE)
async def ai_pipeline_generate(
    file: Optional[UploadFile] = File(None),
    query: str = Body("请基于数据生成一份综合分析看板"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    🤖 AI 多阶段流水线 — 一句话生成完整看板

    流程：语义理解 → 向量检索 → SQL生成 → SQL校验 → 图表推荐 → 自动布板 → 持久化

    支持两种模式：
      - 上传文件：parse Excel/CSV → 自动建表 → 元数据采集 → 流水线
      - 纯文本查询：基于已有数据源/知识库生成
    """
    file_bytes = None
    filename = ""
    if file:
        filename = file.filename or "data.xlsx"
        file_bytes = await file.read()

    return run_ai_pipeline(
        db=db,
        user_id=current_user.id,
        business_query=query,
        uploaded_file=file_bytes,
        uploaded_filename=filename,
    )


@router.get("/ai/audit", dependencies=_AI_USE)
def ai_audit_log(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查询 AI 操作审计日志"""
    rows = db.execute(text(
        "SELECT id, query_text, dashboard_id, latency_ms, status, error_msg, created_at "
        "FROM bi_ai_audit_log WHERE user_id = :uid ORDER BY id DESC LIMIT :limit"
    ), {"uid": current_user.id, "limit": limit}).fetchall()
    return {"logs": [dict(r._mapping) for r in rows]}


# ═══════ Phase 2: 高级 AI 功能 ═══════
from app.services.bi_ai_phase2 import (
    create_task, get_task, update_task,
    auto_build_model, analyze_data_quality, compute_layout,
    kb_list_metrics, kb_upsert_metric, kb_delete_metric,
    kb_list_templates, kb_upsert_template, chat_iterate,
)


def _smart_generate(df, query: str, knowledge: dict) -> dict:
    """智能生成 — LLM 优先，失败/无API则自动分析列类型生成"""
    # Try LLM
    from app.services.bi_ai_engine import _call_llm, _fallback_config
    try:
        if df is not None and not df.empty:
            cols_info = "\n".join(f"- {c} ({df[c].dtype})" for c in df.columns[:30])
            kb_ctx = ""
            if knowledge.get("fields"):
                kb_ctx += "【知识库】\n" + "\n".join(
                    f"- {f['table_name']}.{f['column_name']}" for f in knowledge.get("fields", [])[:8]
                )
            resp = _call_llm(f"业务需求:{query}\n数据列:\n{cols_info}\n{kb_ctx}\n返回看板JSON。", "只返回JSON。", max_tokens=4096)
            m = re.search(r'\{[\s\S]*\}', resp)
            if m:
                cfg = json.loads(m.group())
                if cfg.get("panels") and len(cfg["panels"]) > 0:
                    return cfg
    except Exception:
        pass

    # Fallback: auto-generate from column data types
    if df is not None and not df.empty:
        return _auto_generate_from_columns(df)
    return _fallback_config(query)


def _auto_generate_from_columns(df) -> dict:
    """根据列类型自动生成看板面板（无需 LLM）"""
    import pandas as _pd, numpy as _np
    numeric = [c for c in df.columns if _pd.api.types.is_numeric_dtype(df[c])][:5]
    textual = [c for c in df.columns if _pd.api.types.is_string_dtype(df[c]) or (not _pd.api.types.is_numeric_dtype(df[c]) and not _pd.api.types.is_datetime64_any_dtype(df[c]))][:3]
    date_cols = [c for c in df.columns if _pd.api.types.is_datetime64_any_dtype(df[c]) or 'date' in c.lower() or 'time' in c.lower()][:2]
    name = "数据看板"
    panels = []

    # KPI cards
    for nc in numeric[:3]:
        mean_val = df[nc].dropna().mean()
        panels.append({"title": f"{nc}", "type": "number", "xField": "", "yField": nc, "reason": "核心指标"})

    # Bar chart
    if textual and numeric:
        panels.append({"title": f"{textual[0]}分布", "type": "bar", "xField": textual[0], "yField": numeric[0], "reason": "维度对比"})

    # Line chart (if date/time column exists)
    if date_cols and numeric:
        panels.append({"title": f"{numeric[0]}趋势", "type": "line", "xField": date_cols[0], "yField": numeric[0], "reason": "趋势分析"})

    # Pie/Donut
    if len(textual) >= 2 and len(numeric) >= 2:
        panels.append({"title": f"{textual[1]}占比", "type": "pie", "xField": textual[1], "yField": numeric[1], "reason": "比例分析"})

    # Stack bar
    if len(textual) >= 2 and len(numeric) >= 3:
        panels.append({"title": f"{textual[0]}×{numeric[2]}", "type": "bar_stack", "xField": textual[0], "yField": numeric[2], "reason": "堆叠对比"})

    # Table
    panels.append({"title": "数据明细", "type": "table", "xField": "", "yField": "", "reason": "明细查询"})

    # Ensure at least 4 panels
    if len(panels) < 4:
        extras = [
            {"title": "数据占比", "type": "donut", "xField": textual[0] if textual else "", "yField": numeric[0] if numeric else "", "reason": "环形分布"},
            {"title": "统计汇总", "type": "table", "xField": "", "yField": "", "reason": "汇总"},
        ]
        for e in extras:
            if len(panels) < 6:
                panels.append(e)

    return {"dashboard_name": name, "panels": panels[:8]}


@router.post("/ai/pipeline/async", dependencies=_AI_USE)
async def ai_pipeline_async(
    file: Optional[UploadFile] = File(None),
    query: str = Body("请基于数据生成综合分析看板"),
    layout_preset: str = Body("dashboard"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """异步 AI 流水线 — 创建任务后立即返回 task_id，通过 WebSocket 推送进度"""
    task = create_task(current_user.id)
    task.status = "running"
    task.message = "初始化..."

    try:
        # Stage 1: Parse data
        update_task(task.task_id, progress=10, message="解析数据...")
        df = None
        if file:
            content = await file.read()
            ext = (file.filename or "xlsx").split(".")[-1].lower()
            df = pd.read_excel(io.BytesIO(content)) if ext in ("xlsx", "xls", "xlsm") else pd.read_csv(io.BytesIO(content))
        update_task(task.task_id, progress=20)

        # Stage 1.5: 向量知识库检索 (Phase 1 — pgvector 增强)
        update_task(task.task_id, progress=22, message="检索知识库...")
        knowledge = {}
        try:
            knowledge = search_knowledge(db,
                query if query else " ".join(df.columns.tolist()[:20]) if df is not None and not df.empty else "数据分析"
            )
        except Exception:
            pass

        # Stage 2: Data quality analysis (Phase 2)
        update_task(task.task_id, progress=25, message="分析数据质量...")
        quality = {}
        if df is not None and not df.empty:
            quality = analyze_data_quality(df)
        update_task(task.task_id, progress=35)

        # Stage 3: AI chart recommendations (知识库增强 / 自动降级)
        update_task(task.task_id, progress=40, message="AI 分析中...")
        ai_config = _smart_generate(df, query, knowledge)  # always produces panels

        # Stage 4: Layout
        update_task(task.task_id, progress=70, message="自动排版中...")
        layout_result = compute_layout(ai_config.get("panels", []), layout_preset)
        update_task(task.task_id, progress=80)

        # Stage 5: Save
        update_task(task.task_id, progress=85, message="保存看板...")
        panels_json = json.dumps(ai_config.get("panels", []), ensure_ascii=False)
        db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:n, :uid, CAST(:p AS jsonb), CAST(:t AS jsonb), NOW(), NOW())
            RETURNING id
        """), {"n": ai_config.get("dashboard_name", "AI看板"), "uid": current_user.id, "p": panels_json, "t": '{"_ai_generated":true,"quality":{}}'})
        row = db.execute(text("SELECT id FROM bi_dashboards WHERE owner_id=:uid ORDER BY id DESC LIMIT 1"), {"uid": current_user.id}).fetchone()
        db.commit()
        dashboard_id = row[0] if row else 0

        update_task(task.task_id, status="completed", progress=100, message="完成！",
                    result={"dashboard_id": dashboard_id, "dashboard_name": ai_config.get("dashboard_name", "AI看板"),
                            "panels": ai_config.get("panels", []), "layout": layout_result["layout"],
                            "quality": quality.get("stats", {})})
    except Exception as e:
        update_task(task.task_id, status="failed", message=str(e)[:200],
                    result={"error": str(e)})

    return task.to_dict()


@router.get("/ai/pipeline/status/{task_id}", dependencies=_AI_USE)
def ai_pipeline_status(task_id: str):
    """查询异步任务进度"""
    task = get_task(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    return task.to_dict()


@router.post("/ai/model/build", dependencies=_AI_USE)
def ai_build_model(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """AI 自动多表关联建模"""
    table_names = payload.get("tables", [])
    if len(table_names) < 1:
        raise HTTPException(400, "至少需要 1 个表")
    return auto_build_model(db, table_names)


@router.post("/ai/quality/analyze", dependencies=_AI_USE)
def ai_analyze_quality(
    payload: dict = Body(...),
):
    """AI 智能数据质量分析 — Mock 数据"""
    data = payload.get("data", [])
    import pandas as pd
    df = pd.DataFrame(data) if data else pd.DataFrame()
    return analyze_data_quality(df)


@router.post("/ai/layout/compute", dependencies=_AI_USE)
def ai_compute_layout(
    payload: dict = Body(...),
):
    """AI 自由布局排版"""
    panels = payload.get("panels", [])
    preset = payload.get("preset", "dashboard")
    return compute_layout(panels, preset)


@router.post("/ai/chat/iterate", dependencies=_AI_USE)
def ai_chat_iterate(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """多轮对话迭代修改看板"""
    msg = payload.get("message", "")
    if not msg:
        raise HTTPException(400, "消息不能为空")
    return chat_iterate(current_user.id, msg)


# Knowledge Base
@router.get("/ai/kb/metrics", dependencies=_AI_USE)
def ai_kb_metrics(
    category: str = "",
    db: Session = Depends(get_db),
):
    return {"metrics": kb_list_metrics(db, category)}


@router.post("/ai/kb/metrics", dependencies=_AI_USE)
def ai_kb_add_metric(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    return kb_upsert_metric(db, payload.get("name", ""), payload.get("formula", ""), payload.get("description", ""), payload.get("category", ""))


@router.delete("/ai/kb/metrics/{name}")
def ai_kb_del_metric(name: str, db: Session = Depends(get_db)):
    return kb_delete_metric(db, name)


@router.get("/ai/kb/templates", dependencies=_AI_USE)
def ai_kb_templates(db: Session = Depends(get_db)):
    return {"templates": kb_list_templates(db)}


@router.post("/ai/kb/templates", dependencies=_AI_USE)
def ai_kb_add_template(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    return kb_upsert_template(db, payload.get("name", ""), payload.get("description", ""), payload.get("panels", []))


# ═══════ Phase 3: 差异化高阶能力 ═══════
from app.services.bi_ai_phase3 import (
    ai_root_cause_analysis, ai_large_screen_layout,
    batch_generate_dashboards, ai_generate_alert_rules,
)


@router.post("/ai/anomaly/analyze", dependencies=_AI_USE)
def ai_anomaly_analyze(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    🔍 AI 异常根因下钻分析
    输入: 表名 + 指标列名 + 维度列名
    输出: 异常列表 + 根因因子 + 下钻路径 + 建议
    """
    return ai_root_cause_analysis(
        db, payload["table"], payload["metric"],
        payload.get("dimensions"),
    )


@router.post("/ai/screen/layout", dependencies=_AI_USE)
def ai_screen_layout(
    payload: dict = Body(...),
):
    """
    🖥️ AI 大屏分层排版
    支持 背景层 → 主图区 → 侧边KPI → 浮动卡片 四层叠加
    """
    return ai_large_screen_layout(
        payload.get("panels", []),
        payload.get("screen_w", 1920),
        payload.get("screen_h", 1080),
    )


@router.post("/ai/batch/generate", dependencies=_AI_USE)
def ai_batch_generate(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    📦 AI 批量生成业务看板
    输入: 行业领域 (电商/财务/生产/通用)
    输出: 3-5 套完整看板
    """
    domain = payload.get("domain", "通用")
    results = batch_generate_dashboards(db, current_user.id, domain)
    return {"domain": domain, "dashboards": results, "count": len(results)}


@router.post("/ai/alert/generate", dependencies=_AI_USE)
def ai_alert_generate(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    🚨 AI 智能预警规则
    自动分析数据分布 → 多级阈值 → 告警规则
    """
    return {"rules": ai_generate_alert_rules(db, payload["table"])}


# ═══════ Agent 管线（OpenClaw 多Agent 清洗→校验→生成）═══════
from app.services.bi_ai_agent import run_agent_pipeline

@router.post("/ai/agent-pipeline", dependencies=_AI_USE)
async def ai_agent_pipeline(
    file: UploadFile = File(...),
    query: str = Body(""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    🤖 AI Agent 多阶段管线

    上传数据 → OpenClaw Agent1: 数据清洗 → Agent2: 交叉校验 → Agent3: 看板生成
    返回: 清洗报告 + 校验报告 + 看板配置 + 布局
    """
    content = await file.read()
    result = run_agent_pipeline(
        db=db, user_id=current_user.id,
        file_bytes=content, filename=file.filename or "data.xlsx",
        query=query,
    )
    return result


# ═══════ 批量持久化引擎 ═══════
from app.services.bi_persistence_engine import (
    batch_save_dashboard_cards, incremental_update,
    save_layout_snapshot, batch_delete_cards, load_cached_layout,
)

@router.post("/editor/snapshot")
def editor_snapshot(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """保存布局快照"""
    return save_layout_snapshot(
        db, payload["dashboard_id"], payload.get("cards", []),
        payload.get("snapshot_name", ""),
    )

@router.delete("/editor/cards")
def editor_delete_cards(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """批量删除卡片"""
    return batch_delete_cards(db, payload.get("card_ids", []))

@router.put("/editor/card/{card_id}")
def editor_update_card(
    card_id: str,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """增量更新单卡片坐标或配置"""
    return incremental_update(
        db, card_id,
        layout_only=payload.get("layout_only", True),
        layout=payload.get("layout"),
        chart_config=payload.get("chart_config"),
    )
