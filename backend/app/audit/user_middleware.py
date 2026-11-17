"""把当前请求的用户写进审计上下文（S7）.

只在 HTTP 层解析 JWT 的 `sub`，**不做鉴权**（鉴权仍在 get_current_user）：
目的是让 LLM 调用、深层 service 这类拿不到 user 对象的地方，也能把审计记到人头上。
ContextVar 在 `call_next` 之前设置，sync 端点在线程池里也能读到。
"""

from __future__ import annotations

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings
from app.audit.context import set_audit_user


def _bearer(request: Request) -> str:
    value = (request.headers.get("authorization") or "").strip()
    return value[7:].strip() if value.lower().startswith("bearer ") else ""


class AuditUserMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        token = _bearer(request)
        if token:
            try:
                payload = jwt.decode(
                    token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
                )
                sub = payload.get("sub")
                if sub is not None:
                    set_audit_user(int(sub))
            except (JWTError, TypeError, ValueError):
                pass
        try:
            return await call_next(request)
        finally:
            set_audit_user(None)
