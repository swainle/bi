"""异步任务存储（进程内 / Redis，带 TTL 与容量上限）.

两种实现，接口完全一致（路由与调用方不用动）：
    JobStore       进程内（默认，单进程最省事）
    RedisJobStore  任务表放 Redis：多 worker 之间能互相查到、服务重启后任务记录不丢
                   （任务本身仍在提交它的进程线程池里跑；进程挂了会被判定为中断）

选择方式：`BI_JOB_STORE=auto|memory|redis`（默认 auto：配了能连上的 REDIS_URL 就用 Redis，
否则自动退回进程内，连不上不会让服务起不来）。
"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

JobState = Literal["queued", "running", "done", "failed"]

_MAX_JOBS = 200
_TTL_SECONDS = 30 * 60
# running 状态超过这个时间还没有结果：判定为任务已中断（服务重启 / 执行卡死）
_STALE_RUNNING_SECONDS = 10 * 60


@dataclass
class Job:
    id: str
    state: JobState = "queued"
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    result: dict | None = None
    error: str = ""
    user_id: int | None = None

    def to_dict(self) -> dict:
        return {
            "job_id": self.id,
            "state": self.state,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_ms": round((self.finished_at - self.started_at) * 1000, 1)
            if self.started_at and self.finished_at
            else None,
            "error": self.error,
            "result": self.result,
            "user_id": self.user_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Job":
        return cls(
            id=str(data.get("job_id") or data.get("id") or ""),
            state=data.get("state") or "queued",
            created_at=float(data.get("created_at") or time.time()),
            started_at=data.get("started_at"),
            finished_at=data.get("finished_at"),
            result=data.get("result"),
            error=data.get("error") or "",
            user_id=data.get("user_id"),
        )


class JobStore:
    """线程安全的任务表."""

    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, user_id: int | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], user_id=user_id)
        with self._lock:
            self._evict_locked()
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job and job.finished_at and time.time() - job.finished_at > _TTL_SECONDS:
            self._drop(job_id)
            return None
        return job

    def mark_running(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.state = "running"
                job.started_at = time.time()

    def mark_done(self, job_id: str, result: dict) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.state = "done"
                job.result = result
                job.finished_at = time.time()

    def mark_failed(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.state = "failed"
                job.error = error
                job.finished_at = time.time()

    def stats(self) -> dict:
        with self._lock:
            counts: dict[str, int] = {}
            for job in self._jobs.values():
                counts[job.state] = counts.get(job.state, 0) + 1
        return {"total": len(self._jobs), "by_state": counts}

    def _drop(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def _evict_locked(self) -> None:
        """超过容量时淘汰最老的已结束任务."""
        if len(self._jobs) < _MAX_JOBS:
            return
        finished = [j for j in self._jobs.values() if j.finished_at]
        finished.sort(key=lambda j: j.finished_at or 0)
        for job in finished[: max(1, len(self._jobs) - _MAX_JOBS + 1)]:
            self._jobs.pop(job.id, None)


class RedisJobStore:
    """Redis 任务表：多 worker 共享、重启不丢记录（接口与 JobStore 一致）."""

    prefix = "bi:job:"
    ttl_seconds = _TTL_SECONDS

    def __init__(self, client: Any) -> None:
        self._redis = client

    def _key(self, job_id: str) -> str:
        return f"{self.prefix}{job_id}"

    def _read(self, job_id: str) -> Job | None:
        try:
            raw = self._redis.get(self._key(job_id))
        except Exception:
            return None
        if not raw:
            return None
        try:
            return Job.from_dict(json.loads(raw))
        except (ValueError, TypeError):
            return None

    def _save(self, job: Job) -> None:
        try:
            self._redis.set(self._key(job.id), json.dumps(job.to_dict()), ex=self.ttl_seconds)
        except Exception:  # Redis 掉线时任务本身照旧执行，只是查不到进度
            return

    def _update(self, job_id: str, **fields: Any) -> None:
        job = self._read(job_id)
        if job is None:
            return
        for key, value in fields.items():
            setattr(job, key, value)
        self._save(job)

    def create(self, user_id: int | None = None) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], user_id=user_id)
        self._save(job)
        return job

    def get(self, job_id: str) -> Job | None:
        job = self._read(job_id)
        if job is None:
            return None
        # 服务重启后任务会永久停在 running：超时没结果就判定中断，别让前端一直转圈
        if job.state == "running" and job.started_at and \
                time.time() - float(job.started_at) > _STALE_RUNNING_SECONDS:
            job.state = "failed"
            job.error = "任务已中断（服务重启或执行超时），请重新提交"
            job.finished_at = time.time()
            self._save(job)
        return job

    def mark_running(self, job_id: str) -> None:
        self._update(job_id, state="running", started_at=time.time())

    def mark_done(self, job_id: str, result: dict) -> None:
        self._update(job_id, state="done", result=result, finished_at=time.time())

    def mark_failed(self, job_id: str, error: str) -> None:
        self._update(job_id, state="failed", error=error, finished_at=time.time())

    def stats(self) -> dict:
        counts: dict[str, int] = {}
        total = 0
        try:
            for key in self._redis.scan_iter(match=f"{self.prefix}*", count=200):
                job = self._read(key[len(self.prefix):])
                if job is None:
                    continue
                total += 1
                counts[job.state] = counts.get(job.state, 0) + 1
        except Exception:
            return {"total": total, "by_state": counts}
        return {"total": total, "by_state": counts}


def _redis_client() -> Any:
    """能连上才返回客户端；没配 / 连不上返回 None（不抛异常）."""
    url = (os.getenv("REDIS_URL") or "").strip()
    if not url:
        return None
    try:
        import redis as redis_lib

        client = redis_lib.from_url(url, socket_connect_timeout=1, decode_responses=True)
        client.ping()
        return client
    except Exception:
        return None


def build_store() -> JobStore | RedisJobStore:
    """按 BI_JOB_STORE 选实现：auto（默认）= 能用 Redis 就用，否则进程内."""
    mode = (os.getenv("BI_JOB_STORE") or "auto").strip().lower()
    if mode == "memory":
        return JobStore()
    client = _redis_client()
    if client is not None:
        return RedisJobStore(client)
    return JobStore()


STORE = build_store()

__all__ = ["Job", "JobStore", "RedisJobStore", "STORE", "JobState", "build_store"]
