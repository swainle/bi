"""物理表 RLS 兜底回归（S6）—— 直连绕过应用也拦跨部门数据，跑完自动清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/rls_backstop_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 配置部门规则后物理表自动出现策略（RLS + FORCE + mcbi_dept_scope）；
    2. 直连只读角色：不设会话变量 → 0 行（fail-closed）；
       部门 A → 本部门；A+C → 含下级；data_scope=all → 全量；self → 按用户 id；
    3. 策略被删但 RLS 还开着 → 0 行（数据库默认拒绝），随后可自愈恢复；
    4. 应用链路与 S3 结果一致（同一表达式、同一份规则）；
    5. 配置失败（视图建不了策略）→ 规则回滚 + 安全审计告警。

临时对象一律 QA 前缀，结束全部删除（表 / 视图 / 数据集 / 部门 / 用户 / 角色 / 审计）。
"""

from __future__ import annotations

import argparse
import os
import sys

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal, engine  # noqa: E402
from app.models.user import User  # noqa: E402
from app.query.executor import run as execute_query  # noqa: E402
from app.query.whitelist import ALLOWED_TABLES  # noqa: E402
from app.security import dept_scope, rls_backstop  # noqa: E402
from app.semantic.compiler import compile_query  # noqa: E402
from app.semantic.repository import get_dataset  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

TABLE = "bi_src_rls_qa"
VIEW = "bi_src_rls_qa_view"
DATASET_NAME = "QA RLS 兜底数据集"
VIEW_DATASET_NAME = "QA RLS 视图数据集"
ROLE_CODE = "qa_rls_dept"
USER_NAME = "qa_rls_user"
PASSWORD = "Qa123456"
DEPT_NAMES = ["QA RLS 部门A", "QA RLS 部门B", "QA RLS 部门C"]
ALL_VARS = ("app.rls_enforced", "app.data_scope", "app.dept_ids", "app.user_id", "app.dept_id")


def cleanup(db) -> None:
    datasets = [int(r[0]) for r in db.execute(
        text("SELECT id FROM bi_dataset WHERE name IN (:a, :b)"),
        {"a": DATASET_NAME, "b": VIEW_DATASET_NAME},
    ).fetchall()]
    if datasets:
        ph = ", ".join(f":d{i}" for i in range(len(datasets)))
        params = {f"d{i}": v for i, v in enumerate(datasets)}
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE resource_type = 'dataset' "
                        f"AND resource_id IN ({ph}) AND action LIKE 'security.rls.%'"), params)
        db.execute(text(f"DELETE FROM bi_dataset_scope_rule WHERE dataset_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM bi_dataset WHERE id IN ({ph})"), params)
    db.execute(text(f"DROP VIEW IF EXISTS public.{VIEW}"))
    db.execute(text(f"DROP TABLE IF EXISTS public.{TABLE}"))
    db.execute(text("DELETE FROM users WHERE username = :u"), {"u": USER_NAME})
    db.execute(text("DELETE FROM roles WHERE code = :c"), {"c": ROLE_CODE})
    db.execute(text("DELETE FROM departments WHERE name = ANY(:n)"), {"n": DEPT_NAMES})
    db.commit()


