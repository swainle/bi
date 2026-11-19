"""客户端指纹（安全卫士 v2）—— 有设备号时不混 IP，换 IP 不能绕过指纹封禁."""

from __future__ import annotations

from app.security.security_events import fingerprint


def test_device_fingerprint_stable_across_ip():
    assert (fingerprint("203.0.113.10", "QA/1.0", "device-a", "zh-CN")
            == fingerprint("198.51.100.20", "QA/1.0", "device-a", "zh-CN"))


def test_device_fingerprint_changes_with_device():
    assert (fingerprint("203.0.113.10", "QA/1.0", "device-a", "zh-CN")
            != fingerprint("203.0.113.10", "QA/1.0", "device-b", "zh-CN"))


def test_no_device_fingerprint_still_uses_ip():
    """没有设备号（curl / 脚本）时保留 IP，避免所有同类客户端撞成同一指纹."""
    assert (fingerprint("203.0.113.10", "curl/8.7.1", "", "")
            != fingerprint("198.51.100.20", "curl/8.7.1", "", ""))
