"""MCP 管理后台接口（S1）：客户端增停、工具目录。

网关与工具实现在 S2 / S5；这里只交付「管理员能真实建客户端、能停用、能看目录」。
权限：全部 `bi:mcp:manage`（管理员直通，其余角色需要显式授权）。
"""

from __future__ import annotations

import hashlib
import os
import secrets
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import has_permission, require
from app.database import get_db
from app.mcp import auth as mcp_auth
from app.mcp.gateway import _visible_tools
from app.middleware.audit import log_audit
from app.models.user import User
from app.semantic.access import validate_dept_choice

router = APIRouter(prefix="/mcp", tags=["MCP 管理"])


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _anomaly_grace_minutes() -> int:
    """解冻后的观察期（分钟），期间不再因同一个异常窗口重复冻结."""
    try:
        return max(1, int(os.getenv("BI_MCP_ANOMALY_GRACE_MIN", "30") or 30))
    except ValueError:
        return 30


def _dashboard_ids(db: Session, raw) -> list[int]:
    """校验并去重看板 id（不存在 / 已删除 → 400）."""
    try:
        ids = sorted({int(x) for x in (raw or []) if int(x) > 0})
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, "看板范围不合法") from exc
    if not ids:
        return []
    rows = db.execute(
        text("SELECT id FROM bi_canvas WHERE deleted_at IS NULL AND id = ANY(CAST(:ids AS integer[]))"),
        {"ids": ids},
    ).fetchall()
    found = {int(r[0]) for r in rows}
    missing = [i for i in ids if i not in found]
    if missing:
        raise HTTPException(400, f"看板不存在或已删除：{missing}")
    return ids


def _client_row(row) -> dict:
    return {
        "id": int(row[0]),
        "name": row[1],
        "description": row[2] or "",
        "client_id": row[3],
        "enabled": bool(row[4]),
        "owner_id": row[5],
        "created_at": str(row[6] or ""),
        "last_used_at": str(row[7] or "") if row[7] else "",
        "is_service": bool(row[8]) if len(row) > 8 else False,
        "dept_id": int(row[9]) if len(row) > 9 and row[9] is not None else None,
        "dept_name": (row[10] if len(row) > 10 else "") or "",
        "dashboard_count": int(row[11] or 0) if len(row) > 11 else 0,
    }


@router.get("/clients")
def list_clients(
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text(
            "SELECT c.id, c.name, c.description, c.client_id, c.enabled, c.owner_id, "
            "       c.created_at, c.last_used_at, c.is_service, c.dept_id, d.name, "
            "       (SELECT count(*) FROM bi_mcp_client_dashboard cd WHERE cd.client_id = c.id) "
            "FROM bi_mcp_client c LEFT JOIN departments d ON d.id = c.dept_id "
            "ORDER BY c.id DESC"
        )
    ).fetchall()
    return {"clients": [_client_row(r) for r in rows]}


@router.post("/clients")
def create_client(
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """创建 MCP 客户端；secret 只在这次响应里出现，之后不可再取."""
    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "客户端名称不能为空")
    description = str(payload.get("description") or "").strip()[:200]
    is_service = bool(payload.get("is_service"))
    # 部门为空 = 全员可用；否则本部门及下级部门的人在「MCP 授权」页可见
    dept_id = validate_dept_choice(db, payload.get("dept_id"), current_user)
    dashboard_ids = _dashboard_ids(db, payload.get("dashboard_ids"))

    client_id = uuid4().hex
    secret = secrets.token_urlsafe(32)
    row = db.execute(
        text(
            "INSERT INTO bi_mcp_client "
            "  (name, description, client_id, secret_hash, owner_id, enabled, is_service, dept_id) "
            "VALUES (:n, :d, :cid, :hash, :owner, true, :svc, :dept) RETURNING id"
        ),
        {
            "n": name[:60], "d": description, "cid": client_id,
            "hash": _hash_secret(secret), "owner": current_user.id, "svc": is_service,
            "dept": dept_id,
        },
    ).fetchone()
    new_id = int(row[0])
    for did in dashboard_ids:
        db.execute(
            text("INSERT INTO bi_mcp_client_dashboard (client_id, dashboard_id) "
                 "VALUES (:c, :d) ON CONFLICT DO NOTHING"),
            {"c": new_id, "d": did},
        )
    db.commit()
    log_audit(current_user.id, "mcp.client.create", "mcp_client", new_id,
              {"name": name, "client_id": client_id, "is_service": is_service,
               "dept_id": dept_id, "dashboards": len(dashboard_ids)})
    return {
        "id": new_id, "name": name, "description": description,
        "client_id": client_id, "secret": secret, "enabled": True,
        "is_service": is_service, "dept_id": dept_id,
        "dashboard_ids": dashboard_ids,
        "note": "secret 只显示这一次，请立刻保存到 Agent 配置里",
    }


