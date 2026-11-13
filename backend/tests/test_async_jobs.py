"""异步任务存储回归（不起线程池，只测状态机）."""

from __future__ import annotations

import time

import pytest

from app.query.async_jobs.store import Job, JobStore, RedisJobStore, build_store


def test_create_and_state_transitions() -> None:
    store = JobStore()
    job = store.create()
    assert job.state == "queued"

    store.mark_running(job.id)
    assert store.get(job.id).state == "running"

    store.mark_done(job.id, {"rows": [1, 2]})
    finished = store.get(job.id)
    assert finished.state == "done"
    assert finished.result == {"rows": [1, 2]}
    assert finished.finished_at is not None


def test_failed_job_keeps_error() -> None:
    store = JobStore()
    job = store.create()
    store.mark_failed(job.id, "boom")
    got = store.get(job.id)
    assert got.state == "failed"
    assert "boom" in got.error


def test_missing_job_returns_none() -> None:
    assert JobStore().get("nope") is None


def test_to_dict_shape() -> None:
    store = JobStore()
    job = store.create()
    store.mark_running(job.id)
    store.mark_done(job.id, {"count": 1})
    payload = store.get(job.id).to_dict()
    for key in ("job_id", "state", "created_at", "finished_at", "result", "error"):
        assert key in payload
    assert payload["state"] == "done"


def test_stats_counts_states() -> None:
    store = JobStore()
    a = store.create()
    b = store.create()
    store.mark_running(a.id)
    store.mark_failed(b.id, "x")
    stats = store.stats()
    assert stats["total"] == 2
    assert stats["by_state"].get("running") == 1
    assert stats["by_state"].get("failed") == 1


def test_capacity_eviction() -> None:
    store = JobStore()
    ids = []
    for _ in range(210):
        job = store.create()
        store.mark_done(job.id, {})
        ids.append(job.id)
    assert store.stats()["total"] <= 200


# ── Redis 任务表（多 worker 共享）──────────────────────────────
def test_job_from_dict_roundtrip() -> None:
    job = Job(id="abc", state="done", created_at=1.0, started_at=1.5, finished_at=2.5,
              result={"count": 1})
    back = Job.from_dict(job.to_dict())
    assert back.id == "abc" and back.state == "done"
    assert back.started_at == 1.5 and back.finished_at == 2.5
    assert back.result == {"count": 1}


def test_build_store_memory_mode(monkeypatch) -> None:
    monkeypatch.setenv("BI_JOB_STORE", "memory")
    assert isinstance(build_store(), JobStore)


def test_build_store_falls_back_without_redis(monkeypatch) -> None:
    monkeypatch.setenv("BI_JOB_STORE", "auto")
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert isinstance(build_store(), JobStore)


def _redis_or_skip():
    pytest.importorskip("redis")
    import redis as redis_lib

    try:
        client = redis_lib.from_url("redis://127.0.0.1:6379/0",
                                    socket_connect_timeout=0.5, decode_responses=True)
        client.ping()
        return client
    except Exception:
        pytest.skip("本机没有 Redis，跳过 Redis 任务表用例")


def _cleanup(client, prefix: str) -> None:
    for key in client.scan_iter(match=f"{prefix}*"):
        client.delete(key)


def test_redis_store_state_machine() -> None:
    client = _redis_or_skip()
    store = RedisJobStore(client)
    store.prefix = "bi:job_test:"
    _cleanup(client, store.prefix)
    try:
        job = store.create()
        assert store.get(job.id).state == "queued"
        store.mark_running(job.id)
        assert store.get(job.id).state == "running"
        store.mark_done(job.id, {"rows": [1]})
        done = store.get(job.id)
        assert done.state == "done" and done.result == {"rows": [1]}
        assert store.stats()["by_state"].get("done") == 1
        assert store.get("not-exist") is None
    finally:
        _cleanup(client, store.prefix)


def test_redis_store_marks_stale_running_as_failed() -> None:
    client = _redis_or_skip()
    store = RedisJobStore(client)
    store.prefix = "bi:job_test:"
    _cleanup(client, store.prefix)
    try:
        job = store.create()
        store._update(job.id, state="running", started_at=time.time() - 3600)
        stale = store.get(job.id)
        assert stale.state == "failed" and "中断" in stale.error
    finally:
        _cleanup(client, store.prefix)
