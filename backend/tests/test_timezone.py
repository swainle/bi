from datetime import datetime, timedelta, timezone

import pytest

from app.timezone import CHINA_TZ, as_china, china_now, time_text, utc_now
from app.sources.repository import freshness_of, next_sync_at
from app.reports.scheduler import next_run_at
from app.alerts.evaluate import _in_cooldown
from app.schemas.user import UserResponse


@pytest.mark.parametrize("value", [
    datetime(2026, 11, 18, 20, 30),
    "2026-11-18 20:30:00", "2026-11-18T20:30:00Z",
    "2026-11-19T04:30:00+08:00", "2026-11-18T15:30:00-05:00",
])
def test_system_time_converts_once_across_midnight(value):
    assert time_text(value) == "2026-11-19 04:30:00+08:00"


def test_clocks_and_empty_value():
    assert china_now().utcoffset() == timedelta(hours=8)
    assert utc_now().tzinfo is None
    assert time_text(None) == ""


def test_user_response_includes_beijing_offset():
    user = UserResponse(id=1, username="alice", email="alice@example.com",
                        created_at=datetime(2026, 11, 18, 20, 30))
    assert user.model_dump(mode="json")["created_at"] == "2026-11-19 04:30:00+08:00"


def test_sync_handles_equivalent_offsets():
    now = datetime(2026, 11, 19, 5, tzinfo=CHINA_TZ)
    assert freshness_of("2026-11-18T20:00:00Z", now)["age_hours"] == 1
    assert freshness_of("2026-11-19T04:00:00+08:00", now)["age_hours"] == 1
    assert next_sync_at("2026-11-19T04:00:00+08:00", 60) == datetime(2026, 11, 18, 21)


def test_report_schedule_uses_beijing_calendar_and_stores_utc():
    after = datetime(2026, 11, 18, 23, tzinfo=timezone.utc)
    result = next_run_at("daily", "09:00", after=after)
    assert result == datetime(2026, 11, 19, 1)
    assert as_china(result).hour == 9


def test_alert_cooldown_accepts_offset_and_legacy_utc(monkeypatch):
    monkeypatch.setattr("app.alerts.evaluate.china_now", lambda: datetime(2026, 11, 19, 5, tzinfo=CHINA_TZ))
    for last in ("2026-11-18 20:55:00", "2026-11-19T04:55:00+08:00"):
        assert _in_cooldown({"last_triggered_at": last, "cooldown_minutes": 10})
        assert not _in_cooldown({"last_triggered_at": last, "cooldown_minutes": 1})
