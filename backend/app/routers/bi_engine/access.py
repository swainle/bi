"""BI 引擎 · 资源权限与行列权限（/permissions、/row_permissions、/masks）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.security.errors import SecurityError
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

from fastapi import APIRouter

router = APIRouter()

def _has_permission(db: Session, user_id: int, resource_type: str, resource_id: int, required: str) -> bool:
    """检查用户是否有指定资源的权限。owner 自动获得 manage 权限。"""
    row = db.execute(text(
        "SELECT permission FROM bi_resource_permissions WHERE resource_type=:rt AND resource_id=:rid AND user_id=:uid"
    ), {"rt": resource_type, "rid": resource_id, "uid": user_id}).fetchone()
    if not row:
        return False
    perm = row[0]
    if perm == "manage":
        return True
    if perm == "edit" and required in ("view", "edit"):
        return True
    if perm == "view" and required == "view":
        return True
    return False


def _check_dashboard_access(db: Session, user_id: int, dash_id: int, required: str = "view"):
    """检查看板访问权限。owner 自动放行。"""
    row = db.execute(text("SELECT owner_id FROM bi_dashboards WHERE id=:id"), {"id": dash_id}).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[0] == user_id:
        return  # owner 自动拥有 manage 权限
    if not _has_permission(db, user_id, "dashboard", dash_id, required):
        raise HTTPException(403, f"无权限（需要 {required}）")


@router.get("/permissions/{resource_type}/{resource_id}")
def get_resource_permissions(
    resource_type: str,
    resource_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查看资源的所有权限分配"""
    rows = db.execute(text(
        "SELECT p.user_id, u.username, p.permission FROM bi_resource_permissions p JOIN users u ON p.user_id=u.id WHERE p.resource_type=:rt AND p.resource_id=:rid"
    ), {"rt": resource_type, "rid": resource_id}).fetchall()
    return {"permissions": [{"user_id": r[0], "username": r[1], "permission": r[2]} for r in rows]}


@router.post("/permissions")
def grant_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """授权：{resource_type, resource_id, user_id, permission}"""
    rt = payload["resource_type"]
    rid = payload["resource_id"]
    uid = payload["user_id"]
    perm = payload["permission"]
    if perm not in ("view", "edit", "manage"):
        raise HTTPException(400, "无效权限级别")
    db.execute(text(
        "INSERT INTO bi_resource_permissions (resource_type, resource_id, user_id, permission) VALUES (:rt,:rid,:uid,:p) ON CONFLICT DO NOTHING"
    ), {"rt": rt, "rid": rid, "uid": uid, "p": perm})
    db.commit()
    return {"granted": True}


@router.delete("/permissions")
def revoke_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """撤销权限"""
    db.execute(text(
        "DELETE FROM bi_resource_permissions WHERE resource_type=:rt AND resource_id=:rid AND user_id=:uid AND permission=:p"
    ), {"rt": payload["resource_type"], "rid": payload["resource_id"], "uid": payload["user_id"], "p": payload["permission"]})
    db.commit()
    return {"revoked": True}


@router.get("/row_permissions/{table}")
def get_row_permissions(
    table: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户对该表的行级过滤规则"""
    rows = db.execute(text(
        "SELECT filter_rule FROM bi_row_permissions WHERE table_name=:t AND (user_id=:uid OR role_name IN (SELECT role FROM users WHERE id=:uid))"
    ), {"t": table, "uid": current_user.id}).fetchall()
    return {"rules": [r[0] for r in rows]}


@router.post("/row_permissions")
def set_row_permission(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """设置行级过滤规则：{table_name, user_id|role_name, filter_rule: 'store_id = 5'}"""
    if current_user.role not in ("admin", "super_admin"):
        raise HTTPException(403, "仅管理员可设置行权限")

    table_name = str(payload.get("table_name", "")).strip()
    if not is_queryable(table_name):
        raise HTTPException(404, f"表 {table_name} 不是可访问的业务表")

    # 存库前把关：非法规则直接拒绝，避免把坏规则留到查询期（那时只能 fail-closed）
    from app.security.rls import compile_rule_text

    try:
        rule = compile_rule_text(str(payload.get("filter_rule", "")))
    except SecurityError as exc:
        raise HTTPException(exc.http_status, exc.message) from exc

    db.execute(text(
        "INSERT INTO bi_row_permissions (table_name, user_id, role_name, filter_rule) "
        "VALUES (:t,:uid,:role,:rule) ON CONFLICT DO NOTHING"
    ), {
        "t": table_name,
        "uid": payload.get("user_id"),
        "role": payload.get("role_name"),
        "rule": rule,
    })
    db.commit()
    return {"success": True, "table": table_name, "rule": rule}


@router.get("/masks")
def list_masks(db: Session = Depends(get_db)):
    rows = db.execute(text("SELECT * FROM bi_column_masks")).fetchall()
    return {"masks": [dict(r._mapping) for r in rows]}


@router.post("/masks")
def set_mask(payload: dict = Body(...), db: Session = Depends(get_db)):
    db.execute(text("INSERT INTO bi_column_masks (table_name, column_name, mask_type, mask_pattern) VALUES (:t,:c,:m,:p) ON CONFLICT (table_name, column_name) DO UPDATE SET mask_type=:m, mask_pattern=:p"),
               {"t": payload["table_name"], "c": payload["column_name"], "m": payload["mask_type"], "p": payload.get("mask_pattern","")})
    db.commit()
    return {"success": True}
