"""部门级数据隔离回归（S3）—— 真实物理表 + 真实账号，跑完自动清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/dept_scope_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 按部门：员工只看本部门；主管（本部门及下级）看本部门 + 下级；
    2. 模式 self：列 = 用户 id（用部门列时应当 0 行，证明条件真的注入了）；
    3. 模式 all：不隔离；
    4. fail-closed：账号没有部门 → 403；部门列被删 → 403；
    5. 配置校验：列不存在 → 400；
    6. MCP 继承：同一用户走 MCP 与走 UI 结果一致（数据集规则 + 部门隔离同一条链路）。

临时对象一律 `QA` 前缀，结束全部删除（含物理表 / 数据集 / 部门 / 用户 / 角色 / MCP 客户端）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

TABLE = "bi_src_deptscope_qa"
DATASET_NAME = "QA 部门隔离数据集"
CLIENT_NAME = "QA 部门隔离校验"
PASSWORD = "Qa123456"
USER_NAMES = ["qa_ds_a", "qa_ds_mgr", "qa_ds_b", "qa_ds_none", "qa_ds_mcp"]
ROLE_CODES = ["qa_ds_mcp"]
DEPT_NAMES = ["QA 部门A", "QA 部门B", "QA 部门C"]


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
    db.execute(text("DELETE FROM bi_dataset WHERE name = :n"), {"n": DATASET_NAME})
    db.execute(text(f"DROP TABLE IF EXISTS public.{TABLE}"))
    db.execute(text("DELETE FROM departments WHERE name = ANY(:n) AND COALESCE(is_deleted, false) = false"),
               {"n": DEPT_NAMES})
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

        # ── 造数据：部门 / 物理表 / 数据集 / 账号 ──────────────
        dept_a = int(db.execute(text(
            "INSERT INTO departments (name, is_deleted) VALUES (:n, false) RETURNING id"),
            {"n": DEPT_NAMES[0]}).scalar())
        dept_b = int(db.execute(text(
            "INSERT INTO departments (name, is_deleted) VALUES (:n, false) RETURNING id"),
            {"n": DEPT_NAMES[1]}).scalar())
        dept_c = int(db.execute(text(
            "INSERT INTO departments (name, parent_id, is_deleted) VALUES (:n, :p, false) RETURNING id"),
            {"n": DEPT_NAMES[2], "p": dept_a}).scalar())

        db.execute(text(
            f"CREATE TABLE public.{TABLE} (dept_id integer, name text, amount numeric)"))
        db.execute(text(f"INSERT INTO public.{TABLE} VALUES "
                        "(:a, 'A-1', 10), (:a, 'A-2', 20), (:b, 'B-1', 30), (:c, 'C-1', 40)"),
                   {"a": dept_a, "b": dept_b, "c": dept_c})

        dataset_id = int(db.execute(text(
            "INSERT INTO bi_dataset (name, physical_table, description, owner_id, is_active) "
            "VALUES (:n, :t, '', NULL, true) RETURNING id"),
            {"n": DATASET_NAME, "t": TABLE}).scalar())
        for name, col, role, dtype in (
            ("部门", "dept_id", "dimension", "integer"),
            ("名称", "name", "dimension", "text"),
            ("金额", "amount", "measure", "numeric"),
        ):
            db.execute(text(
                "INSERT INTO bi_dataset_field (dataset_id, name, source_column, role, data_type) "
                "VALUES (:d, :n, :c, :r, :t)"),
                {"d": dataset_id, "n": name, "c": col, "r": role, "t": dtype})

        db.execute(text(
            "INSERT INTO roles (name, code, description, is_system, data_scope) "
            "VALUES ('QA 部门隔离MCP', 'qa_ds_mcp', '临时角色', false, 'dept')"))
        role_id = int(db.execute(text("SELECT id FROM roles WHERE code = 'qa_ds_mcp'")).scalar())
        for perm in ("bi:mcp:use", "bi:nav:datasets"):
            db.execute(text("INSERT INTO role_permission (role_id, permission_code) "
                            "VALUES (:r, :p) ON CONFLICT DO NOTHING"), {"r": role_id, "p": perm})

        def make_user(username: str, role: str, dept: int | None) -> int:
            return int(db.execute(text(
                "INSERT INTO users (username, email, password_hash, role, is_active, "
                "  department_id, approval_status, token_version, created_at) "
                "VALUES (:u, :e, :h, :r, true, :d, 'approved', 0, now()) RETURNING id"),
                {"u": username, "e": f"{username}@example.com", "h": hash_password(PASSWORD),
                 "r": role, "d": dept}).scalar())

        users = {
            "a": make_user("qa_ds_a", "member", dept_a),
            "mgr": make_user("qa_ds_mgr", "manager", dept_a),
            "b": make_user("qa_ds_b", "member", dept_b),
            "none": make_user("qa_ds_none", "member", None),
            "mcp": make_user("qa_ds_mcp", "qa_ds_mcp", dept_a),
        }
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        admin_id, admin_ver = int(admin[0]), int(admin[1] or 0)
        db.commit()

        admin_token = create_access_token(admin_id, admin_ver)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {admin_token}", "X-CSRF-Token": csrf}

        def user_headers(name: str) -> dict:
            version = int(db.execute(text("SELECT token_version FROM users WHERE id = :i"),
                                     {"i": users[name]}).scalar() or 0)
            return {"Authorization": f"Bearer {create_access_token(users[name], version)}",
                    "X-CSRF-Token": csrf}

        payload = {"dimensions": ["名称"], "metrics": ["金额"], "limit": 50}
        query_url = f"{base}/api/bi/semantic/datasets/{dataset_id}/query"

        # ── 配置部门隔离（走真实接口）──────────────────────────
        r = session.put(f"{base}/api/bi/semantic/datasets/{dataset_id}/security/dept-scope",
                        headers=AH, json={"column_name": "部门", "mode": "department"}, timeout=20)
        check("配置部门隔离", r.status_code, 200)

        r = session.put(f"{base}/api/bi/semantic/datasets/{dataset_id}/security/dept-scope",
                        headers=AH, json={"column_name": "不存在的列", "mode": "department"}, timeout=20)
        check("列不存在 → 400", r.status_code, 400)

        def names(name: str) -> list[str]:
            res = session.post(query_url, headers=user_headers(name), json=payload, timeout=60)
            if res.status_code != 200:
                detail = ""
                try:
                    detail = str(res.json().get("detail") or "")[:80]
                except Exception:
                    detail = res.text[:80]
                return [f"HTTP {res.status_code}: {detail}"]
            return sorted(row["名称"] for row in res.json().get("rows", []))

        admin_rows = session.post(query_url, headers=AH, json=payload, timeout=60).json().get("rows", [])
        check("管理员看全量", sorted(row["名称"] for row in admin_rows), ["A-1", "A-2", "B-1", "C-1"])
        check("员工只看本部门", names("a"), ["A-1", "A-2"])
        check("主管看本部门及下级", names("mgr"), ["A-1", "A-2", "C-1"])
        check("别的部门员工只看自己部门", names("b"), ["B-1"])
        check("没部门的账号 → 403", names("none")[0].startswith("HTTP 403"), True)

        # 模式 self：部门列 ≠ 用户 id → 0 行（证明条件真的注入）
        session.put(f"{base}/api/bi/semantic/datasets/{dataset_id}/security/dept-scope",
                    headers=AH, json={"column_name": "部门", "mode": "self"}, timeout=20)
        check("模式 self（用部门列）→ 0 行", names("a"), [])
        session.put(f"{base}/api/bi/semantic/datasets/{dataset_id}/security/dept-scope",
                    headers=AH, json={"column_name": "部门", "mode": "all"}, timeout=20)
        check("模式 all → 不隔离", names("a"), ["A-1", "A-2", "B-1", "C-1"])
        session.put(f"{base}/api/bi/semantic/datasets/{dataset_id}/security/dept-scope",
                    headers=AH, json={"column_name": "部门", "mode": "department"}, timeout=20)

        # fail-closed：部门列被删 → 403（配置失效不放全量）
        db.execute(text("DELETE FROM bi_dataset_field WHERE dataset_id = :d AND source_column = 'dept_id'"),
                   {"d": dataset_id})
        db.commit()
        check("部门列被删 → 403", names("a")[0].startswith("HTTP 403"), True)
        db.execute(text(
            "INSERT INTO bi_dataset_field (dataset_id, name, source_column, role, data_type) "
            "VALUES (:d, '部门', 'dept_id', 'dimension', 'integer')"), {"d": dataset_id})
        db.commit()
        check("恢复部门列 → 员工恢复", names("a"), ["A-1", "A-2"])

        # ── MCP 继承：同一用户 MCP = UI ─────────────────────────
        cl = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                          json={"name": CLIENT_NAME, "description": "部门隔离校验"}, timeout=20).json()
        grant = session.post(f"{base}/api/mcp/grants", headers=user_headers("mcp"),
                             json={"client_id": cl["client_id"]}, timeout=20).json()
        tok = session.post(f"{base}/api/mcp/token", json={
            "client_id": cl["client_id"], "client_secret": cl["secret"],
            "refresh_token": grant["refresh_token"]}, timeout=20).json().get("access_token", "")
        rpc = session.post(f"{base}/api/mcp/rpc",
                           headers={"Authorization": f"Bearer {tok}"},
                           json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": "bi_query_dataset",
                                            "arguments": {"dataset_id": dataset_id, **payload}}},
                           timeout=120)
        mcp_names = sorted(
            row["名称"] for row in json.loads(rpc.json()["result"]["content"][0]["text"])["rows"]
        ) if rpc.status_code == 200 else [f"HTTP {rpc.status_code}"]
        check("MCP 与 UI 的部门范围一致", mcp_names, names("mcp"))

        failed = [r for r in results if not r[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n部门隔离回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
