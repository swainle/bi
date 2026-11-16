"""CSRF 防护中间件 — Double Submit Cookie 模式.

原理：
  1. 登录或访问 /api/auth/csrf-token 时，后端生成随机 CSRF token，
     同时写入 cookie（csrf_token）和响应 body。
  2. 前端每个状态变更请求（POST/PUT/DELETE/PATCH）须在 header
     X-CSRF-Token 中携带该 token。
  3. 中间件校验 cookie 与 header 一致，否则拒绝请求。

豁免：
  - GET / HEAD / OPTIONS（幂等读取）
  - /api/auth/* 路径（登录/注册/csrf-token 本身）
  - /api/health, /metrics, /api/site-info
  - WebSocket 连接
"""

import secrets
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# 不需要 CSRF 校验的路径前缀
_EXEMPT_PATHS = (
    "/api/auth/",
    "/api/health",
    "/metrics",
    "/api/site-info",
    "/docs",
    "/openapi.json",
    "/redoc",
    # OnlyOffice 回调 — 服务器到服务器通信，无法携带浏览器 CSRF cookie/header
    "/api/office/callback",
    "/api/office/team/callback/",
    "/api/teamspace/office/callback",
    # AI / 智能体 — 使用 raw fetch() 进行流式请求或文件上传，无法走 axios 拦截器
    "/api/ai/",
    "/api/agents/",
    "/api/skills/",
    "/api/agent-proxy",
    "/api/openclaw/",
    # 聊天记忆 — 消息批量写入
    "/api/chat-topics",
    # 工作流 — CRUD + 运行
    "/api/workflows",
    # BI 数据导入
    "/api/bi/engine/import/",
    "/api/bi/engine/ai-generate",
    "/api/bi/engine/ai/",
    # 前端错误上报 — ErrorBoundary 使用 raw fetch() 无法走 axios 拦截器
    "/api/report",
    # MCP 网关 — Agent 走 Bearer 令牌（无 cookie 会话），CSRF 不适用
    "/api/mcp/",
)

# cookie 名称
CSRF_COOKIE_NAME = "csrf_token"
# header 名称
CSRF_HEADER_NAME = "x-csrf-token"


def generate_csrf_token() -> str:
    """生成 64 字符随机 CSRF token."""
    return secrets.token_urlsafe(48)


class CSRFMiddleware(BaseHTTPMiddleware):
    """Double Submit Cookie CSRF 防护."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method.upper()

        # WebSocket 豁免
        if "/ws/" in path:
            return await call_next(request)

        # 幂等方法豁免
        if method in ("GET", "HEAD", "OPTIONS"):
            response = await call_next(request)
            return response

        # 白名单路径豁免（登录/注册/csrf-token/健康检查等）
        if any(path.startswith(p) for p in _EXEMPT_PATHS):
            return await call_next(request)

        # ── CSRF 校验 ────────────────────────────────
        cookie_token = request.cookies.get(CSRF_COOKIE_NAME)
        header_token = request.headers.get(CSRF_HEADER_NAME)

        if not cookie_token or not header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token 缺失，请刷新页面重试"},
            )

        # 常量时间比较防时序攻击
        if not _safe_str_eq(cookie_token, header_token):
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token 校验失败"},
            )

        return await call_next(request)


def _safe_str_eq(a: str, b: str) -> bool:
    """常量时间字符串比较（防止时序攻击）."""
    if len(a) != len(b):
        return False
    result = 0
    for x, y in zip(a, b):
        result |= ord(x) ^ ord(y)
    return result == 0


__all__ = ["CSRFMiddleware", "generate_csrf_token", "CSRF_COOKIE_NAME", "CSRF_HEADER_NAME"]
