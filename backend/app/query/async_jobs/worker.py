"""独立 worker 进程：从 `bi:jobq` 取异步任务并执行.

启动：
    BI_JOB_EXECUTOR=worker python -m app.query.async_jobs.worker

行为：
    * 每 10 秒刷新一次心跳（`bi:jobworker:<id>`），供 `/api/bi/query/jobs` 看有几个 worker；
    * 取到任务先看取消标记 —— 排队期间被取消的直接判失败，不执行；
    * 执行复用 `runner.execute_job`：语句超时、每用户配额、`bi:qrun` 登记、取消都照旧；
    * 连接类错误按 `BI_ASYNC_MAX_ATTEMPTS`（默认 2）重投，业务错误不重试；
    * 任务表里查不到（已过期）或参数不合法 → 直接丢弃，不阻塞队列。
"""

from __future__ import annotations

import os
import signal
import sys
import time

from app.query.async_jobs import queue as jobqueue
from app.query.async_jobs.runner import execute_job
from app.query.async_jobs.store import STORE
from app.query.contract import QueryObject

_RETRYABLE_HINTS = ("operationalerror", "connection", "too many connections", "server closed")


def _max_attempts() -> int:
    try:
        return max(1, int(os.getenv("BI_ASYNC_MAX_ATTEMPTS", "2") or "2"))
    except ValueError:
        return 2


def _poll_seconds() -> int:
    try:
        return max(1, int(os.getenv("BI_WORKER_POLL_SECONDS", "5") or "5"))
    except ValueError:
        return 5


def _retryable(error: str) -> bool:
    text = (error or "").lower()
    return any(hint in text for hint in _RETRYABLE_HINTS)


def run_once(timeout_seconds: int | None = None) -> bool:
    """取一个任务执行；没取到返回 False."""
    payload = jobqueue.pop(timeout_seconds or _poll_seconds())
    if payload is None:
        return False

    job_id = str(payload.get("job_id") or "")
    if not job_id:
        return True

    if jobqueue.is_cancelled(job_id):
        jobqueue.clear_cancel(job_id)
        STORE.mark_failed(job_id, "任务已被用户取消")
        return True

    job = STORE.get(job_id)
    if job is None:  # 任务记录已过期 / 被清理
        jobqueue.clear_cancel(job_id)
        return True
    if job.state in ("done", "failed"):  # 排队期间已被取消 / 结束
        jobqueue.clear_cancel(job_id)
        return True

    try:
        query = QueryObject(**(payload.get("query") or {}))
    except Exception as exc:
        STORE.mark_failed(job_id, f"任务参数不合法：{str(exc)[:200]}")
        return True

    ok, error = execute_job(job_id, query, int(payload.get("user_id") or 0), payload.get("role") or "")
    if ok:
        jobqueue.clear_cancel(job_id)
        return True

    attempts = int(payload.get("attempts") or 1)
    if attempts < _max_attempts() and _retryable(error):
        payload["attempts"] = attempts + 1
        time.sleep(min(2 ** (attempts - 1), 5) * 0.2)  # 轻量退避，别把库打更狠
        if jobqueue.push(payload):
            print(f"[worker] 任务 {job_id} 第 {attempts} 次失败，已重投：{error[:120]}")
            return True

    STORE.mark_failed(job_id, error)
    jobqueue.clear_cancel(job_id)
    return True


def main() -> None:
    worker_id = jobqueue.new_worker_id()
    running = {"flag": True}

    def _stop(_signum, _frame):  # noqa: ANN001
        running["flag"] = False

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)

    print(f"[worker] 启动 id={worker_id} executor={os.getenv('BI_JOB_EXECUTOR', 'worker')}")
    last_beat = 0.0
    while running["flag"]:
        now = time.time()
        if now - last_beat > 10:
            jobqueue.heartbeat(worker_id)
            last_beat = now
        try:
            run_once()
        except Exception as exc:  # 单轮异常不退出进程
            print(f"[worker] 循环异常：{exc}")
            time.sleep(1)
    print("[worker] 已停止")
    sys.exit(0)


if __name__ == "__main__":
    main()
