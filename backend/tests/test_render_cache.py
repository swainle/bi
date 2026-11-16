"""整页渲染缓存（app/dashboards/render_cache.py）单元测试.

只测缓存本身的边界：key 隔离、失效、错误不缓存、TTL=0 关闭。
不测真实渲染（那部分由真实链路验证覆盖）。
"""

from types import SimpleNamespace

import pytest

from app import cache
from app.dashboards import render_cache


@pytest.fixture(autouse=True)
def _memory_mode(monkeypatch):
    """强制内存缓存（CI / 本地都不依赖 Redis），每个用例前后清空."""
    monkeypatch.setattr(cache, "_redis", None)
    cache._memory_cache.clear()
    monkeypatch.delenv("BI_RENDER_CACHE_TTL", raising=False)
    yield
    cache._memory_cache.clear()


def _user(user_id: int = 1, role: str = "member", username: str = "u1"):
    return SimpleNamespace(id=user_id, role=role, username=username)


def _key(**kwargs):
    base = {"updated_at": "2026-11-13 10:00:00", "user": _user(), "view": "main", "params": {}, "live_items": None}
    base.update(kwargs)
    return render_cache.key_for(57, **base)


def test_same_request_hits_same_key():
    assert _key() == _key()
    # 参数顺序不影响指纹
    assert _key(params={"a": 1, "b": 2}) == _key(params={"b": 2, "a": 1})


def test_key_isolated_by_user_view_params_doc_and_live_items():
    assert _key() != _key(user=_user(user_id=2))
    assert _key() != _key(user=_user(role="admin"))
    assert _key() != _key(view="extra")
    assert _key() != _key(params={"platform": "天猫"})
    assert _key() != _key(updated_at="2026-11-13 10:00:01")
    assert _key() != _key(live_items=[{"key": "c1"}])


def test_store_and_load_roundtrip():
    key = _key()
    payload = {"view": "main", "cards": {"c1": {"kind": "kpi", "value": 1}}}
    assert render_cache.load(key) is None
    render_cache.store(key, payload)
    assert render_cache.load(key) == payload


def test_invalidate_only_clears_that_dashboard():
    render_cache.store(_key(), {"view": "main"})
    other = render_cache.key_for(58, updated_at="x", user=_user(), view="main", params={})
    render_cache.store(other, {"view": "main"})
    render_cache.invalidate(57)
    assert render_cache.load(_key()) is None
    assert render_cache.load(other) == {"view": "main"}


def test_card_error_is_not_cached():
    key = _key()
    broken = {"view": "main", "cards": {"c1": {"error": "连接超时"}}}
    # 路由里的判定：有报错卡就不写缓存（避免把一次抖动冻住整个 TTL）
    assert render_cache.has_card_error(broken) is True
    assert render_cache.load(key) is None
    assert render_cache.has_card_error({"cards": {"c1": {"value": 1}}}) is False


def test_ttl_zero_disables_cache(monkeypatch):
    monkeypatch.setenv("BI_RENDER_CACHE_TTL", "0")
    key = _key()
    render_cache.store(key, {"view": "main"})
    assert render_cache.load(key) is None


def test_lock_for_is_shared_per_key():
    """同一个 key 拿到同一把单飞锁；不同 key 互不阻塞（防缓存过期雪崩）."""
    first = render_cache.lock_for("render:1:a")
    assert render_cache.lock_for("render:1:a") is first
    assert render_cache.lock_for("render:1:b") is not first
