"""独立 worker 队列：入队 / 消费 / 排队取消 / inline 回退."""

from __future__ import annotations

import pytest

from app.query import redis_bus
from app.query.async_jobs import jobqueue
from app.query.async_jobs import runner, worker
from app.query.async_jobs.store import STORE
from app.query.contract import QueryObject


def _redis_or_skip():
    pytest.importorskip("redis")
    import redis as redis_lib

    try:
        client = redis_lib.from_url("redis://127.0.0.1:6379/0",
                                    socket_connect_timeout=0.5, decode_responses=True)
        client.ping()
        return client
    except Exception:
        pytest.skip("本机没有 Redis，跳过队列用例")


@pytest.fixture
def redis_env(monkeypatch):
    client = _redis_or_skip()
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    redis_bus.reset()
    client.delete(jobqueue.QUEUE_KEY)
    yield client
    client.delete(jobqueue.QUEUE_KEY)
    redis_bus.reset()


def test_push_pop_roundtrip(redis_env):
    payload = {"job_id": "job1", "query": {"table": "bi_demo_sku"}, "user_id": 1, "role": "admin"}
    assert jobqueue.length() == 0
    assert jobqueue.push(payload) is True
    assert jobqueue.length() == 1
    assert jobqueue.pop(timeout_seconds=1) == payload
    assert jobqueue.pop(timeout_seconds=1) is None


def test_cancel_flag(redis_env):
    assert jobqueue.is_cancelled("j1") is False
    assert jobqueue.mark_cancel("j1") is True
    assert jobqueue.is_cancelled("j1") is True
    jobqueue.clear_cancel("j1")
    assert jobqueue.is_cancelled("j1") is False


def test_heartbeat_counts_workers(redis_env):
    jobqueue.heartbeat("w-test-1")
    jobqueue.heartbeat("w-test-2")
    try:
        assert jobqueue.workers() >= 2
    finally:
        redis_env.delete("bi:jobworker:w-test-1", "bi:jobworker:w-test-2")


def test_queue_unavailable_returns_false(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    redis_bus.reset()
    assert jobqueue.push({"job_id": "x"}) is False
    assert jobqueue.pop(timeout_seconds=1) is None
    assert jobqueue.length() == 0


def test_worker_skips_cancelled_queued_job(redis_env, monkeypatch):
    monkeypatch.setenv("BI_JOB_EXECUTOR", "worker")
    job = STORE.create(user_id=1)
    jobqueue.mark_cancel(job.id)
    jobqueue.push({"job_id": job.id, "query": {"table": "bi_demo_sku"}, "user_id": 1, "role": "admin"})
    assert worker.run_once(timeout_seconds=1) is True
    got = STORE.get(job.id)
    assert got.state == "failed" and "取消" in got.error
    assert jobqueue.is_cancelled(job.id) is False  # 标记已清理


def test_worker_skips_finished_job(redis_env, monkeypatch):
    monkeypatch.setenv("BI_JOB_EXECUTOR", "worker")
    job = STORE.create(user_id=1)
    STORE.mark_failed(job.id, "早已失败")
    jobqueue.push({"job_id": job.id, "query": {"table": "bi_demo_sku"}, "user_id": 1, "role": "admin"})
    assert worker.run_once(timeout_seconds=1) is True
    assert STORE.get(job.id).state == "failed"
    assert STORE.get(job.id).error == "早已失败"  # 没有被重新执行覆盖


def test_worker_skips_unknown_job(redis_env):
    jobqueue.push({"job_id": "not-exist", "query": {"table": "bi_demo_sku"}, "user_id": 1, "role": ""})
    assert worker.run_once(timeout_seconds=1) is True


def test_submit_enqueues_in_worker_mode(redis_env, monkeypatch):
    monkeypatch.setenv("BI_JOB_EXECUTOR", "worker")
    job = runner.submit(QueryObject(table="bi_demo_sku"), 1, "admin")
    try:
        assert jobqueue.length() == 1
        payload = jobqueue.pop(timeout_seconds=1)
        assert payload["job_id"] == job.id
        assert payload["user_id"] == 1
    finally:
        redis_env.delete(jobqueue.QUEUE_KEY)


def test_submit_falls_back_inline_without_redis(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.setenv("BI_JOB_EXECUTOR", "worker")
    redis_bus.reset()
    # 队列不可用 → 退回 inline；把执行换成桩，避免单测连数据库
    monkeypatch.setattr(runner, "execute_job", lambda *a, **kw: (True, ""))
    job = runner.submit(QueryObject(table="bi_demo_sku"), 1, "admin")
    assert job.state in ("queued", "running", "done", "failed")


def test_stats_shape():
    stats = runner.stats()
    for key in ("executor", "queue_len", "worker_processes", "total", "by_state"):
        assert key in stats
