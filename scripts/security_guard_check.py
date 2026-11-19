"""安全卫士回归（S7 三期）—— 累计攻击 → 自动封禁 → 人工解封，跑完清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/security_guard_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 同一指纹连续匿名越权 10 次 → 自动封禁 IP + 指纹；
    2. 封禁后请求被 403 拦截（提示「安全卫士」），不再进入业务鉴权；
    3. 普通账号连续越权 → 账号维度封禁；
    4. 管理后台可查看封禁列表并人工解封，解封后恢复正常 403；
    5. guard_block 事件进入操作监控；
    6. 清理本次产生的命中/封禁/安全事件/审计。
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

USER_NAME = "qa_guard_user"
PASSWORD = "Qa123456"
DEVICE_A = "qa-guard-device-a"
DEVICE_B = "qa-guard-device-b"
UA_A = "QA-Guard-Test/1.0"
UA_B = "QA-Guard-User/1.0"
XFF_A = "203.0.113.77"
XFF_B = "203.0.113.78"

START = {"hit": 0, "block": 0, "event": 0, "audit": 0}


def cleanup(db) -> None:
    user_ids = [int(r[0]) for r in db.execute(
        text("SELECT id FROM users WHERE username = :u"), {"u": USER_NAME}
    ).fetchall()]
    if START["hit"]:
        db.execute(text("DELETE FROM bi_guard_hit WHERE id > :m"), {"m": START["hit"]})
    if START["block"]:
        db.execute(text("DELETE FROM bi_security_block WHERE id > :m"), {"m": START["block"]})
    if START["event"]:
        db.execute(text("DELETE FROM bi_security_event WHERE id > :m"), {"m": START["event"]})
    if START["audit"]:
        db.execute(text("DELETE FROM bi_audit_logs WHERE id > :m AND action LIKE 'security.guard.%'"),
                   {"m": START["audit"]})
    if user_ids:
        ph = ", ".join(f":u{i}" for i in range(len(user_ids)))
        params = {f"u{i}": v for i, v in enumerate(user_ids)}
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE user_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM users WHERE id IN ({ph})"), params)
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

    for key, table in (("hit", "bi_guard_hit"), ("block", "bi_security_block"),
                       ("event", "bi_security_event"), ("audit", "bi_audit_logs")):
        START[key] = int(db.execute(text(f"SELECT COALESCE(max(id), 0) FROM {table}")).scalar() or 0)

    session = requests.Session()
    try:
        cleanup(db)
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf}
        guard_info = session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                                 timeout=20).json()
        threshold = int(guard_info["config"]["max_hits"])
        if not guard_info["config"]["enabled"]:
            print("安全卫士当前是关闭状态，请先在「操作监控 → 安全卫士」启用后再跑回归")
            return 1

        # ── 1) 同一指纹连续匿名越权 → 封 IP + 指纹 ─────────────
        scan = {"User-Agent": UA_A, "X-Device-Id": DEVICE_A,
                "X-Forwarded-For": XFF_A, "Accept-Language": "zh-CN"}
        last = None
        for _ in range(threshold):
            last = session.get(f"{base}/api/admin/monitor/summary", headers=scan, timeout=10)
        check("阈值内仍是普通拒绝", last.status_code, 403)
        blocked = session.get(f"{base}/api/admin/monitor/summary", headers=scan, timeout=10)
        check("达到阈值后由安全卫士拦截", "安全卫士" in blocked.text, True)

        guard_info = session.get(f"{base}/api/admin/monitor/guard", headers=AH, timeout=20).json()
        dims = {block["dimension"] for block in guard_info.get("blocks") or []}
        check("已生成 IP 封禁", "ip" in dims, True)
        check("已生成指纹封禁", "fingerprint" in dims, True)

        events = session.get(f"{base}/api/admin/monitor/activity", headers=AH,
                             params={"days": 1, "source": "security", "limit": 100},
                             timeout=30).json().get("items") or []
        check("封禁事件进操作监控",
              any(item["action"] == "guard_block" for item in events), True)

        # ── 2) 普通账号连续越权 → 账号封禁 ────────────────────
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@example.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        ver = int(db.execute(text("SELECT token_version FROM users WHERE id = :i"),
                             {"i": user_id}).scalar() or 0)
        member = {"Authorization": f"Bearer {create_access_token(user_id, ver)}",
                  "User-Agent": UA_B, "X-Device-Id": DEVICE_B,
                  "X-Forwarded-For": XFF_B, "Accept-Language": "zh-CN"}
        for _ in range(threshold):
            session.get(f"{base}/api/admin/monitor/summary", headers=member, timeout=10)
        blocked_user = session.get(f"{base}/api/admin/monitor/summary", headers=member, timeout=10)
        check("账号维度封禁生效", "安全卫士" in blocked_user.text, True)
        user_blocks = [b for b in session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                                              timeout=20).json()["blocks"]
                       if b["dimension"] == "user"]
        check("已生成账号封禁", bool(user_blocks), True)

        # ── 3) 人工解封：恢复为普通 403 ───────────────────────
        for block in session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                                 timeout=20).json()["blocks"]:
            session.delete(f"{base}/api/admin/monitor/guard/blocks/{block['id']}",
                           headers=AH, timeout=20)
        after = session.get(f"{base}/api/admin/monitor/summary", headers=scan, timeout=10)
        check("解封后不再被安全卫士拦截", "安全卫士" in after.text, False)
        check("解封后恢复普通拒绝", after.status_code, 403)
        left = session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                           timeout=20).json()["blocks"]
        check("封禁列表已清空", left, [])

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n安全卫士回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
