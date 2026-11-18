"""管理后台 API —— 概览 / 用户 / 角色权限 / 模型配置 / 运维.

权限：每个分区一个权限码（见 `app/admin/permissions.py`），管理员直通。
所有写操作都落操作审计；用户停用 / 改密会推进 `token_version`，旧会话立即失效。
"""

from __future__ import annotations

from app.timezone import time_text, utc_now



import os
import re
import time

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin.permissions import (
    ADMIN_ROLES,
    VISIBLE_PERMISSION_CODES,
    admin_scope,
    data_scope,
    has_permission,
    is_admin,
    leader_department_ids,
    require,
    scoped_department_ids,
)
from app.database import get_db
from app.errors import repository as errors_repo
from app.middleware.audit import log_audit
from app.middleware.auth import get_current_user
from app.models.rbac import Role
from app.models.user import User
from app.services import ai_models
from app.services.auth import hash_password

router = APIRouter(prefix="/admin", tags=["管理后台"])

_ROLE_CODE_RE = re.compile(r"^[a-z][a-z0-9_]{1,30}$")

POSITION_LABELS = {
    "member": "员工",
    "supervisor": "主管",
    "manager": "经理",
    "director": "总监",
}
POSITION_ROLE = {
    "member": "member",
    "supervisor": "manager",
    "manager": "dept_manager",
    "director": "director",
}


# ═══════════════════════ 通用工具 ═══════════════════════


def _scope(db: Session, user: User) -> str:
    """global / department / self / ""（管理后台范围标签）."""
    return admin_scope(db, user)


def _is_global(db: Session, user: User) -> bool:
    """数据范围是否覆盖全部部门."""
    return data_scope(db, user) == "all"


def _scope_dept_ids(db: Session, user: User) -> list[int] | None:
    """数据范围覆盖的部门：None = 全部；[] = 本人."""
    return scoped_department_ids(db, user)


def _actor_department(db: Session, user: User) -> int | None:
    """当前账号被限制在哪个部门（建号 / 角色归属用）：None = 全部部门或本人范围."""
    if data_scope(db, user) in ("dept", "dept_and_children"):
        return int(user.department_id or 0) or None
    return None


def require_global_admin(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """全局设置（部门树 / 跨部门）需要：用户管理权限 + 数据范围全部部门."""
    if not has_permission(db, current_user, "bi:user:manage") or not _is_global(db, current_user):
        raise HTTPException(403, "只有「数据范围=全部部门」且具备用户管理权限的账号可以修改这项设置")
    return current_user


def _validate_password(password: str) -> str:
    """与注册同口径：≥6 位 + 大小写字母 + 数字."""
    value = (password or "").strip()
    if len(value) < 6:
        raise HTTPException(400, "密码至少需要 6 位")
    if not any(c.islower() for c in value):
        raise HTTPException(400, "密码必须包含至少一个小写字母")
    if not any(c.isupper() for c in value):
        raise HTTPException(400, "密码必须包含至少一个大写字母")
    if not any(c.isdigit() for c in value):
        raise HTTPException(400, "密码必须包含至少一个数字")
    return value


def _drop_user_cache(user_id: int) -> None:
    """推进 token_version 之后必须调用：否则 get_current_user 会命中缓存里的旧版本号，
    让旧 token 继续可用（最长 10 分钟）—— 这是真实踩到过的越权缺口。"""
    try:
        from app.services.cache import cache_delete

        cache_delete(f"user:{int(user_id)}")
    except Exception:
        pass


def _assert_can_manage_target(db: Session, current_user: User, target: User) -> None:
    """非全局管理员不得改动管理员账号（改密 / 停用 / 改角色 / 改资料）—— 防接管。"""
    if not _is_global(db, current_user) and is_admin(target):
        raise HTTPException(403, "只有全局管理员可以修改管理员账号")


def _role_dept_id(db: Session, code: str) -> int | None:
    row = db.execute(text("SELECT dept_id FROM roles WHERE code = :c"), {"c": code}).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _assert_can_assign_role(db: Session, current_user: User, role_code: str) -> None:
    """角色分配边界（标准 RBAC）：
    * 只有数据范围=全部部门 的账号能授予管理员角色；
    * 数据范围受限的账号，只能分配「权限不超过自己」且「归属本部门或全局」的角色。
    """
    code = (role_code or "").strip() or "user"
    all_scope = _is_global(db, current_user)
    if code in ADMIN_ROLES:
        if not all_scope:
            raise HTTPException(403, "只有「数据范围=全部部门」的账号可以授予管理员角色")
        return
    if all_scope:
        return
    from app.admin.permissions import BI_PERMISSION_CODES, effective_permissions, role_permission_codes

    own_dept = _actor_department(db, current_user)
    role_dept = _role_dept_id(db, code)
    if own_dept and role_dept not in (None, own_dept):
        raise HTTPException(403, "不能分配其它部门创建的角色")
    # 只比较「管理后台权限」：业务入口（数据集/SQL 等）可以有差异，避免把普通成员角色判成越权
    console = set(BI_PERMISSION_CODES)
    role_console = set(role_permission_codes(db, code)) & console
    own_console = set(effective_permissions(db, current_user)) & console
    if not role_console <= own_console:
        raise HTTPException(403, "不能分配权限高于自己的角色")


def _assert_perm_scope(db: Session, current_user: User, codes: list[str]) -> None:
    """授出的权限不能超过自己：数据范围=全部 → 任意；否则只能授自己已有的权限。"""
    if _is_global(db, current_user):
        return
    from app.admin.permissions import effective_permissions

    allowed = set(effective_permissions(db, current_user))
    extra = sorted(set(codes) - allowed)
    if extra:
        raise HTTPException(
            403,
            "不能授予自己没有的权限：" + "、".join(extra[:5]),
        )


def _role_codes(db: Session) -> set[str]:
    return {row[0] for row in db.query(Role.code).all()}


def _role_name_map(db: Session) -> dict[str, str]:
    return {role.code: role.name for role in db.query(Role).all()}


def _admin_count(db: Session, exclude_id: int | None = None) -> int:
    sql = "SELECT count(*) FROM users WHERE is_active AND role IN ('admin', 'super_admin')"
    params: dict = {}
    if exclude_id is not None:
        sql += " AND id <> :exclude"
        params["exclude"] = exclude_id
    return int(db.execute(text(sql), params).scalar() or 0)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)) or default)
    except ValueError:
        return default