@router.patch("/clients/{client_id}")
def update_client(
    client_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """启用 / 停用客户端，或修改开放部门（停用后该客户端的 token 立即拒绝）."""
    fields: list[str] = []
    params: dict = {"id": client_id}
    if "enabled" in payload:
        fields.append("enabled = :e")
        params["e"] = bool(payload.get("enabled"))
    if "dept_id" in payload:
        fields.append("dept_id = :dept")
        params["dept"] = validate_dept_choice(db, payload.get("dept_id"), current_user)
    if not fields:
        raise HTTPException(400, "只支持修改 enabled / dept_id")
    result = db.execute(
        text(f"UPDATE bi_mcp_client SET {', '.join(fields)} WHERE id = :id"), params
    )
    if not result.rowcount:
        raise HTTPException(404, "客户端不存在")
    db.commit()
    log_audit(current_user.id, "mcp.client.update", "mcp_client", client_id,
              {k: v for k, v in payload.items() if k in ("enabled", "dept_id")})
    return {"id": client_id, **{k: v for k, v in params.items() if k != "id"}}


@router.get("/dashboards")
def dashboard_options(
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """给客户端配置看板范围用：全部未删除看板（只取 id / 名称 / 所有者）."""
    rows = db.execute(
        text(
            "SELECT c.id, c.name, c.owner_id, u.username, c.updated_at "
            "FROM bi_canvas c LEFT JOIN users u ON u.id = c.owner_id "
            "WHERE c.deleted_at IS NULL ORDER BY c.updated_at DESC NULLS LAST, c.id DESC LIMIT 500"
        )
    ).fetchall()
    return {"dashboards": [
        {"id": int(r[0]), "name": r[1] or f"看板 {r[0]}", "owner": r[3] or "",
         "updated_at": str(r[4] or "")}
        for r in rows
    ]}


@router.get("/clients/{client_pk}/dashboards")
def client_dashboards(
    client_pk: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    if db.execute(text("SELECT 1 FROM bi_mcp_client WHERE id = :i"), {"i": client_pk}).fetchone() is None:
        raise HTTPException(404, "客户端不存在")
    rows = db.execute(
        text("SELECT dashboard_id FROM bi_mcp_client_dashboard WHERE client_id = :c ORDER BY dashboard_id"),
        {"c": client_pk},
    ).fetchall()
    return {"client_id": client_pk, "dashboard_ids": [int(r[0]) for r in rows]}


@router.put("/clients/{client_pk}/dashboards")
def set_client_dashboards(
    client_pk: int,
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """设置客户端的看板范围；传空数组 = 不限（回到只按用户权限收口）."""
    if db.execute(text("SELECT 1 FROM bi_mcp_client WHERE id = :i"), {"i": client_pk}).fetchone() is None:
        raise HTTPException(404, "客户端不存在")
    ids = _dashboard_ids(db, payload.get("dashboard_ids"))
    db.execute(text("DELETE FROM bi_mcp_client_dashboard WHERE client_id = :c"), {"c": client_pk})
    for did in ids:
        db.execute(
            text("INSERT INTO bi_mcp_client_dashboard (client_id, dashboard_id) VALUES (:c, :d)"),
            {"c": client_pk, "d": did},
        )
    db.commit()
    log_audit(current_user.id, "mcp.client.dashboards", "mcp_client", client_pk,
              {"dashboards": len(ids)})
    return {"client_id": client_pk, "dashboard_ids": ids}


@router.delete("/clients/{client_pk}")
def delete_client(
    client_pk: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """删除客户端：授权与工具开关级联清掉，已签发的 token 下一请求即失效（审计保留）."""
    row = db.execute(
        text("SELECT name, client_id FROM bi_mcp_client WHERE id = :id"), {"id": client_pk}
    ).fetchone()
    if row is None:
        raise HTTPException(404, "客户端不存在")
    db.execute(text("DELETE FROM bi_mcp_client WHERE id = :id"), {"id": client_pk})
    db.commit()
    log_audit(current_user.id, "mcp.client.delete", "mcp_client", client_pk,
              {"name": row[0], "client_id": row[1]})
    return {"id": client_pk, "deleted": True}


@router.post("/clients/{client_pk}/connector")
def build_connector(
    client_pk: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """为客户端生成一份属于当前账号的接入凭据：新的授权 secret + refresh_token.

    每个授权有自己的 secret，所以这里不再动客户端级 secret，也不会影响其他成员的接入串；
    只作废「本人」此前对该客户端的旧授权。
    """
    row = db.execute(
        text("SELECT id, name, client_id, enabled FROM bi_mcp_client WHERE id = :id"),
        {"id": client_pk},
    ).fetchone()
    if row is None:
        raise HTTPException(404, "客户端不存在")
    if not row[3]:
        raise HTTPException(403, "客户端已停用，先启用再生成")
    if not (has_permission(db, current_user, "bi:mcp:use")
            or current_user.role in ("admin", "super_admin")):
        raise HTTPException(403, "没有「Agent 代调用」权限，请联系管理员开通")

    db.execute(
        text("UPDATE bi_mcp_grant SET revoked_at = now() "
             "WHERE client_id = :c AND user_id = :u AND revoked_at IS NULL"),
        {"c": client_pk, "u": current_user.id},
    )
    db.commit()
    grant = mcp_auth.create_grant(db, current_user.id, client_pk, [], "控制台生成", "personal")

    ctx = mcp_auth.McpContext(user=current_user, client_id=client_pk, client_name=row[1],
                              jti="", scopes=[])
    tools = sorted(_visible_tools(db, ctx).keys())
    log_audit(current_user.id, "mcp.client.connector", "mcp_client", client_pk,
              {"name": row[1], "client_id": row[2], "tools": len(tools)})
    return {
        "id": client_pk, "name": row[1], "client_id": row[2],
        "secret": grant["secret"], "refresh_token": grant["refresh_token"],
        "grant_id": grant["grant_id"], "expires_at": grant["expires_at"],
        "tools": tools,
        "note": "secret 与 refresh_token 只显示这一次；本人旧的授权已作废",
    }


@router.get("/tools")
def list_tools(
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """工具目录（risk / 必需权限 / 默认开关）."""
    rows = db.execute(
        text(
            "SELECT code, name, description, risk, required_permissions, default_enabled "
            "FROM bi_mcp_tool ORDER BY CASE risk WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, code"
        )
    ).fetchall()
    return {"tools": [
        {
            "code": r[0], "name": r[1], "description": r[2] or "",
            "risk": r[3], "required_permissions": r[4] or [],
            "default_enabled": bool(r[5]),
        }
        for r in rows
    ]}


@router.get("/clients/{client_pk}/tools")
def client_tools(
    client_pk: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """某个客户端的工具开关（没配过时回落到目录默认值）."""
    if db.execute(text("SELECT 1 FROM bi_mcp_client WHERE id = :i"), {"i": client_pk}).fetchone() is None:
        raise HTTPException(404, "客户端不存在")
    rows = db.execute(
        text(
            "SELECT t.code, t.name, t.risk, t.default_enabled, "
            "       COALESCE(ct.enabled, t.default_enabled) AS enabled, ct.granted_at "
            "FROM bi_mcp_tool t "
            "LEFT JOIN bi_mcp_client_tool ct ON ct.tool_code = t.code AND ct.client_id = :c "
            "ORDER BY CASE t.risk WHEN 'low' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, t.code"
        ),
        {"c": client_pk},
    ).fetchall()
    return {"tools": [
        {"code": r[0], "name": r[1], "risk": r[2], "default_enabled": bool(r[3]),
         "enabled": bool(r[4]), "granted_at": str(r[5] or "")}
        for r in rows
    ]}


@router.put("/clients/{client_pk}/tools")
def set_client_tool(
    client_pk: int,
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """开关某个客户端的工具（高危工具默认关，开了才可能被调用）."""
    code = str(payload.get("tool_code") or "").strip()
    if not code:
        raise HTTPException(400, "缺少 tool_code")
    if db.execute(text("SELECT 1 FROM bi_mcp_tool WHERE code = :c"), {"c": code}).fetchone() is None:
        raise HTTPException(404, "工具不存在")
    enabled = bool(payload.get("enabled"))
    db.execute(
        text(
            "INSERT INTO bi_mcp_client_tool (client_id, tool_code, enabled, granted_by) "
            "VALUES (:c, :t, :e, :by) "
            "ON CONFLICT (client_id, tool_code) DO UPDATE SET enabled = :e, "
            "  granted_by = :by, granted_at = now()"
        ),
        {"c": client_pk, "t": code, "e": enabled, "by": current_user.id},
    )
    db.commit()
    log_audit(current_user.id, "mcp.client.tool", "mcp_client", client_pk,
              {"tool_code": code, "enabled": enabled})
    return {"client_id": client_pk, "tool_code": code, "enabled": enabled}


@router.get("/grants")
def list_grants(
    limit: int = 100,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """全部授权记录（谁把权限授给了哪个客户端）."""
    rows = db.execute(
        text(
            "SELECT g.id, g.user_id, u.username, c.name, c.client_id, "
            "       g.expires_at, g.revoked_at, g.created_at, g.device_name, "
            "       g.last_used_at, g.last_ip, g.grant_kind, g.frozen_at, g.frozen_reason "
            "FROM bi_mcp_grant g "
            "JOIN bi_mcp_client c ON c.id = g.client_id "
            "LEFT JOIN users u ON u.id = g.user_id "
            "ORDER BY g.id DESC LIMIT :n"
        ),
        {"n": max(1, min(int(limit or 100), 500))},
    ).fetchall()
    return {"grants": [
        {"id": r[0], "user_id": r[1], "username": r[2] or "(已删除)", "client_name": r[3],
         "client_id": r[4], "expires_at": str(r[5] or ""), "revoked_at": str(r[6] or ""),
         "created_at": str(r[7] or ""), "device_name": r[8] or "",
         "last_used_at": str(r[9] or ""), "last_ip": r[10] or "",
         "kind": r[11] or "personal", "active": r[6] is None,
         "frozen_at": str(r[12] or "") if r[12] else "",
         "frozen_reason": r[13] or "",
         "frozen": r[12] is not None}
        for r in rows
    ]}


@router.delete("/grants")
def revoke_user_grants(
    user_id: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """管理员撤销指定用户的全部授权（离职 / 异常时一键止损）."""
    count = db.execute(
        text("UPDATE bi_mcp_grant SET revoked_at = now() "
             "WHERE user_id = :u AND revoked_at IS NULL RETURNING id"),
        {"u": int(user_id)},
    ).rowcount
    db.commit()
    log_audit(current_user.id, "mcp.grant.admin_revoke_all", "user", int(user_id),
              {"revoked": int(count or 0)})
    return {"user_id": user_id, "revoked": int(count or 0)}


@router.post("/grants/{grant_id}/unfreeze")
def unfreeze_grant(
    grant_id: int,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """解冻被安全策略冻结的授权（人工复核后操作）."""
    row = db.execute(
        text("SELECT user_id, client_id, frozen_reason FROM bi_mcp_grant WHERE id = :i"),
        {"i": grant_id},
    ).fetchone()
    if row is None:
        raise HTTPException(404, "授权记录不存在")
    db.execute(
        text(
            "UPDATE bi_mcp_grant SET frozen_at = NULL, frozen_reason = NULL, "
            "  anomaly_grace_until = now() + make_interval(mins => :g) WHERE id = :i"
        ),
        {"i": grant_id, "g": _anomaly_grace_minutes()},
    )
    db.commit()
    log_audit(current_user.id, "mcp.grant.unfreeze", "mcp_client", int(row[1]),
              {"grant_id": grant_id, "reason": row[2] or ""})
    return {"id": grant_id, "unfrozen": True, "grace_minutes": _anomaly_grace_minutes()}


# ── 数据分级（MCP 取数安全）──────────────────────────────────
_DATA_CLASSES = {"normal", "confidential", "financial"}


@router.get("/datasets")
def dataset_guard_list(
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """数据集分级与今日行数消耗（给「数据分级」页用）."""
    rows = db.execute(
        text(
            "SELECT d.id, d.name, d.data_class, d.mcp_daily_rows, dep.name, "
            "       COALESCE((SELECT sum(a.row_count) FROM bi_mcp_audit a "
            "                 WHERE a.dataset_id = d.id AND a.status = 'ok' "
            "                   AND a.created_at >= date_trunc('day', now())), 0) AS rows_today "
            "FROM bi_dataset d LEFT JOIN departments dep ON dep.id = d.dept_id "
            "WHERE COALESCE(d.is_active, true) ORDER BY d.id"
        )
    ).fetchall()
    return {"datasets": [
        {"id": int(r[0]), "name": r[1] or f"数据集 {r[0]}", "data_class": r[2] or "normal",
         "daily_rows": int(r[3]) if r[3] else None, "dept_name": r[4] or "",
         "rows_today": int(r[5] or 0)}
        for r in rows
    ]}


@router.patch("/datasets/{dataset_id}")
def set_dataset_guard(
    dataset_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """调整数据集分级 / 每日行数预算（空 daily_rows = 用分级默认）."""
    fields: list[str] = []
    params: dict = {"id": dataset_id}
    if "data_class" in payload:
        value = str(payload.get("data_class") or "").strip()
        if value not in _DATA_CLASSES:
            raise HTTPException(400, "data_class 只能是 normal / confidential / financial")
        fields.append("data_class = :cls")
        params["cls"] = value
    if "daily_rows" in payload:
        raw = payload.get("daily_rows")
        if raw in (None, "", 0, "0"):
            params["rows"] = None
        else:
            try:
                params["rows"] = max(1, int(raw))
            except (TypeError, ValueError) as exc:
                raise HTTPException(400, "daily_rows 必须是正整数") from exc
        fields.append("mcp_daily_rows = :rows")
    if not fields:
        raise HTTPException(400, "只支持修改 data_class / daily_rows")
    result = db.execute(text(f"UPDATE bi_dataset SET {', '.join(fields)} WHERE id = :id"), params)
    if not result.rowcount:
        raise HTTPException(404, "数据集不存在")
    db.commit()
    log_audit(current_user.id, "mcp.dataset.guard", "dataset", dataset_id,
              {k: v for k, v in params.items() if k != "id"})
    return {"id": dataset_id, **{k: v for k, v in params.items() if k != "id"}}


@router.get("/audit")
def list_audit(
    limit: int = 100,
    current_user: User = Depends(require("bi:mcp:manage", "没有 MCP 管理权限，请联系管理员开通")),
    db: Session = Depends(get_db),
):
    """最近调用审计（含被拒 / 报错）."""
    rows = db.execute(
        text(
            "SELECT a.id, a.user_id, u.username, c.name, a.tool, a.risk, a.status, "
            "       a.error, a.row_count, a.duration_ms, a.created_at "
            "FROM bi_mcp_audit a "
            "LEFT JOIN users u ON u.id = a.user_id "
            "LEFT JOIN bi_mcp_client c ON c.id = a.client_id "
            "ORDER BY a.id DESC LIMIT :n"
        ),
        {"n": max(1, min(int(limit or 100), 500))},
    ).fetchall()
    return {"items": [
        {"id": r[0], "user_id": r[1], "username": r[2] or "", "client_name": r[3] or "",
         "tool": r[4], "risk": r[5] or "", "status": r[6], "error": r[7] or "",
         "row_count": r[8], "duration_ms": r[9], "created_at": str(r[10] or "")}
        for r in rows
    ]}
