"""告警纯函数回归：比较符 / 波动百分比 / 规则参数校验（不连库）."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.alerts import evaluate
from app.alerts.router import _clean

ADMIN = SimpleNamespace(id=1, role="admin", email="admin@corp.com")


def test_compare_ops() -> None:
    assert evaluate._compare(10, ">", 9) is True
    assert evaluate._compare(10, ">", 10) is False
    assert evaluate._compare(10, ">=", 10) is True
    assert evaluate._compare(10, "<", 11) is True
    assert evaluate._compare(10, "<=", 10) is True
    assert evaluate._compare(10, "=", 10) is True
    assert evaluate._compare(10, "!!", 10) is False


def test_change_pct() -> None:
    assert evaluate._change_pct(110, 100) == pytest.approx(10.0)
    assert evaluate._change_pct(90, 100) == pytest.approx(-10.0)
    assert evaluate._change_pct(10, None) is None
    assert evaluate._change_pct(10, 0) is None


def test_clean_defaults() -> None:
    data = _clean({"item_key": "c1", "name": "日销量告警", "threshold": "100"}, user=ADMIN)
    assert data["op"] == ">"
    assert data["threshold"] == 100.0
    assert data["channel"] == "inapp"
    assert data["webhook_url"] == ""
    assert data["cooldown_minutes"] == 30
    assert data["enabled"] is True
    assert data["change_pct"] is None


def test_clean_accepts_webhook(monkeypatch) -> None:
    # 单测不依赖 DNS：跳过发送前的域名解析，只验证配置校验与字段归一
    monkeypatch.setattr("app.security.outbound.assert_public_host", lambda *a, **k: None)
    data = _clean({
        "item_key": "c1", "name": "x", "op": "<=", "threshold": 5,
        "change_pct": 15, "cooldown_minutes": 0, "channel": "webhook",
        "webhook_url": "https://example.com/hook", "enabled": False,
    }, user=ADMIN)
    assert data["op"] == "<="
    assert data["change_pct"] == 15.0
    assert data["cooldown_minutes"] == 0
    assert data["enabled"] is False


@pytest.mark.parametrize("payload, keyword", [
    ({"item_key": "", "name": "x", "threshold": 1}, "指标卡"),
    ({"item_key": "c1", "name": "", "threshold": 1}, "规则名称"),
    ({"item_key": "c1", "name": "x", "op": "!=", "threshold": 1}, "比较符"),
    ({"item_key": "c1", "name": "x", "threshold": "abc"}, "数字"),
    ({"item_key": "c1", "name": "x", "threshold": 1, "change_pct": -1}, "不能为负"),
    ({"item_key": "c1", "name": "x", "threshold": 1, "cooldown_minutes": 2000}, "冷却时间"),
    ({"item_key": "c1", "name": "x", "threshold": 1, "channel": "sms"}, "通知渠道"),
    ({"item_key": "c1", "name": "x", "threshold": 1, "channel": "webhook", "webhook_url": "ftp://x"}, "http"),
])
def test_clean_rejects(payload: dict, keyword: str) -> None:
    with pytest.raises(HTTPException) as exc:
        _clean(payload, user=ADMIN)
    assert keyword in str(exc.value.detail)
