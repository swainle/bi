"""安全指纹中间件（S7 二期）.

对**不是正常登录用户操作**的请求留痕：
    * 匿名访问 / 令牌无效 / 越权 403 / 限流 429；
    * 扫描器路径（.env、wp-admin、../ 等）的 404；
    每条记录带 IP、X-Forwarded-For、User-Agent、浏览器设备号、指纹与 request_id。

同时把 IP / UA / 指纹写进请求上下文，`log_audit` 会自动带上 ——
即使用户用脚本（Postman / curl）调接口，操作审计里也能看出「是哪台机器」。
"""

from __future__ import annotations

import os
from ipaddress import ip_address, ip_network

from jose import JWTError, jwt
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.config import settings
from app.middleware.audit_context import set_request_meta
from app.security import guard, security_events

_SKIP_PREFIXES = ("/api/health", "/api/readyz", "/metrics", "/docs", "/openapi.json",
                  "/redoc", "/static", "/assets")
_SKIP_AUTH_LOGIN = "/api/auth/login"


def _trusted_networks():
    """可信反代列表（IP / CIDR，逗号分隔）；默认只信任本机反代."""
    raw = os.getenv("BI_TRUSTED_PROXIES", "127.0.0.1,::1")
    networks = []
    for item in raw.split(","):
        value = item.strip()
        if not value:
            continue
        try:
            networks.append(ip_network(value, strict=False))
        except ValueError:
            continue
    return networks


def _is_trusted(ip: str, networks) -> bool:
    try:
        addr = ip_address((ip or "").strip())
    except ValueError:
        return False
    return any(addr in network for network in networks)


def resolve_client_ip(peer: str, forwarded: str, networks=None) -> str:
    """解析真实客户端 IP：只有直连对端是可信反代时才采信 XFF.

    从 XFF 最右侧（离服务最近的代理追加的那一跳）往左走，跳过可信代理，
    第一个不可信地址就是真实客户端。攻击者自己伪造在左侧的 127.0.0.1 不会生效。
    """
    peer = (peer or "").strip()
    chain = [item.strip() for item in (forwarded or "").split(",") if item.strip()]
    if not chain:
        return peer
    nets = networks if networks is not None else _trusted_networks()
    if not _is_trusted(peer, nets):
        # 直连对端不是可信代理：忽略它带来的 XFF，防伪造
        return peer
    resolved = peer
    for hop in reversed(chain):
        resolved = hop
        if not _is_trusted(hop, nets):
            break
    return resolved


def _client_ip(request: Request) -> tuple[str, str]:
    forwarded = (request.headers.get("x-forwarded-for") or "").strip()
    peer = request.client.host if request.client else ""
    return resolve_client_ip(peer, forwarded), forwarded


def _sub(token: str) -> tuple[int | None, str]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        return (int(payload["sub"]), str(payload.get("cid") or "")) if payload.get("sub") else (None, "")
    except (JWTError, TypeError, ValueError):
        return None, ""


class SecurityWatchMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        ip, forwarded = _client_ip(request)
        ua = (request.headers.get("user-agent") or "")[:400]
        device_id = (request.headers.get("x-device-id") or "")[:80]
        language = (request.headers.get("accept-language") or "")[:80]
        fp = security_events.fingerprint(ip, ua, device_id, language)
        set_request_meta(ip=ip, user_agent=ua, fingerprint=fp)

        path = request.url.path
        method = request.method.upper()
        auth_header = (request.headers.get("authorization") or "").strip()
        has_token = auth_header.lower().startswith("bearer ")
        user_id = _sub(auth_header[7:].strip())[0] if has_token else None
        skip = method == "OPTIONS" or any(path.startswith(prefix) for prefix in _SKIP_PREFIXES)

        # 安全卫士：已封禁的 IP / 指纹 / 账号直接拒绝（健康检查等仍放行）
        if not skip:
            blocked = guard.is_blocked(ip=ip, fp=fp, user_id=user_id)
            if blocked is not None:
                return JSONResponse(
                    status_code=403,
                    content={"detail": f"访问已被安全卫士拦截（{blocked['reason']}），"
                                       f"{blocked['expires_at']} 后自动解封"},
                )

        response = await call_next(request)
        if skip:
            return response

        status = response.status_code
        event = ""
        if status == 401:
            event = "denied_invalid_token" if has_token else "denied_anonymous"
        elif status == 403:
            # HTTPBearer 缺凭据时也返回 403：没有令牌 = 匿名访问
            event = "denied_forbidden" if has_token else "denied_anonymous"
        elif status == 429:
            event = "rate_limited"
        elif status == 404 and security_events.is_suspicious_path(path):
            event = "suspicious_path"

        # 登录失败也计入安全卫士（不再重复写安全事件，审计表已有 auth.login_failed）
        if status == 401 and path.startswith(_SKIP_AUTH_LOGIN):
            guard.note("auth_failed", ip=ip, fp=fp, user_id=user_id)
            return response

        if event:
            # 先落事件再计数：组合规则（伪造令牌 + 越权探测）要能看见「本次」这条
            security_events.record(
                event,
                ip=ip, forwarded_for=forwarded, user_agent=ua, device_id=device_id, fp=fp,
                method=method, path=path, status_code=status, user_id=user_id,
                request_id=(request.headers.get("x-request-id") or "")[:64],
                detail={
                    "query": (request.url.query or "")[:300],
                    "referer": (request.headers.get("referer") or "")[:300],
                    "auth_present": has_token,
                },
            )
            guard.note(event, ip=ip, fp=fp, user_id=user_id)
        return response
