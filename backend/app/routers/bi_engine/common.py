"""BI 引擎公共件：读库会话、SQL 校验、渲染缓存、刷新线程、脱敏与 LLM 调用。"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
import hashlib
from app.admin.permissions import require
import os as _os
import re as _re
import time as _time
import threading
from app.query.whitelist import ALLOWED_TABLES
from app.security.masking import apply_masks as _mask_impl

# AI 端点统一鉴权（S0）：登录 + 权限码；此前多数端点匿名可调用
_AI_USE = [Depends(require("bi:ai:use", "没有 AI 使用权限，请联系管理员开通"))]


_AI_SQL = [Depends(require("bi:ai:sql", "没有 AI 生成 SQL 的权限，请联系管理员开通"))]


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


def _validate_col(col: str):
    if not _re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', col):
        raise HTTPException(400, f"非法列名: {col}")


# 查询构建器的 SQL 片段白名单：聚合 / JOIN / 排序 / 行数都只接受结构化输入，
# 不再把用户字符串原样拼进 SQL（2026-11-14 安全模拟：order_by / join.on / agg / limit 均可注入）。
_AGGREGATES = {"SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"}


_JOIN_TYPES = {"INNER", "LEFT", "RIGHT", "FULL", "CROSS"}


_IDENT = r"[A-Za-z_][A-Za-z0-9_]*"


_ORDER_ITEM = _re.compile(rf"^({_IDENT})(?:\s+(ASC|DESC))?$", _re.IGNORECASE)


_JOIN_SIDE = rf"{_IDENT}(?:\.{_IDENT})?"


def _validate_agg(agg) -> str:
    value = str(agg or "").strip().upper()
    if value not in _AGGREGATES:
        raise HTTPException(400, f"不支持的聚合方式: {agg}")
    return value


def _validate_limit(limit) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        raise HTTPException(400, "limit 必须是整数")
    if value < 1 or value > 5000:
        raise HTTPException(400, "limit 需在 1~5000 之间")
    return value


def _order_clause(order_by) -> str:
    text = str(order_by or "").strip()
    if not text:
        return ""
    parts = []
    for chunk in text.split(","):
        piece = chunk.strip()
        matched = _ORDER_ITEM.match(piece)
        if not matched:
            raise HTTPException(400, f"非法排序条件: {piece}")
        parts.append(f'"{matched.group(1)}"'
                     + (f" {matched.group(2).upper()}" if matched.group(2) else ""))
    return "ORDER BY " + ", ".join(parts)


def _validate_join_on(on) -> str:
    text = str(on or "").strip()
    if not text:
        raise HTTPException(400, "JOIN 缺少 ON 条件")
    parts = []
    for cond in _re.split(r"\s+AND\s+", text, flags=_re.IGNORECASE):
        matched = _re.match(rf"^\s*({_JOIN_SIDE})\s*=\s*({_JOIN_SIDE})\s*$", cond)
        if not matched:
            raise HTTPException(400, f"非法 JOIN 条件: {cond.strip()[:80]}")
        parts.append(f"{matched.group(1)} = {matched.group(2)}")
    return " AND ".join(parts)


# 查询构建器允许的筛选运算符（白名单，值一律走绑定参数）
_FILTER_OPS = {
    "=", "!=", "<>", ">", "<", ">=", "<=",
    "IN", "NOT IN", "BETWEEN", "LIKE", "ILIKE",
}


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


def _cache_key(table: str, limit: int = 500, offset: int = 0, func: str = "", rls: str = "-") -> str:
    """缓存键 —— 必须带行级规则指纹，否则会跨用户串数据。"""
    raw = f"{table}:{limit}:{offset}:{func}:{rls}"
    return hashlib.md5(raw.encode()).hexdigest()


ACCEL_MAP = {tbl: f"{tbl}_agg" for tbl in ALLOWED_TABLES}


def _apply_masks(table: str, rows: list[dict], db: Session) -> list[dict]:
    """对查询结果自动应用列脱敏规则（委托安全内核，语义查询共用同一套）."""
    return _mask_impl(table, rows, db)


SYNC_STATE: dict = {}  # table → last_sync_at timestamp


def _call_llm(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    """统一走 ai_engine 的调用链（默认模型 → 其它启用模型 → 文件 → 环境变量）."""
    from app.services.bi_ai_engine import _call_llm as _call

    return _call(prompt, system, max_tokens)
