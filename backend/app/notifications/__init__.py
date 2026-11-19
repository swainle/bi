"""B22 通知渠道（站内 / Webhook / 钉钉 / 企微 / 邮件）."""

from app.notifications.core import (  # noqa: F401
    CHANNELS,
    build_email,
    build_payload,
    send,
    send_email,
    valid_emails,
)
