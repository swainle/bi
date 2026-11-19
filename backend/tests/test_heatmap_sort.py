from app.components.resolver import _matrix


def test_price_intervals_sorted_numerically_and_cells_keep_coordinates():
    cells = [
        {"x": "120-130", "y": "抖音", "value": 120},
        {"x": "30-40", "y": "京东", "value": 30},
        {"x": "0-10", "y": "京东", "value": 1},
        {"x": "10-20", "y": "抖音", "value": 10},
        {"x": "(空)", "y": "京东", "value": 0},
        {"x": "10-20", "y": "京东", "value": 20},
    ]
    matrix = _matrix(cells)
    assert matrix["xLabels"] == ["0-10", "10-20", "30-40", "120-130", "(空)"]
    assert matrix["yLabels"] == sorted({c["y"] for c in cells})
    for original, (x, y, value) in zip(cells, matrix["cells"]):
        assert matrix["xLabels"][x] == original["x"]
        assert matrix["yLabels"][y] == original["y"]
        assert value == original["value"]
    assert matrix["max"] == 120


def test_negative_decimal_and_equal_start_intervals():
    labels = ["10.5-20", "2-10", "-10-0", " 0-10 ", "2-5", "0.5-2"]
    matrix = _matrix([{"x": x, "y": "平台", "value": 1} for x in labels])
    assert matrix["xLabels"] == ["-10-0", " 0-10 ", "0.5-2", "2-5", "2-10", "10.5-20"]


def test_plain_text_keeps_lexical_order_and_empty_labels_go_last():
    labels = ["B", "A", "10元以上", "(空)", "", "not-a-range", "2-10"]
    matrix = _matrix([{"x": x, "y": "平台", "value": 1} for x in labels])
    assert matrix["xLabels"] == ["2-10", "10元以上", "A", "B", "not-a-range", "", "(空)"]


def test_empty_matrix():
    assert _matrix([]) == {"xLabels": [], "yLabels": [], "cells": [], "max": 0}
