"""下钻查询构造（纯函数，不连库）."""

from __future__ import annotations

from types import SimpleNamespace

from app.dashboards.drill import MAX_ROWS, build_request, drill_columns


def test_drill_columns_only_dimensions() -> None:
    fields = [
        SimpleNamespace(name="商品标题", role="dimension"),
        SimpleNamespace(name="日销量", role="metric"),
        SimpleNamespace(name="品牌", role="dimension"),
        SimpleNamespace(name="商品标题", role="dimension"),
    ]
    assert drill_columns(fields) == ["商品标题", "品牌"]


def test_drill_columns_limit() -> None:
    fields = [SimpleNamespace(name=f"d{i}", role="dimension") for i in range(20)]
    assert len(drill_columns(fields)) == 12


def test_build_request_filters_and_limit() -> None:
    request = build_request(["商品标题", "品牌"], "品牌", "萌维兔")
    assert request["filters"] == [{"name": "品牌", "op": "=", "value": "萌维兔"}]
    assert request["columns"] == [{"name": "商品标题"}, {"name": "品牌"}]
    assert request["metrics"] == [] and request["dimensions"] == []
    assert request["limit"] == MAX_ROWS


def test_build_request_caps_limit() -> None:
    assert build_request(["a"], "brand", "x", limit=9999)["limit"] == MAX_ROWS
