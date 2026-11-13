"""存活 / 就绪探针（K8s probes）.

两条不变量：
    · 存活只看进程，不碰数据库（DB 抖动不能导致重启）；
    · 就绪要求数据库可用（不可用 → 503 摘流量），Redis 挂了不影响就绪。
"""

from __future__ import annotations

import json

from app import main as app_main
from app.query import redis_bus


class _DeadEngine:
    def connect(self):  # noqa: ANN001
        raise RuntimeError("database is down")


class _OkEngine:
    def connect(self):  # noqa: ANN001
        engine = self

        class _Conn:
            def __enter__(self):  # noqa: ANN204
                return self

            def __exit__(self, *exc):  # noqa: ANN002, ANN003
                return False

            def execute(self, *_args, **_kwargs):  # noqa: ANN002, ANN003
                return None

        return _Conn()


def test_livez_never_touches_database(monkeypatch) -> None:
    monkeypatch.setattr(app_main, "engine", _DeadEngine())
    assert app_main.livez() == {"status": "alive"}


def test_readyz_503_when_database_down(monkeypatch) -> None:
    monkeypatch.setattr(app_main, "engine", _DeadEngine())
    monkeypatch.delenv("REDIS_URL", raising=False)
    response = app_main.readyz()
    body = json.loads(response.body)
    assert response.status_code == 503
    assert body["status"] == "not_ready"
    assert body["database"] == "down"
    assert body["redis"] == "disabled"


def test_readyz_200_when_database_up(monkeypatch) -> None:
    monkeypatch.setattr(app_main, "engine", _OkEngine())
    monkeypatch.delenv("REDIS_URL", raising=False)
    response = app_main.readyz()
    body = json.loads(response.body)
    assert response.status_code == 200
    assert body["status"] == "ready"
    assert body["database"] == "up"


def test_readyz_stays_ready_when_redis_down(monkeypatch) -> None:
    """Redis 是可选依赖：连不上只降级缓存，不能把 API 摘出负载均衡."""
    monkeypatch.setattr(app_main, "engine", _OkEngine())
    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:6399/0")
    redis_bus.reset()
    try:
        response = app_main.readyz()
        body = json.loads(response.body)
        assert response.status_code == 200
        assert body["redis"] == "down"
    finally:
        redis_bus.reset()


def test_redis_probe_disabled_without_url(monkeypatch) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    assert app_main._probe_redis() == "disabled"
