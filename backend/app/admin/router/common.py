"""管理后台 · 公共件（数据范围、角色/部门断言、请求模型与序列化）。"""

from __future__ import annotations

import os
import re
from fastapi import Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.admin.permissions import ADMIN_ROLES, admin_scope, data_scope, has_permission, is_admin, leader_department_ids, scoped_department_ids
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.rbac import Role
from app.models.user import User
from app.services import ai_models

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
                "last_test_at": str(m["last_test_at"] or ""),
                "last_test_ok": m["last_test_ok"],
                "last_test_ms": m["last_test_ms"],
                "last_test_error": m["last_test_error"] or "",
            }
        )
    return items


def _assert_model_config(base_url: str, model: str, api_key: str, require_key: bool = True) -> str:
    base = ai_models.normalize_base_url(base_url)
    if not base:
        raise HTTPException(400, "Base URL 需要以 http:// 或 https:// 开头")
    if not (model or "").strip():
        raise HTTPException(400, "模型名不能为空")
    if require_key and not (api_key or "").strip():
        raise HTTPException(400, "API Key 不能为空")
    return base
