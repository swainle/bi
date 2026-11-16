"""AI 版面算法的单元测试（S4）—— 纯函数，不依赖数据库."""

from __future__ import annotations

from app.ai.layout import bounds_of, plan_layout


def _kpi(key: str, x: int, y: int, w: int = 200, h: int = 104) -> dict:
    return {"key": key, "type": "chart", "kind": "kpi", "x": x, "y": y, "w": w, "h": h}


def test_six_cards_in_one_row():
    items = [_kpi(f"c{i}", i * 210, 40) for i in range(6)]
    result = plan_layout(items, width=1440, gap=16)
    ops = {op["key"]: op for op in result["ops"]}
    assert len(ops) == 6
    assert [ops[f"c{i}"]["x"] for i in range(6)] == [0, 240, 480, 720, 960, 1200]
    assert all(op["w"] == 224 for op in ops.values())
    assert all(op["h"] == 104 for op in ops.values())
    # 不溢出、不重叠
    assert max(op["x"] + op["w"] for op in ops.values()) <= 1440
    xs = sorted((op["x"], op["x"] + op["w"]) for op in ops.values())
    assert all(xs[i][1] <= xs[i + 1][0] for i in range(len(xs) - 1))


def test_two_rows_stack_with_gap():
    top = [_kpi(f"a{i}", i * 300, 10) for i in range(2)]
    bottom = [
        {"key": "b0", "type": "chart", "kind": "line", "x": 10, "y": 300, "w": 600, "h": 320},
        {"key": "b1", "type": "chart", "kind": "bar", "x": 700, "y": 310, "w": 600, "h": 300},
    ]
    result = plan_layout(top + bottom, width=1440, gap=16)
    ops = {op["key"]: op for op in result["ops"]}
    assert ops["a0"]["y"] == 0
    assert ops["b0"]["y"] == 104 + 16  # 上一行高 + 间距
    assert ops["b0"]["h"] == ops["b1"]["h"] == 320
    assert ops["b0"]["x"] == 0 and ops["b1"]["x"] == 728


def test_filter_is_always_full_width():
    items = [
        {"key": "f", "type": "filter", "x": 120, "y": 0, "w": 400, "h": 56},
        _kpi("c0", 0, 100, 300, 120),
    ]
    ops = {op["key"]: op for op in plan_layout(items, width=1440, gap=16)["ops"]}
    assert ops["f"]["x"] == 0 and ops["f"]["w"] == 1440


def test_selection_only_moves_selected_and_respects_bounds():
    selected = [_kpi("s0", 400, 200, 180), _kpi("s1", 620, 210, 180)]
    bounds = bounds_of(selected)
    result = plan_layout(selected, scope="selection", bounds=bounds, width=1440, gap=16)
    ops = {op["key"]: op for op in result["ops"]}
    assert ops["s0"]["x"] == bounds["x"]
    assert ops["s0"]["y"] == bounds["y"]
    assert ops["s1"]["x"] == bounds["x"] + ops["s0"]["w"] + 16
    assert max(op["x"] + op["w"] for op in ops.values()) <= bounds["x"] + bounds["w"]


def test_forced_rows_from_instruction():
    items = [_kpi(f"c{i}", i * 150, 30) for i in range(5)]
    result = plan_layout(items, forced_rows=[3, 2], width=1440, gap=16)
    ops = {op["key"]: op for op in result["ops"]}
    assert ops["c3"]["x"] == 0  # 第二行从 x=0 重新开始
    assert ops["c2"]["x"] > ops["c3"]["x"]
    assert ops["c3"]["y"] > ops["c0"]["y"]


def test_empty_and_minimum_size():
    assert plan_layout([])["ops"] == []
    items = [{"key": "tiny", "type": "chart", "x": 0, "y": 0, "w": 10, "h": 10}]
    op = plan_layout(items)["ops"][0]
    assert op["w"] >= 100 and op["h"] >= 68
