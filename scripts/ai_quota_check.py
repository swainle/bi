"""AI 成本配额回归（R14）—— 每用户每日调用 / token 预算.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/ai_quota_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 调用 AI 接口后 `bi_ai_usage` 有当日用量；
    2. 把每日调用上限调到 1，第二次调用 429，并写 `ai.quota.blocked` 审计；
    3. 恢复配置后清理测试用量。
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

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    user_id: int | None = None
    audit_start = int(db.execute(text("SELECT COALESCE(max(id), 0) FROM bi_audit_logs")).scalar() or 0)

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'admin', true, 'approved', 0, now()) RETURNING id"),
            {"u": f"qa_quota_{uuid.uuid4().hex[:6]}",
             "e": f"qa_quota_{uuid.uuid4().hex[:6]}@corp.com",
             "h": "x"}
        ).scalar())
        db.commit()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(user_id, 0)}",
              "X-CSRF-Token": csrf}

        first = session.post(f"{base}/api/bi/engine/ai/analyze", headers=AH,
                             json={"prompt": "用一句话说明 BI 的价值"}, timeout=60)
        check("AI 调用不被额度阻断", first.status_code, 200)
        row = db.execute(text("SELECT calls FROM bi_ai_usage WHERE user_id = :u "
                              "AND day = CURRENT_DATE"), {"u": user_id}).fetchone()
        check("写当日用量", bool(row and int(row[0]) >= 1), True)
    finally:
        try:
            if user_id:
                db.execute(text("DELETE FROM bi_ai_usage WHERE user_id = :i"), {"i": user_id})
                db.execute(text("DELETE FROM bi_security_event WHERE user_id = :i"),
                           {"i": user_id})
                db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :i AND id > :s"),
                           {"i": user_id, "s": audit_start})
                db.execute(text("DELETE FROM users WHERE id = :i"), {"i": user_id})
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print("清理测试数据失败：", exc)
        db.close()

    # 单元级：上限 1 时第二次必 429（脚本进程内改环境变量）
    os.environ["BI_AI_DAILY_CALLS"] = "1"
    from fastapi import HTTPException

    from app.services import ai_quota

    db2 = SessionLocal()
    try:
        admin_id = int(db2.execute(text("SELECT id FROM users WHERE role = 'admin' "
                                        "ORDER BY id LIMIT 1")).scalar() or 0)
        marker = int(db2.execute(text("SELECT COALESCE(max(id), 0) FROM bi_audit_logs")
                                 ).scalar() or 0)
        test_id = admin_id
        db2.execute(text("DELETE FROM bi_ai_usage WHERE user_id = :u"), {"u": test_id})
        db2.commit()
        ai_quota.reserve(test_id)
        try:
            ai_quota.reserve(test_id)
            check("超限抛 429", False, True)
        except HTTPException as exc:
            check("超限抛 429", exc.status_code, 429)
        blocked = db2.execute(text(
            "SELECT count(*) FROM bi_audit_logs WHERE action = 'ai.quota.blocked' "
            "AND user_id = :u AND id > :s"), {"u": test_id, "s": marker}).scalar() or 0
        check("超限写审计", int(blocked) >= 1, True)
        db2.execute(text("DELETE FROM bi_ai_usage WHERE user_id = :u"), {"u": test_id})
        db2.execute(text("DELETE FROM bi_audit_logs WHERE action = 'ai.quota.blocked' "
                         "AND user_id = :u AND id > :s"), {"u": test_id, "s": marker})
        db2.execute(text("DELETE FROM bi_security_event WHERE event_type = 'ai_quota_exceeded' "
                         "AND user_id = :u"), {"u": test_id})
        db2.commit()
    finally:
        db2.close()

    passed = sum(1 for ok, _, _ in results if ok)
    for ok, label, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}  ({detail})")
    print(f"\n{passed}/{len(results)} 通过")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
