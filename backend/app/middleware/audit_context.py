"""请求级审计上下文（S7 操作监控）.

为什么需要：LLM 调用、后台任务这类深层函数拿不到 FastAPI 的 `current_user`，
但审计记录必须能对上人。中间件解析出请求指纹与用户后写进 ContextVar，
调用链任意位置都可读；`log_audit` 会自动带上 IP / User-Agent / 指纹。
"""

from __future__ import annotations

from contextvars import ContextVar

_audit_user_id: ContextVar[int | None] = ContextVar("audit_user_id", default=None)
_request_ip: ContextVar[str] = ContextVar("audit_ip", default="")
_request_ua: ContextVar[str] = ContextVar("audit_ua", default="")
_request_fp: ContextVar[str] = ContextVar("audit_fp", default="")


def set_audit_user(user_id: int | None) -> None:
    _audit_user_id.set(int(user_id) if user_id else None)


def get_audit_user() -> int | None:
    return _audit_user_id.get()


def set_request_meta(*, ip: str = "", user_agent: str = "", fingerprint: str = "") -> None:
    _request_ip.set(ip or "")
    _request_ua.set(user_agent or "")
    _request_fp.set(fingerprint or "")


def get_request_meta() -> dict[str, str]:
    return {"ip": _request_ip.get(), "user_agent": _request_ua.get(),
            "fingerprint": _request_fp.get()}


__all__ = [
    "get_audit_user", "get_request_meta", "set_audit_user", "set_request_meta",
]