# ═══════════════════════ 概览 ═══════════════════════


@router.get("/overview")
def overview(
    current_user: User = Depends(require("bi:overview")),
    db: Session = Depends(get_db),
):
    def scalar(sql: str, params: dict | None = None) -> int:
        try:
            return int(db.execute(text(sql), params or {}).scalar() or 0)
        except Exception:
            return 0

    scope = _scope(db, current_user)
    scope_ids = _scope_dept_ids(db, current_user)
    can_view_errors = has_permission(db, current_user, "bi:error:view")
    if scope_ids is None:
        users_filter, users_params = "", {}
    elif scope_ids:
        placeholders = ", ".join(f":d{i}" for i in range(len(scope_ids)))
        users_filter = f" AND department_id IN ({placeholders})"
        users_params = {f"d{i}": d for i, d in enumerate(scope_ids)}
    else:
        users_filter, users_params = " AND id = :self_id", {"self_id": current_user.id}

    from app.database import get_pool_status

    try:
        from app.routers.metrics import collect as metrics_collect

        app_info = metrics_collect().get("app", {})
    except Exception:
        app_info = {}

    started = time.monotonic()
    db_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    latency_ms = round((time.monotonic() - started) * 1000, 1)

    recent = []
    if can_view_errors:
        try:
            recent = errors_repo.list_errors(db, limit=4)
        except Exception:
            recent = []

    return {
        "scope": scope,
        "data_scope": data_scope(db, current_user),
        "counts": {
            "users": scalar(
                f"SELECT count(*) FROM users WHERE 1=1{users_filter}", users_params
            ),
            "active_users": scalar(
                f"SELECT count(*) FROM users WHERE is_active{users_filter}", users_params
            ),
            "dashboards": scalar("SELECT count(*) FROM bi_canvas"),
            "datasets": scalar("SELECT count(*) FROM bi_dataset"),
            "sources": scalar("SELECT count(*) FROM bi_source"),
            # 没有错误日志权限的账号，概览里也不给错误数
            "error_24h": scalar(
                "SELECT count(*) FROM bi_error_log WHERE created_at >= now() - interval '24 hours'"
            ) if can_view_errors else 0,
            "pending_registrations": scalar(
                "SELECT count(*) FROM users "
                "WHERE COALESCE(approval_status, 'approved') = 'pending'"
                + users_filter,
                users_params,
            ),
        },
        "system": {
            "version": app_info.get("version", ""),
            "uptime_seconds": int(app_info.get("uptime_seconds", 0)),
            "db_ok": db_ok,
            "db_latency_ms": latency_ms,
            "pool": get_pool_status(),
            "redis": _redis_state(),
        },
        "recent_errors": recent,
    }


def _redis_state() -> str:
    if not (os.getenv("REDIS_URL") or "").strip():
        return "disabled"
    try:
        from app.query import redis_bus

        client = redis_bus.client()
        if client is None:
            return "down"
        client.ping()
        return "up"
    except Exception:
        return "down"


# ═══════════════════════ 用户管理 ═══════════════════════


class UserCreateBody(BaseModel):
    username: str = Field(..., min_length=2, max_length=50)
    email: EmailStr
    password: str
    role: str = "user"
    account_type: str = "user"
    position: str = "member"
    department_id: int | None = None


