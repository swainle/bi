"""异步任务执行器.

两种执行方式（`BI_JOB_EXECUTOR`）：
    inline（默认）  在 API 进程的线程池里执行 —— 与原来完全一致；
    worker          提交只入队（`bi:jobq`），由独立 worker 进程消费。

队列不可用（Redis 断 / 没配）时自动退回 inline，任务不会永远排队。

约束：
    * 只跑只读查询，不写库
    * 每个任务自己开 Session（SQLAlchemy Session 不跨线程复用）
    * 池满 → 直接拒绝（429），不排队堆内存
    * 任务表由 `store.STORE` 提供：进程内或 Redis（多 worker 共享）
"""

from __future__ import annotations

import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from app.query.async_jobs import queue as jobqueue
from app.query.async_jobs.store import STORE, Job
from app.query.contract import QueryObject
from app.query.executor import run


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


_MAX_WORKERS = _env_int("BI_ASYNC_WORKERS", 2)
_POOL = ThreadPoolExecutor(max_workers=_MAX_WORKERS, thread_name_prefix="bi-query")
_INFLIGHT = threading.Semaphore(_MAX_WORKERS * 4)


def executor_mode() -> str:
    """inline（默认）/ worker."""
    return (os.getenv("BI_JOB_EXECUTOR") or "inline").strip().lower()


def execute_job(job_id: str, query: QueryObject, user_id: int, user_role: str) -> tuple[bool, str]:
    """执行一个已登记的任务，返回 (是否成功, 错误信息)。状态写进 STORE."""
    from app.database import SessionLocal

    STORE.mark_running(job_id)
    db = SessionLocal()
    try:
        result = run(
            db,
            query,
            _User(user_id, user_role),
            # 任务 id 就是查询 id：取消任务时能直接找到正在执行的那条 SQL
            query_id=job_id,
        )
        STORE.mark_done(job_id, {
            "columns": result.columns,
            "rows": result.rows,
            "count": result.count,
            "elapsed_ms": result.elapsed_ms,
            "rls": result.rls,
        })
        return True, ""
    except Exception as exc:  # 任务失败不影响服务
        return False, f"{type(exc).__name__}: {str(exc)[:300]}"
    finally:
        db.close()


def submit(query: QueryObject, user_id: int, user_role: str) -> Job:
    """提交一个异步查询，立即返回 Job（可能已入队、可能已在进程内开跑）."""
    job = STORE.create(user_id=user_id)
    payload = {
        "job_id": job.id,
        "query": query.model_dump(),
        "user_id": int(user_id or 0),
        "role": user_role or "",
        "attempts": 1,
        "enqueued_at": time.time(),
    }
    if executor_mode() == "worker" and jobqueue.push(payload):
        return job

    # inline（默认）或队列不可用 → 本进程线程池执行
    if not _INFLIGHT.acquire(blocking=False):
        STORE.mark_failed(job.id, "异步查询队列已满，请稍后重试")
        from app.security.errors import SecurityError

        raise SecurityError("异步查询队列已满，请稍后重试")

    def _worker() -> None:
        try:
            ok, error = execute_job(job.id, query, user_id, user_role)
            if not ok:
                STORE.mark_failed(job.id, error)
        finally:
            _INFLIGHT.release()

    try:
        _POOL.submit(_worker)
    except RuntimeError as exc:
        _INFLIGHT.release()
        STORE.mark_failed(job.id, f"线程池不可用：{exc}")

    return job


class _User:
    """轻量用户视图（只带 id / role，避免把 ORM 对象带进线程）."""

    __slots__ = ("id", "role")

    def __init__(self, user_id: int, role: str) -> None:
        self.id = user_id
        self.role = role or ""


def stats() -> dict:
    mode = executor_mode()
    return {
        "executor": mode,
        "workers": _MAX_WORKERS,
        "inflight_budget": _MAX_WORKERS * 4,
        "queue_len": jobqueue.length() if mode == "worker" else 0,
        "worker_processes": jobqueue.workers() if mode == "worker" else 0,
        **STORE.stats(),
    }


def shutdown() -> None:
    _POOL.shutdown(wait=False, cancel_futures=True)


__all__ = ["submit", "stats", "shutdown", "STORE", "execute_job", "executor_mode", "jobqueue"]
