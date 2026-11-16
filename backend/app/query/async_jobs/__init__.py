"""异步查询任务（进程内 / 独立 worker 两种执行方式，接口与 Celery 对齐）."""

from app.query.async_jobs import queue as jobqueue
from app.query.async_jobs.runner import execute_job, executor_mode, shutdown, stats, submit
from app.query.async_jobs.store import Job, JobState, STORE

__all__ = ["submit", "stats", "shutdown", "execute_job", "executor_mode",
           "jobqueue", "Job", "JobState", "STORE"]
