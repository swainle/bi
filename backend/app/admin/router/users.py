"""管理后台 · 用户管理（/users）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import ADMIN_ROLES, data_scope, is_admin, require
from app.database import get_db
from app.middleware.audit import log_audit
from app.models.user import User
from app.services.auth import hash_password

from fastapi import APIRouter

router = APIRouter()

from .common import POSITION_LABELS, POSITION_ROLE, UserCreateBody, UserPatchBody, _admin_count, _assert_can_assign_role, _assert_can_manage_target, _drop_user_cache, _role_codes, _role_name_map, _scope_dept_ids, _validate_password

@router.get("/users")
def list_users(
    q: str = Query("", max_length=80),
    role: str = Query("", max_length=40),
    position: str = Query("", max_length=20),
    status: str = Query("", max_length=20),
    department: str = Query("", max_length=20),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    where = ["1 = 1"]
    params: dict = {"limit": limit, "offset": offset}
    keyword = q.strip()
    if keyword:
        where.append("(username ILIKE :kw OR email ILIKE :kw)")
        params["kw"] = f"%{keyword}%"
    if position.strip():
        where.append("position = :position")
        params["position"] = position.strip()
    if role.strip():
        where.append("role = :role")
        params["role"] = role.strip()
    state = status.strip()
    if state == "active":
        where.append("is_active AND COALESCE(approval_status, 'approved') = 'approved'")
    elif state == "inactive":
        where.append("NOT is_active AND COALESCE(approval_status, 'approved') <> 'pending'")
    elif state == "pending":
        where.append("COALESCE(approval_status, 'approved') = 'pending'")
    elif state == "rejected":
        where.append("COALESCE(approval_status, 'approved') = 'rejected'")

    scope_ids = _scope_dept_ids(db, current_user)
    dept = department.strip()
    if scope_ids is not None:
        allowed = {str(i) for i in scope_ids}
        if dept and dept not in ({"all", "none"} | allowed):
            raise HTTPException(403, "只能查看数据范围内的部门账号")
        if not scope_ids:
            where.append("id = :self_id")
            params["self_id"] = current_user.id
        elif dept in allowed:
            where.append("department_id = :dept")
            params["dept"] = int(dept)
        else:
            placeholders = ", ".join(f":d{i}" for i in range(len(scope_ids)))
            where.append(f"department_id IN ({placeholders})")
            params.update({f"d{i}": d for i, d in enumerate(scope_ids)})
    elif dept == "none":
        where.append("department_id IS NULL")
    elif dept:
        try:
            where.append("department_id = :dept")
            params["dept"] = int(dept)
        except ValueError:
            raise HTTPException(400, "部门参数不正确")

    rows = db.execute(
        text(
            "SELECT id, username, email, role, is_active, department_id, created_at, "
            "       COALESCE(approval_status, 'approved') AS approval_status, "
            "       account_type, position "
            f"FROM users WHERE {' AND '.join(where)} ORDER BY id LIMIT :limit OFFSET :offset"
        ),
        params,
    ).fetchall()

    names = _role_name_map(db)
    items = [
        {
            "id": int(r[0]),
            "username": r[1],
            "email": r[2],
            "role": r[3] or "user",
            "role_name": names.get(r[3] or "user", "普通用户"),
            "account_type": r[8] or "user",
            "position": r[9] or "member",
            "position_name": POSITION_LABELS.get(r[9] or "member", "员工"),
            "is_active": bool(r[4]),
            "department_id": r[5],
            "created_at": str(r[6] or ""),
            "approval_status": r[7] or "approved",
        }
        for r in rows
    ]
    total = db.execute(
        text(f"SELECT count(*) FROM users WHERE {' AND '.join(where)}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    ).scalar() or 0
    return {"items": items, "total": int(total)}


@router.post("/users")
def create_user(
    payload: UserCreateBody,
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    username = payload.username.strip()
    email = str(payload.email).strip()
    account_type = (payload.account_type or "user").strip()
    position = (payload.position or "member").strip()
    if account_type not in ("admin", "user"):
        raise HTTPException(400, "权限只能是 admin / user")
    if position not in POSITION_ROLE:
        raise HTTPException(400, "职位只能是 member / supervisor / manager / director")
    if account_type == "admin":
        role = "admin"
    elif (payload.role or "").strip() in ADMIN_ROLES:
        role = payload.role.strip()
        account_type = "admin"
    elif (payload.role or "").strip() not in ("", "user"):
        role = payload.role.strip()
    else:
        role = POSITION_ROLE[position]
    password = _validate_password(payload.password)

    if role not in _role_codes(db) and role != "user":
        raise HTTPException(400, f"角色不存在：{role}")
    _assert_can_assign_role(db, current_user, role)
    if db.execute(text("SELECT 1 FROM users WHERE username = :v"), {"v": username}).first():
        raise HTTPException(409, "用户名已被占用")
    if db.execute(text("SELECT 1 FROM users WHERE email = :v"), {"v": email}).first():
        raise HTTPException(409, "邮箱已被占用")
    actor_scope = data_scope(db, current_user)
    if actor_scope == "self":
        raise HTTPException(403, "数据范围为「本人」的账号不能创建其它账号")
    department_id = payload.department_id
    if actor_scope != "all":
        own_dept = int(current_user.department_id or 0) or None
        if not own_dept:
            raise HTTPException(403, "你的数据范围不是「全部部门」，需要先设置所属部门")
        if department_id not in (None, own_dept):
            raise HTTPException(403, "只能在数据范围内建号")
        department_id = own_dept
    if department_id is not None:
        exists = db.execute(
            text("SELECT 1 FROM departments WHERE id = :id AND is_deleted = false"),
            {"id": department_id},
        ).first()
        if not exists:
            raise HTTPException(400, "部门不存在")

    row = db.execute(
        text(
            "INSERT INTO users (username, email, password_hash, role, is_active, department_id, "
            "                   account_type, position, approval_status, approved_by, approved_at) "
            "VALUES (:username, :email, :hash, :role, true, :dept, :account_type, :position, "
            "        'approved', :approved_by, now()) RETURNING id"
        ),
        {
            "username": username,
            "email": email,
            "hash": hash_password(password),
            "role": role,
            "dept": department_id,
            "account_type": account_type,
            "position": position,
            "approved_by": current_user.id,
        },
    ).fetchone()
    db.commit()
    new_id = int(row[0])
    log_audit(current_user.id, "admin.user.create", "user", new_id, {"username": username, "role": role})
    return {"id": new_id, "message": "用户已创建"}


@router.patch("/users/{user_id}")
def update_user(
    user_id: int,
    payload: UserPatchBody,
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(404, "用户不存在")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return {"message": "没有需要保存的修改"}

    # 非全局管理员不能碰管理员账号（否则可重置管理员密码接管系统）
    _assert_can_manage_target(db, current_user, target)

    scope_ids = _scope_dept_ids(db, current_user)
    if scope_ids is not None:
        if not scope_ids:
            if target.id != current_user.id:
                raise HTTPException(403, "数据范围为「本人」，只能修改自己的账号")
            for field in ("role", "account_type", "position", "department_id"):
                if field in data:
                    raise HTTPException(403, "数据范围为「本人」，不能调整角色、权限或部门")
        else:
            if int(target.department_id or 0) not in scope_ids:
                raise HTTPException(403, "只能管理数据范围内的部门账号")
            if "department_id" in data:
                new_dept = data["department_id"]
                if new_dept is not None and int(new_dept) not in scope_ids:
                    raise HTTPException(403, "不能把账号移到数据范围外的部门")

    # 权限（管理员/普通用户）+ 职位 → 角色（角色权限页仍可细调）
    if "account_type" in data or "position" in data:
        account_type = str(data.get("account_type", target.account_type or "user")).strip()
        position = str(data.get("position", target.position or "member")).strip()
        if account_type not in ("admin", "user"):
            raise HTTPException(400, "权限只能是 admin / user")
        if position not in POSITION_ROLE:
            raise HTTPException(400, "职位只能是 member / supervisor / manager / director")
        data["account_type"] = account_type
        data["position"] = position
        if account_type == "admin":
            data["role"] = "admin"
        elif "role" not in data:
            data["role"] = POSITION_ROLE[position]

    # 待审批账号只能走「注册审批」，不能在这里直接放行（被驳回的可在启用时自动转通过）
    if (getattr(target, "approval_status", "") or "") == "pending" and (
        "is_active" in data or "approval_status" in data
    ):
        raise HTTPException(400, "该账号还在待审批，请到「注册审批」处理")

    # ── 防呆：不能把自己锁在门外 / 不能把最后一个管理员关掉 ──
    demoting = "role" in data and (data["role"] or "") not in ADMIN_ROLES and is_admin(target)
    disabling = data.get("is_active") is False
    if target.id == current_user.id:
        if disabling:
            raise HTTPException(400, "不能停用当前登录的账号")
        if demoting:
            raise HTTPException(400, "不能取消自己的管理员角色")
    if (demoting or disabling) and is_admin(target) and _admin_count(db, exclude_id=target.id) == 0:
        raise HTTPException(400, "至少保留一个启用的管理员")

    if "role" in data:
        role = (data["role"] or "").strip()
        if role not in _role_codes(db) and role != "user":
            raise HTTPException(400, f"角色不存在：{role}")
        _assert_can_assign_role(db, current_user, role)
        target.role = role
        if role in ADMIN_ROLES:
            target.account_type = "admin"
    if "account_type" in data:
        target.account_type = data["account_type"]
    if "position" in data:
        target.position = data["position"]

    if "username" in data and data["username"]:
        username = data["username"].strip()
        if username != target.username:
            taken = db.execute(
                text("SELECT 1 FROM users WHERE username = :v AND id <> :id"),
                {"v": username, "id": target.id},
            ).first()
            if taken:
                raise HTTPException(409, "用户名已被占用")
            target.username = username

    if "email" in data and data["email"]:
        email = str(data["email"]).strip()
        if email != target.email:
            taken = db.execute(
                text("SELECT 1 FROM users WHERE email = :v AND id <> :id"),
                {"v": email, "id": target.id},
            ).first()
            if taken:
                raise HTTPException(409, "邮箱已被占用")
            target.email = email

    if "department_id" in data:
        dept = data["department_id"]
        if dept is not None:
            exists = db.execute(
                text("SELECT 1 FROM departments WHERE id = :id AND is_deleted = false"),
                {"id": dept},
            ).first()
            if not exists:
                raise HTTPException(400, "部门不存在")
        target.department_id = dept

    if "is_active" in data and data["is_active"] is not None:
        target.is_active = bool(data["is_active"])
        if target.is_active and (getattr(target, "approval_status", "") or "") == "rejected":
            # 管理员重新启用被驳回的账号 = 重新放行
            target.approval_status = "approved"
            target.reject_reason = None
        if not target.is_active:
            # 停用 = 立即踢掉该账号所有会话
            target.token_version = (target.token_version or 0) + 1

    if data.get("password"):
        target.password_hash = hash_password(_validate_password(data["password"]))
        # 改密后旧 token 全部失效（重置密码本来就该强制重新登录）
        target.token_version = (target.token_version or 0) + 1

    db.commit()
    if data.get("password") or data.get("is_active") is False:
        _drop_user_cache(target.id)
    log_audit(
        current_user.id,
        "admin.user.update",
        "user",
        target.id,
        {k: ("***" if k == "password" else v) for k, v in data.items()},
    )
    return {"message": "已保存"}
