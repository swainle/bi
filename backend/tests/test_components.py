"""组件库回归：规格校验 + 计算规则（纯函数）."""

from __future__ import annotations

import pytest

from app.components.compute import (
    bucket_series,
    build_payload,
    build_rank,
    build_table,
    explode_tokens,
    fmt_number,
    headline_value,
    hint_text,
)
from app.components.spec import (
    ComponentSpec,
    ComponentSpecError,
    validate_kind,
    validate_spec,
)


# ── 规格校验 ────────────────────────────────────────────────
@pytest.mark.parametrize("top_n", [1, 5, 12, 30])
@pytest.mark.parametrize("sort", ["asc", "desc"])
def test_rank_uses_row_limit_after_sorting(top_n: int, sort: str) -> None:
    rows = [{"商品": f"商品{i}", "销量": i} for i in [3, 12, 1, 9, 5, 11, 2, 10, 4, 8, 6, 7]]
    spec = ComponentSpec(
        title="排行",
        binding={"dimension": "商品", "metric": "销量", "top_n": top_n, "sort": sort},
        rank={"max_items": 2},
    )
    payload = build_rank(rows, spec)
    expected = sorted(rows, key=lambda row: row["销量"], reverse=sort == "desc")[:top_n]
    assert payload["items"] == [{"name": row["商品"], "value": row["销量"]} for row in expected]
    assert payload["count"] == len(rows)


def test_rank_row_limit_handles_empty_data() -> None:
    assert build_rank([], ComponentSpec(title="排行", binding={"top_n": 5}))["items"] == []


@pytest.mark.parametrize("fields", [["item_id", "销量"], ["销量", "item_id", "店铺"]])
def test_table_custom_header_preserves_other_columns_and_field_order(fields: list[str]) -> None:
    spec = ComponentSpec(
        title="明细表", binding={"dimensions": fields},
        table_view={"columns": [{"key": "item_id", "label": "商品编号", "width": 120}]},
    )
    rows = [{"item_id": "123", "销量": 20, "店铺": "旗舰店"}]
    payload = build_table(rows, spec)
    assert [column["key"] for column in payload["columns"]] == fields
    columns = {column["key"]: column for column in payload["columns"]}
    assert columns["item_id"]["label"] == "商品编号"
    assert columns["item_id"]["width"] == 120
    assert columns["销量"]["label"] == "销量"
    assert columns["销量"]["type"] == "number"
    assert payload["rows"] == rows


def test_table_headers_handle_removed_fields_empty_data_and_thumbnails() -> None:
    spec = ComponentSpec(
        title="明细表", binding={"dimensions": ["item_id", "主图"]},
        table_view={"thumb": True, "thumb_key": "主图", "columns": [
            {"key": "item_id", "label": "商品编号"}, {"key": "旧字段", "label": "旧列头"},
        ]},
    )
    assert build_table([], spec)["columns"] == [spec.table_view.columns[0]]


def test_table_blank_header_falls_back_to_field_name() -> None:
    spec = ComponentSpec(title="明细表", binding={"dimensions": ["item_id"]},
                         table_view={"columns": [{"key": "item_id", "label": ""}]})
    assert build_table([], spec)["columns"][0]["label"] == "item_id"


def test_kind_whitelist() -> None:
    assert validate_kind("KPI") == "kpi"
    with pytest.raises(ComponentSpecError):
        validate_kind("pie3d")


def test_kpi_requires_metric() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("kpi", {"title": "日销量"})


def test_latest_kpi_allows_no_metric() -> None:
    spec = validate_spec("kpi", {"title": "上架时间", "compute": {"headline": "latest"}})
    assert spec.compute.headline == "latest"


def test_bar_requires_dimension() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("bar", {"title": "分布", "binding": {"metric": "日销量"}})


def test_funnel_requires_dimension() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("funnel", {"title": "漏斗", "binding": {"metric": "日销量"}})
    ok = validate_spec("funnel", {"title": "漏斗", "binding": {"dimension": "平台", "metric": "日销量"}})
    assert ok.binding.dimension == "平台"


def test_map_requires_dimension_and_metric() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("map", {"title": "省份分布"})
    ok = validate_spec("map", {"title": "省份分布",
                               "binding": {"dimension": "省份", "metric": "日销量"}})
    assert ok.binding.dimension == "省份"


def test_map_payload_keeps_all_regions() -> None:
    spec = validate_spec("map", {"title": "省份分布",
                                 "binding": {"dimension": "省份", "metric": "日销量", "top_n": 10}})
    rows = [{"name": f"省{i}", "value": i} for i in range(1, 31)]
    payload = build_payload("map", rows, spec)
    assert len(payload["series"]) == 30
    assert payload["total"] == sum(range(1, 31))


def test_gauge_requires_metric() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("gauge", {"title": "仪表盘"})
    ok = validate_spec("gauge", {"title": "仪表盘", "binding": {"metric": "日销量"}})
    assert ok.binding.metric == "日销量"


def test_radar_waterfall_require_dimension_and_metric() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("radar", {"title": "雷达", "binding": {"metric": "日销量"}})
    with pytest.raises(ComponentSpecError):
        validate_spec("waterfall", {"title": "瀑布", "binding": {"dimension": "价格带"}})
    radar = validate_spec("radar", {"title": "雷达", "binding": {"dimension": "平台", "metric": "日销量"}})
    fall = validate_spec("waterfall", {"title": "瀑布", "binding": {"dimension": "价格带", "metric": "日销量"}})
    assert radar.binding.dimension == "平台"
    assert fall.binding.metric == "日销量"