def direct_rows(settings: dict | None) -> list[str]:
    """以只读角色直连（SET ROLE），读物理表；settings = 应用会写入的会话变量."""
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            conn.execute(text(f"SET LOCAL ROLE {rls_backstop.ROLE}"))
            for key in ALL_VARS:
                conn.execute(text("SELECT set_config(:k, :v, true)"),
                             {"k": key, "v": ""})
            for key, value in (settings or {}).items():
                conn.execute(text("SELECT set_config(:k, :v, true)"),
                             {"k": key, "v": str(value)})
            rows = conn.execute(text(f"SELECT name FROM public.{TABLE} ORDER BY name")).fetchall()
            return sorted(str(row[0]) for row in rows)
        finally:
            trans.rollback()


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
        check("只读角色可用", rls_backstop.ensure_role(db), True)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")

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

        db.execute(text(f"CREATE TABLE public.{TABLE} (dept_id integer, name text, amount numeric)"))
        db.execute(text(f"INSERT INTO public.{TABLE} VALUES "
                        "(:a, 'A-1', 10), (:a, 'A-2', 20), (:b, 'B-1', 30), (:c, 'C-1', 40)"),
                   {"a": dept_a, "b": dept_b, "c": dept_c})

        dataset_id = int(db.execute(text(
            "INSERT INTO bi_dataset (name, physical_table, description, owner_id, is_active) "
            "VALUES (:n, :t, '', NULL, true) RETURNING id"),
            {"n": DATASET_NAME, "t": TABLE}).scalar())
        for name, col, role, dtype in (("部门", "dept_id", "dimension", "integer"),
                                       ("名称", "name", "dimension", "text"),
                                       ("金额", "amount", "measure", "numeric")):
            db.execute(text(
                "INSERT INTO bi_dataset_field (dataset_id, name, source_column, role, data_type) "
                "VALUES (:d, :n, :c, :r, :t)"),
                {"d": dataset_id, "n": name, "c": col, "r": role, "t": dtype})

        db.execute(text(
            "INSERT INTO roles (name, code, description, is_system, data_scope) "
            "VALUES ('QA RLS 部门角色', :c, '临时角色', false, 'dept')"), {"c": ROLE_CODE})
        role_id = int(db.execute(text("SELECT id FROM roles WHERE code = :c"),
                                 {"c": ROLE_CODE}).scalar())
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  department_id, approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, :r, true, :d, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@example.com", "h": hash_password(PASSWORD),
             "r": ROLE_CODE, "d": dept_a}).scalar())
        db.commit()

        # ── 1) 配规则 → 策略自动出现 ─────────────────────────
        rule = dept_scope.set_rule(db, dataset_id, column_name="部门", mode="department")
        check("规则已保存", rule.get("mode"), "department")
        check("物理表策略已建立", rls_backstop.policy_status(db, TABLE), True)

        # ── 2) 直连只读角色：跨部门被拦 ──────────────────────
        check("直连未设变量 → 0 行（fail-closed）", direct_rows(None), [])
        check("直连部门A → 本部门", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "dept",
            "app.dept_ids": str(dept_a), "app.user_id": str(user_id),
        }), ["A-1", "A-2"])
        check("直连部门A+下级C", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "dept",
            "app.dept_ids": f"{dept_a},{dept_c}", "app.user_id": str(user_id),
        }), ["A-1", "A-2", "C-1"])
        check("直连 data_scope=all → 全量", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "all",
            "app.dept_ids": "", "app.user_id": str(user_id),
        }), ["A-1", "A-2", "B-1", "C-1"])

        # self 模式：列 = 用户 id
        dept_scope.set_rule(db, dataset_id, column_name="部门", mode="self")
        check("直连 self → 只留 user_id 命中的行", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "dept",
            "app.dept_ids": "", "app.user_id": str(dept_b),
        }), ["B-1"])
        dept_scope.set_rule(db, dataset_id, column_name="部门", mode="department")

        # ── 3) 策略被删但 RLS 还开着 → 默认拒绝；自愈后恢复 ──
        db.execute(text(f"DROP POLICY {rls_backstop.POLICY} ON public.{TABLE}"))
        db.commit()
        check("策略缺失 → 0 行（数据库默认拒绝）", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "dept",
            "app.dept_ids": str(dept_a), "app.user_id": str(user_id),
        }), [])
        check("策略可自愈重建", rls_backstop.sync_policy(db, dataset_id), True)
        check("自愈后恢复本部门", direct_rows({
            "app.rls_enforced": "1", "app.data_scope": "dept",
            "app.dept_ids": str(dept_a), "app.user_id": str(user_id),
        }), ["A-1", "A-2"])

        # ── 4) 应用链路与 S3 一致（ABAC + RLS 同一份规则）──────
        db2 = SessionLocal()
        with rls_backstop.read_role(db2):
            who = db2.execute(text("SELECT current_user")).scalar()
        db2.close()
        if os.getenv("BI_RLS_APP_ROLE"):
            check("应用数据查询可切只读角色", who, rls_backstop.ROLE)

        token = create_access_token(user_id, 0)
        res = session.post(f"{base}/api/bi/semantic/datasets/{dataset_id}/query",
                           headers={"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf},
                           json={"dimensions": ["名称"], "metrics": ["金额"], "limit": 50},
                           timeout=60)
        api_names = sorted(str(row["名称"]) for row in res.json().get("rows", [])) if res.status_code == 200 else []
        if res.status_code != 200:
            print(f"  [debug] 应用查询 HTTP {res.status_code}：{res.text[:200]}")
        check("应用查询与直连 RLS 结果一致", api_names, ["A-1", "A-2"])

        # 直接走执行器（可选：BI_RLS_APP_ROLE 打开时，数据查询真的以只读角色执行）
        old_role = os.getenv("BI_RLS_APP_ROLE")
        os.environ["BI_RLS_APP_ROLE"] = rls_backstop.ROLE
        try:
            dataset = get_dataset(db, dataset_id)
            user = db.query(User).filter(User.id == user_id).first()
            query = compile_query(dataset, {"dimensions": ["名称"], "metrics": ["金额"], "limit": 50})
            result = execute_query(db, query, user, allowed_tables=ALLOWED_TABLES,
                                   dataset_id=dataset_id)
            check("执行器在只读角色下结果不变",
                  sorted(str(row["名称"]) for row in result.rows), ["A-1", "A-2"])
        finally:
            if old_role is None:
                os.environ.pop("BI_RLS_APP_ROLE", None)
            else:
                os.environ["BI_RLS_APP_ROLE"] = old_role

        # ── 5) 配置失败 → 规则回滚 + 安全审计告警 ──────────────
        db.execute(text(f"CREATE VIEW public.{VIEW} AS SELECT * FROM public.{TABLE}"))
        view_dataset = int(db.execute(text(
            "INSERT INTO bi_dataset (name, physical_table, description, owner_id, is_active) "
            "VALUES (:n, :t, '', NULL, true) RETURNING id"),
            {"n": VIEW_DATASET_NAME, "t": VIEW}).scalar())
        db.execute(text(
            "INSERT INTO bi_dataset_field (dataset_id, name, source_column, role, data_type) "
            "VALUES (:d, '部门', 'dept_id', 'dimension', 'integer')"), {"d": view_dataset})
        db.commit()
        rejected = False
        try:
            dept_scope.set_rule(db, view_dataset, column_name="部门", mode="department")
        except dept_scope.DeptScopeError:
            rejected = True
        check("视图建不了策略 → 规则被拒", rejected, True)
        check("规则已回滚", dept_scope.get_rule(db, view_dataset), None)
        alerts = int(db.execute(text(
            "SELECT count(*) FROM bi_audit_logs WHERE action = 'security.rls.sync_failed' "
            "AND resource_type = 'dataset' AND resource_id = :i"), {"i": view_dataset}).scalar() or 0)
        check("失败写安全审计告警", alerts > 0, True)

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\nRLS 兜底回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
