"""直连执行器（Superset 式 Live Query）.

与 `app/query/executor.py` 的区别只有一个：**SQL 在源库执行，而不是本地库**。

安全口径与抽取模式保持一致，缺一不可：
    1. 白名单：查询的表必须真实存在于该数据源（按源缓存，5 分钟）
    2. 行级权限：仍由 `security.rls` 生成 WHERE 条件拼进去（fail-closed）
    3. 列脱敏：结果集落到 BI 侧之后再脱敏（源库不参与）
    4. 只读：QueryObject 只能生成 SELECT；语句超时由驱动层限死

源库连接按「数据源 id + 连接串指纹」做进程内缓存，避免每次图表请求都新建连接池。
"""

from __future__ import annotations

import hashlib
import threading
import time
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from app.query.builder import build
from app.query.contract import QueryObject
from app.query.executor import QueryResult
from app.security.errors import RlsBlockedError
from app.security.masking import apply_masks
from app.security.rls import decide as rls_decide
from app.sources.repository import TYPE_DIALECT, SourceError, build_url

MAX_ROWS = 5000
STATEMENT_TIMEOUT_MS = 30000
_TABLE_CACHE_TTL = 300

# (source_id, 连接串指纹) → (engine, 建连时间)
_engines: dict[tuple[int, str], tuple[Engine, float]] = {}
_tables: dict[int, tuple[set[str], float]] = {}
_lock = threading.Lock()

# 直连结果缓存：(源 id, 用户 id, SQL, 参数) → (行, 列, 时间)
_CACHE_TTL = 60
_CACHE_MAX = 200
_cache: dict[tuple, tuple[list[dict], list[str], float]] = {}


def _cache_key(src_id: int, user_id: Any, sql: str, params: dict) -> tuple:
    import json

    try:
        p = json.dumps(params, sort_keys=True, default=str)
    except Exception:
        p = str(sorted(params.items()))
    return (src_id, user_id, sql, p)


def clear_cache() -> None:
    with _lock:
        _cache.clear()


class LiveQueryError(Exception):
    """直连查询失败（连不上 / 表不存在 / 超时 …）."""


def _src_row(src: dict) -> dict:
    return {
        "ds_type": src.get("ds_type"),
        "host": src.get("host"),
        "port": src.get("port"),
        "db_name": src.get("db_name"),
        "username": src.get("username"),
        "password": src.get("password"),
        "uri": src.get("uri"),
    }


