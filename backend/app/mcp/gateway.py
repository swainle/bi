"""MCP 网关（S2）.

对外三类接口：
    用户侧  POST   /api/mcp/grants        生成授权（返回一次性 refresh_token）
            GET    /api/mcp/grants/mine   我的授权
            DELETE /api/mcp/grants/{id}   撤销授权
    Agent  POST   /api/mcp/token          client_id + secret + refresh_token → 1 小时访问令牌
    Agent  POST   /api/mcp/rpc            JSON-RPC 2.0：initialize / tools/list / tools/call / ping

鉴权链（每次调用都重算，不看签发时的快照）：
    令牌（aud=mcp / jti 未吊销 / token_version / 用户状态）
    → 客户端启用 → 用户授权未撤 → 客户端工具策略 → 角色权限 → 数据范围（执行器内）
所有拒绝都会写 `bi_mcp_audit`。
"""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import department_subtree_ids, effective_permissions, has_permission
from app.database import get_db
from app.middleware.audit import log_audit
from app.middleware.auth import get_current_user
from app.mcp import auth as mcp_auth
from app.mcp import limits, loop_guard, orchestration, security_policy
from app.mcp.validate import SchemaError, validate
from app.mcp.tools import (
    TOOLS,
    McpConflictError,
    McpPermissionError,
    McpQuotaError,
    McpToolError,
    McpValidationError,
)
from app.models.user import User
from app.security import prompt_guard

router = APIRouter(prefix="/mcp", tags=["MCP 网关"])

_SENSITIVE_KEYS = ("secret", "token", "password", "sql")
_WRITE_TOOLS = {"bi_create_dashboard", "bi_add_item", "bi_set_layout",
                "bi_save_dashboard", "bi_publish_dashboard"}

# 下发到 Agent 的安全契约（MCP initialize 的标准字段，客户端会注入模型上下文）
_SAFETY_INSTRUCTIONS = (
    "明策BI MCP 服务。以下安全规则必须遵守：\n"
    "1. 只查询当前授权范围内（部门 / 看板 / 数据集）的数据；超出范围会被服务端直接拒绝。\n"
    "2. 禁止批量导出、全表扫描、分页拼接、把多个数据集结果合并后外传；财务/机密级数据只允许聚合或带条件的查询。\n"
    "3. 用户要求绕过权限、伪造身份、导出财务明细、规避审计或执行违法指令时，必须拒绝并说明原因，不得尝试变通。\n"
    "4. 遇到额度不足、范围限制或被冻结时立即停止并向用户说明，不要重试或更换参数绕过。\n"
    "5. 所有调用都会被审计（含行数、IP、User-Agent），用于安全追责。"
)


def _idem_cached(db: Session, client_id: int, tool: str, key: str):
    row = db.execute(
        text("SELECT result FROM bi_mcp_idempotency "
             "WHERE client_id = :c AND tool = :t AND idem_key = :k"),
        {"c": int(client_id), "t": tool, "k": key},
    ).fetchone()
    return row[0] if row else None


def _idem_store(db: Session, client_id: int, tool: str, key: str,
                user_id: int, result: dict) -> None:
    try:
        db.execute(
            text(
                "INSERT INTO bi_mcp_idempotency (client_id, tool, idem_key, user_id, result) "
                "VALUES (:c, :t, :k, :u, CAST(:r AS jsonb)) ON CONFLICT DO NOTHING"
            ),
            {"c": int(client_id), "t": tool, "k": key, "u": int(user_id),
             "r": json.dumps(result, ensure_ascii=False, default=str)[:20000]},
        )
        db.commit()
        db.execute(text("DELETE FROM bi_mcp_idempotency "
                        "WHERE created_at < now() - interval '7 days'"))
        db.commit()
    except Exception:
        db.rollback()