class UserPatchBody(BaseModel):
    username: str | None = Field(default=None, min_length=2, max_length=50)
    email: EmailStr | None = None
    role: str | None = None
    account_type: str | None = None
    position: str | None = None
    is_active: bool | None = None
    department_id: int | None = None
    password: str | None = None


@router.get("/meta")
def admin_meta(
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    """下拉选项：角色 / 部门（用户管理表单用）."""
    roles = [
        {"code": r.code, "name": r.name, "is_system": bool(r.is_system)}
        for r in db.query(Role).order_by(Role.sort_order.desc(), Role.id.asc()).all()
    ]
    own_dept = _actor_department(db, current_user)
    scope = _scope(db, current_user)
    scope_ids = _scope_dept_ids(db, current_user)
    try:
        base = (
            "SELECT id, username, department_id FROM users "
            "WHERE is_active AND COALESCE(approval_status, 'approved') = 'approved' "
        )
        if scope_ids is None:
            rows = db.execute(text(base + "ORDER BY id")).fetchall()
        elif scope_ids:
            placeholders = ", ".join(f":d{i}" for i in range(len(scope_ids)))
            rows = db.execute(
                text(base + f"AND department_id IN ({placeholders}) ORDER BY id"),
                {f"d{i}": d for i, d in enumerate(scope_ids)},
            ).fetchall()
        else:
            rows = db.execute(
                text(base + "AND id = :self_id ORDER BY id"), {"self_id": current_user.id}
            ).fetchall()
        candidates = [
            {"id": int(r[0]), "username": r[1], "department_id": r[2]} for r in rows
        ]
    except Exception:
        candidates = []
    departments = _list_departments(db)
    if scope_ids is not None:
        allowed = set(scope_ids) if scope_ids else {int(user.department_id or 0)}
        departments = [d for d in departments if d["id"] in allowed]
    return {
        "scope": scope,
        "data_scope": data_scope(db, current_user),
        "own_department_id": own_dept,
        "roles": roles,
        "departments": departments,
        "users": candidates,
    }


def _list_departments(db: Session) -> list[dict]:
    """部门列表（含量级：在职用户数 + 负责人）；表未初始化时返回空列表，不报错."""
    try:
        rows = db.execute(
            text(
                "SELECT d.id, d.name, count(u.id), d.leader_id, l.username, d.parent_id "
                "FROM departments d "
                "LEFT JOIN users u ON u.department_id = d.id "
                "LEFT JOIN users l ON l.id = d.leader_id "
                "WHERE d.is_deleted = false "
                "GROUP BY d.id, d.name, d.sort_order, d.leader_id, l.username, d.parent_id "
                "ORDER BY d.sort_order NULLS LAST, d.id"
            )
        ).fetchall()
    except Exception:
        return []
    return [
        {
            "id": int(r[0]),
            "name": r[1],
            "user_count": int(r[2] or 0),
            "leader_id": int(r[3]) if r[3] is not None else None,
            "leader_name": r[4] or "",
            "parent_id": int(r[5]) if r[5] is not None else None,
        }
        for r in rows
    ]


def _leader_department_ids(db: Session, user_id: int) -> list[int]:
    """本人是哪些部门的负责人（审批范围）."""
    try:
        rows = db.execute(
            text(
                "SELECT id FROM departments "
                "WHERE leader_id = :uid AND COALESCE(is_deleted, false) = false "
                "ORDER BY id"
            ),
            {"uid": user_id},
        ).fetchall()
    except Exception:
        return []
    return [int(r[0]) for r in rows]


def _is_approver(db: Session, user: User) -> bool:
    """能审批注册吗：有「注册审批」权限 / 管理员 / 部门负责人."""
    from app.admin.permissions import has_permission

    if is_admin(user) or has_permission(db, user, "bi:user:approve"):
        return True
    return bool(leader_department_ids(db, user.id))


def require_approver(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    if not _is_approver(db, current_user):
        raise HTTPException(403, "没有注册审批权限，请联系管理员")
    return current_user


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
            "created_at": time_text(r[6] or ""),
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


# ═══════════════════════ 部门 ═══════════════════════


class DepartmentCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    parent_id: int | None = Field(default=None, ge=1)


class DepartmentPatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = Field(default=None, ge=0, le=100000)
    parent_id: int | None = Field(default=None, ge=1)
    # 负责人：传 null 表示清空；传用户 id 表示指定（必须是启用且已通过的账号）
    leader_id: int | None = Field(default=None, ge=1)


def _normalize_dept_name(name: str) -> str:
    value = (name or "").strip()
    if not value:
        raise HTTPException(400, "部门名称不能为空")
    if len(value) > 100:
        raise HTTPException(400, "部门名称最多 100 个字符")
    return value


def _require_department(db: Session, dept_id: int):
    row = db.execute(
        text("SELECT id, name FROM departments WHERE id = :id AND COALESCE(is_deleted, false) = false"),
        {"id": dept_id},
    ).fetchone()
    if row is None:
        raise HTTPException(404, "部门不存在")
    return row


def _department_user_count(db: Session, dept_id: int) -> int:
    return int(
        db.execute(
            text("SELECT count(*) FROM users WHERE department_id = :id"), {"id": dept_id}
        ).scalar()
        or 0
    )


@router.get("/departments")
def list_departments(
    current_user: User = Depends(require("bi:user:manage")),
    db: Session = Depends(get_db),
):
    items = _list_departments(db)
    scope_ids = _scope_dept_ids(db, current_user)
    if scope_ids is not None:
        allowed = set(scope_ids) if scope_ids else {int(current_user.department_id or 0)}
        items = [d for d in items if d["id"] in allowed]
    return {"items": items, "data_scope": data_scope(db, current_user)}


@router.post("/departments")
def create_department(
    payload: DepartmentCreateBody,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    name = _normalize_dept_name(payload.name)
    dup = db.execute(
        text(
            "SELECT 1 FROM departments WHERE COALESCE(is_deleted, false) = false "
            "AND lower(name) = lower(:name)"
        ),
        {"name": name},
    ).first()
    if dup:
        raise HTTPException(409, f"部门「{name}」已存在")
    parent_id = payload.parent_id
    if parent_id is not None:
        _require_department(db, parent_id)
    row = db.execute(
        text(
            "INSERT INTO departments (name, sort_order, is_deleted, parent_id, created_at) "
            "SELECT :name, COALESCE(MAX(sort_order), 0) + 10, false, :parent_id, now() "
            "FROM departments WHERE COALESCE(is_deleted, false) = false "
            "RETURNING id"
        ),
        {"name": name, "parent_id": parent_id},
    ).fetchone()
    db.commit()
    log_audit(current_user.id, "admin.department.create", "department", int(row[0]), {"name": name})
    return {"id": int(row[0]), "message": "部门已添加"}


@router.patch("/departments/{dept_id}")
def update_department(
    dept_id: int,
    payload: DepartmentPatchBody,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    _require_department(db, dept_id)
    data = payload.model_dump(exclude_unset=True)
    sets: list[str] = []
    params: dict = {"id": dept_id}

    if "parent_id" in data:
        parent_id = data["parent_id"]
        if parent_id is not None:
            _require_department(db, parent_id)
            if int(parent_id) == int(dept_id):
                raise HTTPException(400, "上级部门不能是自己")
            from app.admin.permissions import department_subtree_ids

            if int(parent_id) in department_subtree_ids(db, dept_id):
                raise HTTPException(400, "不能把部门移到自己的下级里")
        sets.append("parent_id = :parent_id")
        params["parent_id"] = parent_id

    if data.get("name"):
        name = _normalize_dept_name(data["name"])
        dup = db.execute(
            text(
                "SELECT 1 FROM departments WHERE COALESCE(is_deleted, false) = false "
                "AND lower(name) = lower(:name) AND id <> :id"
            ),
            {"name": name, "id": dept_id},
        ).first()
        if dup:
            raise HTTPException(409, f"部门「{name}」已存在")
        sets.append("name = :name")
        params["name"] = name
    if data.get("sort_order") is not None:
        sets.append("sort_order = :sort_order")
        params["sort_order"] = int(data["sort_order"])
    if "leader_id" in data:
        leader = data["leader_id"]
        if leader is None:
            sets.append("leader_id = NULL")
        else:
            row = db.execute(
                text(
                    "SELECT 1 FROM users WHERE id = :id AND is_active "
                    "AND COALESCE(approval_status, 'approved') = 'approved'"
                ),
                {"id": int(leader)},
            ).first()
            if not row:
                raise HTTPException(400, "负责人必须是启用且已通过审批的账号")
            sets.append("leader_id = :leader_id")
            params["leader_id"] = int(leader)

    if not sets:
        return {"message": "没有需要保存的修改"}
    db.execute(text(f"UPDATE departments SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()
    log_audit(current_user.id, "admin.department.update", "department", dept_id, data)
    return {"message": "已保存"}


@router.delete("/departments/{dept_id}")
def delete_department(
    dept_id: int,
    current_user: User = Depends(require_global_admin),
    db: Session = Depends(get_db),
):
    row = _require_department(db, dept_id)
    used = _department_user_count(db, dept_id)
    if used > 0:
        raise HTTPException(400, f"还有 {used} 个用户在该部门，先调整他们的部门再删")
    children = int(
        db.execute(
            text(
                "SELECT count(*) FROM departments WHERE parent_id = :id "
                "AND COALESCE(is_deleted, false) = false"
            ),
            {"id": dept_id},
        ).scalar()
        or 0
    )
    if children > 0:
        raise HTTPException(400, f"该部门还有 {children} 个下级部门，先移走再删")
    db.execute(text("UPDATE departments SET is_deleted = true WHERE id = :id"), {"id": dept_id})
    db.commit()
    log_audit(current_user.id, "admin.department.delete", "department", dept_id, {"name": row[1]})
    return {"message": "部门已删除"}


# ═══════════════════════ 注册审批 ═══════════════════════


class RejectBody(BaseModel):
    reason: str = Field("", max_length=200)


def _registration_scope(db: Session, user: User) -> list[int] | None:
    """审批范围：None = 全部部门；list = 可审批的部门；无权限抛 403.

    标准规则：审批权限（或部门负责人）× 数据范围。
    """
    if is_admin(user):
        return None
    can_approve = has_permission(db, user, "bi:user:approve")
    leader_ids = leader_department_ids(db, user.id)
    if not (can_approve or leader_ids):
        raise HTTPException(403, "没有注册审批权限")
    scope = data_scope(db, user)
    if scope == "all":
        return None
    if scope == "self" and not leader_ids:
        raise HTTPException(403, "数据范围为「本人」的账号不能审批注册")
    ids: set[int] = set()
    if can_approve:
        ids.update(_scope_dept_ids(db, user) or [])
    from app.admin.permissions import department_subtree_ids

    for dept_id in leader_ids:
        ids.update(department_subtree_ids(db, dept_id))
    ids = sorted(ids)
    if not ids:
        raise HTTPException(403, "没有可审批的部门（缺少部门或数据范围）")
    return ids


@router.get("/registrations")
def list_registrations(
    status: str = Query("pending", max_length=20),
    limit: int = Query(100, ge=1, le=300),
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    state = (status or "pending").strip()
    if state not in ("pending", "approved", "rejected"):
        raise HTTPException(400, "状态只能是 pending / approved / rejected")

    scope = _registration_scope(db, current_user)
    scope_sql = ""
    scope_params: dict = {}
    if scope is not None:
        placeholders = ", ".join(f":d{i}" for i in range(len(scope)))
        scope_sql = f" AND u.department_id IN ({placeholders})"
        scope_params = {f"d{i}": dept_id for i, dept_id in enumerate(scope)}

    rows = db.execute(
        text(
            "SELECT u.id, u.username, u.email, u.role, u.department_id, d.name, u.created_at, "
            "       COALESCE(u.approval_status, 'approved'), u.reject_reason, u.approved_at "
            "FROM users u LEFT JOIN departments d ON d.id = u.department_id "
            "WHERE COALESCE(u.approval_status, 'approved') = :state"
            f"{scope_sql} "
            "ORDER BY u.created_at DESC, u.id DESC LIMIT :limit"
        ),
        {"state": state, "limit": limit, **scope_params},
    ).fetchall()

    pending_total = int(
        db.execute(
            text(
                "SELECT count(*) FROM users u "
                "WHERE COALESCE(u.approval_status, 'approved') = 'pending'"
                f"{scope_sql}"
            ),
            scope_params,
        ).scalar()
        or 0
    )

    return {
        "items": [
            {
                "id": int(r[0]),
                "username": r[1],
                "email": r[2],
                "role": r[3] or "user",
                "department_id": r[4],
                "department_name": r[5] or "未分配",
                "created_at": time_text(r[6] or ""),
                "approval_status": r[7] or "approved",
                "reject_reason": r[8] or "",
                "approved_at": time_text(r[9] or ""),
            }
            for r in rows
        ],
        "pending": pending_total,
        "scope": "all" if scope is None else "department",
    }


def _load_pending_target(
    db: Session, user_id: int, current_user: User, allow_rejected: bool = False,
) -> User:
    target = db.query(User).filter(User.id == user_id).first()
    if target is None:
        raise HTTPException(404, "用户不存在")
    # 先判范围：跨部门一律 403（不泄露该申请是否已被处理）
    scope = _registration_scope(db, current_user)
    if scope is not None and int(target.department_id or 0) not in scope:
        raise HTTPException(403, "只能审批自己负责部门的申请")
    state = (getattr(target, "approval_status", "") or "")
    allowed_states = ("pending", "rejected") if allow_rejected else ("pending",)
    if state not in allowed_states:
        raise HTTPException(400, "该申请不在待审批状态（可能已被处理）")
    return target


@router.post("/registrations/{user_id}/approve")
def approve_registration(
    user_id: int,
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    target = _load_pending_target(db, user_id, current_user, allow_rejected=True)
    target.approval_status = "approved"
    target.is_active = True
    target.approved_by = current_user.id
    target.approved_at = utc_now()
    target.reject_reason = None
    target.token_version = (target.token_version or 0) + 1
    db.commit()
    _drop_user_cache(target.id)
    log_audit(
        current_user.id, "admin.registration.approve", "user", target.id,
        {"username": target.username, "department_id": target.department_id},
    )
    return {"message": f"已通过「{target.username}」的注册申请"}


@router.post("/registrations/{user_id}/reject")
def reject_registration(
    user_id: int,
    payload: RejectBody = Body(default=RejectBody()),
    current_user: User = Depends(require_approver),
    db: Session = Depends(get_db),
):
    target = _load_pending_target(db, user_id, current_user)
    reason = (payload.reason or "").strip()[:200]
    target.approval_status = "rejected"
    target.is_active = False
    target.approved_by = current_user.id
    target.approved_at = utc_now()
    target.reject_reason = reason or None
    target.token_version = (target.token_version or 0) + 1
    db.commit()
    _drop_user_cache(target.id)
    log_audit(
        current_user.id, "admin.registration.reject", "user", target.id,
        {"username": target.username, "department_id": target.department_id, "reason": reason},
    )
    return {"message": f"已驳回「{target.username}」的注册申请"}


# ═══════════════════════ 角色与权限 ═══════════════════════


class RoleCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    code: str = Field(..., min_length=2, max_length=31)
    description: str = Field("", max_length=200)
    permissions: list[str] = Field(default_factory=list)
    data_scope: str = Field("dept", max_length=32)


class RolePatchBody(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    description: str | None = Field(default=None, max_length=200)
    permissions: list[str] | None = None
    data_scope: str | None = None


def _clean_permissions(db: Session, codes: list[str]) -> list[str]:
    valid = {row[0] for row in db.execute(text("SELECT code FROM permissions")).fetchall()}
    cleaned = sorted({(c or "").strip() for c in codes if (c or "").strip()})
    unknown = [c for c in cleaned if c not in valid]
    if unknown:
        raise HTTPException(400, f"未知权限码：{', '.join(unknown[:5])}")
    return cleaned


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


# ═══════════════════════ 模型配置 ═══════════════════════


class ModelBody(BaseModel):
    model_config = {"protected_namespaces": ()}

    name: str = Field(..., min_length=1, max_length=80)
    provider: str = Field("deepseek", max_length=40)
    base_url: str = Field(..., min_length=8, max_length=300)
    model: str = Field(..., min_length=1, max_length=120)
    api_key: str = ""
    temperature: float = 0.3
    max_tokens: int = 4096
    enabled: bool = True
    is_default: bool = False


class ModelPatchBody(BaseModel):
    model_config = {"protected_namespaces": ()}

    name: str | None = Field(default=None, min_length=1, max_length=80)
    provider: str | None = Field(default=None, max_length=40)
    base_url: str | None = Field(default=None, max_length=300)
    model: str | None = Field(default=None, min_length=1, max_length=120)
    api_key: str | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    enabled: bool | None = None
    is_default: bool | None = None


class ModelTestBody(BaseModel):
    model_config = {"protected_namespaces": ()}

    model_id: int | None = None
    base_url: str | None = None
    model: str | None = None
    api_key: str | None = None


def _model_rows(db: Session) -> list[dict]:
    try:
        rows = db.execute(
            text(
                "SELECT id, name, provider, base_url, model, api_key_enc, temperature, max_tokens, "
                "       enabled, is_default, last_test_at, last_test_ok, last_test_ms, last_test_error "
                "FROM bi_ai_model ORDER BY is_default DESC, id"
            )
        ).fetchall()
    except Exception:
        return []
    items = []
    for r in rows:
        m = r._mapping
        key = ai_models.decrypt_key(m["api_key_enc"] or "")
        items.append(
            {
                "id": int(m["id"]),
                "name": m["name"],
                "provider": m["provider"],
                "base_url": m["base_url"],
                "model": m["model"],
                "has_key": bool(key),
                "key_mask": ai_models.mask_key(key),
                "temperature": float(m["temperature"] or 0.3),
                "max_tokens": int(m["max_tokens"] or 4096),
                "enabled": bool(m["enabled"]),
                "is_default": bool(m["is_default"]),
                "last_test_at": time_text(m["last_test_at"] or ""),
                "last_test_ok": m["last_test_ok"],
                "last_test_ms": m["last_test_ms"],
                "last_test_error": m["last_test_error"] or "",
            }
        )
    return items


@router.get("/models")
def list_models(
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    active = ai_models.default_config()
    return {
        "items": _model_rows(db),
        "active": {
            "model": active["model"] if active else "",
            "base_url": active["base_url"] if active else "",
            "source": "database" if ai_models.from_db() else ("file" if ai_models.from_json_file() else ("env" if ai_models.from_env() else "")),
        },
        "providers": [
            {"code": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "model": "deepseek-chat"},
            {"code": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
            {"code": "qwen", "name": "通义千问", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen-plus"},
            {"code": "moonshot", "name": "Moonshot", "base_url": "https://api.moonshot.cn/v1", "model": "moonshot-v1-8k"},
            {"code": "custom", "name": "自定义", "base_url": "", "model": ""},
        ],
    }


def _assert_model_config(base_url: str, model: str, api_key: str, require_key: bool = True) -> str:
    base = ai_models.normalize_base_url(base_url)
    if not base:
        raise HTTPException(400, "Base URL 需要以 http:// 或 https:// 开头")
    if not (model or "").strip():
        raise HTTPException(400, "模型名不能为空")
    if require_key and not (api_key or "").strip():
        raise HTTPException(400, "API Key 不能为空")
    return base


@router.post("/models")
def create_model(
    payload: ModelBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    base = _assert_model_config(payload.base_url, payload.model, payload.api_key)
    from app.services.crypto import encrypt

    if payload.is_default:
        db.execute(text("UPDATE bi_ai_model SET is_default = false WHERE is_default"))
    row = db.execute(
        text(
            "INSERT INTO bi_ai_model (name, provider, base_url, model, api_key_enc, temperature, "
            "max_tokens, enabled, is_default) VALUES (:name, :provider, :base_url, :model, :key, "
            ":temp, :max_tokens, :enabled, :is_default) RETURNING id"
        ),
        {
            "name": payload.name.strip(),
            "provider": (payload.provider or "custom").strip(),
            "base_url": base,
            "model": payload.model.strip(),
            "key": encrypt(payload.api_key.strip()),
            "temp": max(0.0, min(2.0, payload.temperature)),
            "max_tokens": max(64, min(32768, payload.max_tokens)),
            "enabled": payload.enabled,
            "is_default": payload.is_default,
        },
    ).fetchone()
    db.commit()
    log_audit(current_user.id, "admin.model.create", "ai_model", int(row[0]), {"model": payload.model, "base_url": base})
    return {"id": int(row[0]), "message": "模型已保存"}


@router.patch("/models/{model_id}")
def update_model(
    model_id: int,
    payload: ModelPatchBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    row = db.execute(text("SELECT * FROM bi_ai_model WHERE id = :id"), {"id": model_id}).fetchone()
    if row is None:
        raise HTTPException(404, "模型不存在")
    current = row._mapping
    data = payload.model_dump(exclude_unset=True)

    sets: list[str] = []
    params: dict = {"id": model_id, "updated_at": utc_now()}
    if "name" in data and data["name"]:
        sets.append("name = :name")
        params["name"] = data["name"].strip()
    if "provider" in data and data["provider"] is not None:
        sets.append("provider = :provider")
        params["provider"] = data["provider"].strip() or "custom"
    if "base_url" in data and data["base_url"] is not None:
        base = _assert_model_config(data["base_url"], data.get("model") or current["model"], "x", require_key=False)
        sets.append("base_url = :base_url")
        params["base_url"] = base
    if "model" in data and data["model"]:
        sets.append("model = :model")
        params["model"] = data["model"].strip()
    if data.get("api_key"):
        from app.services.crypto import encrypt

        sets.append("api_key_enc = :key")
        params["key"] = encrypt(data["api_key"].strip())
    if "temperature" in data and data["temperature"] is not None:
        sets.append("temperature = :temp")
        params["temp"] = max(0.0, min(2.0, float(data["temperature"])))
    if "max_tokens" in data and data["max_tokens"] is not None:
        sets.append("max_tokens = :max_tokens")
        params["max_tokens"] = max(64, min(32768, int(data["max_tokens"])))
    if "enabled" in data and data["enabled"] is not None:
        sets.append("enabled = :enabled")
        params["enabled"] = bool(data["enabled"])
    if data.get("is_default"):
        db.execute(text("UPDATE bi_ai_model SET is_default = false WHERE is_default AND id <> :id"), {"id": model_id})
        sets.append("is_default = true")

    if not sets:
        return {"message": "没有需要保存的修改"}

    sets.append("updated_at = :updated_at")
    db.execute(text(f"UPDATE bi_ai_model SET {', '.join(sets)} WHERE id = :id"), params)
    db.commit()
    log_audit(current_user.id, "admin.model.update", "ai_model", model_id, {k: ("***" if k == "api_key" else v) for k, v in data.items()})
    return {"message": "已保存"}


@router.delete("/models/{model_id}")
def delete_model(
    model_id: int,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    row = db.execute(text("SELECT name, model FROM bi_ai_model WHERE id = :id"), {"id": model_id}).fetchone()
    if row is None:
        raise HTTPException(404, "模型不存在")
    db.execute(text("DELETE FROM bi_ai_model WHERE id = :id"), {"id": model_id})
    db.commit()
    log_audit(current_user.id, "admin.model.delete", "ai_model", model_id, {"name": row[0], "model": row[1]})
    return {"message": "模型已删除"}


@router.post("/models/test")
def test_model(
    payload: ModelTestBody,
    current_user: User = Depends(require("bi:model:manage")),
    db: Session = Depends(get_db),
):
    """真实发一次最小请求；带 model_id 时把结果写回该行（卡片上能看到上次测试）."""
    saved = None
    if payload.model_id:
        row = db.execute(text("SELECT * FROM bi_ai_model WHERE id = :id"), {"id": payload.model_id}).fetchone()
        if row is None:
            raise HTTPException(404, "模型不存在")
        saved = row._mapping

    base_url = (payload.base_url or (saved["base_url"] if saved else "") or "").strip()
    model = (payload.model or (saved["model"] if saved else "") or "").strip()
    api_key = (payload.api_key or "").strip()
    if not api_key and saved is not None:
        api_key = ai_models.decrypt_key(saved["api_key_enc"] or "")

    result = ai_models.test_connection(base_url, model, api_key)
    if saved is not None:
        db.execute(
            text(
                "UPDATE bi_ai_model SET last_test_at = now(), last_test_ok = :ok, "
                "last_test_ms = :ms, last_test_error = :err WHERE id = :id"
            ),
            {
                "ok": result["ok"],
                "ms": result["latency_ms"],
                "err": "" if result["ok"] else str(result["message"])[:500],
                "id": payload.model_id,
            },
        )
        db.commit()
    return result


# ═══════════════════════ 运维 ═══════════════════════


@router.get("/ops")
def ops_status(
    current_user: User = Depends(require("bi:ops:manage")),
    db: Session = Depends(get_db),
):
    from app.routers.metrics import collect

    data = collect()

    started = time.monotonic()
    db_ok = True
    db_error = ""
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        db_ok = False
        db_error = str(exc)[:200]
    latency_ms = round((time.monotonic() - started) * 1000, 1)

    stats = {"total": 0, "last24h": 0}
    try:
        stats = errors_repo.counts(db)
    except Exception:
        pass

    slow: list[dict] = []
    try:
        rows = db.execute(
            text(
                "SELECT table_name, elapsed_ms, source, created_at FROM bi_query_slow "
                "ORDER BY created_at DESC LIMIT 8"
            )
        ).fetchall()
        slow = [
            {
                "table_name": r[0] or "—",
                "elapsed_ms": float(r[1] or 0),
                "source": r[2] or "internal",
                "created_at": time_text(r[3] or ""),
            }
            for r in rows
        ]
    except Exception:
        slow = []

    return {
        **data,
        "database": {
            **data.get("database", {}),
            "ok": db_ok,
            "latency_ms": latency_ms,
            "error": db_error,
        },
        "errors": {
            "total": int(stats.get("total", 0)),
            "last24h": int(stats.get("last24h", 0)),
            "retain_days": errors_repo.retain_days(),
        },
        "top_slow": slow,
        "settings": {
            "render_cache_ttl": _env_int("BI_RENDER_CACHE_TTL", 15),
            "job_executor": os.getenv("BI_JOB_EXECUTOR", "inline"),
            "job_store": os.getenv("BI_JOB_STORE", "auto"),
            "alerts_seconds": _env_int("BI_ALERT_INTERVAL_SECONDS", 60),
            "reports_seconds": _env_int("BI_REPORT_INTERVAL_SECONDS", 60),
            "sync_seconds": _env_int("BI_SYNC_INTERVAL_SECONDS", 60),
            "sync_max_per_run": _env_int("BI_SYNC_MAX_PER_RUN", 3),
            "rate_limit_per_min": _env_int("RATE_LIMIT_DEFAULT", 300),
            "query_timeout_ms": _env_int("BI_QUERY_TIMEOUT_MS", 15000),
            "user_max_concurrent": _env_int("BI_USER_MAX_CONCURRENT", 16),
            "render_workers": _env_int("BI_RENDER_WORKERS", 4),
        },
    }


@router.post("/ops/prune-errors")
def prune_errors(
    payload: dict = Body(default={}),
    current_user: User = Depends(require("bi:ops:manage")),
    db: Session = Depends(get_db),
):
    """按天清理错误日志（默认按保留天数）；返回实际删除条数."""
    raw_days = payload.get("days")
    try:
        days = errors_repo.retain_days() if raw_days in (None, "") else int(raw_days)
    except (TypeError, ValueError):
        raise HTTPException(400, "days 必须是整数")
    if days < 1 or days > 3650:
        raise HTTPException(400, "保留天数需要在 1-3650 之间")
    result = db.execute(
        text("DELETE FROM bi_error_log WHERE created_at < now() - make_interval(days => :days)"),
        {"days": days},
    )
    deleted = int(result.rowcount or 0)
    db.commit()
    log_audit(current_user.id, "admin.ops.prune_errors", "error_log", 0, {"days": days, "deleted": deleted})
    return {"deleted": deleted, "days": days, "message": f"已清理 {deleted} 条错误日志"}


@router.post("/ops/clear-cache")
def clear_render_cache(
    current_user: User = Depends(require("bi:ops:manage")),
):
    from app import cache

    cache.invalidate_prefix("render")
    log_audit(current_user.id, "admin.ops.clear_cache", "render_cache", 0, {})
    return {"message": "渲染缓存已清空"}


__all__ = ["router"]