def test_heatmap_requires_two_dims() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("heatmap", {"title": "矩阵", "binding": {"dimension": "平台"}})
    ok = validate_spec("heatmap", {"title": "矩阵", "binding": {"dimension": "平台", "series": "价格带"}})
    assert ok.binding.series == "价格带"


def test_spec_rejects_bad_aggregate() -> None:
    with pytest.raises(ComponentSpecError):
        validate_spec("kpi", {"title": "x", "binding": {"metric": "日销量", "agg": "EVIL"}})


def test_title_length_limit() -> None:
    with pytest.raises(ComponentSpecError):
        ComponentSpec(title="超" * 60)


def test_ui_accent_falls_back() -> None:
    spec = ComponentSpec(title="x", ui={"accent": "rainbow"})
    assert spec.ui.accent == "indigo"


# ── 数值格式化 ──────────────────────────────────────────────
@pytest.mark.parametrize("value,fmt,expected", [
    (1234, "int", "1,234"),
    (12345, "w", "1.2万"),
    (0.42, "pct", "42.0%"),
    (1234.5, "money", "¥1,234.50"),
    ("2026-11-03", "date", "2026-11-03"),
    (None, "int", "-"),
])
def test_fmt_number(value, fmt, expected) -> None:
    assert fmt_number(value, fmt) == expected


# ── 大数字规则 ──────────────────────────────────────────────
ROWS = [{"name": "A", "value": 100}, {"name": "B", "value": 60}, {"name": "C", "value": 40}]


def _spec(**compute) -> ComponentSpec:
    return ComponentSpec(title="t", binding={"top_n": 2}, compute=compute)


def test_headline_rules() -> None:
    assert headline_value(ROWS, _spec(headline="first")) == 100
    assert headline_value(ROWS, _spec(headline="max")) == 100
    assert headline_value(ROWS, _spec(headline="min")) == 40
    assert headline_value(ROWS, _spec(headline="total")) == 200
    assert headline_value(ROWS, _spec(headline="mode")) == "A"


def test_headline_latest_uses_value_when_no_name() -> None:
    rows = [{"name": None, "value": "2026-11-03"}, {"name": None, "value": "2026-12-25"}]
    assert headline_value(rows, _spec(headline="latest")) == "2026-12-25"


def test_hint_rules() -> None:
    assert hint_text(ROWS, _spec(hint="sum_topn")) == "前2合计 160"
    assert hint_text(ROWS, _spec(hint="avg_topn")) == "前2平均 80"
    assert hint_text(ROWS, _spec(hint="total")) == "合计 200"
    assert hint_text(ROWS, _spec(hint="none")) == ""


def test_hint_count_topn() -> None:
    rows = [{"name": "a", "value": 1}, {"name": "b", "value": 2}, {"name": "c", "value": 20}]
    assert hint_text(rows, _spec(hint="count_topn")) == "前2名 SKU 2 个"


# ── 分档 ────────────────────────────────────────────────────
def test_bucket_series() -> None:
    rows = [{"value": v} for v in (1, 5, 11, 25, 99)]
    series = bucket_series(rows, size=10, start=1, count=3)
    assert [s["value"] for s in series] == [2, 1, 2]
    assert series[-1]["name"] == "≥21"


def test_bucket_series_empty_when_disabled() -> None:
    assert bucket_series([{"value": 1}], size=0, start=None, count=0) == []


# ── 词云拆词 ────────────────────────────────────────────────
def test_explode_tokens() -> None:
    rows = [{"name": "高鲜肉/养胃护肠", "value": 1}, {"name": "高鲜肉 / 低脂", "value": 2}]
    tokens = {t["name"]: t["value"] for t in explode_tokens(rows, "/")}
    assert tokens["高鲜肉"] == 3
    assert tokens["养胃护肠"] == 1
    assert tokens["低脂"] == 2


# ── payload 组装 ────────────────────────────────────────────
def test_build_payload_kpi() -> None:
    payload = build_payload("kpi", ROWS, _spec(headline="max", hint="sum_topn"))
    assert payload["value"] == "100"
    assert payload["hint"] == "前2合计 160"
    assert payload["kind"] == "kpi"


def test_build_payload_bar_limits_topn() -> None:
    payload = build_payload("bar", ROWS, _spec())
    assert len(payload["series"]) == 2          # 显示条数按 top_n 截断
    assert payload["total"] == 200              # 合计覆盖全量（算占比用）


def test_build_payload_funnel_drops_non_positive() -> None:
    rows = [
        {"name": "A", "value": 100},
        {"name": "B", "value": 60},
        {"name": "C", "value": 0},
        {"name": "D", "value": -5},
    ]
    spec = ComponentSpec(title="漏斗", binding={"dimension": "平台", "metric": "日销量", "top_n": 10})
    payload = build_payload("funnel", rows, spec)
    assert [item["name"] for item in payload["series"]] == ["A", "B"]
    assert payload["total"] == 160


def test_build_payload_gauge_auto_ceiling() -> None:
    rows = [{"name": "全部", "value": 126033}]
    spec = ComponentSpec(title="目标", binding={"metric": "日销量", "agg": "SUM"})
    payload = build_payload("gauge", rows, spec)
    assert payload["gauge_value"] == 126033
    assert payload["max"] == 150000


def test_build_payload_gauge_respects_y_max() -> None:
    rows = [{"name": "全部", "value": 100}]
    spec = ComponentSpec(title="目标", binding={"metric": "日销量"}, chart={"y_max": 500})
    payload = build_payload("gauge", rows, spec)
    assert payload["max"] == 500
