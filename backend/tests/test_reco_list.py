"""推荐列表（reco_list）的规格校验与 payload 组装.

都是纯函数：直接喂 rows，不连库（需求端表还没导数据，组件也要能验收）。
"""

import pytest

from app.components.reco import build_reco, reco_tags
from app.components.spec import KINDS, ROLES, ComponentSpecError, validate_spec


def spec(**overrides):
    """一份最小可用的推荐列表 spec：5 个取值列全部显式声明."""
    raw = {
        "title": "推荐",
        "binding": {
            "dataset_id": 6, "dimension": "搜索词", "metric": "搜索人气", "agg": "AVG",
            "top_n": 10, "sort": "desc", "limit": 500,
            "metrics": [
                {"name": "点击率", "agg": "AVG"},
                {"name": "支付转化率", "agg": "AVG"},
                {"name": "需求供给比", "agg": "AVG"},
                {"name": "搜索增速", "agg": "AVG"},
            ],
        },
        "reco": {
            "value_key": "搜索人气", "ctr_key": "点击率", "cvr_key": "支付转化率",
            "ds_key": "需求供给比", "g_key": "搜索增速",
        },
    }
    raw.update(overrides)
    return validate_spec("reco_list", raw)


ROWS = [
    {"搜索词": "冻干", "搜索人气": 60000, "点击率": 0.79, "支付转化率": 32.5,
     "需求供给比": 12.0, "搜索增速": 220.0, "来源": "人气·相关"},
    {"搜索词": "猫条", "搜索人气": 30000, "点击率": 0.55, "支付转化率": 18.0,
     "需求供给比": 2.0, "搜索增速": 40.0, "来源": "人气"},
    {"搜索词": "猫粮", "搜索人气": 2000, "点击率": 0.30, "支付转化率": 8.0,
     "需求供给比": 0.5, "搜索增速": 5.0, "来源": "增速"},
]


def test_kind_registered_as_data_component():
    assert "reco_list" in KINDS
    assert ROLES["reco_list"] == "data"


def test_requires_dimension_and_metric():
    with pytest.raises(ComponentSpecError):
        validate_spec("reco_list", {"title": "x", "binding": {"metric": "搜索人气"}})
    with pytest.raises(ComponentSpecError):
        validate_spec("reco_list", {"title": "x", "binding": {"dimension": "搜索词"}})


def test_value_key_defaults_to_metric():
    """没单独配 value_key 时沿用人气指标，避免「配了指标却不参与评分」."""
    item = validate_spec("reco_list", {
        "title": "推荐",
        "binding": {"dimension": "搜索词", "metric": "搜索人气"},
        "reco": {},
    })
    assert item.reco.value_key == "搜索人气"


def test_weights_clamped_and_unknown_keys_dropped():
    item = spec(reco={"weights": {"v": 2, "cvr": -1, "nope": 0.9}})
    assert item.reco.weights == {"v": 1.0, "cvr": 0.0}


def test_stats_limited_to_three():
    item = spec(reco={"stats": [{"key": f"k{i}", "label": f"L{i}"} for i in range(5)]})
    assert len(item.reco.stats) == 3


def test_trend_days_and_score_label_clamped():
    item = spec(reco={"trend_days": 99, "score_label": "一个特别长的分数名称"})
    assert item.reco.trend_days == 30
    assert len(item.reco.score_label) <= 8


def test_scores_sorted_by_opportunity_and_ranked():
    payload = build_reco(ROWS, spec())
    items = payload["reco_items"]
    assert [item["name"] for item in items] == ["冻干", "猫条", "猫粮"]
    assert [item["rank"] for item in items] == [1, 2, 3]
    assert items[0]["score"] > items[1]["score"] > items[2]["score"]
    # 权重 0.45/0.30/0.25 全部拿满 = 100；这里人气最高但转化/缺口未满，落在 90 出头
    assert 90 <= items[0]["score"] <= 100
    assert 0 <= items[-1]["score"] < items[1]["score"]


