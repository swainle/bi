"""字段级血缘：文档解析（P4）."""

from __future__ import annotations

from app.dashboards.sources import field_hits_in_doc

DOC = {
    "views": [{
        "key": "main",
        "items": [
            {
                "key": "c_kpi", "type": "chart",
                "spec": {"kind": "kpi", "binding": {"dataset_id": 7, "metric": "日销量"}},
            },
            {
                "key": "c_bar", "type": "chart",
                "spec": {"kind": "bar", "binding": {"dataset_id": 7, "dimension": "平台", "metric": "热销指数"}},
            },
            {
                "key": "c_filter", "type": "filter",
                "spec": {"kind": "filter", "filter": {"fields": [
                    {"id": "category", "label": "品类", "column": "种类", "dataset_map": {"天猫": 7}},
                ]}},
            },
            {
                "key": "c_other", "type": "chart",
                "spec": {"kind": "kpi", "binding": {"dataset_id": 99, "metric": "日销量"}},
            },
        ],
    }],
}


def test_metric_and_dimension_hits() -> None:
    hits = field_hits_in_doc(DOC, 7, ["日销量", "平台", "热销指数"])
    assert [h["item_key"] for h in hits["日销量"]] == ["c_kpi"]      # 别的数据集的卡片不算
    assert hits["日销量"][0]["role"] == "metric"
    assert [h["item_key"] for h in hits["平台"]] == ["c_bar"]
    assert hits["平台"][0]["role"] == "dimension"
    assert [h["item_key"] for h in hits["热销指数"]] == ["c_bar"]


def test_filter_field_hit_via_dataset_map() -> None:
    hits = field_hits_in_doc(DOC, 7, ["种类"])
    assert len(hits["种类"]) == 1
    assert hits["种类"][0]["item_kind"] == "filter"
    assert hits["种类"][0]["role"] == "filter:品类"


def test_unused_field_and_unknown_dataset() -> None:
    assert field_hits_in_doc(DOC, 7, ["省份"])["省份"] == []
    assert field_hits_in_doc(DOC, 123, ["日销量"])["日销量"] == []
    assert field_hits_in_doc({}, 7, ["日销量"])["日销量"] == []
