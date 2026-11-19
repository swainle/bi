"""SENTRY_DSN 开关：没配就完全不动，配错也不能影响启动."""

from __future__ import annotations

from app.observability import sentry as observability


def _reset(monkeypatch) -> None:
    monkeypatch.setattr(observability, "_initialized", False)


def test_disabled_without_dsn(monkeypatch) -> None:
    monkeypatch.delenv("SENTRY_DSN", raising=False)
    _reset(monkeypatch)
    assert observability.init_sentry() is False
    assert observability.enabled() is False


def test_bad_dsn_does_not_raise(monkeypatch) -> None:
    monkeypatch.setenv("SENTRY_DSN", "not-a-dsn")
    _reset(monkeypatch)
    assert observability.init_sentry() is False
    assert observability.enabled() is False


def test_dsn_host_is_masked() -> None:
    assert observability.dsn_host("https://key@glitchtip.local/1") == "glitchtip.local"
    assert observability.dsn_host("weird") == "?"


def test_explicit_dsn_wins_over_env(monkeypatch) -> None:
    """Settings 从 .env 读到的值优先；显式传空 = 不启用（不被同名环境变量顶掉）."""
    monkeypatch.setenv("SENTRY_DSN", "http://key@127.0.0.1:9/1")
    _reset(monkeypatch)
    assert observability.init_sentry("", "dev", 0) is False
    assert observability.enabled() is False
