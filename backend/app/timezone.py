"""系统时间：存储沿用 UTC，业务显示及排期使用 UTC+8。"""

from datetime import datetime, timedelta, timezone

CHINA_TZ = timezone(timedelta(hours=8))


def china_now() -> datetime:
    return datetime.now(CHINA_TZ)


def utc_now() -> datetime:
    """兼容现有 timestamp without time zone 字段。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def as_china(value: datetime) -> datetime:
    # 无时区的系统时间来自历史 UTC 字段，不能当作服务器本地时间。
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(CHINA_TZ)


def time_text(value: datetime | str | None) -> str:
    if not value:
        return ""
    if isinstance(value, str):
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return as_china(value).isoformat(sep=" ")
