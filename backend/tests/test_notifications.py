"""通知渠道请求体（纯函数，不联网）."""

from __future__ import annotations

from app import notifications


def test_dingtalk_markdown_payload() -> None:
    payload = notifications.build_payload(
        "dingtalk", "指标告警 · 日销量", "当前值 26 > 阈值 10",
        links={"查看看板": "https://x/y"},
    )
    assert payload["msgtype"] == "markdown"
    assert payload["markdown"]["title"] == "指标告警 · 日销量"
    assert "当前值 26" in payload["markdown"]["text"]
    assert "[查看看板](https://x/y)" in payload["markdown"]["text"]


def test_wecom_markdown_payload() -> None:
    payload = notifications.build_payload("wecom", "定时报表", "报表已生成")
    assert payload["msgtype"] == "markdown"
    assert payload["markdown"]["content"].startswith("**定时报表**")
    assert "报表已生成" in payload["markdown"]["content"]


def test_custom_webhook_keeps_business_json() -> None:
    payload = notifications.build_payload(
        "webhook", "t", "x", data={"type": "alert", "value": 26},
    )
    assert payload["type"] == "alert"
    assert payload["value"] == 26
    assert payload["title"] == "t"


def test_empty_url_fails() -> None:
    assert notifications.send("dingtalk", "", "t", "x")[0] == "failed"


def test_valid_emails_filters_and_dedupes() -> None:
    raw = "a@x.com, b@y.cn;bad-address c@x.com  d@z"
    assert notifications.valid_emails(raw) == ["a@x.com", "b@y.cn", "c@x.com"]
    assert notifications.valid_emails("a@x.com b@y.cn c@z.cn", limit=2) == ["a@x.com", "b@y.cn"]


def test_build_email_without_recipient_is_none() -> None:
    assert notifications.build_email("", "标题", "正文") is None
    assert notifications.build_email("not-an-email", "标题", "正文") is None


def test_build_email_contains_links(monkeypatch) -> None:
    monkeypatch.setenv("SMTP_FROM", "bi@mingcebi.com")
    message = notifications.build_email(
        "boss@mingcebi.com", "定时报表", "报表已生成",
        links={"查看报表": "https://x/r/1", "下载 Excel": "https://x/r/1.xlsx"},
    )
    assert message is not None
    assert message["To"] == "boss@mingcebi.com"
    assert message["From"] == "bi@mingcebi.com"
    body = message.get_content()
    assert "查看报表：https://x/r/1" in body
    assert "下载 Excel：https://x/r/1.xlsx" in body


def test_email_without_smtp_host_fails(monkeypatch) -> None:
    monkeypatch.delenv("SMTP_HOST", raising=False)
    channel, error = notifications.send("email", "boss@mingcebi.com", "t", "x")
    assert channel == "failed"
    assert error == "未配置 SMTP_HOST"


def test_email_without_recipient_fails() -> None:
    channel, error = notifications.send("email", "", "t", "x")
    assert channel == "failed"
    assert "收件人" in error
