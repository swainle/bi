"""管理后台权限 —— 标准 RBAC + 数据范围（2026-11-14 重构）.

模型：
    * **角色** = 功能权限（role_permission）+ 数据范围（roles.data_scope）；
    * 数据范围：all 全部部门 / dept_and_children 本部门及下级 / dept 本部门 / self 本人；
    * **部门** = 树（departments.parent_id），负责人（leader_id）自动获得本部门及下级的审批权；
    * 超级管理员（admin / super_admin）拥有全部权限、数据范围固定 all；
    * 审批 = `bi:user:approve` 权限 × 数据范围；数据范围覆盖不到的部门一律 403。

**每次请求都从库里现算**，不信任 JWT 里的旧快照（改权限 / 改范围后立刻生效）。
"""

from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.rbac import Permission, Role
from app.models.user import User

ADMIN_ROLES = {"admin", "super_admin"}

# 业务入口权限（主页左侧菜单）
NAV_PERMISSIONS: list[tuple[str, str, str]] = [
    ("bi:nav:datasets", "数据集入口", "业务入口"),
    ("bi:nav:datasources", "数据源入口", "业务入口"),
    ("bi:nav:sql", "SQL 查询入口", "业务入口"),
    ("bi:nav:components", "组件库入口", "业务入口"),
    ("bi:nav:editor", "编辑设计入口", "业务入口"),
]
NAV_PERMISSION_CODES = [code for code, _n, _g in NAV_PERMISSIONS]

# 管理后台权限目录
BI_PERMISSIONS: list[tuple[str, str, str]] = [
    ("bi:overview", "查看概览", "管理后台"),
    ("bi:user:manage", "用户管理", "管理后台"),
    ("bi:user:approve", "注册审批", "管理后台"),
    ("bi:role:manage", "角色与权限", "管理后台"),
    ("bi:model:manage", "模型配置", "管理后台"),
    ("bi:error:view", "错误日志", "管理后台"),
    ("bi:ops:manage", "运维操作", "管理后台"),
]

BI_PERMISSION_CODES = [code for code, _name, _group in BI_PERMISSIONS]

# AI 能力权限（不是后台分区：有了它也不进管理后台，只决定能不能用 AI 功能）
AI_PERMISSIONS: list[tuple[str, str, str]] = [
    ("bi:ai:use", "AI 分析", "AI 能力"),
    ("bi:ai:sql", "AI 生成 SQL", "AI 能力"),
    ("bi:ai:export", "AI 导出", "AI 能力"),
]
AI_PERMISSION_CODES = [code for code, _name, _group in AI_PERMISSIONS]

# 界面上真正存在的权限码：管理后台 + 业务入口 + AI 能力。
VISIBLE_PERMISSION_CODES = set(BI_PERMISSION_CODES) | set(NAV_PERMISSION_CODES) | set(AI_PERMISSION_CODES)

DATA_SCOPE_VALUES = {"all", "dept_and_children", "dept", "self"}
DATA_SCOPE_LABELS = {
    "all": "全部部门",
    "dept_and_children": "本部门及下级",
    "dept": "本部门",
    "self": "本人",
}


def is_admin(user: User | None) -> bool:
    return bool(user) and (getattr(user, "role", "") or "") in ADMIN_ROLES


def role_permission_codes(db: Session, role_code: str) -> list[str]:
    """一个角色拥有哪些权限码（角色不存在 → 空）."""
    if not role_code:
        return []
    role = db.query(Role).filter(Role.code == role_code).first()
    if role is None:
        return []
    return sorted({p.code for p in role.permissions})


def role_department(db: Session, user: User | None) -> int | None:
    """用户所属角色归属的部门（部门自建角色）；全局角色返回 None."""
    if not user:
        return None
    code = getattr(user, "role", "") or ""
    if not code:
        return None
    try:
        row = db.execute(text("SELECT dept_id FROM roles WHERE code = :c"), {"c": code}).fetchone()
    except Exception:
        return None
    return int(row[0]) if row and row[0] is not None else None


def data_scope(db: Session, user: User | None) -> str:
    """当前账号的数据范围（超级管理员固定 all）."""
    if not user:
        return "self"
    if is_admin(user):
        return "all"
    code = getattr(user, "role", "") or ""
    if not code:
        return "self"
    try:
        row = db.execute(
            text("SELECT data_scope FROM roles WHERE code = :c"), {"c": code}
        ).fetchone()
    except Exception:
        return "self"
    value = (row[0] if row else "") or "self"
    return value if value in DATA_SCOPE_VALUES else "self"


