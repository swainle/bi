"""数据库引擎与会话管理.

支持 SQLite（开发）和 PostgreSQL（生产）。
通过 DATABASE_URL 环境变量切换。
"""

import os

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings


class Base(DeclarativeBase):
    """SQLAlchemy 声明式基类."""
    pass


# ── 数据库 URL 判断 ──────────────────────────────────────────
_db_url = settings.database_url
_is_sqlite = _db_url.startswith("sqlite")

# ── 引擎参数 ─────────────────────────────────────────────────
_engine_kwargs = {"echo": getattr(settings, "db_echo", False)}

if _is_sqlite:
    # 确保 SQLite 数据目录存在
    data_dir = os.path.dirname(_db_url.replace("sqlite:///", ""))
    if data_dir and not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)
    _engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    # 历史无时区字段存的是 UTC，连接时区固定，避免部署环境改变写入含义。
    _engine_kwargs["connect_args"] = {"options": "-c timezone=UTC"}
    # PostgreSQL 企业级连接池配置（可环境变量调；多 worker 时记得按 worker 数对齐 PG 的 max_connections）
    def _env_int(name: str, default: int) -> int:
        try:
            return max(1, int(os.getenv(name, str(default)) or default))
        except ValueError:
            return default

    _engine_kwargs["pool_size"] = _env_int("DB_POOL_SIZE", 20)          # 基础连接数（每个进程）
    _engine_kwargs["max_overflow"] = _env_int("DB_MAX_OVERFLOW", 10)    # 高峰额外连接（总计最多 30）
    _engine_kwargs["pool_pre_ping"] = True       # 每次借出前检测连接可用性
    _engine_kwargs["pool_recycle"] = 1800        # 30 分钟后回收连接，防止 PG 断开
    _engine_kwargs["pool_timeout"] = _env_int("DB_POOL_TIMEOUT", 30)    # 等待连接超时，防并发 500
    _engine_kwargs["pool_use_lifo"] = True       # LIFO 复用最近连接，减少空闲数
    # 标记应用连接：安全监控据此区分「应用查询」与「外部直连会话」
    _engine_kwargs["connect_args"] = {"application_name": "mingcebi-api"}

engine = create_engine(_db_url, **_engine_kwargs)


if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
        """启用 SQLite WAL 模式和外键约束."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


# ── 会话工厂 ─────────────────────────────────────────────────
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI 依赖：获取数据库会话."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── 慢查询日志 + 连接池监控 ──────────────────────────────────
import logging
import time as _time

_slow_log = logging.getLogger("sqlalchemy.slow")
_pool_log = logging.getLogger("sqlalchemy.pool")

try:
    _SLOW_QUERY_MS = max(0, int(os.getenv("DB_SLOW_QUERY_MS", "500") or "500"))
except ValueError:
    _SLOW_QUERY_MS = 500

@event.listens_for(engine, "before_cursor_execute")
def _before_exec(conn, cursor, statement, parameters, context, executemany):
    # 每条语句都覆盖起点：请求中途被取消（客户端断开）时 after_cursor_execute 不会执行，
    # 用 setdefault 会把旧起点留到下一次语句，日志里就会出现假的 600s / 784s「慢查询」。
    conn.info["_start"] = _time.time()

@event.listens_for(engine, "after_cursor_execute")
def _after_exec(conn, cursor, statement, parameters, context, executemany):
    start = conn.info.pop("_start", None)
    if start is None:
        return
    elapsed = _time.time() - start
    if _SLOW_QUERY_MS > 0 and elapsed * 1000 > _SLOW_QUERY_MS:  # 慢查询告警阈值可调
        _slow_log.warning(f"SLOW QUERY ({elapsed:.2f}s): {statement[:200]}")


# ── 连接池溢出告警 ───────────────────────────────────────────
@event.listens_for(engine, "checkout")
def _on_checkout(dbapi_connection, connection_record, connection_proxy):
    """连接池使用率超 80% 时告警."""
    pool = engine.pool  # type: ignore[attr-defined]
    size = pool.size()
    checked_out = pool.checkedout()
    if size > 0 and checked_out / size > 0.8:
        _pool_log.warning(
            f"POOL HIGH USAGE: {checked_out}/{size} connections in use "
            f"(overflow: {pool.overflow()})"
        )


def get_pool_status() -> dict:
    """获取连接池状态 — 供 /api/health 或监控端点调用."""
    pool = engine.pool  # type: ignore[attr-defined]
    return {
        "pool_size": pool.size(),
        "checked_in": pool.checkedin(),
        "checked_out": pool.checkedout(),
        "overflow": pool.overflow(),
        "utilization_pct": round(pool.checkedout() / max(pool.size(), 1) * 100, 1),
    }
