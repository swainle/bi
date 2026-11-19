"""安全卫士 v2 回归（R4）—— 组合风控 / 白名单分级 / 业务高频只告警.

用法（后端 :8300 在跑；本脚本需要「非工作时段」才能触发组合规则，
启动后端时加 `BI_GUARD_WORK_HOURS=25-24`，或在北京时间 20:00–08:00 之间跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/security_guard_v2_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 白名单分级：内网 CIDR 只豁免频率风控；公网 IP 正常参与判定；
    2. 业务高频（查询 / 导出）只写告警事件，绝不封禁；
    3. 组合规则 1：陌生指纹 + 非工作时段 + 明细导出 → 默认只告警；打开阻断后 403；
       内网白名单 IP 不受组合规则影响；
    4. 组合规则 2：伪造令牌 + 反复跨部门探测 → 直接阻断（不依赖 10 次阈值）；
    5. 跑完清理测试账号 / 封禁 / 安全事件 / 命中计数。
"""

from __future__ import annotations

import argparse
import os
import sys
import time
import uuid

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.security import guard  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

MEMBER = "qa_guard_v2_member"
PASSWORD = "Qa123456"
EXTERNAL_IP = "203.0.113.10"
INTERNAL_IP = "10.1.2.3"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    member_id: int | None = None
    fp_used = ""
    event_start = int(db.execute(text("SELECT COALESCE(max(id), 0) FROM bi_security_event")).scalar() or 0)
    old_enabled = db.execute(text(
        "SELECT value FROM bi_app_setting WHERE key = 'security.guard.enabled'")).scalar()

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        # 确保卫士开启（回归结束后恢复原状态）
        db.execute(text(
            "INSERT INTO bi_app_setting (key, value, updated_at) "
            "VALUES ('security.guard.enabled', '1', now()) "
            "ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = now()"))
        db.commit()
        time.sleep(6)  # 卫士开关有 5 秒进程内缓存

        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 1) 白名单分级
        check("内网 CIDR 豁免频率风控", guard.is_frequency_whitelisted(INTERNAL_IP), True)
        check("公网 IP 不豁免", guard.is_frequency_whitelisted(EXTERNAL_IP), False)

        # 2) 业务高频只告警
        guard.observe_business("qa_business", ip=EXTERNAL_IP, fp="qa-business-fp", user_id=1)
        for _ in range(70):
            guard.observe_business("qa_business", ip=EXTERNAL_IP, fp="qa-business-fp", user_id=1)
        alert = db.execute(text(
            "SELECT count(*) FROM bi_security_event WHERE id > :s "
            "AND event_type = 'business_high_frequency'"), {"s": event_start}).scalar() or 0
        check("业务高频写告警", int(alert) >= 1, True)
        check("业务高频不封禁", guard.is_blocked(ip=EXTERNAL_IP, fp="qa-business-fp", user_id=1), None)

        # 准备：临时角色（有导出权限，但不是管理员，组合规则才会真的阻断）
        role_row = db.execute(text(
            "INSERT INTO roles (name, code, description, is_system, data_scope, sort_order) "
            "VALUES ('QA导出角色', 'qa_export', '', false, 'self', 99) RETURNING id"
        )).fetchone()
        role_id = int(role_row[0])
        for code in ("bi:data:export:detail", "bi:data:export:summary", "bi:nav:datasets"):
            db.execute(text("INSERT INTO role_permission (role_id, permission_code) "
                            "VALUES (:r, :c) ON CONFLICT DO NOTHING"), {"r": role_id, "c": code})
        member_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'qa_export', true, 'approved', 0, now()) RETURNING id"),
            {"u": MEMBER, "e": f"{MEMBER}@corp.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        admin_h = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
                   "X-CSRF-Token": session.get(f"{base}/api/auth/csrf-token",
                                               timeout=10).json().get("csrf_token", "")}
        member_h = {"Authorization": f"Bearer {create_access_token(member_id, 0)}",
                    "X-CSRF-Token": admin_h["X-CSRF-Token"]}

        def with_identity(headers: dict, ip: str, tag: str) -> dict:
            return {**headers, "X-Forwarded-For": ip, "User-Agent": f"QA-Guard-v2/{tag}",
                    "X-Device-Id": f"qa-device-{tag}"}

        # 3) 组合规则 1：陌生指纹 + 非工作时段 + 明细导出（用非管理员角色验证阻断）
        tag = uuid.uuid4().hex[:8]
        headers = with_identity(member_h, EXTERNAL_IP, tag)
        fp_used = __import__("app.security.security_events", fromlist=["x"]).fingerprint(
            EXTERNAL_IP, f"QA-Guard-v2/{tag}", f"qa-device-{tag}", "")
        db.execute(text("DELETE FROM bi_security_block WHERE dimension = 'fingerprint' AND value = :v"),
                   {"v": fp_used})
        db.execute(text("UPDATE bi_app_setting SET value = '0' WHERE key = 'security.guard.combo.block'"))
        db.commit()

        r = session.get(f"{base}/api/bi/engine/export/bi_demo_sku", headers=headers, timeout=60)
        check("组合规则默认不阻断", r.status_code, 200)
        combo_alert = db.execute(text(
            "SELECT count(*) FROM bi_security_event WHERE id > :s "
            "AND event_type = 'guard_combo_alert' AND fingerprint = :fp"),
            {"s": event_start, "fp": fp_used}).scalar() or 0
        check("组合规则写告警", int(combo_alert) >= 1, True)

        db.execute(text(
            "INSERT INTO bi_app_setting (key, value, updated_at) VALUES "
            "('security.guard.combo.block', '1', now()) "
            "ON CONFLICT (key) DO UPDATE SET value = '1', updated_at = now()"))
        db.commit()
        tag2 = uuid.uuid4().hex[:8]
        headers2 = with_identity(member_h, EXTERNAL_IP, tag2)
        fp2 = __import__("app.security.security_events", fromlist=["x"]).fingerprint(
            EXTERNAL_IP, f"QA-Guard-v2/{tag2}", f"qa-device-{tag2}", "")
        r = session.get(f"{base}/api/bi/engine/export/bi_demo_sku", headers=headers2, timeout=60)
        check("打开阻断后 403", r.status_code, 403)
        blocked = db.execute(text(
            "SELECT reason FROM bi_security_block WHERE dimension = 'fingerprint' "
            "AND value = :v AND released_at IS NULL AND expires_at > now()"), {"v": fp2}).fetchone()
        check("组合规则封禁落库", bool(blocked), True)
        check("封禁原因可读", "组合规则" in str(blocked[0]) if blocked else False, True)

        # 内网白名单不受组合规则影响（仍可导出）
        tag3 = uuid.uuid4().hex[:8]
        r = session.get(f"{base}/api/bi/engine/export/bi_demo_sku",
                        headers=with_identity(member_h, INTERNAL_IP, tag3), timeout=60)
        check("内网白名单不误杀", r.status_code, 200)

        # 4) 组合规则 2：伪造令牌 + 反复越权探测
        # 先释放组合规则 1 的封禁，否则下面的请求会被“已封禁”直接挡住，进不到越权探测
        db.execute(text("DELETE FROM bi_security_block WHERE reason LIKE '%组合规则%'"))
        db.commit()
        combo_tag = uuid.uuid4().hex[:8]
        combo_headers = with_identity(member_h, EXTERNAL_IP, combo_tag)
        combo_fp = __import__("app.security.security_events", fromlist=["x"]).fingerprint(
            EXTERNAL_IP, f"QA-Guard-v2/{combo_tag}", f"qa-device-{combo_tag}", "")
        db.execute(text("DELETE FROM bi_security_block WHERE dimension IN ('fingerprint','user') "
                        "AND ((dimension = 'fingerprint' AND value = :fp) OR "
                        "     (dimension = 'user' AND value = :uid))"),
                   {"fp": combo_fp, "uid": str(member_id)})
        db.commit()
        session.get(f"{base}/api/auth/me",
                    headers={**combo_headers, "Authorization": "Bearer forged.token.value"},
                    timeout=10)
        codes = [session.get(f"{base}/api/admin/monitor/guard", headers=combo_headers,
                             timeout=10).status_code for _ in range(3)]
        check("越权探测先 403", codes, [403, 403, 403])
        final = session.get(f"{base}/api/bi/dashboards", headers=combo_headers, timeout=10)
        check("组合规则 2 直接阻断", final.status_code, 403)
        check("阻断提示含安全卫士", "安全卫士" in (final.text or ""), True)
        combo_block = db.execute(text(
            "SELECT reason FROM bi_security_block WHERE dimension = 'fingerprint' "
            "AND value = :v AND released_at IS NULL AND expires_at > now()"), {"v": combo_fp}).fetchone()
        check("组合规则 2 封禁落库",
              "组合规则" in str(combo_block[0]) if combo_block else False, True)
    finally:
        try:
            db.execute(text("UPDATE bi_app_setting SET value = '0' "
                            "WHERE key = 'security.guard.combo.block'"))
            if old_enabled is not None:
                db.execute(text("UPDATE bi_app_setting SET value = :v "
                                "WHERE key = 'security.guard.enabled'"),
                           {"v": str(old_enabled)})
            db.execute(text("DELETE FROM bi_security_block WHERE dimension = 'fingerprint' "
                            "AND value IN (:fp)"), {"fp": fp_used or "none"})
            # 组合规则可能封了账号 / 指纹，统一按原因清理，避免污染后续回归
            db.execute(text("DELETE FROM bi_security_block WHERE reason LIKE '%组合规则%'"))
            if member_id:
                db.execute(text("DELETE FROM bi_security_block WHERE dimension = 'user' "
                                "AND value = :v"), {"v": str(member_id)})
                db.execute(text("DELETE FROM bi_security_event WHERE user_id = :i"),
                           {"i": member_id})
                db.execute(text("DELETE FROM bi_guard_hit WHERE user_id = :i"), {"i": member_id})
                db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :i"), {"i": member_id})
                db.execute(text("DELETE FROM users WHERE id = :i"), {"i": member_id})
            db.execute(text("DELETE FROM role_permission WHERE role_id IN "
                            "(SELECT id FROM roles WHERE code = 'qa_export')"))
            db.execute(text("DELETE FROM roles WHERE code = 'qa_export'"))
            db.execute(text("DELETE FROM bi_guard_hit WHERE fingerprint LIKE 'qa-%'"))
            db.execute(text("DELETE FROM bi_security_event WHERE id > :s AND "
                            "(event_type IN ('guard_combo_alert', 'business_high_frequency') "
                            " OR fingerprint LIKE 'qa%')"), {"s": event_start})
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