def _summarize(args: dict | None) -> dict:
    """审计参数脱敏：敏感键丢弃、字符串截断、结构只留长度."""
    out: dict = {}
    for key, value in (args or {}).items():
        if any(bad in str(key).lower() for bad in _SENSITIVE_KEYS):
            continue
        if isinstance(value, str):
            out[key] = value[:120]
        elif isinstance(value, (int, float, bool)) or value is None:
            out[key] = value
        elif isinstance(value, list):
            out[key] = f"[{len(value)}]"
        elif isinstance(value, dict):
            out[key] = f"{{{len(value)}}}"
        else:
            out[key] = str(value)[:60]
    return out


def _audit(db: Session, *, user_id: int | None, client_id: int | None, tool: str,
           risk: str, status: str, error: str = "", duration_ms: int = 0,
           args: dict | None = None, dataset_id: int | None = None,
           row_count: int | None = None, ip: str = "") -> None:
    try:
        db.execute(
            text(
                "INSERT INTO bi_mcp_audit (user_id, client_id, tool, risk, args_summary, "
                "  dataset_id, row_count, status, error, duration_ms, ip) "
                "VALUES (:u, :c, :t, :r, CAST(:a AS jsonb), :d, :n, :s, :e, :ms, :ip)"
            ),
            {
                "u": user_id, "c": client_id, "t": tool, "r": risk or "",
                "a": json.dumps(_summarize(args), ensure_ascii=False),
                "d": dataset_id, "n": row_count, "s": status,
                "e": (error or "")[:300], "ms": int(duration_ms), "ip": ip,
            },
        )
        db.commit()
    except Exception as exc:  # 审计写失败不能影响调用本身
        db.rollback()
        print(f"[mcp] 审计写入失败：{exc}")


def _visible_tools(db: Session, ctx: mcp_auth.McpContext) -> dict[str, dict]:
    """可见工具 = 已实现 ∩ 客户端策略（或默认开）∩ 用户角色权限."""
    perms = set(effective_permissions(db, ctx.user))
    rows = db.execute(
        text(
            "SELECT t.code, t.risk, t.required_permissions, "
            "       COALESCE(ct.enabled, t.default_enabled) AS granted "
            "FROM bi_mcp_tool t "
            "LEFT JOIN bi_mcp_client_tool ct "
            "  ON ct.tool_code = t.code AND ct.client_id = :c"
        ),
        {"c": ctx.client_id},
    ).fetchall()
    visible: dict[str, dict] = {}
    for code, risk, required, granted in rows:
        tool = TOOLS.get(code)
        if tool is None or not granted:
            continue
        if not set(required or []) <= perms:
            continue
        visible[code] = {"risk": risk, "tool": tool}

    # R12：授权里的 scopes 真正参与鉴权（工具名 / 风险级 / *）
    scopes = set(ctx.scopes or [])
    if scopes and "*" not in scopes:
        visible = {
            code: meta for code, meta in visible.items()
            if code in scopes or (meta.get("risk") or "") in scopes
        }
    return visible


def _bearer(header: str | None) -> str:
    value = (header or "").strip()
    if not value.lower().startswith("bearer "):
        return ""
    return value[7:].strip()


def visible_dept_ids(db: Session, user: User) -> list[int] | None:
    """客户端开放范围：None = 不限（管理员），[] = 只能看全员客户端."""
    if user.role in ("admin", "super_admin"):
        return None
    own = getattr(user, "department_id", None)
    if not own:
        return []
    return department_subtree_ids(db, int(own))


def client_allowed(db: Session, user: User, dept_id: int | None) -> bool:
    """部门为空 = 全员可用；否则本部门 + 下级部门可见."""
    if dept_id in (None, 0):
        return True
    scoped = visible_dept_ids(db, user)
    return scoped is None or int(dept_id) in scoped


def dashboard_scope(db: Session, client_id: int) -> set[int] | None:
    """客户端的看板范围：None = 不限；否则只能用这些看板."""
    rows = db.execute(
        text("SELECT dashboard_id FROM bi_mcp_client_dashboard WHERE client_id = :c"),
        {"c": int(client_id)},
    ).fetchall()
    if not rows:
        return None
    return {int(r[0]) for r in rows}