def test_top_n_truncates_but_count_keeps_all():
    payload = build_reco(ROWS, spec(binding={**spec().binding.model_dump(), "top_n": 2}))
    assert len(payload["reco_items"]) == 2
    assert payload["count"] == 3
    assert payload["reco_meta"]["total"] == 3


def test_rate_columns_accept_both_ratio_and_percent():
    """点击率 0.79（比例）与 79（百分数）必须得到同一个展示值 79%."""
    ratio_rows = [{"搜索词": "a", "搜索人气": 10, "点击率": 0.79, "支付转化率": 0.325,
                   "需求供给比": 1, "搜索增速": 0}]
    percent_rows = [{"搜索词": "a", "搜索人气": 10, "点击率": 79, "支付转化率": 32.5,
                     "需求供给比": 1, "搜索增速": 0}]
    ratio_item = build_reco(ratio_rows, spec())["reco_items"][0]
    percent_item = build_reco(percent_rows, spec())["reco_items"][0]
    assert ratio_item["ctr"] == percent_item["ctr"] == 79.0
    assert ratio_item["cvr"] == percent_item["cvr"] == 32.5
    assert ratio_item["score"] == percent_item["score"]


def test_meta_averages_and_directions():
    payload = build_reco(ROWS, spec())
    meta = payload["reco_meta"]
    assert meta["avg_ctr"] == pytest.approx((79 + 55 + 30) / 3, abs=0.01)
    assert meta["avg_cvr"] == pytest.approx((32.5 + 18 + 8) / 3, abs=0.01)
    top = payload["reco_items"][0]
    ctr_cell = next(cell for cell in top["stats"] if cell["f"] == "pct")
    assert ctr_cell["dir"] == "up"
    bottom = payload["reco_items"][-1]
    assert all(cell["dir"] in ("", "down") for cell in bottom["stats"])


def test_stats_fall_back_to_value_conversion_score():
    """参考页「汇总推荐」的行内三项：人气 / 转化率 / 机会分（机会分是算出来的保留键）."""
    payload = build_reco(ROWS, spec(reco={"value_key": "搜索人气", "ctr_key": "点击率",
                                          "cvr_key": "支付转化率", "stats": []}))
    cells = payload["reco_items"][0]["stats"]
    assert [cell["k"] for cell in cells] == ["搜索人气", "支付转化率", "机会分"]
    assert [cell["f"] for cell in cells] == ["int", "pct", "score"]
    assert cells[2]["v"] == payload["reco_items"][0]["score"]


def test_tag_rules_match_template():
    assert reco_tags(60000, 60000, 32.5, 12, 220, "人气·相关") == ["人气高", "转化好", "缺口大"]
    assert reco_tags(100, 60000, 10, 0.5, 5, "增速") == []
    assert "多表命中" in reco_tags(1, 1, 0, 0, 0, "人气|相关|增速")
    assert len(reco_tags(60000, 60000, 40, 20, 300, "a·b")) == 3


def test_custom_stats_and_bar_key_flow_through():
    custom = spec(reco={
        "value_key": "搜索人气", "ctr_key": "点击率", "cvr_key": "支付转化率",
        "stats": [{"key": "点击率", "label": "CTR", "format": "pct"}],
        "bar_key": "支付转化率", "score_label": "机会",
    })
    payload = build_reco(ROWS, custom)
    assert [cell["k"] for cell in payload["reco_items"][0]["stats"]] == ["CTR"]
    assert payload["bar_key"] == "支付转化率"
    assert payload["score_label"] == "机会"


def test_empty_rows_do_not_crash():
    payload = build_reco([], spec())
    assert payload["reco_items"] == []
    assert payload["reco_meta"]["total"] == 0
    assert payload["count"] == 0


def test_detail_flags_exposed_for_renderer():
    payload = build_reco(ROWS, spec(reco={"trend_days": 14, "detail": False}))
    assert payload["reco_detail"] is False
    assert payload["reco_trend_days"] == 14
