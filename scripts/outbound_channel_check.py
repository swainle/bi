"""外发通道管控回归（R2）—— 邮件域名 / Webhook 白名单 / SSRF / 审计.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/outbound_channel_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 普通成员邮件只能发自己域名，外部邮箱 403；
    2. 普通成员 Webhook 需域名白名单，否则 403；
    3. 管理员可以配外部邮箱，但内网 / 回环 / 元数据地址一律 400；
    4. 外发配置写审计（report.subscription.outbound）；
    5. 跑完清理订阅 / 看板 / 测试账号 / 审计。
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

from app.dashboards import repository as dash_repo  # noqa: E402
from app.dashboards.router import _blank_doc  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

USER_NAME = "qa_outbound_member"
PASSWORD = "Qa123456"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    dash_id: int | None = None
    user_id: int | None = None
    sub_ids: list[int] = []
    audit_start = int(db.execute(text("SELECT COALESCE(max(id), 0) FROM bi_audit_logs")).scalar() or 0)

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        probe = session.post(f"{base}/api/bi/query/run", json={}, timeout=10)
        if probe.status_code == 429:
            print("本机写请求仍在限流窗口内，等待 65 秒后继续…")
            time.sleep(65)

        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@corp.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        dash = dash_repo.create(db, "QA-外发通道回归", None, _blank_doc(), owner_id=user_id)
        dash_id = int(dash.id)

        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf}
        MH = {"Authorization": f"Bearer {create_access_token(user_id, 0)}",
              "X-CSRF-Token": csrf}

        def subscribe(headers: dict, channel: str, extra: dict) -> requests.Response:
            body = {"dashboard_id": dash_id, "name": "R2 回归", "frequency": "daily",
                    "send_time": "09:00", "channel": channel, **extra}
            resp = session.post(f"{base}/api/bi/reports/subscriptions", headers=headers,
                                json=body, timeout=30)
            if resp.status_code == 200:
                sub_ids.append(int((resp.json() or {}).get("id") or 0))
            return resp

        check("成员外部邮箱被拒",
              subscribe(MH, "email", {"email_to": "attacker@evil.test"}).status_code, 403)
        check("成员本公司邮箱可用",
              subscribe(MH, "email", {"email_to": f"{USER_NAME}@corp.com"}).status_code, 200)
        check("成员外部 Webhook 被拒",
              subscribe(MH, "webhook", {"webhook_url": "https://hooks.example.com/x"}).status_code, 403)
        check("管理员可配外部邮箱",
              subscribe(AH, "email", {"email_to": "boss@partner.test"}).status_code, 200)
        check("管理员也不能访问云元数据",
              subscribe(AH, "webhook",
                        {"webhook_url": "http://169.254.169.254/latest/meta-data"}).status_code, 400)
        check("管理员也不能访问回环地址",
              subscribe(AH, "webhook",
                        {"webhook_url": "http://127.0.0.1:9/hook"}).status_code, 400)

        audits = int(db.execute(text(
            "SELECT count(*) FROM bi_audit_logs "
            "WHERE action = 'report.subscription.outbound' AND user_id = :u"),
            {"u": user_id}).scalar() or 0)
        check("外发配置写入审计", audits >= 1, True)

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n外发通道回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        if sub_ids:
            ph = ", ".join(f":s{i}" for i in range(len(sub_ids)))
            db.execute(text(f"DELETE FROM bi_report_subscription WHERE id IN ({ph})"),
                       {f"s{i}": v for i, v in enumerate(sub_ids)})
        if dash_id:
            db.execute(text("DELETE FROM bi_report_subscription WHERE dashboard_id = :d"),
                       {"d": dash_id})
            db.execute(text("DELETE FROM bi_canvas WHERE id = :d"), {"d": dash_id})
        if user_id:
            db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :u"), {"u": user_id})
            db.execute(text("DELETE FROM users WHERE id = :u"), {"u": user_id})
        db.execute(text(
            "DELETE FROM bi_audit_logs WHERE id > :m AND action IN "
            "('report.subscription.outbound','alert.rule.outbound')"), {"m": audit_start})
        db.commit()
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