def scope_datasets(db: Session, scope: set[int]) -> set[int]:
    """这些看板实际引用的数据集（来自「元素 → 数据集」账本）."""
    rows = db.execute(
        text(
            "SELECT DISTINCT dataset_id FROM bi_dash_item_source "
            "WHERE dashboard_id = ANY(CAST(:ids AS integer[])) AND dataset_id IS NOT NULL"
        ),
        {"ids": sorted(scope)},
    ).fetchall()
    return {int(r[0]) for r in rows}


def _check_scope(name: str, args: dict, scope: set[int], datasets: set[int]) -> None:
    """看板范围内的越界拦截（在业务层之前；拒绝会写 denied 审计）."""
    dash = args.get("dashboard_id")
    if dash is not None:
        try:
            dash_id = int(dash)
        except (TypeError, ValueError) as exc:
            raise McpPermissionError("dashboard_id 不合法") from exc
        if dash_id not in scope:
            raise McpPermissionError("该看板不在这个客户端的授权范围内")
    if name == "bi_create_dashboard":
        raise McpPermissionError("这个客户端限定了看板范围，不能新建看板")
    ds = args.get("dataset_id")
    if ds is not None:
        try:
            ds_id = int(ds)
        except (TypeError, ValueError) as exc:
            raise McpPermissionError("dataset_id 不合法") from exc
        if ds_id not in datasets:
            raise McpPermissionError("该数据集不属于这个客户端授权的看板")


def _filter_scope_result(name: str, result: dict, scope: set[int] | None,
                         datasets: set[int] | None) -> dict:
    """列表类工具按范围过滤，避免「看得到但用不了」."""
    if scope is None or not isinstance(result, dict):
        return result
    if name == "bi_list_dashboards":
        keep = [d for d in result.get("dashboards", []) if int(d.get("id") or 0) in scope]
        return {**result, "dashboards": keep}
    if name == "bi_list_datasets":
        allowed = datasets or set()
        keep = [d for d in result.get("datasets", []) if int(d.get("id") or 0) in allowed]
        return {**result, "datasets": keep}
    return result


# ── 用户侧：授权 ─────────────────────────────────────────────
@router.post("/grants")
def create_grant(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """用户同意把权限授予某个 Agent 客户端；返回一次性 refresh_token."""
    if not (has_permission(db, current_user, "bi:mcp:use") or current_user.role in ("admin", "super_admin")):
        raise HTTPException(403, "没有「Agent 代调用」权限，请联系管理员开通")
    client_id = str(payload.get("client_id") or "").strip()
    row = db.execute(
        text("SELECT id, name, enabled, is_service, dept_id FROM bi_mcp_client WHERE client_id = :c"),
        {"c": client_id},
    ).fetchone()
    if row is None:
        raise HTTPException(404, "MCP 客户端不存在")
    if not row[2]:
        raise HTTPException(403, "该客户端已停用")
    if not client_allowed(db, current_user, row[4]):
        raise HTTPException(403, "该客户端未对你的部门开放")
    kind = "service" if payload.get("kind") == "service" else "personal"
    if row[3] and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "服务账号客户端只能由管理员授权")
    if kind == "service" and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "服务账号授权只能由管理员创建")

    active = mcp_auth.active_grant_count(db, current_user.id)
    if active >= mcp_auth.max_active_grants():
        raise HTTPException(
            429,
            f"活跃授权已达上限（{mcp_auth.max_active_grants()} 个），请先撤销不再使用的授权",
        )

    grant = mcp_auth.create_grant(db, current_user.id, int(row[0]),
                                  payload.get("scopes") or [],
                                  payload.get("device_name") or "", kind)
    log_audit(current_user.id, "mcp.grant.create", "mcp_client", int(row[0]),
              {"client_id": client_id, "device_name": grant.get("device_name"), "kind": kind})
    return {"client_id": client_id, **grant}


