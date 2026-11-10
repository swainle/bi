"""RBAC 种子数据 — 权限码 + 默认角色"""
from sqlalchemy.orm import Session
from app.models.rbac import Permission, Role

PERMISSIONS = [
    # 知识库
    ("kb:view", "查看知识库", "kb"),
    ("kb:create", "创建知识库", "kb"),
    ("kb:edit", "编辑知识库", "kb"),
    ("kb:delete", "删除知识库", "kb"),
    ("kb:share", "共享知识库", "kb"),
    # 团队空间
    ("teamspace:view", "查看团队空间", "teamspace"),
    ("teamspace:create", "创建文件夹/文件", "teamspace"),
    ("teamspace:edit", "编辑文件夹/文件", "teamspace"),
    ("teamspace:delete", "删除文件夹/文件", "teamspace"),
    # 用户管理
    ("user:view", "查看用户", "user"),
    ("user:create", "创建用户", "user"),
    ("user:edit", "编辑用户", "user"),
    ("user:delete", "删除用户", "user"),
    # 系统管理
    ("system:settings", "系统设置", "system"),
    ("system:audit", "查看审计日志", "system"),
]

DEFAULT_ROLES = {
    "admin": {
        "name": "管理员",
        "description": "超级管理员，拥有所有权限",
        "permissions": [p[0] for p in PERMISSIONS],
    },
    "manager": {
        "name": "部门主管",
        "description": "可管理本部门的知识库和文件",
        "permissions": ["kb:view", "kb:create", "kb:edit", "kb:delete", "kb:share",
                        "teamspace:view", "teamspace:create", "teamspace:edit", "teamspace:delete",
                        "user:view"],
    },
    "member": {
        "name": "普通成员",
        "description": "可查看和创建知识库",
        "permissions": ["kb:view", "kb:create", "kb:edit", "kb:share",
                        "teamspace:view", "teamspace:create", "teamspace:edit"],
    },
    "viewer": {
        "name": "访客",
        "description": "只读权限",
        "permissions": ["kb:view", "teamspace:view"],
    },
}


def seed_permissions(db: Session):
    existing = {p.code for p in db.query(Permission).all()}
    for code, name, group in PERMISSIONS:
        if code not in existing:
            db.add(Permission(code=code, name=name, group=group))
    db.commit()


def seed_roles(db: Session):
    for code, info in DEFAULT_ROLES.items():
        role = db.query(Role).filter(Role.code == code).first()
        if not role:
            role = Role(code=code, name=info["name"], description=info["description"], is_system=True)
            db.add(role)
            db.flush()
        # 更新权限
        perms = db.query(Permission).filter(Permission.code.in_(info["permissions"])).all()
        role.permissions = perms
    db.commit()
