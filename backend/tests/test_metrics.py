"""指标计数器与 /api/metrics 端点."""

from __future__ import annotations

from app.dashboards import render_cache
from app.observability import metrics
from app.observability import router as metrics_router


def test_incr_snapshot_reset():
    metrics.reset()
    metrics.incr("demo.a")
    metrics.incr("demo.a")
    metrics.incr("demo.b", 2.5)
    metrics.decr("demo.b", 0.5)
    snap = metrics.snapshot()
    assert snap["demo.a"] == 2
    assert snap["demo.b"] == 2
    metrics.reset()
    assert metrics.snapshot() == {}


def test_render_cache_counts_hits_and_stores(monkeypatch):
    from app import cache

    monkeypatch.setattr(cache, "_redis", None)
    cache._memory_cache.clear()
    metrics.reset()
    key = "render:999:abc"
    assert render_cache.load(key) is None  # miss
    render_cache.store(key, {"view": "main"})
    assert render_cache.load(key) == {"view": "main"}  # hit
    snap = metrics.snapshot()
    assert snap["render_cache.lookups"] == 2
    assert snap["render_cache.hits"] == 1
    assert snap["render_cache.stores"] == 1
    cache._memory_cache.clear()


def test_collect_shape():
    payload = metrics_router.collect()
    for key in ("app", "database", "redis", "query", "render_cache", "slow_queries", "jobs"):
        assert key in payload
    assert set(("in_flight", "total", "ok", "failed", "timeout", "cancelled", "quota_rejected")) <= set(payload["query"])
    assert "hit_rate" in payload["render_cache"]
    assert "executor" in payload["jobs"]