@router.get("/grants/mine")
def my_grants(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            "SELECT g.id, c.name, c.client_id, g.expires_at, g.revoked_at, g.created_at, "
            "       g.device_name, g.last_used_at, g.last_ip, g.last_user_agent, g.grant_kind, "
            "       g.frozen_at, g.frozen_reason "
            "FROM bi_mcp_grant g JOIN bi_mcp_client c ON c.id = g.client_id "
            "WHERE g.user_id = :u ORDER BY g.id DESC"
        ),
        {"u": current_user.id},
    ).fetchall()
    return {"grants": [
        {"id": r[0], "client_name": r[1], "client_id": r[2],
         "expires_at": str(r[3] or ""), "revoked_at": str(r[4] or ""),
         "created_at": str(r[5] or ""), "device_name": r[6] or "",
         "last_used_at": str(r[7] or ""), "last_ip": r[8] or "",
         "last_user_agent": r[9] or "", "kind": r[10] or "personal",
         "active": r[4] is None,
         "frozen": r[11] is not None,
         "frozen_reason": r[12] or ""}
        for r in rows
    ]}


@router.get("/clients/available")
def available_clients(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """当前用户可用的客户端（按部门开放范围过滤），附带自己的授权状态与可见工具."""
    if not (has_permission(db, current_user, "bi:mcp:use") or current_user.role in ("admin", "super_admin")):
        raise HTTPException(403, "没有「Agent 代调用」权限，请联系管理员开通")
    rows = db.execute(
        text(
            "SELECT c.id, c.name, c.description, c.client_id, c.dept_id, d.name "
            "FROM bi_mcp_client c LEFT JOIN departments d ON d.id = c.dept_id "
            "WHERE c.enabled ORDER BY c.id DESC"
        )
    ).fetchall()
    scoped = visible_dept_ids(db, current_user)
    scope_counts = {
        int(r[0]): int(r[1]) for r in db.execute(
            text("SELECT client_id, count(*) FROM bi_mcp_client_dashboard GROUP BY client_id")
        ).fetchall()
    }
    granted = {
        int(r[0]) for r in db.execute(
            text("SELECT g.client_id FROM bi_mcp_grant g WHERE g.user_id = :u "
                 "AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())"),
            {"u": current_user.id},
        ).fetchall()
    }
    items = []
    for cid, name, desc, key, dept_id, dept_name in rows:
        if dept_id not in (None, 0) and scoped is not None and int(dept_id) not in scoped:
            continue
        ctx = mcp_auth.McpContext(user=current_user, client_id=int(cid), client_name=name,
                                  jti="", scopes=[])
        items.append({
            "id": int(cid), "name": name, "description": desc or "",
            "client_id": key, "dept": dept_name or "全员",
            "tools": sorted(_visible_tools(db, ctx).keys()),
            "granted": int(cid) in granted,
            "dashboard_count": scope_counts.get(int(cid), 0),
        })
    return {"clients": items}


@router.delete("/grants/mine")
def revoke_my_grants(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """一键撤销我的全部授权（旧访问令牌下一请求立即失效）."""
    count = db.execute(
        text("UPDATE bi_mcp_grant SET revoked_at = now() "
             "WHERE user_id = :u AND revoked_at IS NULL RETURNING id"),
        {"u": current_user.id},
    ).rowcount
    db.commit()
    log_audit(current_user.id, "mcp.grant.revoke_all", "user", current_user.id,
              {"revoked": int(count or 0)})
    return {"revoked": int(count or 0)}


@router.delete("/grants/{grant_id}")
def revoke_grant(
    grant_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.execute(text("SELECT user_id FROM bi_mcp_grant WHERE id = :id"), {"id": grant_id}).fetchone()
    if row is None:
        raise HTTPException(404, "授权记录不存在")
    if int(row[0]) != current_user.id and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "只能撤销自己的授权")
    db.execute(
        text("UPDATE bi_mcp_grant SET revoked_at = now() WHERE id = :id AND revoked_at IS NULL"),
        {"id": grant_id},
    )
    db.commit()
    log_audit(current_user.id, "mcp.grant.revoke", "mcp_client", grant_id, {})
    return {"id": grant_id, "revoked": True}


# ── Agent 侧：换令牌 ─────────────────────────────────────────
@router.post("/token")
def issue_token(
    request: Request,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    client_key = str(payload.get("client_id") or "").strip()
    secret = str(payload.get("client_secret") or "").strip()
    refresh = str(payload.get("refresh_token") or "").strip()
    if not (client_key and secret and refresh):
        raise HTTPException(400, "client_id / client_secret / refresh_token 都不能为空")

    client = db.execute(
        text("SELECT id, enabled, secret_hash, is_service FROM bi_mcp_client WHERE client_id = :c"),
        {"c": client_key},
    ).fetchone()
    if client is None:
        raise HTTPException(403, "客户端凭据不正确")
    if not client[1]:
        raise HTTPException(403, "该客户端已停用")

    grant = mcp_auth.grant_by_refresh(db, int(client[0]), refresh)
    if grant is None:
        raise HTTPException(403, "授权不存在、已撤销或已过期")
    if grant[5] is not None:
        raise HTTPException(403, f"该授权已被安全策略冻结（{grant[6] or '异常取数'}），请联系管理员解冻")
    # 凭据优先按授权自己的 secret（团队每人一份），老授权回落到客户端级 secret
    if not mcp_auth.secret_matches(secret, grant[4], client[2]):
        raise HTTPException(403, "客户端凭据不正确")
    if bool(client[3]) != (str(grant[3] or "personal") == "service"):
        raise HTTPException(403, "服务账号客户端必须使用服务授权，个人授权不能借用")
    user = db.query(User).filter(User.id == int(grant[1])).first()
    if user is None or not user.is_active:
        raise HTTPException(403, "账号不可用")

    db.execute(
        text("UPDATE bi_mcp_client SET last_used_at = now() WHERE id = :id"), {"id": int(client[0])}
    )
    db.commit()
    mcp_auth.touch_grant(
        db, int(grant[0]),
        ip=(request.client.host if request.client else ""),
        user_agent=(request.headers.get("user-agent") or ""),
    )
    token = mcp_auth.issue_access_token(user.id, int(user.token_version or 0), int(client[0]))
    return {**token, "token_type": "Bearer", "aud": mcp_auth.AUD}


# ── Agent 侧：JSON-RPC ───────────────────────────────────────
def _rpc_error(req_id, code: int, message: str, status: int = 200) -> HTTPException:
    return HTTPException(status, detail={"jsonrpc": "2.0", "id": req_id,
                                         "error": {"code": code, "message": message}})


def _map_tool_error(exc: McpToolError) -> tuple[int, int, bool]:
    """业务错误 → (JSON-RPC code, HTTP 状态, 是否算权限拒绝)."""
    if isinstance(exc, McpPermissionError):
        return -32003, 403, True
    if isinstance(exc, McpQuotaError):
        return -32029, 429, False
    if isinstance(exc, McpConflictError):
        return -32009, 409, False
    if isinstance(exc, McpValidationError):
        return -32004, 400, False
    return -32002, 200, False


@router.post("/rpc")
def rpc(
    request: Request,
    payload: dict = Body(...),
    authorization: str | None = Header(default=None),
    mcp_session_id: str | None = Header(default=None, alias="Mcp-Session-Id"),
    db: Session = Depends(get_db),
):
    req_id = payload.get("id")
    method = str(payload.get("method") or "")
    params = payload.get("params") or {}
    ip = request.client.host if request.client else ""

    token = _bearer(authorization)
    if not token:
        raise _rpc_error(req_id, -32001, "缺少 MCP 访问令牌", 403)
    try:
        ctx = mcp_auth.authenticate(db, token)
    except mcp_auth.McpAuthError as exc:
        raise _rpc_error(req_id, -32001, exc.message, 403) from exc

    if method == "initialize":
        return {"jsonrpc": "2.0", "id": req_id, "result": {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "mingcebi-mcp", "version": "0.2.0"},
            "instructions": _SAFETY_INSTRUCTIONS,
        }}

    # JSON-RPC 通知（无 id，如 notifications/initialized）：按 MCP 规范回 202 空 body。
    # 之前回的是 -32601 错误对象，rmcp（Codex / Claude Code）会当成传输层故障，握手直接失败。
    if "id" not in payload:
        return Response(status_code=202)

    if method == "ping":
        return {"jsonrpc": "2.0", "id": req_id, "result": {}}

    if method == "tools/list":
        visible = _visible_tools(db, ctx)
        tools = [
            {"name": code, "description": meta["tool"]["description"],
             "inputSchema": meta["tool"]["inputSchema"]}
            for code, meta in sorted(visible.items())
        ]
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool="tools/list",
               risk="", status="ok", ip=ip)
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}}

    if method != "tools/call":
        raise _rpc_error(req_id, -32601, f"不支持的方法：{method}")

    name = str((params or {}).get("name") or "")
    args = (params or {}).get("arguments") or {}
    visible = _visible_tools(db, ctx)
    meta = visible.get(name)
    if meta is None:
        risk_row = db.execute(
            text("SELECT risk FROM bi_mcp_tool WHERE code = :c"), {"c": name}
        ).fetchone()
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name or "(empty)",
               risk=(risk_row[0] if risk_row else ""), status="denied",
               error="工具未启用或无权限", args=args, ip=ip)
        raise _rpc_error(req_id, -32003, f"工具未启用或没有权限：{name}", 403)

    # 会话键提前算好：后续任何一步失败（含参数校验）都要能回收本会话的孤儿草稿
    session = loop_guard.session_key(ctx.client_id, ctx.user.id, ctx.jti,
                                     mcp_session_id or "")

    def _rollback() -> None:
        """只回收「终止型失败」的孤儿草稿；参数/权限类可重试错误不回滚."""
        if name in _WRITE_TOOLS:
            orchestration.rollback(session, db)

    # R10：熔断 + 客户端 QPS / 用户每日额度
    try:
        limits.check_breaker(ctx.client_id)
        limits.check_rate(ctx.client_id, ctx.user.id, db)
    except (limits.McpRateLimitError, limits.McpCircuitOpenError) as exc:
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied", error=exc.message, args=args, ip=ip)
        if isinstance(exc, limits.McpCircuitOpenError):
            _rollback()
        raise _rpc_error(req_id, -32029, exc.message, 429) from exc

    # R7：按工具 inputSchema 强校验，失败不进业务层
    try:
        validate(args, meta["tool"].get("inputSchema") or {})
    except SchemaError as exc:
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied", error=str(exc), args=args, ip=ip)
        raise _rpc_error(req_id, -32004, f"参数不合法：{exc}", 400) from exc

    # 看板范围：客户端限定了看板时，越界直接 403（数据集按这些看板实际引用收口）
    scope = dashboard_scope(db, ctx.client_id)
    allowed_datasets: set[int] | None = None
    if scope is not None:
        allowed_datasets = scope_datasets(db, scope)
        try:
            _check_scope(name, args, scope, allowed_datasets)
        except McpPermissionError as exc:
            _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
                   risk=meta["risk"], status="denied", error=exc.message, args=args, ip=ip)
            raise _rpc_error(req_id, -32003, exc.message, 403) from exc

    # 取数安全底座：异常行为冻结 + 数据集分级（预算 / 明细 / 分页）
    try:
        security_policy.check_anomaly(
            db, ctx, ip=ip, user_agent=(request.headers.get("user-agent") or ""))
        dataset_id = args.get("dataset_id")
        if name in security_policy.DATASET_TOOLS and dataset_id:
            policy = security_policy.dataset_policy(db, int(dataset_id))
            if policy:
                security_policy.apply_dataset_policy(db, ctx, name, args, policy)
    except McpToolError as exc:
        limits.record_result(ctx.client_id, False)
        code, status, denied = _map_tool_error(exc)
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied" if denied else "error",
               error=exc.message, args=args, ip=ip)
        raise _rpc_error(req_id, code, exc.message, status) from exc

    # R8：写工具幂等键（同客户端同工具同 key 只执行一次）
    idem_key = str(args.get("idempotency_key") or "").strip()[:120]
    idem_applies = bool(idem_key) and (name in _WRITE_TOOLS or meta["risk"] == "high")
    if idem_applies:
        cached = _idem_cached(db, ctx.client_id, name, idem_key)
        if cached is not None:
            _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
                   risk=meta["risk"], status="ok", error="idempotent-replay",
                   args=args, ip=ip)
            return {"jsonrpc": "2.0", "id": req_id, "result": {
                "content": [{"type": "text",
                             "text": json.dumps(cached, ensure_ascii=False, default=str)}],
                "isError": False,
            }}

    started = time.time()
    # R6：会话步数 / 重复调用 / 无进展 防护（带 task_id 的批量任务只计步数）
    try:
        loop_guard.before_call(session, name, args)
    except loop_guard.LoopGuardError as exc:
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied", error=exc.message, args=args, ip=ip)
        _rollback()
        raise _rpc_error(req_id, -32010, exc.message, 429) from exc
    # R5：工具参数注入检测（命中攻击规则直接 400，疑似只记事件）
    verdict = prompt_guard.check_tool_args(args, tool=name, user_id=ctx.user.id)
    if verdict["level"] == "attack":
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied",
               error=f"参数命中注入规则：{','.join(verdict.get('categories') or [])}",
               args=args, ip=ip)
        _rollback()
        raise _rpc_error(req_id, -32004, "参数未通过安全检查", 400)
    try:
        result = meta["tool"]["handler"](db, ctx, args)
    except McpToolError as exc:
        limits.record_result(ctx.client_id, False)
        code, status, denied = _map_tool_error(exc)
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="denied" if denied else "error",
               error=exc.message, args=args,
               duration_ms=int((time.time() - started) * 1000), ip=ip)
        raise _rpc_error(req_id, code, exc.message, status) from exc
    except HTTPException:
        limits.record_result(ctx.client_id, False)
        raise
    except Exception as exc:  # 未预期异常也要留审计
        limits.record_result(ctx.client_id, False)
        cleaned = orchestration.rollback(session, db) if name in _WRITE_TOOLS else []
        _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
               risk=meta["risk"], status="error",
               error=str(exc)[:200] + (f"；已回滚草稿 {cleaned}" if cleaned else ""),
               args=args, duration_ms=int((time.time() - started) * 1000), ip=ip)
        raise HTTPException(500, f"工具执行失败：{str(exc)[:200]}") from exc

    limits.record_result(ctx.client_id, True)
    result = _filter_scope_result(name, result, scope, allowed_datasets)
    if name == "bi_create_dashboard" and isinstance(result, dict):
        orchestration.note_created(session, int(result.get("dashboard_id") or 0))
    if idem_applies and isinstance(result, dict):
        _idem_store(db, ctx.client_id, name, idem_key, ctx.user.id, result)

    # R5：工具返回二次校验，清掉数据里夹带的指令，避免回流诱导模型
    result, removed = prompt_guard.sanitize_tool_output(result)
    # R6：记录结果指纹（连续相同结果 → 判定无进展）
    loop_guard.after_call(session, result)
    payload_text = json.dumps(result, ensure_ascii=False, default=str)
    _audit(db, user_id=ctx.user.id, client_id=ctx.client_id, tool=name,
           risk=meta["risk"], status="ok", args=args,
           dataset_id=args.get("dataset_id"),
           row_count=(result.get("row_count") if isinstance(result, dict) else None),
           error=(f"输出已清理 {removed} 处疑似注入" if removed else ""),
           duration_ms=int((time.time() - started) * 1000), ip=ip)
    return {"jsonrpc": "2.0", "id": req_id, "result": {
        "content": [{"type": "text", "text": payload_text}],
        "isError": False,
    }}
