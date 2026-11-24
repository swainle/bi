"""散点四象限的阈值 / 提示框附加指标 / 气泡对数（纯函数，不连库）."""

from app.components.compute import build_scatter
from app.components.spec import validate_spec

ROWS = [
    {"商品": "A", "需求指数": 5000, "需求供给比": 6935, "人气": 3695833, "转化率": 0.25},
    {"商品": "B", "需求指数": 20, "需求供给比": 50, "人气": 100, "转化率": 1.5},
    {"商品": "C", "需求指数": 900, "需求供给比": 4000, "人气": 2000, "转化率": 3.0},
]


def spec(**chart):
    return validate_spec("scatter", {
        "title": "需求 × 供给",
        "binding": {"dimension": "商品", "metric": "需求指数"},
        "chart": {"scatter_mode": "quadrant", "x_key": "需求供给比", "size_key": "人气", **chart},
    })


def test_thresholds_default_to_medians():
    out = build_scatter(ROWS, spec())
    assert out["medians"] == out["auto_medians"]
    assert out["medians"]["x"] == 4000          # 50 / 4000 / 6935 的中位数
    assert out["medians"]["y"] == 900


def test_custom_thresholds_drive_quadrants_and_lines():
    out = build_scatter(ROWS, spec(quad_x=1000, quad_y=1000))
    assert out["medians"] == {"x": 1000.0, "y": 1000.0}      # 画线用生效阈值
    assert out["auto_medians"]["x"] == 4000                  # 中位数仍然带回去
    quads = {row["name"]: row["quad"] for row in out["series"]}
    # A 双高=蓝海，B 双低=放弃，C 高竞争低需求=红海
    assert quads == {"A": "blue", "B": "drop", "C": "red"}


def test_quadrant_uses_metric_as_y_when_y_key_empty():
    """纵轴没单独指定时用主指标，不能当成 0（否则象限只按 X 轴切）."""
    rows = [
        {"商品": "高指数低比", "需求指数": 9000, "需求供给比": 10},
        {"商品": "低指数高比", "需求指数": 10, "需求供给比": 9000},
        {"商品": "双高", "需求指数": 9000, "需求供给比": 9000},
        {"商品": "双低", "需求指数": 10, "需求供给比": 10},
    ]
    out = build_scatter(rows, spec())
    quads = {row["name"]: row["quad"] for row in out["series"]}
    assert quads["双高"] == "blue"
    assert quads["双低"] == "drop"
    assert quads["高指数低比"] in ("pot", "red")


def test_tooltip_extras_and_size_log_flags():
    out = build_scatter(ROWS, spec(tooltip_keys=["转化率", "人气"], size_log=True))
    assert out["series"][0]["extras"] == [
        {"label": "转化率", "key": "转化率", "value": 0.25},
        {"label": "人气", "key": "人气", "value": 3695833},
    ]
    assert out["size_log"] is True


def test_extra_fields_use_custom_labels_and_are_unlimited():
    """面板「＋ 添加」的附加字段：说明可以自己写，不限数量（旧的 tooltip_keys 也一起算）."""
    extras = [{"label": f"说明{i}", "key": key, "agg": ""}
              for i, key in enumerate(["转化率", "人气", "需求指数", "需求供给比", "转化率"])]
    out = build_scatter(ROWS, spec(extras=extras + [{"label": "空行", "key": ""}], tooltip_keys=["需求指数"]))
    assert [row["label"] for row in out["series"][0]["extras"]] == [
        "说明0", "说明1", "说明2", "说明3", "说明4",      # 重复字段不去重（用户显式加了两次）
    ]
    assert out["series"][0]["extras"][0]["key"] == "转化率"
    assert out["series"][0]["extras"][0]["value"] == 0.25
    assert "空行" not in [row["label"] for row in out["series"][0]["extras"]]   # 没绑字段的跳过


def test_legacy_tooltip_keys_still_work():
    out = build_scatter(ROWS, spec(tooltip_keys=["转化率"]))
    assert out["series"][0]["extras"] == [{"label": "转化率", "key": "转化率", "value": 0.25}]


