"""查询治理第二批：Redis 全局配额 / 正在执行的查询登记 / 慢查询采样.

这些用例尽量不依赖外部服务：
    * 进程内回退、登记表、权限判断 → 纯内存；
    * Redis 配额、Redis 登记 → 本机有 Redis 才跑，没有自动跳过。
"""

from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from app.observability import slowlog
from app.query import executor, redis_bus, running


@pytest.fixture(autouse=True)
def _no_flusher(monkeypatch):
    """单测不启动慢查询写库线程，避免连数据库."""
    monkeypatch.setattr(slowlog, "_ensure_flusher", lambda: None)
    slowlog._buffer.clear()
    yield
    slowlog._buffer.clear()


def _user(user_id: int = 1, role: str = "member"):
    return SimpleNamespace(id=user_id, role=role)


# ── 正在执行的查询登记 / 取消 ─────────────────────────────────
def test_register_lookup_unregister(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    redis_bus.reset()
    running.register("q1", user_id=1, table="bi_demo_sku", pid=1234)
    info = running.lookup("q1")
    assert info["user_id"] == 1 and info["pid"] == 1234 and info["source"] == "internal"
    running.unregister("q1")
    assert running.lookup("q1") is None


def test_cancel_unknown_query():
    with pytest.raises(LookupError):
        running.cancel("nope", _user())


def test_cancel_other_users_query(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    redis_bus.reset()
    # pid=0：只验证权限分支，不碰任何真实数据库会话
    running.register("q2", user_id=7, table="bi_demo_sku", pid=0)
    try:
        with pytest.raises(PermissionError):
            running.cancel("q2", _user(user_id=8))
        # 管理员可以取消别人的；pid 无效时给的是「没有可取消的会话」
        with pytest.raises(ValueError):
            running.cancel("q2", _user(user_id=8, role="admin"))
    finally:
        running.unregister("q2")


def test_cancel_live_source_rejected(monkeypatch):
    monkeypatch.delenv("REDIS_URL", raising=False)
    redis_bus.reset()
    running.register("q3", user_id=1, table="dm.v_bangdan", pid=999, source="live")
    try:
        with pytest.raises(ValueError):
            running.cancel("q3", _user(user_id=1))
    finally:
        running.unregister("q3")


# ── 慢查询采样缓冲 ────────────────────────────────────────────
def test_slowlog_below_threshold_is_skipped(monkeypatch):
    monkeypatch.setenv("BI_SLOW_SAMPLE_MS", "1000")
    slowlog.record(table="bi_demo_sku", user_id=1, elapsed_ms=12, sql="SELECT 1")
    assert len(slowlog._buffer) == 0


def test_slowlog_records_and_truncates(monkeypatch):
    monkeypatch.setenv("BI_SLOW_SAMPLE_MS", "100")
    slowlog.record(table="bi_demo_sku", user_id=3, elapsed_ms=250.4, sql="S" * 800, source="internal")
    assert len(slowlog._buffer) == 1
    item = slowlog._buffer[0]
    assert item["elapsed_ms"] == 250.4 and item["user_id"] == 3
    assert len(item["sql_text"]) == 500


def test_slowlog_disabled_by_zero(monkeypatch):
    monkeypatch.setenv("BI_SLOW_SAMPLE_MS", "0")
    slowlog.record(table="t", user_id=1, elapsed_ms=9999, sql="x")
    assert len(slowlog._buffer) == 0


# ── Redis 全局配额（本机没有 Redis 就跳过）──────────────────────
def _redis_or_skip():
    pytest.importorskip("redis")
    import redis as redis_lib

    try:
        client = redis_lib.from_url("redis://127.0.0.1:6379/0",
                                    socket_connect_timeout=0.5, decode_responses=True)
        client.ping()
        return client
    except Exception:
        pytest.skip("本机没有 Redis，跳过 Redis 配额用例")


def test_redis_quota_limit_and_release(monkeypatch):
    client = _redis_or_skip()
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(executor, "USER_MAX_CONCURRENT", 1)
    monkeypatch.setattr(executor, "_wait_seconds", lambda: 0.2)  # 排队 0.2s 足够验证超限
    redis_bus.reset()
    key = f"{executor.QUOTA_PREFIX}555001"
    client.delete(key)

    release = executor._redis_acquire(555001)
    assert callable(release)
    try:
        # 名额已占满：第二次排队到超时 → ValueError
        with pytest.raises(ValueError):
            executor._redis_acquire(555001)
    finally:
        release()
    # 释放后可以再拿
    release2 = executor._redis_acquire(555001)
    assert callable(release2)
    release2()
    assert client.zcard(key) == 0
    client.delete(key)


def test_redis_quota_purges_expired_leases(monkeypatch):
    client = _redis_or_skip()
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setattr(executor, "USER_MAX_CONCURRENT", 1)
    from app.query import redis_bus

    redis_bus.reset()
    key = f"{executor.QUOTA_PREFIX}555002"
    client.delete(key)
    # 一条早就过期的租约（模拟进程崩溃没释放）不应占名额
    client.zadd(key, {"dead": time.time() - 60})
    release = executor._redis_acquire(555002)
    assert callable(release)
    release()
    client.delete(key)
