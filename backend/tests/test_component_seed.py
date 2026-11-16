"""组件库种子回归：模板必须真的能跑、字段必须真有、不许写死假数据.

2026-11-15 体检发现两类「假生效」：
  · `seed_base` 里 `_spec("词云")["chart"]` 直接 KeyError → 整个种子模块 import 失败，
    启动时被 `except` 吞掉，组件库永远停在旧版本（改模板不生效）；
  · 结论卡只放了一句占位文案、头标卡的 36/14/6 是写死的字符串 —— 换数据集就是假数字。
这份用例从「能不能 import / 每个模板能不能校验通过 / 有没有写死数字与占位符」三条守住。
"""

from __future__ import annotations

import datetime as dt

import pytest

from app.components import seed_base
from app.components.resolver import _format_time_dimension, _grain_label
from app.components.spec import validate_spec


def test_seed_imports_and_every_template_validates() -> None:
    """种子模块必须能 import（import 挂了 = 组件库永远不更新），每个模板都要过校验."""
    assert len(seed_base.BASE) >= 20
    codes = set()
    for code, name, kind, _category, _desc, spec in seed_base.BASE:
        assert code not in codes, f"组件 code 重复：{code}"
        codes.add(code)
        assert name and kind
        validate_spec(kind, spec)      # 校验不过 = 拖到画布上就报错


def test_banner_stats_are_data_driven() -> None:
    """头标卡右侧统计不许写死数字：必须绑到数据集列 + 聚合."""
    entry = next(item for item in seed_base.BASE if item[0] == "base.banner")
    stats = entry[5]["banner"]["stats"]
    assert stats
    for stat in stats:
        assert stat.get("metric"), f"统计项「{stat.get('label')}」没绑字段"
        assert stat.get("agg") in ("SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT")


def test_insight_uses_real_placeholders() -> None:
    """结论卡的句子必须只用「真绑定的指标」当占位符，不能留「{指标}」这种假占位."""
    entry = next(item for item in seed_base.BASE if item[0] == "base.insight")
    spec = entry[5]
    names = {spec["binding"]["metric"]} | {m["name"] for m in spec["binding"]["metrics"]}
    assert spec["binding"]["metric"], "结论卡没绑主指标"
    for item in spec["content"]["items"]:
        placeholders = set(__import__("re").findall(r"\{([^}]+)\}", item["v"]))
        assert placeholders <= names, f"占位符没有对应指标：{placeholders - names}"


def test_time_templates_keep_chronological_order() -> None:
    """折线 / 面积必须按维度（时间）升序，否则画出来是「值最大的几天」."""
    for code in ("base.line", "base.area"):
        entry = next(item for item in seed_base.BASE if item[0] == code)
        assert entry[5]["binding"].get("order_by_dimension") is True
        assert entry[5]["binding"].get("grain"), "时间序列模板要给个默认粒度（默认日会挤成一片）"


@pytest.mark.parametrize(("value", "grain", "expect"), [
    (dt.datetime(2026, 5, 1, 13, 20), "hour", "2026-05-01 13:00"),
    (dt.datetime(2026, 5, 1), "day", "2026-05-01"),
    (dt.datetime(2026, 5, 1), "month", "2026-05"),
    (dt.datetime(2026, 5, 1), "quarter", "2026-Q2"),
    (dt.date(2026, 5, 1), "year", "2026"),
])
def test_grain_label(value, grain, expect) -> None:
    assert _grain_label(value, grain) == expect


def test_time_dimension_is_formatted_for_charts() -> None:
    """时间维度不能把 datetime 原样丢给前端（横轴会显示 2026-05-01T00:00:00+08:00）."""
    from types import SimpleNamespace

    from app.components.spec import validate_spec

    spec = validate_spec("line", {"title": "趋势", "binding": {"dimension": "上架时间", "metric": "日销量",
                                                              "grain": "month"}})
    dataset = SimpleNamespace(field_by_name=lambda name: SimpleNamespace(role="time", default_grain="day"))
    rows = [{"上架时间": dt.datetime(2026, 5, 1), "日销量": 10}]
    out = _format_time_dimension(rows, dataset, spec)
    assert out[0]["上架时间"] == "2026-05"


def test_non_time_dimension_untouched() -> None:
    from types import SimpleNamespace

    spec = validate_spec("bar", {"title": "分布", "binding": {"dimension": "平台", "metric": "日销量"}})
    dataset = SimpleNamespace(field_by_name=lambda name: SimpleNamespace(role="dimension", default_grain=None))
    rows = [{"平台": "平台A", "日销量": 10}]
    assert _format_time_dimension(rows, dataset, spec)[0]["平台"] == "平台A"


# ── 指标卡右上角徽标的弹窗（独立 TOP N 榜单）────────────────────
def test_kpi_template_ships_with_top_popup() -> None:
    entry = next(item for item in seed_base.BASE if item[0] == "base.kpi")
    top = entry[5]["top"]
    assert top["enabled"] is True
    assert top["dim"] and top["metric"], "弹窗必须配好维度与指标"
    assert top["agg"] in ("SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT")
    assert 1 <= top["top_n"] <= 200
    assert top["columns"], "至少给几列明细，弹窗才有内容"


def test_top_list_spec_clamps_and_dedupes() -> None:
    from app.components.spec import validate_spec

    spec = validate_spec("kpi", {
        "title": "日销量",
        "binding": {"metric": "日销量"},
        "top": {"enabled": True, "top_n": 999, "page_size": 1, "agg": "nope",
                "columns": ["品牌", "品牌", " ", "榜单"]},
    })
    assert spec.top.top_n == 200
    assert spec.top.page_size == 5
    assert spec.top.agg == "SUM"
    assert spec.top.columns == ["品牌", "榜单"]


def test_top_list_off_by_default() -> None:
    from app.components.spec import validate_spec

    spec = validate_spec("kpi", {"title": "日销量", "binding": {"metric": "日销量"}})
    assert spec.top.enabled is False
