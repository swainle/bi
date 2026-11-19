"""通知渠道 —— 自定义 Webhook / 钉钉机器人 / 企业微信机器人 / 邮件（SMTP）.

约定：
    * 钉钉：POST {"msgtype":"markdown","markdown":{"title","text"}}
    * 企微：POST {"msgtype":"markdown","markdown":{"content"}}
    * 自定义：保留原有业务 JSON（type=alert / report）
    * 邮件：`send(channel="email", url=收件人列表)`，SMTP 配置见 `_smtp_conf`
    * 失败只返回 (failed, 错误)，不抛异常、不影响站内事件
"""

from __future__ import annotations

import os
import re
import smtplib
from email.message import EmailMessage
from typing import Any
from urllib.parse import urlparse

import requests

from app.security import outbound

CHANNELS = ("inapp", "webhook", "dingtalk", "wecom", "email")
BOT_CHANNELS = ("dingtalk", "wecom")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_emails(raw: str, limit: int = 10) -> list[str]:
    """逗号 / 分号 / 空格分隔的收件人 → 去重后的合法邮箱（最多 limit 个）."""
    out: list[str] = []
    for token in re.split(r"[,;\s]+", str(raw or "")):
        address = token.strip()
        if not address or not _EMAIL_RE.match(address):
            continue
        if address not in out:
            out.append(address)
        if len(out) >= limit:
            break
    return out


def _timeout() -> float:
    try:
        return max(1.0, float(os.getenv("BI_NOTIFY_TIMEOUT", "5") or "5"))
    except ValueError:
        return 5.0


def _links_markdown(links: dict[str, str] | None, joiner: str) -> str:
    if not links:
        return ""
    return joiner + joiner.join(f"[{label}]({url})" for label, url in links.items() if url)


def build_payload(channel: str, title: str, text: str, *,
                  data: dict[str, Any] | None = None,
                  links: dict[str, str] | None = None) -> dict:
    """按渠道组装请求体（纯函数，便于单测）."""
    if channel == "dingtalk":
        content = f"### {title}\n\n{text}{_links_markdown(links, chr(10) + chr(10))}"
        return {"msgtype": "markdown", "markdown": {"title": title, "text": content}}
    if channel == "wecom":
        content = f"**{title}**\n{text}{_links_markdown(links, chr(10) + chr(10))}"
        return {"msgtype": "markdown", "markdown": {"content": content}}
    return {"type": "webhook", "title": title, "text": text, **(data or {})}


def _smtp_conf() -> dict[str, Any]:
    """SMTP 配置（环境变量）—— 没配 host 视为未启用."""
    def _flag(name: str) -> bool:
        return str(os.getenv(name, "") or "").strip().lower() in ("1", "true", "yes", "on")

    try:
        port = int(os.getenv("SMTP_PORT", "25") or "25")
    except ValueError:
        port = 25
    user = str(os.getenv("SMTP_USER", "") or "").strip()
    return {
        "host": str(os.getenv("SMTP_HOST", "") or "").strip(),
        "port": port,
        "user": user,
        "password": str(os.getenv("SMTP_PASSWORD", "") or ""),
        "sender": str(os.getenv("SMTP_FROM", "") or "").strip() or user,
        "starttls": _flag("SMTP_STARTTLS"),
        "ssl": _flag("SMTP_SSL"),
    }


def build_email(to_raw: str, subject: str, text: str, *,
                links: dict[str, str] | None = None) -> EmailMessage | None:
    """组装纯文本邮件（纯函数）；没有合法收件人时返回 None."""
    recipients = valid_emails(to_raw)
    if not recipients:
        return None
    body = text
    if links:
        body += "".join(f"\n{label}：{url}" for label, url in links.items() if url)
    message = EmailMessage()
    conf = _smtp_conf()
    message["Subject"] = subject
    message["From"] = conf["sender"] or "mingcebi@localhost"
    message["To"] = ", ".join(recipients)
    message.set_content(body)
    return message


def send_email(to_raw: str, subject: str, text: str, *,
               links: dict[str, str] | None = None,
               timeout: float | None = None) -> tuple[str, str]:
    """SMTP 发送通知；未配置 / 无收件人 / 发送失败都返回 failed."""
    message = build_email(to_raw, subject, text, links=links)
    if message is None:
        return "failed", "收件人为空或格式不合法"
    conf = _smtp_conf()
    if not conf["host"]:
        return "failed", "未配置 SMTP_HOST"
    client = None
    try:
        if conf["ssl"]:
            client = smtplib.SMTP_SSL(conf["host"], conf["port"], timeout=timeout or _timeout())
        else:
            client = smtplib.SMTP(conf["host"], conf["port"], timeout=timeout or _timeout())
            if conf["starttls"]:
                client.starttls()
        if conf["user"]:
            client.login(conf["user"], conf["password"])
        client.send_message(message)
        return "email", ""
    except Exception as exc:
        return "failed", str(exc)[:300]
    finally:
        if client is not None:
            try:
                client.quit()
            except Exception:
                pass


def send(channel: str, url: str, title: str, text: str, *,
         data: dict[str, Any] | None = None,
         links: dict[str, str] | None = None,
         timeout: float | None = None) -> tuple[str, str]:
    """发送通知；成功返回 (channel, "")，失败返回 ("failed", 原因)."""
    if channel == "email":
        # email 的「地址」是收件人列表，不是 URL
        return send_email(url, title, text, links=links, timeout=timeout)
    target = str(url or "").strip()
    if not target:
        return "failed", "通知地址为空"
    # SSRF 兜底：即使配置里漏了校验，发送前也拒绝内网 / 回环 / 元数据地址
    try:
        parsed = urlparse(target)
        outbound.assert_public_host(parsed.hostname or "",
                                    parsed.port or (443 if parsed.scheme == "https" else 80))
    except outbound.OutboundError as exc:
        return "failed", str(exc)
    try:
        response = requests.post(
            target,
            json=build_payload(channel, title, text, data=data, links=links),
            timeout=timeout or _timeout(),
            allow_redirects=False,
        )
        if 200 <= response.status_code < 300:
            return channel, ""
        # 钉钉/企微机器人常常 200 才生效，非 2xx 一律算失败
        return "failed", f"HTTP {response.status_code}"
    except Exception as exc:
        return "failed", str(exc)[:300]


__all__ = ["CHANNELS", "BOT_CHANNELS", "valid_emails", "build_payload", "build_email", "send_email", "send"]
