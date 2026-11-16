"""报表临时下载链接 —— HMAC 签名（站内通知点击可直接在浏览器打开）.

格式：base64url(payload) . base64url(hmac_sha256(payload))
payload：run_id:kind:exp（Unix 秒）
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import time

from app.config import settings

KINDS = ("html", "xlsx", "pdf")
DEFAULT_TTL = 7 * 24 * 3600


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(payload: str) -> str:
    return _b64(hmac.new(settings.jwt_secret.encode("utf-8"), payload.encode("utf-8"),
                         hashlib.sha256).digest())


def sign_run(run_id: int, kind: str, ttl: int = DEFAULT_TTL) -> str:
    if kind not in KINDS:
        raise ValueError(f"不支持的报表格式：{kind}")
    payload = f"{int(run_id)}:{kind}:{int(time.time()) + int(ttl)}"
    return f"{_b64(payload.encode('utf-8'))}.{_sign(payload)}"


def verify_run(token: str) -> tuple[int, str] | None:
    try:
        encoded, signature = str(token or "").split(".", 1)
        payload = _unb64(encoded).decode("utf-8")
    except Exception:
        return None
    if not hmac.compare_digest(signature, _sign(payload)):
        return None
    try:
        run_id, kind, expires = payload.split(":")
        if kind not in KINDS or int(expires) < int(time.time()):
            return None
        return int(run_id), kind
    except ValueError:
        return None


def download_path(run_id: int, kind: str) -> str:
    return f"/api/bi/reports/download/{int(run_id)}/{kind}?token={sign_run(run_id, kind)}"


__all__ = ["KINDS", "sign_run", "verify_run", "download_path"]
