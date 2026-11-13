"""数据源结构快照 / 漂移 / 新鲜度（P4）."""

from __future__ import annotations

from datetime import datetime, timedelta

from app.sources.repository import (
    FRESH_HOURS,
    STALE_HOURS,
    diff_columns,
    freshness_of,
    snapshot_hash,
)

OLD = [
    {"name": "id", "type": "INTEGER"},
    {"name": "store", "type": "VARCHAR(32)"},
    {"name": "revenue", "type": "NUMERIC(12,2)"},
]


def test_diff_no_change() -> None:
    drift = diff_columns(OLD, list(OLD))
    assert drift["has_changes"] is False
    assert drift["added"] == [] and drift["removed"] == [] and drift["changed"] == []


def test_diff_added_column() -> None:
    new = OLD + [{"name": "province", "type": "VARCHAR(16)"}]
    drift = diff_columns(OLD, new)
    assert drift["has_changes"] is True
    assert [c["name"] for c in drift["added"]] == ["province"]
    assert drift["removed"] == [] and drift["changed"] == []


def test_diff_removed_and_type_changed() -> None:
    new = [
        {"name": "id", "type": "BIGINT"},          # 类型变了
        {"name": "store", "type": "VARCHAR(32)"},
    ]                                           # revenue 被删掉
    drift = diff_columns(OLD, new)
    assert [c["name"] for c in drift["removed"]] == ["revenue"]
    assert drift["changed"] == [{"name": "id", "from": "INTEGER", "to": "BIGINT"}]
    assert drift["added"] == []


def test_diff_handles_empty_old_snapshot() -> None:
    """历史数据没有快照（迁移前接入的表）：全部算新增，不报错."""
    drift = diff_columns(None, OLD)
    assert drift["has_changes"] is True
    assert len(drift["added"]) == 3
    assert diff_columns(None, None)["has_changes"] is False


def test_snapshot_hash_order_independent() -> None:
    assert snapshot_hash(OLD) == snapshot_hash(list(reversed(OLD)))
    assert snapshot_hash(OLD) != snapshot_hash(OLD[:2])


def test_freshness_levels() -> None:
    now = datetime(2026, 11, 13, 12, 0, 0)
    assert freshness_of(now - timedelta(hours=1), now)["level"] == "fresh"
    assert freshness_of(now - timedelta(hours=FRESH_HOURS + 1), now)["level"] == "aging"
    assert freshness_of(now - timedelta(hours=STALE_HOURS + 1), now)["level"] == "stale"
    assert freshness_of(None)["level"] == "unknown"
    assert freshness_of("2026-11-13 11:00:00", now)["level"] == "fresh"
    assert freshness_of("not-a-date")["level"] == "unknown"
