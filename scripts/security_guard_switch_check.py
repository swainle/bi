"""安全卫士开关回归（管理员可启停）—— 跑完恢复原状态并清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/security_guard_switch_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 普通成员不能切换安全卫士（403）；
    2. 管理员关闭后，攻击请求不被拦截、也不计数；
    3. 管理员重新开启后，达到阈值恢复自动封禁；
    4. 启停动作写入审计（security.guard.toggle）；
    5. 脚本结束恢复原始开关并清理测试数据。
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

USER_NAME = "qa_guard_switch_user"
PASSWORD = "Qa123456"
XFF_OFF = "203.0.113.91"
XFF_ON = "203.0.113.92"
UA_OFF = "QA-Guard-Switch-Off/1.0"
UA_ON = "QA-Guard-Switch-On/1.0"
DEV_OFF = "qa-guard-switch-off"
DEV_ON = "qa-guard-switch-on"

START = {"hit": 0, "block": 0, "event": 0, "audit": 0}


def cleanup(db) -> None:
    user_ids = [int(r[0]) for r in db.execute(
        text("SELECT id FROM users WHERE username = :u"), {"u": USER_NAME}
    ).fetchall()]
    db.execute(text("DELETE FROM bi_guard_hit WHERE ip IN (:a, :b)"), {"a": XFF_OFF, "b": XFF_ON})
    db.execute(text("DELETE FROM bi_security_event WHERE ip IN (:a, :b)"), {"a": XFF_OFF, "b": XFF_ON})
    db.execute(text("DELETE FROM bi_security_block WHERE value IN (:a, :b)"), {"a": XFF_OFF, "b": XFF_ON})
    if START["block"]:
        db.execute(text("DELETE FROM bi_security_block WHERE id > :m"), {"m": START["block"]})
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
    original: bool | None = None
    try:
        cleanup(db)
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 上一轮若刚跑完限流脚本，本机写请求会处于 60s 冷却；先探一下
        probe = session.post(f"{base}/api/bi/query/run", json={}, timeout=10)
        if probe.status_code == 429:
            print("本机写请求仍在限流窗口内，等待 65 秒后继续…")
            time.sleep(65)

        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf,
              "User-Agent": "QA-Guard-Switch-Admin/1.0", "X-Device-Id": "qa-guard-switch-admin"}

        info = session.get(f"{base}/api/admin/monitor/guard", headers=AH, timeout=20).json()
        original = bool(info["config"]["enabled"])
        threshold = int(info["config"]["max_hits"])

        # 普通成员：不能切换
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@example.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        member = {"Authorization": f"Bearer {create_access_token(user_id, 0)}",
                  "X-CSRF-Token": csrf, "User-Agent": "QA-Guard-Switch-Member/1.0"}
        denied = session.put(f"{base}/api/admin/monitor/guard/config", headers=member,
                             json={"enabled": False}, timeout=20)
        check("普通成员不能切换安全卫士", denied.status_code, 403)

        # 关闭：攻击不拦截、不计数
        off = session.put(f"{base}/api/admin/monitor/guard/config", headers=AH,
                          json={"enabled": False}, timeout=20)
        check("管理员关闭生效", bool(off.json()["config"]["enabled"]), False)

        scan_off = {"User-Agent": UA_OFF, "X-Device-Id": DEV_OFF,
                    "X-Forwarded-For": XFF_OFF, "Accept-Language": "zh-CN"}
        last = None
        for _ in range(threshold + 1):
            last = session.get(f"{base}/api/admin/monitor/summary", headers=scan_off, timeout=10)
        check("关闭期间不被拦截", "安全卫士" in last.text, False)
        hits_off = int(db.execute(
            text("SELECT count(*) FROM bi_guard_hit WHERE ip = :ip"), {"ip": XFF_OFF}
        ).scalar() or 0)
        check("关闭期间不计数", hits_off, 0)

        # 开启：达到阈值恢复封禁
        on = session.put(f"{base}/api/admin/monitor/guard/config", headers=AH,
                         json={"enabled": True}, timeout=20)
        check("管理员开启生效", bool(on.json()["config"]["enabled"]), True)

        scan_on = {"User-Agent": UA_ON, "X-Device-Id": DEV_ON,
                   "X-Forwarded-For": XFF_ON, "Accept-Language": "zh-CN"}
        for _ in range(threshold):
            session.get(f"{base}/api/admin/monitor/summary", headers=scan_on, timeout=10)
        blocked = session.get(f"{base}/api/admin/monitor/summary", headers=scan_on, timeout=10)
        check("开启后恢复自动拦截", "安全卫士" in blocked.text, True)

        blocks = session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                             timeout=20).json()["blocks"]
        check("开启后生成封禁", any(b["value"] == XFF_ON for b in blocks), True)

        toggles = int(db.execute(
            text("SELECT count(*) FROM bi_audit_logs WHERE action = 'security.guard.toggle' AND id > :m"),
            {"m": START["audit"]},
        ).scalar() or 0)
        check("启停动作写入审计", toggles >= 2, True)

        # 恢复原始状态
        restored = session.put(f"{base}/api/admin/monitor/guard/config", headers=AH,
                               json={"enabled": original}, timeout=20)
        check("恢复原始开关", bool(restored.json()["config"]["enabled"]), original)

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n安全卫士开关回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        try:
            if original is not None:
                session.put(f"{base}/api/admin/monitor/guard/config",
                            headers={"Authorization": AH["Authorization"], "X-CSRF-Token": csrf},
                            json={"enabled": original}, timeout=20)
        except Exception:
            # 限流窗口内 PUT 会 429：直接写库兜底，绝不把卫士留在关闭状态
            try:
                if original is not None:
                    db.execute(text(
                        "INSERT INTO bi_app_setting (key, value, updated_at) "
                        "VALUES ('security.guard.enabled', :v, now()) "
                        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"),
                        {"v": "1" if original else "0"})
                    db.commit()
            except Exception:
                pass
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
