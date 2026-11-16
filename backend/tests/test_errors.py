"""错误日志纯函数回归（不连库）."""

from __future__ import annotations

from app.errors import repository as repo


def test_clip_truncates() -> None:
    assert repo._clip("abcdef", 3) == "abc"
    assert repo._clip(None, 5) == ""


def test_retain_days_env(monkeypatch) -> None:
    monkeypatch.setenv("BI_ERROR_RETAIN_DAYS", "7")
    assert repo.retain_days() == 7
    monkeypatch.setenv("BI_ERROR_RETAIN_DAYS", "bad")
    assert repo.retain_days() == 30
    monkeypatch.setenv("BI_ERROR_RETAIN_DAYS", "0")
    assert repo.retain_days() == 1
