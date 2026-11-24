"""辅助列引用回归：换绑数据集后旧字段残留不能把整张卡打成报错.

场景（2026-11-15「666」实测）：明细表的缩略图字段还是直连表的 `主图ID`，
卡片已切到「测试-01」，结果整张明细表只剩一行「天猫：未知字段：主图ID」。
缩略图 / 图表轴 / 排行取值列都是挂载用参数，缺了应当降级，用户显式绑定的
维度 / 指标仍然照旧报错（那是有意的提示）。
"""

from __future__ import annotations

from app.components.resolver import _prune_aux_refs
from app.components.spec import validate_spec

FIELDS = {"品牌", "日销量", "主图_id"}


def _table(**extra):
    payload = {
        "title": "明细表",
        "binding": {"dataset_id": 20, "dimensions": ["品牌"]},
        "table_view": {"thumb": True, "thumb_key": "主图ID"},
    }
    payload.update(extra)
    return validate_spec("table", payload)


def test_missing_thumb_key_is_dropped_but_thumb_stays_on() -> None:
    spec = _table()
    pruned = _prune_aux_refs(spec, FIELDS)
    assert pruned.table_view.thumb is True
    assert pruned.table_view.thumb_key == ""
    # 用户显式绑定的列一个不动
    assert pruned.binding.dimensions == ["品牌"]


def test_valid_thumb_key_is_kept() -> None:
    spec = _table(table_view={"thumb": True, "thumb_key": "主图_id"})
    pruned = _prune_aux_refs(spec, FIELDS)
    assert pruned.table_view.thumb_key == "主图_id"


def test_missing_chart_and_rank_keys_are_dropped() -> None:
    spec = validate_spec("rank_list", {
        "title": "排行",
        "binding": {"dataset_id": 20, "dimension": "品牌", "metric": "日销量"},
        "rank": {"value_key": "不存在", "x_key": "日销量", "tags_key": "也没有"},
        "chart": {"x_key": "品牌", "y_key": "不存在2"},
    })
    pruned = _prune_aux_refs(spec, FIELDS)
    assert pruned.rank.value_key == "" and pruned.rank.tags_key == ""
    assert pruned.rank.x_key == "日销量"
    assert pruned.chart.x_key == "品牌" and pruned.chart.y_key == ""


def test_table_columns_keep_metric_names() -> None:
    """表格列配置可能按指标名写（例：「三张表的构成」的 词数 / 覆盖人气），不能当成死字段删掉。"""
    spec = _table(table_view={"thumb": False, "columns": [{"key": "品牌"}, {"key": "词数"}]})
    pruned = _prune_aux_refs(spec, FIELDS | {"词数"})
    assert [c["key"] for c in pruned.table_view.columns] == ["品牌", "词数"]


def test_stale_table_columns_are_dropped() -> None:
    spec = _table(table_view={
        "thumb": False,
        "columns": [{"key": "品牌"}, {"key": "旧列"}],
    })
    pruned = _prune_aux_refs(spec, FIELDS)
    assert [c["key"] for c in pruned.table_view.columns] == ["品牌"]


def test_no_field_list_returns_spec_untouched() -> None:
    spec = _table()
    assert _prune_aux_refs(spec, set()) is spec


def test_stale_extra_metrics_extras_and_tooltip_keys_are_dropped() -> None:
    """换绑数据集后「附加指标 / 附加字段 / 提示框字段」残留：降级成少几列，而不是整卡报错.

    2026-11-24 实测：散点从「榜单端」复制到「词级」数据集，`rank_position / final_price`
    还留在 binding.metrics 里 → 整张卡只显示「未知字段：rank_position（数据集 …）」。
    """
    spec = validate_spec("scatter", {
        "title": "需求 × 供给",
        "binding": {
            "dataset_id": 17, "dimension": "关键词", "metric": "人气",
            "metrics": [{"name": "排名", "agg": "MAX"}, {"name": "人气", "agg": "SUM"}],
        },
        "chart": {
            "x_key": "人气", "size_key": "转化",
            "extras": [{"label": "转化率", "key": "转化"}, {"label": "旧", "key": "排名"}],
            "tooltip_keys": ["排名", "转化"],
        },
    })
    pruned = _prune_aux_refs(spec, {"关键词", "人气", "转化"})
    assert [m["name"] for m in pruned.binding.metrics] == ["人气"]
    assert [row["key"] for row in pruned.chart.extras] == ["转化"]
    assert pruned.chart.tooltip_keys == ["转化"]
    assert pruned.chart.x_key == "人气" and pruned.chart.size_key == "转化"


def test_primary_bindings_are_left_to_the_compiler() -> None:
    """维度 / 指标是用户显式绑定的口径：不静默改掉，仍然交给 compiler 报「未知字段」."""
    spec = validate_spec("bar", {
        "title": "柱",
        "binding": {"dataset_id": 17, "dimension": "不存在的维度", "metric": "不存在的指标"},
    })
    pruned = _prune_aux_refs(spec, {"关键词", "人气"})
    assert pruned.binding.dimension == "不存在的维度"
    assert pruned.binding.metric == "不存在的指标"