def engine_for_source(src: dict) -> Engine:
    """按数据源取（并缓存）连接池."""
    url = build_url(_src_row(src))
    fingerprint = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
    key = (int(src["id"]), fingerprint)
    with _lock:
        cached = _engines.get(key)
        if cached and time.time() - cached[1] < 3600:
            return cached[0]
    kwargs: dict[str, Any] = {"pool_pre_ping": True, "pool_recycle": 1800, "pool_size": 3, "max_overflow": 2}
    if url.startswith("postgresql"):
        kwargs["connect_args"] = {
            "connect_timeout": 8,
            "options": f"-c statement_timeout={STATEMENT_TIMEOUT_MS}",
        }
    elif url.startswith("mysql"):
        kwargs["connect_args"] = {"connect_timeout": 8, "read_timeout": STATEMENT_TIMEOUT_MS // 1000}
    elif url.startswith("clickhouse+native"):
        # ClickHouse 默认会拿 SELECT 别名去替换同名源列（时间粒度 `toStartOfMonth(dt) AS dt`
        # 时 GROUP BY / ORDER BY 会报 NOT_AN_AGGREGATE），这里统一让列名优先于别名
        kwargs["connect_args"] = {
            "connect_timeout": 8,
            "settings": {"prefer_column_name_to_alias": 1},
        }
    elif url.startswith("mssql+pyodbc"):
        # pyodbc 的登录超时（秒）；查询超时由 QueryObject / 调用方控制
        kwargs["connect_args"] = {"timeout": 8}
    try:
        eng = create_engine(url, **kwargs)
    except ModuleNotFoundError as exc:
        raise LiveQueryError(f"该类型的驱动未安装：{exc.name}") from exc
    except Exception as exc:
        raise LiveQueryError(f"连接配置有误：{str(exc)[:160]}") from exc
    with _lock:
        _engines[key] = (eng, time.time())
        # 顺手清掉同一数据源的旧指纹（密码/地址改过）
        for k in [k for k in _engines if k[0] == key[0] and k != key]:
            old, _ = _engines.pop(k)
            old.dispose()
    return eng


def source_tables(eng: Engine, src_id: int) -> set[str]:
    """源库里可见的 表 / 视图 名（含 schema 前缀），按数据源缓存."""
    now = time.time()
    with _lock:
        cached = _tables.get(src_id)
        if cached and now - cached[1] < _TABLE_CACHE_TTL:
            return cached[0]
    insp = inspect(eng)
    names: set[str] = set()
    try:
        schemas = [s for s in insp.get_schema_names() if not s.startswith("pg_")]
    except Exception:
        schemas = ["public"]
    for schema in schemas:
        try:
            found = list(insp.get_table_names(schema=schema)) + list(insp.get_view_names(schema=schema))
        except Exception:
            continue
        for name in found:
            names.add(f"{schema}.{name}")
            if schema == "public":
                names.add(name)
    with _lock:
        _tables[src_id] = (names, now)
    return names


def run_live(
    db: Session,
    query: QueryObject,
    user: Any,
    src: dict,
    *,
    max_rows: int = MAX_ROWS,
    apply_row_level: bool = True,
    dataset_id: int | None = None,
) -> QueryResult:
    """在源库上执行一次契约查询."""
    eng = engine_for_source(src)

    table = query.table
    if table not in source_tables(eng, int(src["id"])):
        raise LiveQueryError(f"源库里没有这张表：{table}")

    dialect = TYPE_DIALECT.get(str(src.get("ds_type") or ""), "")
    if not dialect:
        raise LiveQueryError(f"不支持的数据源类型：{src.get('ds_type')}")
    query = query.model_copy(update={"dialect": dialect, "limit": min(int(query.limit or max_rows), max_rows)})

    rls_conditions: list[str] = []
    if apply_row_level:
        decision = rls_decide(db, table, user)
        rls_conditions = list(decision.conditions)
        # 数据集级行级规则（与表级同时 AND；模板副本也按 dataset_id 生效）
        from app.security import dataset_rules

        rls_conditions.extend(dataset_rules.row_conditions(db, dataset_id, user))

    built = build(query, allowed_tables=None, rls_conditions=rls_conditions, column_types={})

    user_id = getattr(user, "id", None)
    # 数据集不同 → 行级条件 / 脱敏可能不同，缓存键必须带 dataset_id
    ckey = _cache_key(int(src["id"]), (user_id, dataset_id), built.sql, built.params)
    with _lock:
        hit = _cache.get(ckey)
    if hit and time.time() - hit[2] < _CACHE_TTL:
        return QueryResult(sql=built.sql, columns=hit[1], rows=hit[0], count=len(hit[0]),
                           elapsed_ms=0.0, rls=bool(rls_conditions), params=built.params)

    started = time.time()
    from app.query import metrics, slowlog

    metrics.incr("query.live_total")
    try:
        with eng.connect() as conn:
            rows = [dict(r._mapping) for r in conn.execute(text(built.sql), built.params).fetchall()]
    except Exception as exc:
        metrics.incr("query.live_failed")
        raise LiveQueryError(f"源库查询失败：{str(exc)[:180]}") from exc
    metrics.incr("query.live_ok")
    elapsed = (time.time() - started) * 1000

    slowlog.record(table=table, user_id=getattr(user, "id", None),
                   elapsed_ms=elapsed, sql=built.sql, source="live")

    rows = apply_masks(table, rows, db)
    from app.security import dataset_rules

    rows = dataset_rules.apply_dataset_masks(db, dataset_id, rows)
    if rows:
        with _lock:
            if len(_cache) >= _CACHE_MAX:
                _cache.clear()
            _cache[ckey] = (rows, list(rows[0].keys()), time.time())
    return QueryResult(
        sql=built.sql,
        columns=list(rows[0].keys()) if rows else [],
        rows=rows[:max_rows],
        count=len(rows[:max_rows]),
        elapsed_ms=round(elapsed, 1),
        rls=bool(rls_conditions),
        params=built.params,
    )


__all__ = ["run_live", "engine_for_source", "source_tables", "clear_cache",
           "LiveQueryError", "SourceError", "RlsBlockedError"]
