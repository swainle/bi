"""外发通道安全（R2）—— 邮件域名白名单 / Webhook 白名单 / SSRF 防护."""

from __future__ import annotations

import pytest

from app import notifications
from app.security import outbound


def test_member_email_same_domain_allowed():
    result = outbound.validate_email_targets(
        "a@corp.com, b@corp.com", is_admin=False, user_email="me@corp.com")
    assert result == "a@corp.com, b@corp.com"


def test_member_email_external_blocked():
    with pytest.raises(outbound.OutboundError):
        outbound.validate_email_targets(
            "attacker@evil.test", is_admin=False, user_email="me@corp.com")


def test_admin_email_external_allowed():
    assert outbound.validate_email_targets(
        "attacker@evil.test", is_admin=True, user_email="admin@corp.com") == "attacker@evil.test"


def test_member_webhook_requires_allowlist(monkeypatch):
    monkeypatch.delenv("BI_OUTBOUND_WEBHOOK_HOSTS", raising=False)
    with pytest.raises(outbound.OutboundError):
        outbound.validate_webhook_url("https://hooks.example.com/x", is_admin=False)


def test_webhook_respects_allowlist(monkeypatch):
    monkeypatch.setenv("BI_OUTBOUND_WEBHOOK_HOSTS", "hooks.example.com")
    assert outbound.validate_webhook_url(
        "https://hooks.example.com/x", is_admin=False, resolve=False) == "https://hooks.example.com/x"


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/hook",
    "http://localhost/hook",
    "http://10.0.0.8/hook",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/hook",
])
def test_ssrf_targets_blocked_for_admin(url):
    with pytest.raises(outbound.OutboundError):
        outbound.validate_webhook_url(url, is_admin=True, resolve=True)


def test_notifications_send_blocks_private_target():
    status, reason = notifications.send("webhook", "http://127.0.0.1:9/hook", "t", "x")
    assert status == "failed"
    assert "内网" in reason or "回环" in reason


def test_mask_target_hides_secret_query():
    masked = outbound.mask_target("https://oapi.dingtalk.com/robot/send?access_token=secret")
    assert "secret" not in masked
    assert masked.endswith("?***")
    assert "corp.com" in outbound.mask_target("a@corp.com, b@corp.com")