def department_subtree_ids(db: Session, dept_id: int) -> list[int]:
    """本部门 + 所有下级部门 id（递归）."""
    if not dept_id:
        return []
    try:
        rows = db.execute(
            text(
                "WITH RECURSIVE sub AS ("
                "  SELECT id FROM departments WHERE id = :id AND COALESCE(is_deleted,false)=false"
                "  UNION ALL"
                "  SELECT d.id FROM departments d JOIN sub s ON d.parent_id = s.id"
                "   WHERE COALESCE(d.is_deleted,false)=false"
                ") SELECT id FROM sub"
            ),
            {"id": int(dept_id)},
        ).fetchall()
    except Exception:
        return [int(dept_id)]
    return sorted({int(r[0]) for r in rows}) or [int(dept_id)]


def scoped_department_ids(db: Session, user: User | None) -> list[int] | None:
    """数据范围覆盖的部门：None = 全部；[] = 本人（不看部门）."""
    scope = data_scope(db, user)
    if scope == "all":
        return None
    if scope == "self":
        return []
    own = getattr(user, "department_id", None)
    if not own:
        return []
    if scope == "dept_and_children":
        return department_subtree_ids(db, int(own))
    return [int(own)]


def leader_department_ids(db: Session, user_id: int) -> list[int]:
    if not user_id:
        return []
    try:
        rows = db.execute(
            text(
                "SELECT id FROM departments WHERE leader_id = :uid AND COALESCE(is_deleted,false)=false"
            ),
            {"uid": user_id},
        ).fetchall()
    except Exception:
        return []
    return [int(r[0]) for r in rows]


def allowed_permissions(db: Session, user: User | None) -> list[str]:
    """当前账号的功能权限（超级管理员 = 全部可见权限码）."""
    if not user:
        return []
    if is_admin(user):
        codes = {row[0] for row in db.query(Permission.code).all()}
        return sorted(codes & VISIBLE_PERMISSION_CODES)
    return sorted(set(role_permission_codes(db, getattr(user, "role", "") or "")) & VISIBLE_PERMISSION_CODES)


def effective_permissions(db: Session, user: User | None) -> list[str]:
    return allowed_permissions(db, user)


def has_permission(db: Session, user: User | None, code: str) -> bool:
    if not user:
        return False
    if is_admin(user):
        return True
    if code not in VISIBLE_PERMISSION_CODES:
        return False
    return code in role_permission_codes(db, getattr(user, "role", "") or "")


def admin_scope(db: Session, user: User | None) -> str:
    """管理后台范围标签：global / department / self / ""（没有后台权限）."""
    if not user:
        return ""
    if is_admin(user):
        return "global"
    perms = set(allowed_permissions(db, user))
    if not (perms & set(BI_PERMISSION_CODES)):
        return ""
    scope = data_scope(db, user)
    return {"all": "global", "dept_and_children": "department", "dept": "department"}.get(scope, "self")


def approval_scope(db: Session, user: User | None) -> str:
    """注册审批范围：all / department / ""（不能审批）."""
    if not user:
        return ""
    can_approve = has_permission(db, user, "bi:user:approve") or bool(leader_department_ids(db, user.id))
    if not can_approve:
        return ""
    scope = data_scope(db, user)
    if scope == "all":
        return "all"
    return "" if scope == "self" else "department"


def require(code: str, message: str = "没有该管理后台权限，请联系管理员开通"):
    """FastAPI 依赖：要求某个权限码（超级管理员直通）."""

    def dependency(
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> User:
        if not has_permission(db, current_user, code):
            raise HTTPException(403, message)
        return current_user

    return dependency


def require_all_scope(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """要求数据范围 = 全部部门（部门设置、跨部门角色等全局操作）."""
    if data_scope(db, current_user) != "all":
        raise HTTPException(403, "只有「数据范围=全部部门」的账号可以修改这项设置")
    return current_user


__all__ = [
    "ADMIN_ROLES",
    "AI_PERMISSION_CODES",
    "AI_PERMISSIONS",
    "BI_PERMISSIONS",
    "BI_PERMISSION_CODES",
    "DATA_SCOPE_LABELS",
    "DATA_SCOPE_VALUES",
    "NAV_PERMISSION_CODES",
    "VISIBLE_PERMISSION_CODES",
    "admin_scope",
    "allowed_permissions",
    "approval_scope",
    "data_scope",
    "department_subtree_ids",
    "effective_permissions",
    "has_permission",
    "is_admin",
    "leader_department_ids",
    "require",
    "require_all_scope",
    "role_department",
    "role_permission_codes",
    "scoped_department_ids",
]
