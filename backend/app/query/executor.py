"""查询执行器 —— 把「契约 → SQL → 结果」收成一次调用.

调用方（路由 / 语义层）只需要传 QueryObject + 当前用户：
    run(db, query, user) -> QueryResult

它负责五件事：行级权限 → 编译 SQL → 执行 → 超时/并发治理 → 列脱敏。

治理旋钮（P1）：
    BI_QUERY_TIMEOUT_MS    单条 SQL 的语句超时（默认 15000，0 = 不限）；
                           超时由 PostgreSQL 端取消，不是只在前端断开
    BI_USER_MAX_CONCURRENT 同一用户同时在跑的查询数（默认 16，0 = 不限）；
                           有 Redis 时是全局配额（多 worker 一起算），没有则本进程内生效
    BI_QUERY_QUOTA         配额实现：auto（默认）/ local / redis
    BI_SLOW_SAMPLE_MS      慢查询采样阈值（默认 1000ms，0 = 不采样；见 app/query/slowlog.py）
    取消查询：每次执行都会登记 query_id + PG 后端 pid，可由 /api/bi/query/cancel/{query_id} 打断
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.query import metrics, redis_bus, running, slowlog
from app.query.builder import build
from app.query.column_types import column_types as _column_types
from app.query.contract import QueryObject
from app.security import rls_backstop
from app.security.errors import RlsBlockedError
from app.security.masking import apply_masks
from app.security.rls import decide as rls_decide


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


QUERY_TIMEOUT_MS = _env_int("BI_QUERY_TIMEOUT_MS", 15000)
USER_MAX_CONCURRENT = _env_int("BI_USER_MAX_CONCURRENT", 16)

# Redis 全局配额：key 里每个用户一个 ZSET，member 是租约 token（score = 到期时间）
QUOTA_PREFIX = "bi:qcon:"
QUOTA_LEASE_SECONDS = 180

# 每个用户的并发查询信号量（进程内；多 worker 时每个进程各管一份）
_user_slots: dict[int, threading.BoundedSemaphore] = {}
_slots_lock = threading.Lock()


def _user_slot(user_id: int) -> threading.BoundedSemaphore | None:
    if USER_MAX_CONCURRENT <= 0:
        return None
    with _slots_lock:
        sem = _user_slots.get(user_id)
        if sem is None:
            sem = threading.BoundedSemaphore(USER_MAX_CONCURRENT)
            _user_slots[user_id] = sem
        return sem


def _apply_timeout(db: Session) -> None:
    """给这次事务设置语句超时（仅 PostgreSQL；其他方言保持原行为）."""
    if QUERY_TIMEOUT_MS <= 0:
        return
    try:
        if db.get_bind().dialect.name != "postgresql":
            return
        db.execute(text(f"SET LOCAL statement_timeout = {QUERY_TIMEOUT_MS}"))
    except Exception:  # 权限/方言不支持 → 退回原行为，不能因为治理把查询打挂
        return


def _wait_seconds() -> float:
    return max(1.0, (QUERY_TIMEOUT_MS / 1000) if QUERY_TIMEOUT_MS > 0 else 30.0)


def _quota_busy() -> ValueError:
    return ValueError(
        f"当前查询并发过多，请稍后重试（同一账号最多 {USER_MAX_CONCURRENT} 个查询同时执行）"
    )


def _redis_release(client: Any, key: str, token: str) -> None:
    try:
        client.zrem(key, token)
    except Exception:
        pass


def _redis_acquire(user_id: int) -> Any:
    """Redis 全局配额（多 worker 一起算）。拿不到 Redis 返回 None → 回退本进程信号量."""
    if (os.getenv("BI_QUERY_QUOTA") or "auto").strip().lower() == "local":
        return None
    client = redis_bus.client()
    if client is None:
        return None
    key = f"{QUOTA_PREFIX}{user_id}"
    token = uuid.uuid4().hex
    deadline = time.time() + _wait_seconds()
    while True:
        now = time.time()
        try:
            pipe = client.pipeline()
            # 清理超时的租约：进程崩溃 / 被 kill 时不会把名额永久占死
            pipe.zremrangebyscore(key, 0, now)
            pipe.zcard(key)
            current = int(pipe.execute()[1])
            if current < USER_MAX_CONCURRENT:
                client.zadd(key, {token: now + QUOTA_LEASE_SECONDS})
                client.expire(key, QUOTA_LEASE_SECONDS * 2)
                return lambda: _redis_release(client, key, token)
            if now >= deadline:
                raise _quota_busy()
            time.sleep(0.05)
        except ValueError:
            raise
        except Exception:
            redis_bus.disable()  # Redis 中途坏掉：降级成本地配额，别每条查询都等超时
            return None


def _acquire_slot(user_id: int) -> Any:
    """拿一个查询名额，返回 release；超限抛 ValueError."""
    if USER_MAX_CONCURRENT <= 0:
        return lambda: None
    release = _redis_acquire(user_id)
    if release is not None:
        return release
    sem = _user_slot(user_id)
    if sem is None:
        return lambda: None
    if not sem.acquire(timeout=_wait_seconds()):
        raise _quota_busy()
    return sem.release


def _backend_pid(db: Session) -> int:
    """当前连接的 PG 后端进程号（取消查询用；拿不到返回 0）."""
    try:
        if db.get_bind().dialect.name != "postgresql":
            return 0
        fairy = db.connection().connection
        driver = getattr(fairy, "driver_connection", fairy)
        return int(driver.get_backend_pid())
    except Exception:
        return 0


@dataclass
class QueryResult:
    sql: str
    columns: list[str] = field(default_factory=list)
    rows: list[dict] = field(default_factory=list)
    count: int = 0
    elapsed_ms: float = 0.0
    rls: bool = False
    params: dict = field(default_factory=dict)
    query_id: str = ""


def run(
    db: Session,
    query: QueryObject,
    user: Any,
    *,
    apply_row_level: bool = True,
    max_rows: int = 5000,
    query_id: str | None = None,
    dataset_id: int | None = None,
) -> QueryResult:
    """执行一次查询。异常：
        RlsBlockedError  行级规则损坏 → fail-closed
        TableNotAllowedError 越权表
        ValueError       契约不合法 / 并发超限 / 语句超时
    """
    if not query.subquery:
        from app.query.table_catalog import assert_queryable
        assert_queryable(query.table)
    if query.subquery and apply_row_level:
        from app.query.sql_lab import prepare
        query = query.model_copy(update={"subquery": prepare(db, query.subquery, user)})
    rls_conditions: list[str] = []
    if apply_row_level and not query.subquery:
        decision = rls_decide(db, query.table, user)
        rls_conditions = list(decision.conditions)

    # 数据集级行级规则：与表级规则同时 AND 进 WHERE（见 security/dataset_rules.py）
    from app.security import dataset_rules

    if apply_row_level and dataset_id:
        # 数据集规则 + 部门隔离（S3）一起 AND；方言决定标识符引号
        rls_conditions.extend(
            dataset_rules.row_conditions(db, dataset_id, user, query.dialect or "postgres")
        )
        # S6：物理表策略预检（缺失先自愈，仍失败 → 403，不放行）
        rls_backstop.preflight(db, int(dataset_id))

    types = _column_types(db, query.table)
    from app.semantic.formulas import check_formula_masks

    check_formula_masks(db, query, dataset_id)
    built = build(
        query,
        rls_conditions=rls_conditions,
        column_types=types,
    )

    user_id = int(getattr(user, "id", 0) or 0)
    qid = query_id or uuid.uuid4().hex[:16]
    started = time.time()
    metrics.incr("query.total")
    try:
        release = _acquire_slot(user_id)
    except ValueError:
        metrics.incr("query.quota_rejected")
        raise
    metrics.incr("query.in_flight")
    try:
        _apply_timeout(db)
        # S6：把部门范围写进事务变量；配了 BI_RLS_APP_ROLE 时数据查询期间切只读角色
        if dataset_id:
            rls_backstop.apply_session(db, user, int(dataset_id))
        running.register(qid, user_id=user_id, table=query.table, pid=_backend_pid(db))
        try:
            with rls_backstop.read_role(db):
                result = db.execute(text(built.sql), built.params).fetchall()
        except Exception as exc:
            detail = str(exc).lower()
            if "user request" in detail:  # pg_cancel_backend（手动取消）
                metrics.incr("query.cancelled")
                raise ValueError("查询已被取消") from exc
            if "statement timeout" in detail or "canceling statement" in detail:
                metrics.incr("query.timeout")
                raise ValueError(
                    f"查询超过 {QUERY_TIMEOUT_MS / 1000:.0f} 秒被取消，请缩小时间范围或加筛选条件"
                ) from exc
            metrics.incr("query.failed")
            raise
        finally:
            running.unregister(qid)
    finally:
        metrics.decr("query.in_flight")
        release()
    metrics.incr("query.ok")
    elapsed = (time.time() - started) * 1000

    slowlog.record(table=query.table, user_id=user_id, elapsed_ms=elapsed,
                   sql=built.sql, source="internal")

    rows = [dict(r._mapping) for r in result][:max_rows]
    if query.subquery:
        from app.query.sql_lab import mask_rows
        rows = mask_rows(db, query.subquery, rows)
    rows = apply_masks(query.table, rows, db)
    # 数据集级脱敏（同一列以数据集规则为准，覆盖表级规则）
    rows = dataset_rules.apply_dataset_masks(db, dataset_id, rows)

    return QueryResult(
        sql=built.sql,
        columns=list(rows[0].keys()) if rows else [],
        rows=rows,
        count=len(rows),
        elapsed_ms=round(elapsed, 1),
        rls=bool(rls_conditions),
        params=built.params,
        query_id=qid,
    )


__all__ = ["run", "QueryResult", "RlsBlockedError"]
