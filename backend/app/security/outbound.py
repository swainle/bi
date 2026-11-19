"""外发通道安全 —— 邮件域名白名单 / Webhook 域名白名单 / SSRF 防护.

策略（2026-11-15，R2）：
    * 普通用户：邮件只能发给「自己的邮箱域名」或 BI_OUTBOUND_EMAIL_DOMAINS 白名单；
      Webhook / 钉钉 / 企微 只能发到 BI_OUTBOUND_WEBHOOK_HOSTS 白名单，否则仅管理员可配。
    * 管理员：允许外部地址，但仍写审计。
    * 所有 Webhook（含管理员）在发送前解析域名，禁止回环 / 内网 / 链路本地 / 元数据地址；
      确需内网 Webhook 的，把主机名加入 BI_OUTBOUND_ALLOW_PRIVATE_HOSTS。
    * 发送时不跟随重定向，避免 302 跳到内网（SSRF）。
"""

from __future__ import annotations

import ipaddress
import os
import re
import socket
from urllib.parse import urlparse

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class OutboundError(ValueError):
    """外发目标不合规（路由层转 400/403）."""


def _env_list(name: str) -> list[str]:
    return [item.strip().lower() for item in (os.getenv(name, "") or "").split(",") if item.strip()]


def email_allowlist() -> set[str]:
    return set(_env_list("BI_OUTBOUND_EMAIL_DOMAINS"))


def webhook_allowlist() -> set[str]:
    return set(_env_list("BI_OUTBOUND_WEBHOOK_HOSTS"))


def _private_allowlist() -> set[str]:
    return set(_env_list("BI_OUTBOUND_ALLOW_PRIVATE_HOSTS"))


def _is_public(addr) -> bool:
    return not (addr.is_private or addr.is_loopback or addr.is_link_local
                or addr.is_multicast or addr.is_reserved or addr.is_unspecified)


def assert_public_host(host: str, port: int | None = None) -> None:
    """解析主机并拒绝内网 / 回环 / 元数据地址（发送前兜底）."""
    name = (host or "").strip().lower()
    if not name:
        raise OutboundError("通知地址为空")
    if name in _private_allowlist():
        return
    if name == "localhost" or name.endswith(".localhost"):
        raise OutboundError("不允许访问本机地址")
    addrs = []
    try:
        addrs = [ipaddress.ip_address(name)]
    except ValueError:
        try:
            infos = socket.getaddrinfo(name, port or 443, proto=socket.IPPROTO_TCP)
        except OSError:
            raise OutboundError("通知域名无法解析")
        for info in infos:
            try:
                addrs.append(ipaddress.ip_address(info[4][0]))
            except ValueError:
                continue
    if not addrs:
        raise OutboundError("通知域名无法解析")
    for addr in addrs:
        if not _is_public(addr):
            raise OutboundError("不允许访问内网 / 回环 / 元数据地址")


def validate_webhook_url(url: str, *, is_admin: bool, resolve: bool = True) -> str:
    target = str(url or "").strip()
    parsed = urlparse(target)
    if parsed.scheme not in ("http", "https"):
        raise OutboundError("通知地址必须以 http:// 或 https:// 开头")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise OutboundError("通知地址缺少域名")
    if not is_admin and host not in webhook_allowlist():
        raise OutboundError(
            "外部 Webhook / 机器人仅管理员可配置；"
            "或把域名加入 BI_OUTBOUND_WEBHOOK_HOSTS 白名单"
        )
    if resolve:
        assert_public_host(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    return target


def validate_email_targets(raw: str, *, is_admin: bool, user_email: str = "") -> str:
    """校验收件人域名；返回归一化后的收件人字符串."""
    recipients: list[str] = []
    for token in re.split(r"[,;\s]+", str(raw or "")):
        address = token.strip()
        if address and _EMAIL_RE.match(address) and address not in recipients:
            recipients.append(address)
    if not recipients:
        raise OutboundError("请填写收件人邮箱")

    if not is_admin:
        allowed = email_allowlist()
        domain = (user_email or "").split("@")[-1].strip().lower()
        if domain:
            allowed.add(domain)
        bad = [item for item in recipients
               if item.split("@")[-1].strip().lower() not in allowed]
        if bad:
            raise OutboundError(
                "普通用户只能发送到公司邮箱域名；外部收件人仅管理员可配置"
            )
    return ", ".join(recipients)


def mask_target(value: str) -> str:
    """审计里展示目标但去掉敏感部分（邮箱只留域名；Webhook 去掉 query）."""
    text = str(value or "").strip()
    if not text:
        return ""
    if "@" in text and "://" not in text:
        domains = sorted({item.split("@")[-1].lower() for item in re.split(r"[,;\s]+", text)
                          if "@" in item})
        return "邮箱域：" + ", ".join(domains)
    parsed = urlparse(text)
    if not parsed.scheme:
        return text[:80]
    return f"{parsed.scheme}://{parsed.hostname or ''}{parsed.path or ''}" + \
           ("?***" if parsed.query else "")


__all__ = [
    "OutboundError", "assert_public_host", "email_allowlist", "mask_target",
    "validate_email_targets", "validate_webhook_url", "webhook_allowlist",
]
