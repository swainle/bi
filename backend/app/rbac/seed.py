"""RBAC 种子数据 — 权限码 + 默认角色"""
from sqlalchemy.orm import Session
from app.rbac.models import Permission, Role

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
    # 管理后台（概览 / 用户 / 权限 / 模型 / 错误 / 运维）
    ("bi:overview", "查看概览", "管理后台"),
    ("bi:user:manage", "用户管理", "管理后台"),
    ("bi:user:approve", "注册审批", "管理后台"),
    ("bi:role:manage", "角色与权限", "管理后台"),
    ("bi:model:manage", "模型配置", "管理后台"),
    ("bi:error:view", "错误日志", "管理后台"),
    ("bi:audit:view", "操作监控", "管理后台"),
    ("bi:ops:manage", "运维操作", "管理后台"),
    ("bi:mcp:manage", "MCP 客户端", "管理后台"),
    ("bi:nav:datasets", "数据集入口", "业务入口"),
    ("bi:nav:datasources", "数据源入口", "业务入口"),
    ("bi:nav:sql", "SQL 查询入口", "业务入口"),
    ("bi:nav:components", "组件库入口", "业务入口"),
    ("bi:nav:editor", "编辑设计入口", "业务入口"),
    # AI 能力（不是后台分区）
    ("bi:ai:use", "AI 分析", "AI 能力"),
    ("bi:ai:sql", "AI 生成 SQL", "AI 能力"),
    ("bi:ai:export", "AI 导出", "AI 能力"),
    # MCP / Agent 能力
    ("bi:mcp:use", "Agent 代调用", "MCP 能力"),
    ("bi:mcp:write", "Agent 写看板", "MCP 能力"),
    # 数据能力
    ("bi:data:export:summary", "汇总导出", "数据能力"),
    ("bi:data:export:detail", "明细导出", "数据能力"),
    ("bi:resource:delete", "删除资源", "数据能力"),
]

DEFAULT_ROLES = {
    "admin": {
        "name": "管理员",
        "description": "超级管理员，拥有所有权限",
        "permissions": [p[0] for p in PERMISSIONS],
        "data_scope": "all",
        "sort_order": 100,
    },
    "executive": {
        "name": "高层",
        "description": "股东 / 老板：全部部门只读 + 汇总导出；禁 SQL、明细导出与任何写操作",
        "permissions": ["bi:ai:use", "bi:data:export:summary"],
        "data_scope": "all",
        "sort_order": 95,
    },
    "manager": {
        "name": "主管",
        "description": "可查看概览、审批本部门注册",
        "permissions": ["bi:overview", "bi:user:manage", "bi:user:approve", "bi:role:manage", "bi:ai:use"],
        "data_scope": "dept_and_children",
        "sort_order": 70,
    },
    "member": {
        "name": "员工",
        "description": "基础成员：默认只读看板",
        "permissions": ["bi:ai:use"],
        "data_scope": "self",
        "sort_order": 60,
    },
    "viewer": {
        "name": "访客",
        "description": "只读权限",
        "permissions": [],
        "data_scope": "self",
        "sort_order": 50,
    },
}


def seed_permissions(db: Session):
    existing = {p.code for p in db.query(Permission).all()}
    for code, name, group in PERMISSIONS:
        if code not in existing:
            db.add(Permission(code=code, name=name, group=group))
    db.commit()


def seed_roles(db: Session):
    """补缺失的内置角色。

    注意：**只在角色第一次创建时写入默认权限**。旧实现每次启动都无条件覆盖
    `role.permissions`，管理后台里配好的权限一重启就被冲掉 —— 那样「权限分配」就是花架子。
    """
    for code, info in DEFAULT_ROLES.items():
        role = db.query(Role).filter(Role.code == code).first()
        if role:
            continue
        role = Role(
            code=code,
            name=info["name"],
            description=info["description"],
            is_system=True,
            data_scope=info.get("data_scope", "dept"),
            sort_order=info.get("sort_order", 0),
        )
        db.add(role)
        db.flush()
        perms = db.query(Permission).filter(Permission.code.in_(info["permissions"])).all()
        role.permissions = perms
    db.commit()
