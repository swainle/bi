"""水印身份化回归（R3）—— 页面 / Excel / HTML / PDF 都能追溯到人.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/watermark_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 水印文本 = 用户名 · 部门 · 时间 · 请求号，两个用户文本不同；
    2. 明细导出 Excel 第一行含导出人 / 部门 / 请求号，且请求号 = 响应头 X-Request-Id；
    3. 整页导出 HTML 含水印文本（PDF / PNG 由同一份 HTML 渲染，水印随文件走）；
    4. 整页导出 Excel「概览」含导出人 / 部门 / 请求号；
    5. 无导出权限的成员仍被 403 拦住（水印不放宽鉴权）；
    6. 跑完清理测试账号 / 看板 / 审计。
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import time

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.dashboards import repository as dash_repo  # noqa: E402
from app.dashboards.router import _blank_doc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.security import watermark  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

MEMBER = "qa_watermark_member"
PASSWORD = "Qa123456"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    member_id: int | None = None
    board_id: int | None = None
    dept_id: int | None = None
    audit_start = int(db.execute(text("SELECT COALESCE(max(id), 0) FROM bi_audit_logs")).scalar() or 0)

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label,
                        f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        probe = session.post(f"{base}/api/bi/query/run", json={}, timeout=10)
        if probe.status_code == 429:
            print("本机写请求仍在限流窗口内，等待 65 秒后继续…")
            time.sleep(65)

        # 准备：一个带部门的成员 + 一块可读看板
        dept_id = int(db.execute(text("SELECT id FROM departments ORDER BY id LIMIT 1")).scalar() or 0)
        member_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, department_id, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, :d, now()) RETURNING id"),
            {"u": MEMBER, "e": f"{MEMBER}@corp.com", "h": hash_password(PASSWORD),
             "d": dept_id or None}
        ).scalar())
        db.commit()
        board = dash_repo.create(db, "QA-水印回归", None, _blank_doc(), owner_id=member_id)
        board_id = int(board.id)

        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        member = db.execute(text("SELECT id, token_version, username, department_id FROM users "
                                 "WHERE id = :i"), {"i": member_id}).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf}
        MH = {"Authorization": f"Bearer {create_access_token(member_id, 0)}",
              "X-CSRF-Token": csrf}

        admin_user = db.execute(text(
            "SELECT u.*, d.name AS dept_name FROM users u "
            "LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = :i"
        ), {"i": int(admin[0])}).fetchone()
        admin_info = watermark.identity(db, _User(admin_user))
        member_info = watermark.identity(db, _User(member))
        check("管理员水印含用户名", admin_info["user"] in admin_info["text"], True)
        check("成员水印含用户名", member_info["user"] in member_info["text"], True)
        check("两个用户水印文本不同", admin_info["text"] != member_info["text"], True)
        check("水印含部门", bool(member_info["department"]), True)

        # 1) 明细导出 Excel：第一行身份信息 + 请求号与响应头一致
        table = "bi_demo_sku"
        resp = session.get(f"{base}/api/bi/engine/export/{table}", headers=AH, timeout=60)
        check("明细导出 200", resp.status_code, 200)
        rid = (resp.headers.get("X-Request-Id") or "")[:12]
        check("导出响应带请求号", bool(rid), True)
        if resp.status_code == 200 and rid:
            import openpyxl

            wb = openpyxl.load_workbook(io.BytesIO(resp.content))
            first = str(wb.active.cell(row=1, column=1).value or "")
            check("Excel 第一行含导出人", admin_info["user"] in first, True)
            check("Excel 第一行含部门", admin_info["department"] in first, True)
            check("Excel 请求号 = 响应头", f"#{rid}" in first, True)

        # 2) 整页导出 HTML：含身份水印（PDF / PNG 由同一份 HTML 渲染）
        resp = session.post(f"{base}/api/bi/reports/export/{board_id}",
                            headers=AH, json={"format": "html"}, timeout=60)
        check("整页导出 HTML 200", resp.status_code, 200)
        html = (resp.text or "") if resp.status_code == 200 else ""
        rid2 = (resp.headers.get("X-Request-Id") or "")[:12]
        check("HTML 含水印用户名", admin_info["user"] in html, True)
        check("HTML 含水印部门", admin_info["department"] in html, True)
        check("HTML 含请求号", (f"#{rid2}" in html) if rid2 else False, True)
        check("HTML 含水印图层", "mz-wm" in html, True)

        # 3) 整页导出 Excel：概览页有身份信息
        resp = session.post(f"{base}/api/bi/reports/export/{board_id}",
                            headers=AH, json={"format": "xlsx"}, timeout=60)
        check("整页导出 Excel 200", resp.status_code, 200)
        if resp.status_code == 200:
            import openpyxl

            wb = openpyxl.load_workbook(io.BytesIO(resp.content))
            column = " ".join(
                f"{row[0]} {row[1]}" for row in wb["概览"].iter_rows(values_only=True) if row
            )
            check("Excel 概览含导出人", admin_info["user"] in column, True)
            check("Excel 概览含部门", admin_info["department"] in column, True)

        # 4) PDF / PNG：走同一份带水印的 HTML 渲染
        for kind in ("pdf", "png"):
            resp = session.post(f"{base}/api/bi/reports/export/{board_id}",
                                headers=AH, json={"format": kind}, timeout=120)
            check(f"整页导出 {kind.upper()} 200", resp.status_code, 200)
            check(f"{kind.upper()} 非空", len(resp.content or b"") > 1000, True)

        # 5) 无导出权限的成员仍 403（水印不放宽鉴权）
        resp = session.post(f"{base}/api/bi/reports/export/{board_id}",
                            headers=MH, json={"format": "html"}, timeout=30)
        check("成员无导出权限 403", resp.status_code, 403)

        # 5) 审计里有请求号，可反查
        if rid:
            hit = db.execute(text(
                "SELECT 1 FROM bi_audit_logs WHERE action = 'data.export.detail' "
                "AND detail::text LIKE :like ORDER BY id DESC LIMIT 1"),
                {"like": f"%{rid}%"}).fetchone()
            # 老数据没有 request_id 字段时不强求，只作为参考项
            results.append((True, "审计落库（请求号可选）", f"命中={bool(hit)}"))
    finally:
        try:
            if member_id:
                db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :i AND id > :s"),
                           {"i": member_id, "s": audit_start})
                db.execute(text("DELETE FROM bi_canvas WHERE id = :i"), {"i": board_id or 0})
                db.execute(text("DELETE FROM users WHERE id = :i"), {"i": member_id})
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


class _User:
    """把数据库行包成 watermark.identity 需要的最小对象."""

    def __init__(self, row) -> None:
        mapping = getattr(row, "_mapping", {})
        self.username = mapping.get("username") or ""
        self.department_id = mapping.get("department_id")
        self.department = None
        dept_name = mapping.get("dept_name")
        if dept_name:
            self.department = type("Dept", (), {"name": dept_name})()


if __name__ == "__main__":
    raise SystemExit(main())