def test_no_extras_when_not_configured():
    out = build_scatter(ROWS, spec())
    assert out["tooltip_keys"] == []
    assert "extras" not in out["series"][0]
    assert out["size_log"] is False


def test_scatter_axis_aggregations():
    """X / Y 轴的聚合：面板里各选一个；Y 留空时跟随指标聚合."""
    from app.components.resolver import scatter_aggs

    picked = validate_spec("scatter", {
        "title": "T", "binding": {"dimension": "商品", "metric": "需求指数", "agg": "AVG"},
        "chart": {"x_key": "均价", "y_key": "需求指数", "x_agg": "SUM", "y_agg": "MIN"},
    })
    assert scatter_aggs(picked) == {"均价": "SUM", "需求指数": "MIN"}

    default = validate_spec("scatter", {
        "title": "T", "binding": {"dimension": "商品", "metric": "需求指数", "agg": "AVG"},
        "chart": {"x_key": "均价", "y_key": "需求指数"},
    })
    assert scatter_aggs(default) == {"均价": "MAX", "需求指数": "AVG"}

    broken = validate_spec("scatter", {
        "title": "T", "binding": {"dimension": "商品", "metric": "需求指数"},
        "chart": {"x_key": "均价", "x_agg": "不存在的聚合"},
    })
    assert scatter_aggs(broken)["均价"] == "MAX"      # 非法值回落，不让 500 冒出来


def test_score_field_mode_uses_dataset_column():
    """「用数据字段」：机会分直接取该列的值（夹到 0~100），象限照旧按两条轴."""
    rows = [
        {"关键词": "A", "人气": 9000, "供需比": 9000, "分值": 88},
        {"关键词": "B", "人气": 200, "供需比": 100, "分值": 12},
        {"关键词": "C", "人气": 8000, "供需比": 3000, "分值": 260},
    ]
    spec = validate_spec("scatter", {
        "title": "T", "binding": {"dimension": "关键词", "metric": "人气"},
        "chart": {"scatter_mode": "quadrant", "x_key": "人气", "y_key": "供需比",
                  "score_mode": "field", "score_key": "分值"},
    })
    out = build_scatter(rows, spec)
    assert [p["score"] for p in out["series"]] == [88, 12, 100]      # 260 被夹到 100


def test_score_custom_mode_uses_own_fields_and_keeps_quadrants():
    """「自定义三项」：分量字段和权重由面板决定，但象限仍然按画出来的 X/Y 轴判定."""
    rows = [
        {"关键词": "A", "人气": 5000, "供需比": 9000, "转化": 1.5, "热度": 30},
        {"关键词": "B", "人气": 200, "供需比": 100, "转化": 0.2, "热度": 90},
        {"关键词": "C", "人气": 8000, "供需比": 3000, "转化": 6.0, "热度": 60},
    ]
    base = {"title": "T", "binding": {"dimension": "关键词", "metric": "人气"},
            "chart": {"scatter_mode": "quadrant", "x_key": "供需比", "y_key": "人气"}}
    auto = build_scatter(rows, validate_spec("scatter", base))
    custom = build_scatter(rows, validate_spec("scatter", {
        **base, "chart": {**base["chart"], "score_mode": "custom",
                          "score_fields": {"v": "热度", "cvr": "转化", "ds": "供需比"},
                          "score_weights": {"v": 0.6, "cvr": 0.3, "ds": 0.1}},
    }))
    assert [p["quad"] for p in custom["series"]] == [p["quad"] for p in auto["series"]]
    assert [p["score"] for p in custom["series"]] != [p["score"] for p in auto["series"]]


def test_score_auto_mode_is_default():
    rows = [{"关键词": "A", "人气": 10, "供需比": 10}]
    spec = validate_spec("scatter", {
        "title": "T", "binding": {"dimension": "关键词", "metric": "人气"},
        "chart": {"scatter_mode": "quadrant", "x_key": "人气", "y_key": "供需比"},
    })
    assert spec.chart.score_mode == "auto"
    assert build_scatter(rows, spec)["series"][0]["score"] >= 0
