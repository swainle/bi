"""管理后台权限矩阵回归 —— 证明「权限真的生效」，不是界面显隐.

覆盖四类风险：
    1. 越权访问：普通用户 / 只拿到某一块权限的账号，访问其它分区必须 403；
    2. 自我提权：用户管理 / 角色管理不能把管理员角色给自己、不能授出自己没有的权限；
    3. 横向越权：部门负责人 / 部门管理员只能审批本部门的注册申请，跨部门 403；
    4. 部门范围：部门管理员只有四块分区、用户与角色都限本部门；全局部门（IT运维/股东高层）才是全后台；
    5. 业务入口：数据集/数据源/SQL/组件库/编辑设计的菜单权限与对应写接口一致（有权限放行、无权限 403）。

用法（反反复复跑都行，脚本自己清场）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/admin_permission_matrix.py [--base-url http://127.0.0.1:8300]

需要后端在跑。当前 160 项断言；任何一条不符合预期 → 退出码 1（CI / 交付前门禁）。
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

PREFIX = "qa_"
PASSWORD = "Qa123456"

# (角色 code, 角色名, 权限码列表)
ROLES = [
    ("qa_ro", "QA 只读概览", ["bi:overview"]),
    ("qa_usermgr", "QA 用户管理", ["bi:user:manage"]),
    ("qa_rolemgr", "QA 角色管理", ["bi:role:manage"]),
    ("qa_errmgr", "QA 错误日志", ["bi:error:view"]),
    ("qa_opsmgr", "QA 运维", ["bi:ops:manage"]),
    ("qa_modelmgr", "QA 模型", ["bi:model:manage"]),
    ("qa_approver", "QA 注册审批", ["bi:user:approve"]),
    ("qa_leader", "QA 部门负责人", []),
    ("qa_dept_admin_role", "QA 部门管理员", ["bi:overview", "bi:user:manage", "bi:user:approve", "bi:role:manage"]),
    ("qa_exec", "QA 高管", ["bi:user:approve"]),
    ("qa_leader_role", "QA 部门领导", [
        "bi:overview", "bi:user:manage", "bi:user:approve", "bi:role:manage",
    ]),
    ("qa_nav_sql", "QA SQL 入口", ["bi:nav:sql"]),
    ("qa_nav_ds", "QA 数据集入口", ["bi:nav:datasets"]),
    ("qa_nav_src", "QA 数据源入口", ["bi:nav:datasources"]),
    ("qa_nav_comp", "QA 组件库入口", ["bi:nav:components"]),
    ("qa_nav_edit", "QA 编辑设计入口", ["bi:nav:editor"]),
    # AI 能力（S0：登录 + 权限码，此前 AI 端点匿名可调用）
    ("qa_ai_none", "QA 无 AI 权限", []),
    ("qa_ai_use", "QA AI 分析", ["bi:ai:use"]),
    ("qa_ai_sql", "QA AI 生成 SQL", ["bi:ai:use", "bi:ai:sql"]),
]

GET_MATRIX = {
    # actor: {path: expected_status}
    "qa_plain": {
        "/admin/overview": 403, "/admin/meta": 403, "/admin/users": 403,
        "/admin/departments": 403, "/admin/roles": 403, "/admin/permissions": 403,
        "/admin/models": 403, "/admin/ops": 403, "/admin/registrations": 403,
        "/bi/errors": 403,
    },
    "qa_ro": {
        "/admin/overview": 200, "/admin/users": 403, "/admin/roles": 403,
        "/admin/models": 403, "/admin/ops": 403, "/admin/registrations": 403,
        "/bi/errors": 403,
    },
    "qa_usermgr": {
        "/admin/users": 200, "/admin/meta": 200, "/admin/departments": 200,
        "/admin/overview": 403, "/admin/roles": 403, "/admin/models": 403,
        "/admin/ops": 403, "/admin/registrations": 403, "/bi/errors": 403,
    },
    "qa_rolemgr": {
        "/admin/roles": 200, "/admin/permissions": 200, "/admin/users": 403,
        "/admin/overview": 403, "/admin/models": 403, "/admin/ops": 403,
        "/admin/registrations": 403,
    },
    "qa_errmgr": {
        "/bi/errors": 200, "/admin/overview": 403, "/admin/users": 403,
        "/admin/ops": 403, "/admin/registrations": 403,
    },
    "qa_opsmgr": {
        "/admin/ops": 200, "/admin/overview": 403, "/admin/users": 403,
        "/admin/roles": 403, "/admin/models": 403,
    },
    "qa_modelmgr": {
        "/admin/models": 200, "/admin/overview": 403, "/admin/users": 403,
        "/admin/ops": 403,
    },
    "qa_approver": {
        "/admin/registrations": 200, "/admin/users": 403, "/admin/overview": 403,
        "/admin/roles": 403,
    },
    "qa_leader": {
        "/admin/registrations": 200, "/admin/users": 403, "/admin/overview": 403,
        "/admin/departments": 403,
    },
    "admin": {
        "/admin/overview": 200, "/admin/meta": 200, "/admin/users": 200,
        "/admin/departments": 200, "/admin/roles": 200, "/admin/permissions": 200,
        "/admin/models": 200, "/admin/ops": 200, "/admin/registrations": 200,
        "/bi/errors": 200,
    },
    "qa_mgr_a": {
        "/admin/registrations": 200, "/admin/overview": 200,
        "/admin/users": 200, "/admin/roles": 200, "/admin/meta": 200,
        "/admin/models": 403, "/admin/ops": 403, "/bi/errors": 403,
    },
    # 只有业务入口权限的账号：不进管理后台
    "qa_nav_sql": {
        "/admin/overview": 403, "/admin/users": 403, "/admin/roles": 403,
        "/admin/models": 403, "/admin/ops": 403, "/admin/registrations": 403,
    },
    # 部门管理员：只有四块分区，模型 / 运维 / 错误日志 403
    "qa_dept_admin": {
        "/admin/overview": 200, "/admin/meta": 200, "/admin/users": 200,
        "/admin/departments": 200, "/admin/roles": 200, "/admin/permissions": 200,
        "/admin/registrations": 200,
        "/admin/models": 403, "/admin/ops": 403, "/bi/errors": 403,
    },
    # 全局部门（股东高层 / IT运维）管理员：全后台
    "qa_global_admin": {
        "/admin/overview": 200, "/admin/meta": 200, "/admin/users": 200,
        "/admin/departments": 200, "/admin/roles": 200, "/admin/permissions": 200,
        "/admin/models": 200, "/admin/ops": 200, "/admin/registrations": 200,
        "/bi/errors": 200,
    },
}


class Checker:
    def __init__(self) -> None:
        self.results: list[tuple[bool, str, str]] = []

    def check(self, label: str, actual, expected) -> None:
        ok = actual == expected
        self.results.append((ok, label, f"期望 {expected}，实际 {actual}"))

    def summary(self) -> int:
        failed = [r for r in self.results if not r[0]]
        total = len(self.results)
        print()
        for ok, label, detail in self.results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n权限矩阵：{total - len(failed)}/{total} 通过")
        if failed:
            print("有未通过的检查，权限没有真正生效，先修再交付。")
            return 1
        print("全部通过：越权 / 提权 / 横向越权都被拦住。")
        return 0


def _user_names() -> list[str]:
    return [f"qa_{code[3:]}" for code, _n, _p in ROLES] + [
        "qa_plain", "qa_admin2", "qa_pending_own", "qa_pending_other",
        "qa_rejected", "qa_victim", "qa_plain2", "qa_admin3",
        "qa_dept_admin", "qa_global_admin", "qa_other_user", "qa_exec2",
        "qa_dept_user", "qa_dept_forced", "qa_dept_other", "qa_dept_escalate",
        "qa_mgr_a", "qa_mgr_share", "qa_share_member",
        "qa_pending_mgr_a", "qa_pending_mgr_b", "qa_mgr_user", "qa_mgr_other",
    ]


def cleanup(db) -> None:
    names = _user_names()
    codes = [r[0] for r in ROLES] + [
        "qa_ok_role", "qa_evil", "qa_fake_admin", "qa_dept_ok", "qa_dept_evil",
        "qa_op_role", "qa_dept_admin_role", "qa_exec", "qa_mgr_role", "qa_leader_role",
    ]
    params = {f"n{i}": v for i, v in enumerate(names)}
    name_ph = ", ".join(f":n{i}" for i in range(len(params)))
    role_ph = ", ".join(f":r{i}" for i in range(len(codes)))
    rparams = {f"r{i}": v for i, v in enumerate(codes)}
    ids = [r[0] for r in db.execute(
        text(f"SELECT id FROM users WHERE username IN ({name_ph})"), params
    ).fetchall()]
    if ids:
        id_ph = ", ".join(f":i{i}" for i in range(len(ids)))
        iparams = {f"i{i}": v for i, v in enumerate(ids)}
        db.execute(text(f"UPDATE departments SET leader_id = NULL WHERE leader_id IN ({id_ph})"), iparams)
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE resource_id IN ({id_ph})"), iparams)
        db.execute(text(f"DELETE FROM users WHERE id IN ({id_ph})"), iparams)
    # 待审批测试账号在审批流程里产生的审计也一起清（按名字找不到时兜底）
    db.execute(text("DELETE FROM bi_audit_logs WHERE action LIKE 'admin.registration.%' "
                    "AND resource_id NOT IN (SELECT id FROM users)"))
    db.execute(text(f"DELETE FROM roles WHERE code IN ({role_ph})"), rparams)
    db.execute(text("DELETE FROM bi_audit_logs WHERE resource_type='role' "
                    "AND resource_id NOT IN (SELECT id FROM roles)"))
    db.commit()


ROLE_SCOPES = {
    "qa_dept_admin_role": "dept",
    "qa_exec": "all",
    "qa_approver": "all",
    "qa_leader_role": "dept_and_children",
}


def make_role(db, code: str, name: str, perms: list[str]) -> int:
    row = db.execute(
        text("INSERT INTO roles (name, code, description, is_system, data_scope) "
             "VALUES (:name, :code, '权限矩阵回归临时角色', false, :scope) RETURNING id"),
        {"name": name, "code": code, "scope": ROLE_SCOPES.get(code, "dept")},
    ).fetchone()
    role_id = int(row[0])
    for perm in perms:
        db.execute(
            text("INSERT INTO role_permission (role_id, permission_code) VALUES (:rid, :p) "
                 "ON CONFLICT DO NOTHING"),
            {"rid": role_id, "p": perm},
        )
    return role_id


def make_user(db, username: str, role: str, department_id: int | None = None,
              approval: str = "approved", active: bool = True) -> int:
    row = db.execute(
        text(
            "INSERT INTO users (username, email, password_hash, role, is_active, department_id, "
            "                   approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, :r, :a, :d, :ap, 0, now()) RETURNING id"
        ),
        {
            "u": username,
            "e": f"{username}@example.com",
            "h": hash_password(PASSWORD),
            "r": role,
            "a": active,
            "d": department_id,
            "ap": approval,
        },
    ).fetchone()
    return int(row[0])


class Api:
    def __init__(self, base_url: str) -> None:
        self.base = base_url.rstrip("/")
        self.session = requests.Session()
        self.csrf = ""
        resp = self.session.get(f"{self.base}/api/auth/csrf-token", timeout=10)
        self.csrf = (resp.json() or {}).get("csrf_token", "")
        self.tokens: dict[int, str] = {}
        self.db = SessionLocal()

    def token(self, user_id: int) -> str:
        if user_id not in self.tokens:
            version = int(self.db.execute(
                text("SELECT token_version FROM users WHERE id = :i"), {"i": user_id}
            ).scalar() or 0)
            self.tokens[user_id] = create_access_token(user_id, version)
        return self.tokens[user_id]

    def fresh_token(self, user_id: int) -> str:
        self.tokens.pop(user_id, None)
        return self.token(user_id)

    def call(self, user_id: int | None, method: str, path: str, body=None):
        headers = {"X-CSRF-Token": self.csrf}
        if user_id is not None:
            headers["Authorization"] = f"Bearer {self.token(user_id)}"
        return self.session.request(
            method, f"{self.base}/api{path}", headers=headers, json=body, timeout=15
        )

    def close(self) -> None:
        self.db.close()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        cleanup(db)
        # ── 准备账号/角色 ──
        ids: dict[str, int] = {}
        for code, name, perms in ROLES:
            make_role(db, code, name, perms)
        dept_row = db.execute(
            text("SELECT id FROM departments WHERE COALESCE(is_deleted,false)=false "
                 "ORDER BY id LIMIT 1")
        ).fetchone()
        dept_a = int(dept_row[0]) if dept_row else None
        dept_row2 = db.execute(
            text("SELECT id FROM departments WHERE COALESCE(is_deleted,false)=false "
                 "ORDER BY id OFFSET 1 LIMIT 1")
        ).fetchone()
        dept_b = int(dept_row2[0]) if dept_row2 else dept_a

        ids["admin"] = int(db.execute(text("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")).scalar())
        for code, _name, _perms in ROLES:
            ids[code] = make_user(db, f"qa_{code[3:]}", code, department_id=dept_a)
        ids["qa_plain"] = make_user(db, "qa_plain", "user", department_id=dept_a)
        ids["qa_victim"] = make_user(db, "qa_victim", "user", department_id=dept_a)
        ids["qa_plain2"] = make_user(db, "qa_plain2", "user", department_id=dept_a)
        share_dept = db.execute(text(
            "SELECT id FROM departments WHERE name = '股东高层' AND COALESCE(is_deleted,false)=false"
        )).scalar()
        ids["qa_mgr_a"] = make_user(db, "qa_mgr_a", "qa_leader_role", department_id=dept_a)
        ids["qa_mgr_share"] = make_user(db, "qa_mgr_share", "qa_exec",
                                       department_id=int(share_dept) if share_dept else None)
        ids["qa_share_member"] = make_user(db, "qa_share_member", "user",
                                          department_id=int(share_dept) if share_dept else None)
        ids["qa_pending_mgr_a"] = make_user(db, "qa_pending_mgr_a", "user",
                                            department_id=dept_a,
                                            approval="pending", active=False)
        ids["qa_pending_mgr_b"] = make_user(db, "qa_pending_mgr_b", "user",
                                            department_id=dept_b,
                                            approval="pending", active=False)
        ids["qa_dept_admin"] = make_user(db, "qa_dept_admin", "qa_dept_admin_role", department_id=dept_a)
        ids["qa_other_user"] = make_user(db, "qa_other_user", "user", department_id=dept_b)
        global_dept = db.execute(text(
            "SELECT id FROM departments WHERE is_global_admin AND COALESCE(is_deleted,false)=false "
            "ORDER BY id LIMIT 1"
        )).scalar()
        ids["qa_global_admin"] = make_user(
            db, "qa_global_admin", "admin",
            department_id=int(global_dept) if global_dept else None,
        )
        ids["qa_admin2"] = make_user(db, "qa_admin2", "admin")
        # 高层角色（S1 内置角色，真实角色而不是 qa_ 临时角色）
        ids["qa_exec2"] = make_user(db, "qa_exec2", "executive", department_id=dept_a)
        # 部门负责人：dept_a 负责人
        db.execute(text("UPDATE departments SET leader_id = :u WHERE id = :d"),
                   {"u": ids["qa_leader"], "d": dept_a})
        # 待审批账号：一个在负责人部门、一个在别的部门
        ids["qa_pending_own"] = make_user(db, "qa_pending_own", "user", department_id=dept_a,
                                         approval="pending", active=False)
        ids["qa_pending_other"] = make_user(db, "qa_pending_other", "user", department_id=dept_b,
                                           approval="pending", active=False)
        # 被驳回账号（管理员重新启用应转已通过）
        ids["qa_rejected"] = make_user(db, "qa_rejected", "user", department_id=dept_a,
                                      approval="rejected", active=False)
        db.commit()

        api = Api(args.base_url)
        check = Checker()

        # 健康检查
        if api.call(None, "GET", "/health").status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # ── 1. 越权矩阵 ──
        for actor, cases in GET_MATRIX.items():
            for path, expected in cases.items():
                resp = api.call(ids[actor], "GET", path)
                check.check(f"{actor} GET {path}", resp.status_code, expected)

        # ── 2. 自我提权 / 接管管理员 ──
        admin_id = ids["admin"]
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_usermgr']}", {"role": "admin"})
        check.check("用户管理员把自己改成 admin", r.status_code, 403)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_admin2']}", {"password": "Hack12345"})
        check.check("用户管理员重置管理员密码", r.status_code, 403)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_admin2']}", {"is_active": False})
        check.check("用户管理员停用管理员", r.status_code, 403)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_admin2']}", {"role": "user"})
        check.check("用户管理员降级管理员", r.status_code, 403)
        r = api.call(ids["qa_usermgr"], "POST", "/admin/users", {
            "username": "qa_escalate", "email": "qa_escalate@example.com",
            "password": PASSWORD, "role": "admin",
        })
        check.check("用户管理员创建 admin 账号", r.status_code, 403)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_victim']}", {"role": "qa_usermgr"})
        check.check("用户管理员分配与自己同权的角色（允许）", r.status_code, 200)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_victim']}", {"role": "qa_ro"})
        check.check("用户管理员分配自己权限外的角色", r.status_code, 403)

        # ── 3. 角色管理不能扩权 ──
        r = api.call(ids["qa_rolemgr"], "POST", "/admin/roles", {
            "name": "QA 越权角色", "code": "qa_evil", "permissions": ["bi:user:manage"],
        })
        check.check("角色管理员创建含自己没有的权限的角色", r.status_code, 403)
        r = api.call(ids["qa_rolemgr"], "POST", "/admin/roles", {
            "name": "QA 合法角色", "code": "qa_ok_role", "permissions": ["bi:role:manage"],
        })
        check.check("角色管理员创建权限不超自己的角色（允许）", r.status_code, 200)
        own_role_id = db.execute(text("SELECT id FROM roles WHERE code='qa_rolemgr'")).scalar()
        r = api.call(ids["qa_rolemgr"], "PATCH", f"/admin/roles/{own_role_id}",
                     {"permissions": ["bi:role:manage", "bi:user:manage"]})
        check.check("角色管理员给自己角色加权限", r.status_code, 403)
        admin_role_id = db.execute(text("SELECT id FROM roles WHERE code='admin'")).scalar()
        r = api.call(ids["qa_rolemgr"], "PATCH", f"/admin/roles/{admin_role_id}",
                     {"permissions": ["bi:role:manage"]})
        check.check("角色管理员改管理员角色", r.status_code, 400)
        r = api.call(ids["qa_rolemgr"], "POST", "/admin/roles",
                     {"name": "QA 假管理员", "code": "qa_fake_admin", "permissions": []})
        check.check("角色管理员新建空角色", r.status_code, 200)
        if r.status_code == 200:
            new_id = r.json().get("id")
            r2 = api.call(ids["qa_rolemgr"], "PATCH", f"/admin/roles/{new_id}",
                          {"permissions": ["bi:user:manage"]})
            check.check("角色管理员给空角色加自己权限外的权限", r2.status_code, 403)

        # ── 4. 审批横向越权 ──
        r = api.call(ids["qa_leader"], "POST", f"/admin/registrations/{ids['qa_pending_own']}/approve", {})
        check.check("部门负责人通过本部门申请", r.status_code, 200)
        r = api.call(ids["qa_leader"], "POST", f"/admin/registrations/{ids['qa_pending_other']}/approve", {})
        check.check("部门负责人通过别的部门申请", r.status_code, 403)
        r = api.call(ids["qa_plain"], "POST", f"/admin/registrations/{ids['qa_pending_other']}/approve", {})
        check.check("普通用户审批注册", r.status_code, 403)
        r = api.call(ids["qa_approver"], "POST", f"/admin/registrations/{ids['qa_pending_other']}/approve", {})
        check.check("持审批权限的账号通过任意部门申请", r.status_code, 200)
        r = api.call(ids["qa_leader"], "POST", f"/admin/registrations/{ids['qa_rejected']}/approve", {})
        check.check("部门负责人重新通过本部门被驳回账号", r.status_code, 200)

        # ── 5. 会话失效真的生效 ──
        old = api.fresh_token(ids["qa_plain"])          # 改密前拿一个当前有效的 token
        r = api.session.get(f"{api.base}/api/auth/me",
                            headers={"Authorization": f"Bearer {old}"}, timeout=10)
        check.check("改密前 token 可用（200）", r.status_code, 200)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_plain']}", {"password": "Newpass123"})
        check.check("用户管理员重置普通账号密码", r.status_code, 200)
        r = api.session.get(f"{api.base}/api/auth/me",
                            headers={"Authorization": f"Bearer {old}"}, timeout=10)
        check.check("改密后旧 token 失效（401）", r.status_code, 401)

        # 停用后立刻失效
        active_token = api.fresh_token(ids["qa_plain"])
        r = api.session.get(f"{api.base}/api/auth/me",
                            headers={"Authorization": f"Bearer {active_token}"}, timeout=10)
        check.check("改密后重新签发的新 token 可用（200）", r.status_code, 200)
        r = api.call(ids["qa_usermgr"], "PATCH", f"/admin/users/{ids['qa_plain']}", {"is_active": False})
        check.check("用户管理员停用普通账号", r.status_code, 200)
        r = api.session.get(f"{api.base}/api/auth/me",
                            headers={"Authorization": f"Bearer {active_token}"}, timeout=10)
        check.check("停用后旧 token 失效（401）", r.status_code, 401)

        # ── 6. 管理员自身边界（允许管理管理员，但不能把自己锁死） ──
        r = api.call(admin_id, "POST", "/admin/users", {
            "username": "qa_admin3", "email": "qa_admin3@example.com",
            "password": PASSWORD, "role": "admin",
        })
        check.check("管理员创建管理员账号（允许）", r.status_code, 200)
        new_admin_id = r.json().get("id") if r.status_code == 200 else None
        if new_admin_id:
            r = api.call(admin_id, "PATCH", f"/admin/users/{new_admin_id}", {"password": "Admin12345"})
            check.check("管理员重置另一个管理员密码（允许）", r.status_code, 200)
        r = api.call(admin_id, "PATCH", f"/admin/users/{admin_id}", {"is_active": False})
        check.check("管理员停用自己", r.status_code, 400)
        r = api.call(admin_id, "PATCH", f"/admin/users/{admin_id}", {"role": "user"})
        check.check("管理员给自己降级", r.status_code, 400)

        # ── 6.4 注册审批：本部门主管只审本部门；股东高层主管可审所有部门 ──
        r = api.call(ids["qa_mgr_a"], "GET", "/admin/registrations")
        regs = r.json().get("items", []) if r.status_code == 200 else []
        check.check(
            "部门主管审批列表只含本部门",
            bool(regs) and all(int(x.get("department_id") or 0) == dept_a for x in regs),
            True,
        )
        # 部门领导：能管本部门用户 / 角色，不能碰系统级
        r = api.call(ids["qa_mgr_a"], "GET", "/admin/users")
        rows = r.json().get("items", []) if r.status_code == 200 else []
        check.check(
            "部门主管用户列表只含本部门",
            bool(rows) and all(int(x.get("department_id") or 0) == dept_a for x in rows),
            True,
        )
        r = api.call(ids["qa_mgr_a"], "POST", "/admin/users", {
            "username": "qa_mgr_user", "email": "qa_mgr_user@example.com",
            "password": PASSWORD, "role": "user", "position": "member",
            "department_id": dept_a,
        })
        check.check("部门主管在本部门建号", r.status_code, 200)
        r = api.call(ids["qa_mgr_a"], "POST", "/admin/users", {
            "username": "qa_mgr_other", "email": "qa_mgr_other@example.com",
            "password": PASSWORD, "role": "user", "department_id": dept_b,
        })
        check.check("部门主管在别的部门建号", r.status_code, 403)
        r = api.call(ids["qa_mgr_a"], "POST", "/admin/roles", {
            "name": "QA 主管部门角色", "code": "qa_mgr_role",
            "permissions": ["bi:overview"], "data_scope": "dept",
        })
        check.check("部门主管建本部门角色", r.status_code, 200)
        r = api.call(ids["qa_mgr_a"], "PATCH", f"/admin/departments/{dept_a}", {"name": "改名试试"})
        check.check("部门主管改部门设置", r.status_code, 403)
        r = api.call(ids["qa_mgr_a"], "GET", "/admin/models")
        check.check("部门主管访问系统级模型配置", r.status_code, 403)

        r = api.call(ids["qa_mgr_a"], "POST",
                     f"/admin/registrations/{ids['qa_pending_mgr_b']}/approve", {})
        check.check("部门主管审批别的部门注册", r.status_code, 403)
        r = api.call(ids["qa_mgr_a"], "POST",
                     f"/admin/registrations/{ids['qa_pending_mgr_a']}/approve", {})
        check.check("部门主管审批本部门注册", r.status_code, 200)
        # 股东高层的主管：可以审所有部门
        r = api.call(ids["qa_mgr_share"], "POST",
                     f"/admin/registrations/{ids['qa_pending_mgr_b']}/approve", {})
        check.check("股东高层主管审批别的部门注册", r.status_code, 200)
        # 审批范围（/auth/me 下发，前端用来显示「审批范围」）
        def scope_of(actor):
            r = api.call(ids[actor], "GET", "/auth/me")
            return r.json().get("data", {}).get("approval_scope") if r.status_code == 200 else None
        check.check("部门主管审批范围=本部门", scope_of("qa_mgr_a"), "department")
        check.check("股东高层主管审批范围=全部", scope_of("qa_mgr_share"), "all")
        check.check("股东高层普通成员没有审批范围", scope_of("qa_share_member"), "")

        # 股东高层的普通成员：没有审批权
        r = api.call(ids["qa_share_member"], "GET", "/admin/registrations")
        check.check("股东高层普通成员看审批列表", r.status_code, 403)
        r = api.call(ids["qa_share_member"], "POST",
                     f"/admin/registrations/{ids['qa_pending_mgr_a']}/approve", {})
        check.check("股东高层普通成员审批注册", r.status_code, 403)

        # ── 6.5 部门管理员：只能本部门，且没有全后台能力 ──
        r = api.call(ids["qa_dept_admin"], "GET", "/admin/users")
        rows = r.json().get("items", []) if r.status_code == 200 else []
        check.check(
            "部门管理员用户列表只含本部门",
            bool(rows) and all(int(x.get("department_id") or 0) == dept_a for x in rows),
            True,
        )
        r = api.call(ids["qa_dept_admin"], "GET", f"/admin/users?department={dept_b}")
        check.check("部门管理员筛选别的部门", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/users/{ids['qa_other_user']}", {"role": "user"})
        check.check("部门管理员改别的部门账号", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/departments/{dept_a}", {"name": "改名试试"})
        check.check("部门管理员改部门设置", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "GET", "/admin/permissions")
        codes = [i["code"] for i in r.json().get("items", [])] if r.status_code == 200 else []
        check.check(
            "权限目录不含旧模块（知识库/团队空间/用户/系统）",
            [c for c in codes if not c.startswith("bi:")], [],
        )
        check.check(
            "部门管理员权限目录只有四块",
            sorted(codes) == sorted(["bi:overview", "bi:user:manage", "bi:user:approve", "bi:role:manage"]),
            True,
        )
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/users", {
            "username": "qa_dept_user", "email": "qa_dept_user@example.com",
            "password": PASSWORD, "role": "user", "department_id": dept_a,
        })
        check.check("部门管理员在本部门建号", r.status_code, 200)
        if r.status_code == 200:
            created_id = r.json().get("id")
            ids["qa_dept_user"] = created_id
            forced = db.execute(text("SELECT department_id FROM users WHERE id=:i"),
                                {"i": created_id}).scalar()
            check.check("部门管理员建号强制本部门", int(forced or 0), dept_a)
            r2 = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/users/{created_id}",
                          {"department_id": dept_b})
            check.check("部门管理员把账号搬去别的部门", r2.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/users", {
            "username": "qa_dept_other", "email": "qa_dept_other@example.com",
            "password": PASSWORD, "role": "user", "department_id": dept_b,
        })
        check.check("部门管理员在别的部门建号", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/users", {
            "username": "qa_dept_forced", "email": "qa_dept_forced@example.com",
            "password": PASSWORD, "role": "user",
        })
        if r.status_code == 200:
            forced_id = r.json().get("id")
            forced = db.execute(text("SELECT department_id FROM users WHERE id=:i"),
                                {"i": forced_id}).scalar()
            check.check("部门管理员不填部门时强制本部门", int(forced or 0), dept_a)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/users", {
            "username": "qa_dept_escalate", "email": "qa_dept_escalate@example.com",
            "password": PASSWORD, "role": "admin",
        })
        check.check("部门管理员创建 admin 账号", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/users/{ids['qa_other_user']}",
                     {"role": "admin"})
        check.check("部门管理员把别人提成 admin", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/roles", {
            "name": "QA 部门越权角色", "code": "qa_dept_evil", "permissions": ["bi:ops:manage"],
        })
        check.check("部门管理员建带运维权限的角色", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/roles", {
            "name": "QA 部门全范围角色", "code": "qa_dept_all",
            "permissions": ["bi:overview"], "data_scope": "all",
        })
        check.check("部门管理员建「全部部门」范围角色", r.status_code, 403)
        own_role_id = db.execute(text("SELECT id FROM roles WHERE code='qa_dept_admin_role'")).scalar()
        r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/roles/{own_role_id}",
                     {"data_scope": "all"})
        check.check("部门管理员把自己的角色改成全部范围", r.status_code, 403)
        r = api.call(ids["qa_dept_admin"], "POST", "/admin/roles", {
            "name": "QA 部门角色", "code": "qa_dept_ok",
            "permissions": ["bi:user:manage", "bi:user:approve", "bi:role:manage"],
        })
        check.check("部门管理员建本部门角色", r.status_code, 200)
        dept_role_id = db.execute(text("SELECT id FROM roles WHERE code='qa_dept_ok'")).scalar()
        if dept_role_id:
            role_dept = db.execute(text("SELECT dept_id FROM roles WHERE id=:i"),
                                   {"i": dept_role_id}).scalar()
            check.check("部门管理员建的角色归属本部门", int(role_dept or 0), dept_a)
            r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/roles/{dept_role_id}",
                         {"permissions": ["bi:user:manage", "bi:user:approve", "bi:overview", "bi:role:manage"]})
            check.check("部门管理员改自己部门角色", r.status_code, 200)
        global_role_id = db.execute(text("SELECT id FROM roles WHERE code='member'")).scalar()
        r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/roles/{global_role_id}",
                     {"permissions": ["bi:overview"]})
        check.check("部门管理员改全局系统角色", r.status_code, 403)
        # 把部门角色分配给本部门用户 → 该用户成为「部门操作员」，仍只能管本部门
        if ids.get("qa_dept_user"):
            r = api.call(ids["qa_dept_admin"], "PATCH", f"/admin/users/{ids['qa_dept_user']}",
                         {"role": "qa_dept_ok"})
            check.check("部门管理员把部门角色分配给本部门用户", r.status_code, 200)
            r = api.call(ids["qa_dept_user"], "GET", "/admin/users")
            rows = r.json().get("items", []) if r.status_code == 200 else []
            check.check(
                "部门操作员用户列表只含本部门",
                bool(rows) and all(int(x.get("department_id") or 0) == dept_a for x in rows),
                True,
            )
            r = api.call(ids["qa_dept_user"], "GET", f"/admin/users?department={dept_b}")
            check.check("部门操作员筛选别的部门", r.status_code, 403)
            r = api.call(ids["qa_dept_user"], "PATCH", f"/admin/users/{ids['qa_other_user']}", {"role": "user"})
            check.check("部门操作员改别的部门账号", r.status_code, 403)
            r = api.call(ids["qa_dept_user"], "POST", f"/admin/registrations/{ids['qa_pending_other']}/approve", {})
            check.check("部门操作员审批别的部门注册", r.status_code, 403)
            r = api.call(ids["qa_dept_user"], "GET", "/admin/models")
            check.check("部门操作员访问模型配置", r.status_code, 403)
            r = api.call(ids["qa_dept_user"], "POST", "/admin/roles", {
                "name": "QA 操作员角色", "code": "qa_op_role", "permissions": ["bi:user:manage"],
            })
            check.check("部门操作员建角色（自动归本部门）", r.status_code, 200)
            if r.status_code == 200:
                op_role_dept = db.execute(text("SELECT dept_id FROM roles WHERE code='qa_op_role'")).scalar()
                check.check("部门操作员建的角色归属本部门", int(op_role_dept or 0), dept_a)

        r = api.call(ids["qa_dept_admin"], "POST", f"/admin/registrations/{ids['qa_pending_other']}/approve", {})
        check.check("部门管理员审批别的部门注册", r.status_code, 403)
        check.check(
            "部门管理员概览没有错误列表",
            api.call(ids["qa_dept_admin"], "GET", "/admin/overview").json().get("recent_errors", None),
            [],
        )

        # 全局部门管理员：可以管到别的部门
        r = api.call(ids["qa_global_admin"], "GET", "/admin/users")
        depts = (
            {int(x.get("department_id") or 0) for x in r.json().get("items", [])}
            if r.status_code == 200 else set()
        )
        check.check("全局部门管理员能看到多部门用户", len(depts) >= 2, True)
        r = api.call(ids["qa_global_admin"], "PATCH", f"/admin/users/{ids['qa_other_user']}",
                     {"is_active": True})
        check.check("全局部门管理员改别的部门账号", r.status_code, 200)

        # ── 6.6 业务入口权限：菜单 + 接口写操作都真的生效 ──
        def nav_status(actor: str, method: str, path: str, body=None):
            return api.call(ids[actor], method, path, body).status_code

        # SQL 入口：只有 SQL 权限 / IT运维默认的人能执行
        check.check("SQL 权限账号执行查询（放行，非 403）",
                    nav_status("qa_nav_sql", "POST", "/bi/engine/query", {}) not in (401, 403), True)
        check.check("SQL 权限账号建数据源（拒绝）",
                    nav_status("qa_nav_sql", "POST", "/bi/sources", {}), 403)
        check.check("普通账号执行 SQL（拒绝）",
                    nav_status("qa_plain2", "POST", "/bi/engine/query", {}), 403)

        # 数据集入口：建/改/删被放行到参数校验，没权限 403
        check.check("数据集权限账号建数据集（放行，非 403）",
                    nav_status("qa_nav_ds", "POST", "/bi/semantic/datasets", {}) not in (401, 403), True)
        check.check("数据集权限账号删不存在的数据集（放行为 404）",
                    nav_status("qa_nav_ds", "DELETE", "/bi/semantic/datasets/999999"), 404)
        check.check("无数据集权限删数据集（拒绝）",
                    nav_status("qa_nav_sql", "DELETE", "/bi/semantic/datasets/999999"), 403)
        # 数据源入口
        check.check("数据源权限账号建数据源（放行，非 403）",
                    nav_status("qa_nav_src", "POST", "/bi/sources", {}) not in (401, 403), True)
        check.check("数据源权限账号建数据集（拒绝）",
                    nav_status("qa_nav_src", "POST", "/bi/semantic/datasets", {}), 403)
        # 组件库入口
        check.check("组件库权限建组件（放行，非 403）",
                    nav_status("qa_nav_comp", "POST", "/bi/components", {}) not in (401, 403), True)
        check.check("组件库权限删数据集（拒绝）",
                    nav_status("qa_nav_comp", "DELETE", "/bi/semantic/datasets/999999"), 403)
        # 编辑设计入口
        check.check("编辑设计权限改看板（放行为 404）",
                    nav_status("qa_nav_edit", "PATCH", "/bi/dashboards/999999", {}), 404)
        check.check("编辑设计权限建数据源（拒绝）",
                    nav_status("qa_nav_edit", "POST", "/bi/sources", {}), 403)
        # 管理员不受业务入口影响
        check.check("全局管理员执行 SQL（放行，非 403）",
                    nav_status("admin", "POST", "/bi/engine/query", {}) not in (401, 403), True)

        # ── 6.7 AI 能力权限（S0：登录 + 权限码；此前 AI 端点匿名可调用）──
        check.check("匿名调用 AI 接口（拒绝 403）",
                    api.call(None, "GET", "/bi/engine/ai/audit").status_code, 403)
        check.check("无 AI 权限账号调用 AI（拒绝 403）",
                    nav_status("qa_ai_none", "GET", "/bi/engine/ai/audit"), 403)
        check.check("有 bi:ai:use 账号调用 AI（放行）",
                    nav_status("qa_ai_use", "GET", "/bi/engine/ai/audit"), 200)
        check.check("只有 bi:ai:use 却调 AI 生成 SQL（拒绝 403）",
                    nav_status("qa_ai_use", "POST", "/bi/engine/ai/nl_to_sql",
                               {"question": "销售额", "table": "bi_demo_sku"}), 403)
        check.check("有 bi:ai:sql 调 AI 生成 SQL（放行，非 403）",
                    nav_status("qa_ai_sql", "POST", "/bi/engine/ai/nl_to_sql",
                               {"question": "销售额", "table": "bi_demo_sku"}) not in (401, 403), True)
        check.check("管理员调用 AI（放行）",
                    nav_status("admin", "GET", "/bi/engine/ai/audit"), 200)
        # 一次性回填（迁移 046）：现有内置角色保留 AI 分析，SQL 入口角色保留 AI 生成 SQL
        missing_ai_use = db.execute(text(
            "SELECT count(*) FROM roles r WHERE r.code IN ('member', 'manager') "
            "AND NOT EXISTS (SELECT 1 FROM role_permission rp WHERE rp.role_id = r.id "
            "                AND rp.permission_code = 'bi:ai:use')"
        )).scalar()
        check.check("内置角色已回填 bi:ai:use", int(missing_ai_use or 0), 0)
        missing_ai_sql = db.execute(text(
            "SELECT count(*) FROM role_permission rp JOIN roles r ON r.id = rp.role_id "
            "WHERE rp.permission_code = 'bi:nav:sql' AND r.code NOT LIKE 'qa_%' "
            "AND NOT EXISTS (SELECT 1 FROM role_permission x WHERE x.role_id = rp.role_id "
            "                AND x.permission_code = 'bi:ai:sql')"
        )).scalar()
        check.check("SQL 入口角色已回填 bi:ai:sql", int(missing_ai_sql or 0), 0)

        # ── 6.8 MCP 分区（S1：只有 bi:mcp:manage 能进，高危工具默认关）──
        check.check("管理员看 MCP 客户端（放行）",
                    nav_status("admin", "GET", "/admin/mcp/clients"), 200)
        check.check("无 MCP 管理权限看客户端（拒绝）",
                    nav_status("qa_ro", "GET", "/admin/mcp/clients"), 403)
        check.check("高层角色看 MCP 客户端（拒绝）",
                    nav_status("qa_exec2", "GET", "/admin/mcp/clients"), 403)
        check.check("管理员看工具目录（放行）",
                    nav_status("admin", "GET", "/admin/mcp/tools"), 200)
        high_default_on = db.execute(text(
            "SELECT count(*) FROM bi_mcp_tool WHERE risk = 'high' AND default_enabled"
        )).scalar()
        check.check("高危工具默认全关", int(high_default_on or 0), 0)

        # ── 6.9 高层角色边界（S1：全部部门只读 + 汇总导出；禁 SQL / 明细 / 写操作）──
        check.check("高层执行 SQL（拒绝）", nav_status("qa_exec2", "POST", "/bi/engine/query", {}), 403)
        check.check("高层看我的看板（放行）", nav_status("qa_exec2", "GET", "/bi/dashboards"), 200)
        check.check("高层用 AI 分析（放行）", nav_status("qa_exec2", "GET", "/bi/engine/ai/audit"), 200)
        exec_perms = {r[0] for r in db.execute(text(
            "SELECT rp.permission_code FROM role_permission rp JOIN roles r ON r.id = rp.role_id "
            "WHERE r.code = 'executive'"
        )).fetchall()}
        check.check("高层权限 = AI 分析 + 汇总导出", exec_perms, {"bi:ai:use", "bi:data:export:summary"})
        check.check("高层数据范围 = 全部部门",
                    db.execute(text("SELECT data_scope FROM roles WHERE code = 'executive'")).scalar(), "all")

        # ── 7. 普通用户没有后台/审批能力 ──
        r = api.call(ids["qa_plain2"], "POST", "/admin/registrations/1/reject", {"reason": "x"})
        check.check("普通用户驳回注册", r.status_code, 403)
        r = api.call(ids["qa_plain2"], "GET", "/admin/overview")
        check.check("普通用户看概览", r.status_code, 403)

        return check.summary()
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
