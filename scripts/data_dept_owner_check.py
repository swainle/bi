"""数据源 / 数据集「归属部门」回归（2026-11-14）—— 真实账号，跑完自动清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/data_dept_owner_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 数据集标了部门：本部门可见 / 可取数；别的部门列表看不到、详情与取数 403；
    2. 没标部门（全局）：行为不变，任何登录用户可见；
    3. 新建时不能把数据归到自己数据范围之外的部门（403）；
    4. 数据源可标部门，列表返回 dept_name；
    5. MCP 自动继承：别的部门的 Agent 取不到（tools/call 拒绝）。
"""

from __future__ import annotations

import argparse
import os
import sys

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

PASSWORD = "Qa123456"
DEPT_NAMES = ["QA 归属部门A", "QA 归属部门B"]
DATASET_NAMES = ["QA 归属数据集", "QA 归属全局数据集"]
SOURCE_NAME = "QA 归属数据源"
CLIENT_NAME = "QA 归属校验"
USER_NAMES = ["qa_owner_a", "qa_owner_b"]
ROLE_CODES = ["qa_owner_role"]


def cleanup(db) -> None:
    ids = [r[0] for r in db.execute(
        text("SELECT id FROM users WHERE username = ANY(:n)"), {"n": USER_NAMES}
    ).fetchall()]
    if ids:
        ph = ", ".join(f":i{i}" for i in range(len(ids)))
        params = {f"i{i}": v for i, v in enumerate(ids)}
        db.execute(text(f"UPDATE departments SET leader_id = NULL WHERE leader_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM users WHERE id IN ({ph})"), params)
    db.execute(text("DELETE FROM bi_mcp_client WHERE name = :n"), {"n": CLIENT_NAME})
    db.execute(text("DELETE FROM bi_mcp_audit"))
    db.execute(text("DELETE FROM roles WHERE code = ANY(:c)"), {"c": ROLE_CODES})
    db.execute(text("DELETE FROM bi_source WHERE name = :n"), {"n": SOURCE_NAME})
    db.execute(text("DELETE FROM bi_dataset WHERE name = ANY(:n)"), {"n": DATASET_NAMES})
    db.execute(text("DELETE FROM departments WHERE name = ANY(:n)"), {"n": DEPT_NAMES})
    db.execute(text("DELETE FROM bi_audit_logs WHERE action LIKE 'mcp.%' "
                    "AND resource_type = 'mcp_client' "
                    "AND resource_id NOT IN (SELECT id FROM bi_mcp_client)"))
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        cleanup(db)
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        dept_a = int(db.execute(text(
            "INSERT INTO departments (name, is_deleted) VALUES (:n, false) RETURNING id"),
            {"n": DEPT_NAMES[0]}).scalar())
        dept_b = int(db.execute(text(
            "INSERT INTO departments (name, is_deleted) VALUES (:n, false) RETURNING id"),
            {"n": DEPT_NAMES[1]}).scalar())

        db.execute(text(
            "INSERT INTO roles (name, code, description, is_system, data_scope) "
            "VALUES ('QA 归属角色', 'qa_owner_role', '临时角色', false, 'dept')"))
        role_id = int(db.execute(text("SELECT id FROM roles WHERE code = 'qa_owner_role'")).scalar())
        for perm in ("bi:nav:datasets", "bi:mcp:use"):
            db.execute(text("INSERT INTO role_permission (role_id, permission_code) "
                            "VALUES (:r, :p) ON CONFLICT DO NOTHING"), {"r": role_id, "p": perm})

        def make_user(username: str, role: str, dept: int) -> int:
            return int(db.execute(text(
                "INSERT INTO users (username, email, password_hash, role, is_active, "
                "  department_id, approval_status, token_version, created_at) "
                "VALUES (:u, :e, :h, :r, true, :d, 'approved', 0, now()) RETURNING id"),
                {"u": username, "e": f"{username}@example.com", "h": hash_password(PASSWORD),
                 "r": role, "d": dept}).scalar())

        user_a = make_user("qa_owner_a", "qa_owner_role", dept_a)
        user_b = make_user("qa_owner_b", "qa_owner_role", dept_b)
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        admin_id, admin_ver = int(admin[0]), int(admin[1] or 0)
        db.commit()

        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(admin_id, admin_ver)}",
              "X-CSRF-Token": csrf}

        def headers(user_id: int) -> dict:
            ver = int(db.execute(text("SELECT token_version FROM users WHERE id = :i"),
                                 {"i": user_id}).scalar() or 0)
            return {"Authorization": f"Bearer {create_access_token(user_id, ver)}",
                    "X-CSRF-Token": csrf}

        # ── 1. 标了部门的数据集 ────────────────────────────────
        r = session.post(f"{base}/api/bi/semantic/datasets", headers=AH, json={
            "name": DATASET_NAMES[0], "physical_table": "bi_demo_sku", "dept_id": dept_a,
        }, timeout=30)
        check("管理员建部门数据集", r.status_code, 200)
        dept_ds = r.json().get("id")

        def dataset_names(user_id: int) -> list[str]:
            res = session.get(f"{base}/api/bi/semantic/datasets", headers=headers(user_id), timeout=30)
            return [d["name"] for d in res.json().get("datasets", [])]

        check("本部门可见", DATASET_NAMES[0] in dataset_names(user_a), True)
        check("别的部门列表看不到", DATASET_NAMES[0] in dataset_names(user_b), False)
        check("本部门看详情", session.get(f"{base}/api/bi/semantic/datasets/{dept_ds}",
                                          headers=headers(user_a), timeout=30).status_code, 200)
        check("别的部门看详情 403", session.get(f"{base}/api/bi/semantic/datasets/{dept_ds}",
                                                headers=headers(user_b), timeout=30).status_code, 403)

        # ── 2. 公共数据集（owner 为空）：所有人可见；管理员私有数据集仍不可见 ──
        public_ds = int(db.execute(text(
            "INSERT INTO bi_dataset (name, physical_table, description, owner_id, is_active) "
            "VALUES (:n, 'bi_demo_sku', '', NULL, true) RETURNING id"),
            {"n": DATASET_NAMES[1]}).scalar())
        db.commit()
        check("公共数据集别的部门可见", DATASET_NAMES[1] in dataset_names(user_b), True)
        check("公共数据集别的部门可看详情",
              session.get(f"{base}/api/bi/semantic/datasets/{public_ds}",
                          headers=headers(user_b), timeout=30).status_code, 200)

        r = session.post(f"{base}/api/bi/semantic/datasets", headers=AH, json={
            "name": "QA 私有数据集", "physical_table": "bi_demo_sku",
        }, timeout=30)
        check("建私有数据集", r.status_code, 200)
        private_ds = r.json().get("id")
        DATASET_NAMES.append("QA 私有数据集")
        check("别人的私有数据集列表看不到", "QA 私有数据集" in dataset_names(user_b), False)
        check("别人的私有数据集详情 403",
              session.get(f"{base}/api/bi/semantic/datasets/{private_ds}",
                          headers=headers(user_b), timeout=30).status_code, 403)

        # ── 3. 不能归到范围外的部门 ─────────────────────────────
        r = session.post(f"{base}/api/bi/semantic/datasets", headers=headers(user_b), json={
            "name": "QA 越权归属数据集", "physical_table": "bi_demo_sku", "dept_id": dept_a,
        }, timeout=30)
        check("归到别的部门被拒", r.status_code, 403)
        DATASET_NAMES.append("QA 越权归属数据集")

        # ── 4. 数据源归属部门 + 列表回显 ─────────────────────────
        r = session.post(f"{base}/api/bi/sources", headers=AH, json={
            "name": SOURCE_NAME, "ds_type": "postgresql", "host": "127.0.0.1", "port": 5432,
            "db_name": "nope", "username": "nope", "password": "nope", "dept_id": dept_a,
        }, timeout=30)
        check("建部门数据源", r.status_code, 200)
        check("数据源返回部门名", (r.json() or {}).get("dept_name"), DEPT_NAMES[0])
        listed = session.get(f"{base}/api/bi/sources", headers=AH, timeout=30).json().get("sources", [])
        check("数据源列表带部门", any(s["name"] == SOURCE_NAME and s.get("dept_name") == DEPT_NAMES[0]
                                     for s in listed), True)

        # ── 5. MCP 继承部门归属 ────────────────────────────────
        cl = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                          json={"name": CLIENT_NAME, "description": "归属校验"}, timeout=20).json()
        grant = session.post(f"{base}/api/mcp/grants", headers=headers(user_b),
                             json={"client_id": cl["client_id"]}, timeout=20).json()
        tok = session.post(f"{base}/api/mcp/token", json={
            "client_id": cl["client_id"], "client_secret": cl["secret"],
            "refresh_token": grant["refresh_token"]}, timeout=20).json().get("access_token", "")
        rpc = session.post(f"{base}/api/mcp/rpc", headers={"Authorization": f"Bearer {tok}"},
                           json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": "bi_query_dataset",
                                            "arguments": {"dataset_id": dept_ds}}}, timeout=60)
        check("MCP 取别的部门数据集被拒", rpc.status_code, 403)

        failed = [r for r in results if not r[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n归属部门回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
