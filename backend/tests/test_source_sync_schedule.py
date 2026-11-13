"""已接入表自动同步：间隔校验与到期时间（P4）."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from app.sources.repository import (
    SYNC_MAX_MINUTES,
    SYNC_MIN_MINUTES,
    SourceError,
    next_sync_at,
    normalize_interval,
)


def test_interval_zero_means_off() -> None:
    assert normalize_interval(0) == 0
    assert normalize_interval("0") == 0


def test_interval_accepts_presets() -> None:
    assert normalize_interval(60) == 60
    assert normalize_interval("360") == 360
    assert normalize_interval(1440) == 1440


def test_interval_rejects_too_short_and_too_long() -> None:
    with pytest.raises(SourceError):
        normalize_interval(SYNC_MIN_MINUTES - 1)
    with pytest.raises(SourceError):
        normalize_interval(SYNC_MAX_MINUTES + 1)
    with pytest.raises(SourceError):
        normalize_interval(-5)


def test_interval_rejects_non_number() -> None:
    with pytest.raises(SourceError):
        normalize_interval("每小时")
    with pytest.raises(SourceError):
        normalize_interval(None)


def test_next_sync_at() -> None:
    synced = datetime(2026, 11, 13, 10, 0, 0)
    assert next_sync_at(synced, 60) == datetime(2026, 11, 13, 11, 0, 0)
    assert next_sync_at(synced, 1440) == datetime(2026, 11, 14, 10, 0, 0)
    # 未开自动同步 / 时间缺失 → 不算下次时间
    assert next_sync_at(synced, 0) is None
    assert next_sync_at(None, 60) is None
    # 字符串时间也接受（接口返回的 synced_at 是字符串）
    assert next_sync_at("2026-11-13 10:00:00", 60) == datetime(2026, 11, 13, 11, 0, 0)
    assert next_sync_at("not-a-date", 60) is None


def test_due_math_matches_scheduler_rule() -> None:
    """调度判定：synced_at + 间隔 <= now 才算到期（与 SQL 里 make_interval 同口径）."""
    now = datetime(2026, 11, 13, 12, 0, 0)
    last = now - timedelta(minutes=90)
    assert next_sync_at(last, 60) <= now
    assert next_sync_at(last, 180) > now
