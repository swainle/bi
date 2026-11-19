"""MCP 令牌与授权（S2）.

令牌 = JWT（`aud=mcp`），授权记录 = `bi_mcp_grant`（刷新令牌只存哈希）。
设计原则（与 docs/MCP与Agent权限接入方案.md §5 一致）：
    * Agent 没有独立账号，令牌里的 `sub` 就是用户本人；
    * 每次调用都重新校验：用户状态 → token_version → 客户端启用 → 授权未撤 → 权限码；
    * 任何一环失效立刻拒绝，不依赖「令牌签发时的快照」。
"""

from __future__ import annotations

import hashlib
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import User

AUD = "mcp"


def _access_ttl() -> int:
    """访问令牌有效期：默认 30 分钟，可配 15–60 分钟（R12 收紧，refresh 仍 7 天）."""
    try:
        return min(3600, max(900, int(os.getenv("BI_MCP_ACCESS_TTL_SECONDS", "1800") or "1800")))
    except ValueError:
        return 1800


def max_active_grants() -> int:
    try:
        return max(1, int(os.getenv("BI_MCP_MAX_GRANTS", "5") or "5"))
    except ValueError:
        return 5


REFRESH_TTL_DAYS = 7


class McpAuthError(Exception):
    """鉴权失败（统一按 403 返回，避免暴露「差在哪一环」的细粒度信息）."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class McpContext:
    """一次 MCP 调用的身份上下文（全部来自实时校验，不是令牌快照）."""

    user: User
    client_id: int
    client_name: str
    jti: str
    scopes: list[str]


def hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def issue_access_token(user_id: int, token_version: int, client_id: int) -> dict:
    """签发访问令牌（带 jti，可单条吊销）；有效期默认 30 分钟."""
    ttl = _access_ttl()
    jti = secrets.token_hex(16)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "aud": AUD,
        "cid": int(client_id),
        "ver": int(token_version or 0),
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return {"access_token": token, "jti": jti, "expires_in": ttl}


def create_grant(db: Session, user_id: int, client_id: int, scopes: list[str] | None = None,
                 device_name: str = "", kind: str = "personal") -> dict:
    """生成用户授权 + 刷新令牌 + 该授权专属的 secret（明文只返回这一次）.

    每个授权有自己的 secret：团队成员各自生成接入串，互不共用、互不影响。
    """
    refresh = secrets.token_urlsafe(32)
    secret = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_TTL_DAYS)
    row = db.execute(
        text(
            "INSERT INTO bi_mcp_grant (user_id, client_id, scopes, expires_at, refresh_hash, "
            "  secret_hash, device_name, grant_kind) "
            "VALUES (:u, :c, CAST(:s AS jsonb), :e, :h, :sh, :d, :k) RETURNING id"
        ),
        {
            "u": int(user_id), "c": int(client_id),
            "s": str(scopes or []).replace("'", '"'),
            "e": expires, "h": hash_secret(refresh), "sh": hash_secret(secret),
            "d": (device_name or "")[:80], "k": "service" if kind == "service" else "personal",
        },
    ).fetchone()
    db.commit()
    return {
        "grant_id": int(row[0]), "refresh_token": refresh, "secret": secret,
        "expires_at": expires.isoformat(timespec="seconds"),
        "device_name": (device_name or "")[:80],
        "note": "secret 与 refresh_token 只显示这一次；Agent 用 client_id + secret + refresh_token 换访问令牌",
    }


def active_grant_count(db: Session, user_id: int) -> int:
    return int(db.execute(
        text(
            "SELECT count(*) FROM bi_mcp_grant WHERE user_id = :u AND revoked_at IS NULL "
            "AND (expires_at IS NULL OR expires_at > now())"
        ),
        {"u": int(user_id)},
    ).scalar() or 0)


def touch_grant(db: Session, grant_id: int, *, ip: str = "", user_agent: str = "") -> None:
    try:
        db.execute(
            text(
                "UPDATE bi_mcp_grant SET last_used_at = now(), last_ip = :ip, "
                "  last_user_agent = :ua WHERE id = :id"
            ),
            {"id": int(grant_id), "ip": (ip or "")[:80], "ua": (user_agent or "")[:400]},
        )
        db.commit()
    except Exception:
        db.rollback()


def active_grant(db: Session, user_id: int, client_id: int):
    return db.execute(
        text(
            "SELECT id, scopes, frozen_at, frozen_reason FROM bi_mcp_grant "
            "WHERE user_id = :u AND client_id = :c AND revoked_at IS NULL "
            "  AND (expires_at IS NULL OR expires_at > now()) "
            "ORDER BY id DESC LIMIT 1"
        ),
        {"u": int(user_id), "c": int(client_id)},
    ).fetchone()


def grant_by_refresh(db: Session, client_id: int, refresh_token: str):
    return db.execute(
        text(
            "SELECT g.id, g.user_id, g.scopes, g.grant_kind, g.secret_hash, "
            "       g.frozen_at, g.frozen_reason FROM bi_mcp_grant g "
            "WHERE g.client_id = :c AND g.refresh_hash = :h AND g.revoked_at IS NULL "
            "  AND (g.expires_at IS NULL OR g.expires_at > now()) "
            "ORDER BY g.id DESC LIMIT 1"
        ),
        {"c": int(client_id), "h": hash_secret(refresh_token)},
    ).fetchone()


def secret_matches(provided: str, grant_secret_hash: str | None, client_secret_hash: str | None) -> bool:
    """校验客户端凭据：授权自己的 secret 或客户端级 secret 均可（老配置向前兼容）."""
    if not provided:
        return False
    digest = hash_secret(provided)
    return digest == (grant_secret_hash or "") or digest == (client_secret_hash or "")


def authenticate(db: Session, token: str) -> McpContext:
    """解析并逐层校验 MCP 访问令牌；任何一环失败都抛 McpAuthError."""
    try:
        # python-jose 会在「令牌带 aud」时强制校验，必须显式传 audience
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], audience=AUD)
    except JWTError as exc:
        raise McpAuthError("令牌无效或已过期") from exc

    if payload.get("aud") != AUD:
        raise McpAuthError("令牌不是 MCP 专用令牌（aud 不匹配）")

    try:
        user_id = int(payload.get("sub") or 0)
        client_id = int(payload.get("cid") or 0)
        token_ver = int(payload.get("ver") or 0)
    except (TypeError, ValueError) as exc:
        raise McpAuthError("令牌内容不完整") from exc
    jti = str(payload.get("jti") or "")

    revoked = db.execute(
        text("SELECT 1 FROM bi_mcp_token_revoke WHERE jti = :j"), {"j": jti}
    ).fetchone()
    if revoked:
        raise McpAuthError("令牌已被吊销")

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise McpAuthError("账号不存在或已注销")
    if not user.is_active:
        raise McpAuthError("账号已停用")
    if (user.approval_status or "approved") != "approved":
        raise McpAuthError("账号未通过审批")
    if int(user.token_version or 0) != token_ver:
        raise McpAuthError("账号会话已失效，请重新授权")

    client = db.execute(
        text("SELECT id, name, enabled, dept_id FROM bi_mcp_client WHERE id = :id"), {"id": client_id}
    ).fetchone()
    if client is None:
        raise McpAuthError("MCP 客户端不存在")
    if not client[2]:
        raise McpAuthError("MCP 客户端已停用")
    # 部门开放范围每次调用都重算：换部门 / 客户端改范围后旧令牌立刻失效
    if client[3] is not None and user.role not in ("admin", "super_admin"):
        from app.admin.permissions import department_subtree_ids

        own_dept = getattr(user, "department_id", None)
        if not own_dept or int(client[3]) not in department_subtree_ids(db, int(own_dept)):
            raise McpAuthError("该客户端未对你的部门开放")

    grant = active_grant(db, user_id, client_id)
    if grant is None:
        raise McpAuthError("用户未授权该客户端，或授权已撤销/过期")
    if grant[2] is not None:
        reason = (grant[3] or "检测到异常取数行为").strip()
        raise McpAuthError(f"该授权已被安全策略冻结（{reason}），请联系管理员解冻")

    scopes = grant[1] if isinstance(grant[1], list) else []
    return McpContext(user=user, client_id=int(client[0]), client_name=client[1],
                      jti=jti, scopes=scopes)
