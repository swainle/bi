"""图表联动：交叉筛选条件归一化 + 渲染缓存 key 区分（纯函数）."""

from __future__ import annotations

from types import SimpleNamespace

from app.dashboards import render_cache
from app.dashboards.render import normalize_cross_filters


def test_normalize_basic() -> None:
    assert normalize_cross_filters(None) == []
    assert normalize_cross_filters([{"column": "品牌", "value": "萌趣兔"}]) == [
        {"name": "品牌", "op": "=", "value": "萌趣兔"}
    ]
    assert normalize_cross_filters([{"name": "平台", "value": "拼多多"}]) == [
        {"name": "平台", "op": "=", "value": "拼多多"}
    ]


def test_normalize_drops_invalid() -> None:
    assert normalize_cross_filters("x") == []
    assert normalize_cross_filters([{"column": "", "value": "a"}]) == []
    assert normalize_cross_filters([{"column": "品牌", "value": ""}]) == []
    assert normalize_cross_filters([{"column": "品牌", "value": {"a": 1}}]) == []


def test_normalize_limits() -> None:
    raw = [{"column": f"c{i}", "value": i} for i in range(20)]
    assert len(normalize_cross_filters(raw)) == 10
    many = normalize_cross_filters([{"column": "平台", "value": [str(i) for i in range(50)]}])
    assert len(many[0]["value"]) == 20


def test_cache_key_differs_by_cross_filters() -> None:
    user = SimpleNamespace(id=1, role="admin", username="admin")
    base = render_cache.key_for(
        1, updated_at="t", user=user, view="main", params={}, cross_filters=[],
    )
    linked = render_cache.key_for(
        1, updated_at="t", user=user, view="main", params={},
        cross_filters=[{"column": "品牌", "value": "萌趣兔"}],
    )
    assert base != linked
