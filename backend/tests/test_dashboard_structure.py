"""看板结构操作的纯函数：加页 / 删页 / 改名 / 发布（不连库）."""

import pytest

from app.dashboards.structure import (
    StructureError,
    add_view,
    publish_doc,
    remove_view,
    rename_view,
)


def doc(*keys, published=False):
    return {
        "version": 2.1,
        "published": published,
        "published_at": "",
        "views": [{"key": key, "title": key.upper(), "items": []} for key in keys],
    }


def test_add_view_appends_and_clamps_title():
    out = add_view(doc("a"), {"key": "b", "title": "  一个特别特别长的页面名字超过十六个字  ", "items": []})
    assert [v["key"] for v in out["views"]] == ["a", "b"]
    assert len(out["views"][1]["title"]) <= 16


def test_add_view_after_puts_it_right_after():
    out = add_view(doc("a", "b", "c"), {"key": "copy", "title": "副本"}, after="a")
    assert [v["key"] for v in out["views"]] == ["a", "copy", "b", "c"]


def test_add_view_after_unknown_appends():
    out = add_view(doc("a"), {"key": "b", "title": "B"}, after="nope")
    assert [v["key"] for v in out["views"]] == ["a", "b"]


def test_add_view_rejects_duplicate_and_missing_key():
    with pytest.raises(StructureError):
        add_view(doc("a"), {"key": "a"})
    with pytest.raises(StructureError):
        add_view(doc("a"), {"title": "没有 key"})
    with pytest.raises(StructureError):
        add_view(doc("a"), "不是对象")


def test_remove_view_keeps_others_untouched():
    source = doc("a", "b")
    source["views"][1]["items"] = [{"key": "x"}]
    out = remove_view(source, "a")
    assert [v["key"] for v in out["views"]] == ["b"]
    assert out["views"][0]["items"] == [{"key": "x"}]      # 别的页内容原样保留


def test_remove_view_refuses_last_page_and_unknown_key():
    with pytest.raises(StructureError):
        remove_view(doc("only"), "only")
    with pytest.raises(StructureError):
        remove_view(doc("a"), "missing")


def test_rename_view_clamps_and_rejects_unknown():
    out = rename_view(doc("a"), "a", "  " + "长" * 30 + "  ")
    assert out["views"][0]["title"] == "长" * 16
    assert rename_view(doc("a"), "a", "   ")["views"][0]["title"] == "页面"
    with pytest.raises(StructureError):
        rename_view(doc("a"), "missing", "x")


def test_publish_sets_flag_and_time():
    out = publish_doc(doc("a"))
    assert out["published"] is True
    assert out["published_at"]
    # 指定时间也照用（便于测试/补数据）
    assert publish_doc(doc("a"), "2026-11-24T12:00:00+08:00")["published_at"] == "2026-11-24T12:00:00+08:00"
