"""明细表列配置的规范化（颜色 / 行数 / 宽度 / 类型）—— 纯函数，不连库."""

from app.components.table_columns import COLUMN_TYPES, normalize_columns


def test_keeps_valid_column_fields():
    out = normalize_columns([
        {"key": "a", "label": "列头", "type": "number", "align": "right",
         "width": 120, "color": "#E11D48", "rows": 2, "format": "w"},
    ])
    assert out == [{
        "key": "a", "label": "列头", "type": "number", "align": "right",
        "width": 120, "color": "#E11D48", "rows": 2, "format": "w",
    }]


def test_label_defaults_to_key_and_type_falls_back():
    out = normalize_columns([{"key": "a", "type": "不存在的类型", "align": "center"}])
    assert out[0]["label"] == "a"
    assert out[0]["type"] == "text"
    assert out[0]["align"] == "center"


def test_rejects_non_hex_color():
    for color in ("red", "#GGGGGG", "rgb(0,0,0)", "#12", ""):
        out = normalize_columns([{"key": "a", "color": color}])
        assert "color" not in out[0], color


def test_accepts_short_and_long_hex():
    assert normalize_columns([{"key": "a", "color": "#ABC"}])[0]["color"] == "#ABC"
    assert normalize_columns([{"key": "a", "color": "#a1b2c3"}])[0]["color"] == "#a1b2c3"


def test_rows_clamped_and_zero_dropped():
    assert normalize_columns([{"key": "a", "rows": 99}])[0]["rows"] == 4
    assert normalize_columns([{"key": "a", "rows": -3}])[0].get("rows") is None
    assert normalize_columns([{"key": "a", "rows": "脏数据"}])[0].get("rows") is None
    assert normalize_columns([{"key": "a", "rows": 0}])[0].get("rows") is None


def test_width_clamped():
    assert normalize_columns([{"key": "a", "width": 9999}])[0]["width"] == 420
    assert normalize_columns([{"key": "a", "width": -5}])[0]["width"] == 0


def test_skips_entries_without_key_and_caps_at_20():
    assert normalize_columns([{"label": "没有 key"}]) == []
    rows = [{"key": f"c{i}"} for i in range(30)]
    assert len(normalize_columns(rows)) == 20


def test_empty_extras_are_not_written():
    out = normalize_columns([{"key": "a", "sub_key": "", "tag_split": ""}])
    assert "sub_key" not in out[0] and "tag_split" not in out[0]


def test_column_types_cover_renderer_set():
    assert set(COLUMN_TYPES) == {
        "text", "number", "percent", "money", "image", "badge", "rank", "dual", "tag", "date", "link",
    }


def test_link_type_is_kept():
    """明细表的「链接」列：存的是 URL，前端渲染成二维码按钮."""
    out = normalize_columns([{"key": "item_url", "label": "链接", "type": "link", "align": "left"}])
    assert out[0]["type"] == "link"
    assert "link" in COLUMN_TYPES
    assert normalize_columns([{"key": "x", "type": "link"}])[0]["type"] == "link"
