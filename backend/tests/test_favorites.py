"""收藏视图：参数归一化（纯函数，不连库）."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.dashboards.favorites import clean_payload


def test_clean_ok() -> None:
    name, view, params = clean_payload({"name": "  拼多多视图  ", "view": "main",
                                        "params": {"platform": "拼多多", "band": "all"}})
    assert name == "拼多多视图"
    assert view == "main"
    assert params == {"platform": "拼多多", "band": "all"}


def test_clean_defaults() -> None:
    name, view, params = clean_payload({"name": "视图"})
    assert name == "视图"
    assert view == ""
    assert params == {}


def test_clean_rejects_empty_name() -> None:
    with pytest.raises(HTTPException):
        clean_payload({"name": "   "})


def test_clean_rejects_bad_params() -> None:
    with pytest.raises(HTTPException):
        clean_payload({"name": "x", "params": ["platform"]})


def test_clean_rejects_huge_params() -> None:
    with pytest.raises(HTTPException):
        clean_payload({"name": "x", "params": {"keyword": "长" * 5000}})
