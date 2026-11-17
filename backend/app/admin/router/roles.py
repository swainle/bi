"""管理后台 · 权限码与角色（/permissions、/roles）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import ADMIN_ROLES, VISIBLE_PERMISSION_CODES, is_admin, require
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.rbac import Role
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import RoleCreateBody, RolePatchBody, _ROLE_CODE_RE, _actor_department, _assert_perm_scope, _clean_permissions, _is_global, _scope

@router.get("/permissions")
def list_permissions(
    current_user: User = Depends(require("bi:role:manage")),
    db: Session = Depends(get_db),
):
    rows = db.execute(text("SELECT code, name, \"group\" FROM permissions ORDER BY code")).fetchall()
    scope = _scope(db, current_user)
    items = [
        {"code": r[0], "name": r[1], "group": r[2] or ""}
        for r in rows
        if r[0] in VISIBLE_PERMISSION_CODES
    ]
    if not _is_global(db, current_user):
        from app.admin.permissions import effective_permissions

        own = set(effective_permissions(db, current_user))
        items = [i for i in items if i["code"] in own]
    return {"items": items, "scope": scope}


@router.get("/roles")
def list_roles(
    current_user: User = Depends(require("bi:role:manage")),
    db: Session = Depends(get_db),
):
    usage = {
        row[0]: int(row[1])
        for row in db.execute(
            text("SELECT role, count(*) FROM users GROUP BY role")
        ).fetchall()
    }
    scope = _scope(db, current_user)
    all_scope = _is_global(db, current_user)
    own_dept = _actor_department(db, current_user)
    dept_ids = {
        int(r[0]): r[1] for r in db.execute(text("SELECT id, name FROM departments")).fetchall()
    }
    items = []
    for role in db.query(Role).order_by(Role.sort_order.desc(), Role.id.asc()).all():
        role_dept = getattr(role, "dept_id", None)
        locked = role.code in ADMIN_ROLES
        editable = True
        if locked:
            editable = False
        elif not all_scope:
            # 数据范围受限：只能改本部门自建的非系统角色
            editable = (not bool(role.is_system)) and own_dept is not None and role_dept == own_dept
        # 数据范围=全部：可改除 admin 以外的角色（含系统角色）
        items.append(
            {
                "id": role.id,
                "code": role.code,
                "name": role.name,
                "description": role.description or "",
                "is_system": bool(role.is_system),
                "locked": locked,
                "editable": editable,
                "dept_id": int(role_dept) if role_dept is not None else None,
                "dept_name": dept_ids.get(int(role_dept)) if role_dept is not None else "",
                "data_scope": getattr(role, "data_scope", "dept") or "dept",
                "user_count": usage.get(role.code, 0),
                "permissions": sorted(
                    {p.code for p in role.permissions} & VISIBLE_PERMISSION_CODES
                ),
            }
        )
    return {"items": items, "scope": scope}


@router.post("/roles")
def create_role(
    payload: RoleCreateBody,
    current_user: User = Depends(require("bi:role:manage")),
    db: Session = Depends(get_db),
):
    code = payload.code.strip().lower()
    if not _ROLE_CODE_RE.match(code):
        raise HTTPException(400, "角色标识只能用 2-31 位小写字母、数字、下划线，且以字母开头")
    if db.query(Role).filter(Role.code == code).first():
        raise HTTPException(409, "角色标识已存在")
    if db.query(Role).filter(Role.name == payload.name.strip()).first():
        raise HTTPException(409, "角色名称已存在")

    from app.admin.permissions import DATA_SCOPE_VALUES

    scope_value = (payload.data_scope or "dept").strip()
    if scope_value not in DATA_SCOPE_VALUES:
        raise HTTPException(400, "数据范围只能是 all / dept_and_children / dept / self")
    if scope_value == "all" and not _is_global(db, current_user):
        raise HTTPException(403, "只有「数据范围=全部部门」的账号可以创建全部范围的角色")
    role = Role(
        code=code,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        is_system=False,
        dept_id=None if scope_value == "all" else _actor_department(db, current_user),
        data_scope=scope_value,
    )
    db.add(role)
    db.flush()
    codes = [c for c in _clean_permissions(db, payload.permissions)
             if c in VISIBLE_PERMISSION_CODES]
    _assert_perm_scope(db, current_user, codes)
    from app.models.rbac import Permission

    role.permissions = db.query(Permission).filter(Permission.code.in_(codes)).all()
    db.commit()
    log_audit(current_user.id, "admin.role.create", "role", role.id, {"code": code, "permissions": codes})
    return {"id": role.id, "message": "角色已创建"}


@router.patch("/roles/{role_id}")
def update_role(
    role_id: int,
    payload: RolePatchBody,
    current_user: User = Depends(require("bi:role:manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(404, "角色不存在")
    if role.code in ADMIN_ROLES:
        raise HTTPException(400, "内置管理员角色拥有全部权限，不可修改")
    own_dept = _actor_department(db, current_user)
    if own_dept is not None and getattr(role, "dept_id", None) != own_dept:
        raise HTTPException(403, "部门管理员只能修改本部门创建的角色")
    if not is_admin(current_user) and role.code == (current_user.role or ""):
        raise HTTPException(403, "不能修改自己所属的角色（避免自我提权）")
    if is_admin(current_user) and role.code == (current_user.role or "") and not (
        _is_global(db, current_user)
    ):
        raise HTTPException(403, "部门管理员不能修改自己所属的角色")

    data = payload.model_dump(exclude_unset=True)
    if "data_scope" in data and data["data_scope"] is not None:
        from app.admin.permissions import DATA_SCOPE_VALUES

        value = str(data["data_scope"]).strip()
        if value not in DATA_SCOPE_VALUES:
            raise HTTPException(400, "数据范围只能是 all / dept_and_children / dept / self")
        if value == "all" and not _is_global(db, current_user):
            raise HTTPException(403, "只有「数据范围=全部部门」的账号可以设全部范围")
        role.data_scope = value
    if "name" in data and data["name"]:
        name = data["name"].strip()
        if name != role.name:
            if db.query(Role).filter(Role.name == name, Role.id != role.id).first():
                raise HTTPException(409, "角色名称已存在")
            role.name = name
    if "description" in data and data["description"] is not None:
        role.description = data["description"].strip()
    if "permissions" in data and data["permissions"] is not None:
        from app.models.rbac import Permission

        codes = [c for c in _clean_permissions(db, data["permissions"])
                 if c in VISIBLE_PERMISSION_CODES]
        _assert_perm_scope(db, current_user, codes)
        role.permissions = db.query(Permission).filter(Permission.code.in_(codes)).all()

    db.commit()
    log_audit(current_user.id, "admin.role.update", "role", role.id, data)
    return {"message": "已保存"}


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    current_user: User = Depends(require("bi:role:manage")),
    db: Session = Depends(get_db),
):
    role = db.query(Role).filter(Role.id == role_id).first()
    if role is None:
        raise HTTPException(404, "角色不存在")
    if role.is_system or role.code in ADMIN_ROLES:
        raise HTTPException(400, "内置角色不可删除")
    own_dept = _actor_department(db, current_user)
    if own_dept is not None and getattr(role, "dept_id", None) != own_dept:
        raise HTTPException(403, "部门管理员只能删除本部门创建的角色")
    if role.code == (current_user.role or "") and not _is_global(db, current_user):
        raise HTTPException(403, "不能删除自己所属的角色")
    used = db.execute(text("SELECT count(*) FROM users WHERE role = :code"), {"code": role.code}).scalar() or 0
    if int(used) > 0:
        raise HTTPException(400, f"还有 {int(used)} 个用户在使用该角色，先改掉再删")
    code = role.code
    db.delete(role)
    db.commit()
    log_audit(current_user.id, "admin.role.delete", "role", role_id, {"code": code})
    return {"message": "角色已删除"}
