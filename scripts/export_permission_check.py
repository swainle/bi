"""导出权限开关回归 —— 在「角色与权限」里点开 / 关掉导出，接口立即生效.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/export_permission_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 角色未勾选导出 → 明细导出 403、整页汇总导出 403；
    2. 勾选「明细导出」→ 明细 Excel 200、整页 xlsx 200；汇总导出仍 403；
    3. 勾选「汇总导出」→ HTML/PDF 导出 200；
    4. 再取消两项 → 两个接口恢复 403（开关可反复开关，不需要改代码/重启）；
    5. 管理员角色始终可用；权限变更写 `admin.role.update` 审计。
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.dashboards import repository as dash_repo  # noqa: E402
from app.dashboards.router import _blank_doc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

ROLE_NAME = "QA导出开关"
ROLE_CODE = "qa_export_toggle"
USER = "qa_export_toggle_user"
PASSWORD = "Qa123456"
DETAIL = "bi:data:export:detail"
SUMMARY = "bi:data:export:summary"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    role_id: int | None = None
    user_id: int | None = None
    board_id: int | None = None

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 清理可能残留的同名测试角色 / 账号
        db.execute(text("DELETE FROM users WHERE username = :u"), {"u": USER})
        db.execute(text("DELETE FROM role_permission WHERE role_id IN "
                        "(SELECT id FROM roles WHERE code = :c)"), {"c": ROLE_CODE})
        db.execute(text("DELETE FROM roles WHERE code = :c"), {"c": ROLE_CODE})
        db.commit()

        role_id = int(db.execute(text(
            "INSERT INTO roles (name, code, description, is_system, data_scope, sort_order) "
            "VALUES (:n, :c, '导出开关回归', false, 'self', 98) RETURNING id"),
            {"n": ROLE_NAME, "c": ROLE_CODE}).scalar())
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, :r, true, 'approved', 0, now()) RETURNING id"),
            {"u": USER, "e": f"{USER}@corp.com", "h": hash_password(PASSWORD),
             "r": ROLE_CODE}).scalar())
        db.commit()
        board = dash_repo.create(db, "QA-导出开关看板", None, _blank_doc(), owner_id=user_id)
        board_id = int(board.id)

        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf}
        UH = {"Authorization": f"Bearer {create_access_token(user_id, 0)}",
              "X-CSRF-Token": csrf}

        def patch_role(codes: list[str]) -> int:
            resp = session.patch(f"{base}/api/admin/roles/{role_id}", headers=AH,
                                 json={"permissions": codes}, timeout=20)
            return resp.status_code

        def detail_export() -> requests.Response:
            return session.get(f"{base}/api/bi/engine/export/bi_demo_sku",
                               headers=UH, timeout=60)

        def summary_export(kind: str = "html") -> requests.Response:
            return session.post(f"{base}/api/bi/reports/export/{board_id}",
                                headers=UH, json={"format": kind}, timeout=120)

        # 1) 默认关闭
        me = session.get(f"{base}/api/auth/me", headers=UH, timeout=20).json().get("data") or {}
        perms = set(me.get("effective_permissions") or [])
        check("默认没有导出权限", bool(perms & {DETAIL, SUMMARY}), False)
        check("关闭时明细导出 403", detail_export().status_code, 403)
        check("关闭时汇总导出 403", summary_export("html").status_code, 403)

        # 2) 只开明细
        check("勾选明细导出", patch_role([DETAIL]), 200)
        check("开启后明细导出 200", detail_export().status_code, 200)
        check("开启后整页 xlsx 200", summary_export("xlsx").status_code, 200)
        check("未开汇总仍 403", summary_export("html").status_code, 403)

        # 3) 再开汇总
        check("勾选汇总导出", patch_role([DETAIL, SUMMARY]), 200)
        check("开启后 HTML 导出 200", summary_export("html").status_code, 200)
        check("开启后 PDF 导出 200", summary_export("pdf").status_code, 200)

        # 4) 全部关闭
        check("取消两项导出", patch_role([]), 200)
        check("关闭后明细恢复 403", detail_export().status_code, 403)
        check("关闭后汇总恢复 403", summary_export("html").status_code, 403)

        # 5) 管理员始终可用 + 审计
        admin_export = session.get(f"{base}/api/bi/engine/export/bi_demo_sku",
                                   headers=AH, timeout=60)
        check("管理员不受导出开关影响", admin_export.status_code, 200)
        audit = db.execute(text(
            "SELECT count(*) FROM bi_audit_logs WHERE action = 'admin.role.update' "
            "AND resource_id = :r"), {"r": role_id}).scalar() or 0
        check("权限变更写审计", int(audit) >= 3, True)
    finally:
        try:
            if board_id:
                dash_repo.soft_delete(db, board_id)
            if user_id:
                db.execute(text("DELETE FROM users WHERE id = :i"), {"i": user_id})
            if role_id:
                db.execute(text("DELETE FROM role_permission WHERE role_id = :i"), {"i": role_id})
                db.execute(text("DELETE FROM roles WHERE id = :i"), {"i": role_id})
                db.execute(text("DELETE FROM bi_audit_logs WHERE action = 'admin.role.update' "
                                "AND resource_id = :i"), {"i": role_id})
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print("清理测试数据失败：", exc)
        db.close()

    passed = sum(1 for ok, _, _ in results if ok)
    for ok, label, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}  ({detail})")
    print(f"\n{passed}/{len(results)} 通过")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
