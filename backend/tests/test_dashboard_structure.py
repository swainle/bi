"""看板结构操作的纯函数：加页 / 删页 / 改名 / 发布（不连库）."""

import pytest

from app.dashboards.structure import (
    StructureError,
    add_view,
    clone_view,
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


def test_clone_view_regenerates_keys_and_keeps_bindings():
    """跨项目复制：页 key / 元素 key / 参考线 id 重新生成，数据集绑定原样保留."""
    view = {
        "key": "p1", "title": "页1",
        "items": [
            {"key": "c_mw1", "spec": {"binding": {"dataset_id": 20, "metric": "daily_deal"}}},
            {"key": "c_mw2"},
        ],
        "items_map": {"天猫": [{"key": "c_x1"}]},
        "guides": [{"id": "g_1", "x": 10}],
    }
    out = clone_view(view, "abc")
    assert out["key"] == "page_abc"
    assert out["title"] == "页1"
    assert [item["key"] for item in out["items"]] == ["c_mw_abc0", "c_mw_abc1"]
    assert out["items"][0]["spec"]["binding"] == {"dataset_id": 20, "metric": "daily_deal"}
    assert list(out["items_map"]) == ["天猫"]
    assert out["items_map"]["天猫"][0]["key"] == "c_x_abc0"
    assert out["guides"][0]["id"] == "g_abc0"
    # 深拷贝：改副本不影响源页面
    out["items"][0]["spec"]["binding"]["dataset_id"] = 99
    assert view["items"][0]["spec"]["binding"]["dataset_id"] == 20


def test_clone_view_titles_do_not_collide():
    assert clone_view({"key": "p", "title": "页1"}, "s")["title"] == "页1"
    assert clone_view({"key": "p", "title": "页1"}, "s", existing_titles={"页1"})["title"] == "页1 副本"
    assert clone_view({"key": "p", "title": "页1"}, "s", "自定义")["title"] == "自定义"
    long_title = clone_view({"key": "p", "title": "这是特别特别特别长的页面名字超过十六个字了"}, "s")["title"]
    assert len(long_title) <= 16
    with pytest.raises(StructureError):
        clone_view("不是页面", "s")
