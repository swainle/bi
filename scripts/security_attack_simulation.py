"""安全卫士全场景攻防模拟 —— 真实 HTTP 请求，跑完清场并恢复开关.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/security_attack_simulation.py [--base-url http://127.0.0.1:8300]

覆盖：
    A 身份与令牌：匿名、随机令牌、篡改令牌、过期令牌、alg=none
    B 跨权限：普通成员访问管理后台各分区 / 启停安全卫士
    C 漏洞利用：表名注入、非白名单表、筛选值 SQL 注入、指标表达式注入、扫描器路径
    D 攻击封禁：IP / 指纹 / 账号三个维度、解封恢复
    E 登录爆破：连续错误密码触发 auth_failed 封禁
    F 白名单与开关：本机豁免、关闭后不拦截、开启后恢复
    G 限流：高频写请求触发 429
    H 已知缺口（不计失败，标记 GAP）：XFF 伪造白名单、指纹含 IP、明细导出未鉴权、指标表达式注入

退出码：只要存在真实 FAIL 就返回 1；GAP 只报告不阻断。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time

import requests
from jose import jwt
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

USER_NAME = "qa_sim_member"
PASSWORD = "Qa123456"
PREFIX = "203.0.113."

SCAN_IP = PREFIX + "101"
LOGIN_IP = PREFIX + "103"
BLOCK_IP = PREFIX + "104"
OTHER_IP = PREFIX + "105"
ACCOUNT_IP = PREFIX + "106"
ACCOUNT_IP2 = PREFIX + "107"
OFF_IP = PREFIX + "109"
ON_IP = PREFIX + "110"

UA_BLOCK = "QA-Sim-Attack/1.0"
DEV_BLOCK = "qa-sim-attack"
UA_LOGIN = "QA-Sim-Login/1.0"
UA_SCAN = "QA-Sim-Scanner/1.0"
UA_ACCOUNT = "QA-Sim-Member/1.0"

START = {"hit": 0, "block": 0, "event": 0, "audit": 0}
GAPS: list[tuple[str, str]] = []


def cleanup(db, member_id: int | None) -> None:
    db.execute(text("DELETE FROM bi_security_block WHERE id > :m OR value LIKE :p"),
               {"m": START["block"], "p": PREFIX + "%"})
    db.execute(text("DELETE FROM bi_guard_hit WHERE id > :m OR ip LIKE :p"),
               {"m": START["hit"], "p": PREFIX + "%"})
    db.execute(text(
        "DELETE FROM bi_security_event WHERE id > :m AND (ip LIKE :p OR ip = '127.0.0.1')"),
        {"m": START["event"], "p": PREFIX + "%"})
    db.execute(text(
        "DELETE FROM bi_audit_logs WHERE id > :m AND "
        "(action IN ('auth.login_failed','security.guard.toggle','security.guard.block',"
        " 'security.guard.release_manual','security.guard.release',"
        " 'data.export.detail','data.export.summary') OR user_id = :u)"),
        {"m": START["audit"], "u": member_id})
    if member_id:
        db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :u"), {"u": member_id})
        db.execute(text("DELETE FROM users WHERE id = :u"), {"u": member_id})
    db.execute(text("DELETE FROM users WHERE username = :u"), {"u": USER_NAME})
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    results: list[tuple[bool, str, str]] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    def gap(label: str, detail: str) -> None:
        GAPS.append((label, detail))

    db = SessionLocal()
    session = requests.Session()
    member_id: int | None = None
    original_enabled: bool | None = None
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 上一轮若刚跑完 320 次限流，本机写请求会处于 60s 冷却；先探一下，避免误判
        probe = session.post(f"{base}/api/bi/query/run", json={}, timeout=10)
        if probe.status_code == 429:
            print("本机写请求仍在限流窗口内，等待 65 秒后继续…")
            time.sleep(65)

        for key, table in (("hit", "bi_guard_hit"), ("block", "bi_security_block"),
                           ("event", "bi_security_event"), ("audit", "bi_audit_logs")):
            START[key] = int(db.execute(text(f"SELECT COALESCE(max(id), 0) FROM {table}")).scalar() or 0)
        cleanup(db, None)

        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
              "X-CSRF-Token": csrf, "User-Agent": "QA-Sim-Admin/1.0",
              "X-Device-Id": "qa-sim-admin"}

        info = session.get(f"{base}/api/admin/monitor/guard", headers=AH, timeout=20).json()
        original_enabled = bool(info["config"]["enabled"])
        threshold = int(info["config"]["max_hits"])
        if not original_enabled:
            print("安全卫士当前是关闭状态，请先在「操作监控 → 安全卫士」启用后再跑模拟")
            return 1

        member_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@example.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        member_token = create_access_token(member_id, 0)
        MH = {"Authorization": f"Bearer {member_token}", "X-CSRF-Token": csrf,
              "User-Agent": "QA-Sim-Member-Local/1.0", "X-Device-Id": "qa-sim-member"}

        # ── A 身份与令牌（本机白名单，不计入卫士）────────────
        anon = session.get(f"{base}/api/admin/monitor/summary", timeout=10)
        check("A1 匿名访问管理接口被拒", anon.status_code, 403)
        r = session.get(f"{base}/api/admin/monitor/summary",
                        headers={"Authorization": "Bearer not-a-real-token"}, timeout=10)
        check("A2 随机伪造令牌被拒", r.status_code, 401)

        parts = member_token.split(".")
        seg = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(seg))
        payload["sub"] = str(admin[0])
        tampered = ".".join([parts[0],
                             base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("="),
                             parts[2]])
        r = session.get(f"{base}/api/admin/monitor/summary",
                        headers={"Authorization": f"Bearer {tampered}"}, timeout=10)
        check("A3 篡改令牌（改 sub）被拒", r.status_code, 401)

        now = int(time.time())
        expired = jwt.encode({"sub": str(member_id), "iat": now - 120, "exp": now - 60},
                             settings.jwt_secret, algorithm=settings.jwt_algorithm)
        r = session.get(f"{base}/api/admin/monitor/summary",
                        headers={"Authorization": f"Bearer {expired}"}, timeout=10)
        check("A4 过期令牌被拒", r.status_code, 401)

        none_token = (base64.urlsafe_b64encode(json.dumps({"alg": "none", "typ": "JWT"}).encode())
                      .decode().rstrip("=") + "." +
                      base64.urlsafe_b64encode(json.dumps({"sub": str(admin[0])}).encode())
                      .decode().rstrip("=") + ".")
        r = session.get(f"{base}/api/admin/monitor/summary",
                        headers={"Authorization": f"Bearer {none_token}"}, timeout=10)
        check("A5 alg=none 令牌被拒", r.status_code, 401)

        # ── B 跨权限（本机白名单）────────────────────────────
        for path in ("/api/admin/users", "/api/admin/roles", "/api/admin/registrations",
                     "/api/admin/monitor/guard"):
            r = session.get(f"{base}{path}", headers=MH, timeout=10)
            check(f"B 跨权限 {path} 被拒", r.status_code, 403)
        r = session.put(f"{base}/api/admin/monitor/guard/config", headers=MH,
                        json={"enabled": False}, timeout=10)
        check("B 普通成员不能启停安全卫士", r.status_code, 403)

        # ── C 漏洞利用（本机白名单）──────────────────────────
        baseline = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": [{"column": "platform"}],
            "metrics": [{"column": "sales_lower", "agg": "SUM"}], "limit": 3,
        })
        check("C0 正常查询可用（基线）", baseline.status_code, 200)

        r = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "bi_demo_sku; DROP TABLE bi_demo_sku;--", "limit": 3,
        })
        check("C1 表名注入被拒", r.status_code in (400, 403), True)
        exists = db.execute(text("SELECT to_regclass('public.bi_demo_sku')")).scalar()
        check("C1 注入后演示表仍存在", exists is not None, True)

        r = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "users", "dimensions": [{"column": "username"}], "limit": 3,
        })
        check("C2 非白名单表被拒", r.status_code in (400, 403), True)

        r = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": [{"column": "platform"}],
            "metrics": [{"column": "sales_lower", "agg": "SUM"}],
            "filters": [{"column": "platform", "op": "=", "value": "' OR '1'='1"}], "limit": 10,
        })
        if r.status_code == 200:
            check("C3 筛选值注入未被拼接（0 行）", int(r.json().get("count") or 0), 0)
        else:
            check("C3 筛选值注入被拒", r.status_code in (400, 403), True)

        r = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "bi_demo_sku",
            "metrics": [{"expression": "(SELECT 42)", "alias": "inj"}], "limit": 1,
        })
        check("C4 指标表达式注入被拒", r.status_code, 400)

        r = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "subquery": "(SELECT 42) AS x", "limit": 1,
        })
        check("C4b 自定义子查询被拒", r.status_code, 400)

        qb = f"{base}/api/bi/engine/query_builder"
        r = session.post(qb, headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": ["platform"],
            "metrics": [{"col": "sales_lower", "agg": "SUM; DROP TABLE bi_demo_sku;--"}], "limit": 1,
        })
        check("C4c 聚合方式注入被拒", r.status_code, 400)

        r = session.post(qb, headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": ["platform"],
            "order_by": "platform; DROP TABLE bi_demo_sku;--", "limit": 1,
        })
        check("C4d 排序条件注入被拒", r.status_code, 400)

        r = session.post(qb, headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": ["platform"], "limit": "1; DROP TABLE bi_demo_sku;--",
        })
        check("C4e limit 注入被拒", r.status_code, 400)

        r = session.post(qb, headers=MH, timeout=20, json={
            "table": "bi_demo_sku", "dimensions": ["platform"],
            "joins": [{"table": "bi_demo_sku", "on": "1=1; DROP TABLE bi_demo_sku;--"}], "limit": 1,
        })
        check("C4f JOIN 条件注入被拒", r.status_code, 400)

        r = session.post(f"{base}/api/bi/engine/metrics", headers=MH, timeout=20, json={
            "name": "qa_sim_injected_metric", "formula": "(SELECT 42)",
        })
        check("C4g 指标公式注入被拒", r.status_code, 400)

        exists = db.execute(text("SELECT to_regclass('public.bi_demo_sku')")).scalar()
        check("C4h 注入尝试后演示表仍存在", exists is not None, True)

        scan = {"User-Agent": UA_SCAN, "X-Device-Id": "qa-sim-scan",
                "X-Forwarded-For": SCAN_IP, "Accept-Language": "zh-CN"}
        codes = [session.get(f"{base}{p}", headers=scan, timeout=10).status_code
                 for p in ("/.env", "/wp-admin/", "/.git/config")]
        check("C5 扫描器路径返回 404", all(c == 404 for c in codes), True)
        events = int(db.execute(text(
            "SELECT count(*) FROM bi_security_event WHERE id > :m AND ip = :ip AND event_type = 'suspicious_path'"),
            {"m": START["event"], "ip": SCAN_IP}).scalar() or 0)
        check("C5 扫描路径写入安全事件", events >= 1, True)

        # ── D 攻击封禁：IP / 指纹 / 账号 ─────────────────────
        block_headers = {"User-Agent": UA_BLOCK, "X-Device-Id": DEV_BLOCK,
                         "X-Forwarded-For": BLOCK_IP, "Accept-Language": "zh-CN"}
        last = None
        for _ in range(threshold):
            last = session.get(f"{base}/api/admin/monitor/summary", headers=block_headers, timeout=10)
        check("D1 阈值内仍是普通拒绝", last.status_code, 403)
        blocked = session.get(f"{base}/api/admin/monitor/summary", headers=block_headers, timeout=10)
        check("D2 达到阈值后被安全卫士拦截", "安全卫士" in blocked.text, True)

        blocks = session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                             timeout=20).json()["blocks"]
        dims = {b["dimension"] for b in blocks}
        check("D3 生成 IP 封禁", "ip" in dims, True)
        check("D4 生成指纹封禁", "fingerprint" in dims, True)

        same_ip_new_ua = {"User-Agent": "QA-Sim-Other/2.0", "X-Device-Id": "qa-sim-other",
                          "X-Forwarded-For": BLOCK_IP, "Accept-Language": "en-US"}
        r = session.get(f"{base}/api/admin/monitor/summary", headers=same_ip_new_ua, timeout=10)
        check("D5 同 IP 换 UA 仍被 IP 维度拦截", "安全卫士" in r.text, True)

        other_ip = {"User-Agent": UA_BLOCK, "X-Device-Id": DEV_BLOCK,
                    "X-Forwarded-For": OTHER_IP, "Accept-Language": "zh-CN"}
        r = session.get(f"{base}/api/admin/monitor/summary", headers=other_ip, timeout=10)
        check("D6 换 IP 同设备仍被指纹拦截", "安全卫士" in r.text, True)

        # 账号维度
        acc_headers = {"Authorization": f"Bearer {member_token}", "User-Agent": UA_ACCOUNT,
                       "X-Device-Id": "qa-sim-acc", "X-Forwarded-For": ACCOUNT_IP,
                       "Accept-Language": "zh-CN"}
        for _ in range(threshold):
            session.get(f"{base}/api/admin/monitor/summary", headers=acc_headers, timeout=10)
        r = session.get(f"{base}/api/admin/monitor/summary", headers=acc_headers, timeout=10)
        check("D7 账号维度触发封禁", "安全卫士" in r.text, True)

        acc_other = {"Authorization": f"Bearer {member_token}", "User-Agent": "QA-Sim-AccOther/2.0",
                     "X-Device-Id": "qa-sim-acc-other", "X-Forwarded-For": ACCOUNT_IP2,
                     "Accept-Language": "en-US"}
        r = session.get(f"{base}/api/admin/monitor/summary", headers=acc_other, timeout=10)
        check("D8 换 IP/UA 仍被账号维度拦截", "安全卫士" in r.text, True)

        for block in session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                                 timeout=20).json()["blocks"]:
            session.delete(f"{base}/api/admin/monitor/guard/blocks/{block['id']}",
                           headers=AH, timeout=20)
        after = session.get(f"{base}/api/admin/monitor/summary", headers=block_headers, timeout=10)
        check("D9 解封后恢复普通拒绝", "安全卫士" in after.text, False)
        left = session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                           timeout=20).json()["blocks"]
        check("D10 解封后封禁列表清空", left, [])

        # ── E 登录爆破 ──────────────────────────────────────
        login_headers = {"User-Agent": UA_LOGIN, "X-Device-Id": "qa-sim-login",
                         "X-Forwarded-For": LOGIN_IP, "Accept-Language": "zh-CN"}
        for _ in range(threshold):
            session.post(f"{base}/api/auth/login", headers=login_headers,
                         json={"account": "admin", "password": "wrong-password"}, timeout=10)
        r = session.post(f"{base}/api/auth/login", headers=login_headers,
                         json={"account": "admin", "password": "wrong-password"}, timeout=10)
        check("E1 连续登录失败触发安全卫士", "安全卫士" in r.text, True)
        hits = int(db.execute(text(
            "SELECT count(*) FROM bi_guard_hit WHERE id > :m AND ip = :ip AND event_type = 'auth_failed'"),
            {"m": START["hit"], "ip": LOGIN_IP}).scalar() or 0)
        check("E2 登录失败命中已计数", hits >= threshold, True)

        # ── F 白名单与开关 ──────────────────────────────────
        before = int(db.execute(text(
            "SELECT count(*) FROM bi_guard_hit WHERE ip = '127.0.0.1'")).scalar() or 0)
        for _ in range(threshold + 2):
            session.get(f"{base}/api/admin/monitor/summary", timeout=10)
        after_hits = int(db.execute(text(
            "SELECT count(*) FROM bi_guard_hit WHERE ip = '127.0.0.1'")).scalar() or 0)
        check("F1 本机白名单攻击不计数", after_hits - before, 0)

        # XFF 伪造：真实场景是「攻击者前置 127.0.0.1，反代在右侧追加真实 IP」
        from app.middleware.security_watch import _trusted_networks, resolve_client_ip

        nets = _trusted_networks()
        check("F2 非可信来源忽略 XFF",
              resolve_client_ip("203.0.113.10", "127.0.0.1", nets), "203.0.113.10")
        check("F2b 可信代理解析最右真实 IP",
              resolve_client_ip("127.0.0.1", "127.0.0.1, 203.0.113.10", nets), "203.0.113.10")

        spoof_ip = PREFIX + "151"
        spoof = {"X-Forwarded-For": f"127.0.0.1, {spoof_ip}",
                 "User-Agent": "QA-Sim-Spoof/1.0", "X-Device-Id": "qa-sim-spoof"}
        for _ in range(threshold):
            session.get(f"{base}/api/admin/monitor/summary", headers=spoof, timeout=10)
        r = session.get(f"{base}/api/admin/monitor/summary", headers=spoof, timeout=10)
        check("F2c 伪造 XFF 前置白名单不能绕过", "安全卫士" in r.text, True)
        spoof_hits = int(db.execute(text(
            "SELECT count(*) FROM bi_guard_hit WHERE id > :m AND ip = :ip"),
            {"m": START["hit"], "ip": spoof_ip}).scalar() or 0)
        check("F2d 伪造请求按真实 IP 计数", spoof_hits >= threshold, True)

        def guard_put(next_enabled: bool) -> dict:
            resp = session.put(f"{base}/api/admin/monitor/guard/config", headers=AH,
                               json={"enabled": next_enabled}, timeout=20)
            try:
                body = resp.json()
            except Exception:
                body = {}
            if resp.status_code != 200 or "config" not in body:
                print(f"[debug] guard PUT enabled={next_enabled} -> {resp.status_code} "
                      f"{resp.text[:200]}")
            return body

        off = guard_put(False)
        check("F3 管理员关闭开关", bool((off.get("config") or {}).get("enabled")), False)
        off_headers = {"User-Agent": "QA-Sim-Off/1.0", "X-Device-Id": "qa-sim-off",
                       "X-Forwarded-For": OFF_IP, "Accept-Language": "zh-CN"}
        last_off = None
        for _ in range(threshold + 1):
            last_off = session.get(f"{base}/api/admin/monitor/summary", headers=off_headers, timeout=10)
        check("F4 关闭后攻击不被拦截", "安全卫士" in last_off.text, False)
        off_hits = int(db.execute(text(
            "SELECT count(*) FROM bi_guard_hit WHERE id > :m AND ip = :ip"),
            {"m": START["hit"], "ip": OFF_IP}).scalar() or 0)
        check("F5 关闭后不再计数", off_hits, 0)

        on = guard_put(True)
        check("F6 管理员重新开启", bool((on.get("config") or {}).get("enabled")), True)
        on_headers = {"User-Agent": "QA-Sim-On/1.0", "X-Device-Id": "qa-sim-on",
                      "X-Forwarded-For": ON_IP, "Accept-Language": "zh-CN"}
        for _ in range(threshold):
            session.get(f"{base}/api/admin/monitor/summary", headers=on_headers, timeout=10)
        r = session.get(f"{base}/api/admin/monitor/summary", headers=on_headers, timeout=10)
        check("F7 开启后恢复拦截", "安全卫士" in r.text, True)
        for block in session.get(f"{base}/api/admin/monitor/guard", headers=AH,
                                 timeout=20).json()["blocks"]:
            session.delete(f"{base}/api/admin/monitor/guard/blocks/{block['id']}",
                           headers=AH, timeout=20)

        # ── H 导出鉴权（H1 已修复）────────────────────────────
        r = session.get(f"{base}/api/bi/engine/export/bi_rank_board", headers=MH, timeout=30)
        check("H1 普通成员明细导出被拒", r.status_code, 403)

        r = session.get(f"{base}/api/bi/engine/export/bi_rank_board", headers=AH, timeout=30)
        check("H1b 管理员明细导出可用", r.status_code, 200)
        audit_rows = int(db.execute(text(
            "SELECT count(*) FROM bi_audit_logs WHERE id > :m AND action = 'data.export.detail'"),
            {"m": START["audit"]}).scalar() or 0)
        check("H1c 导出写入审计", audit_rows >= 1, True)

        r = session.get(f"{base}/api/bi/engine/export/bi_demo_sku", headers=AH, timeout=60)
        check("H2 无 id 列的表也能导出", r.status_code, 200)

        # ── G 限流（本机白名单，不被卫士计数）────────────────
        limited = False
        for _ in range(320):
            rr = session.post(f"{base}/api/bi/query/run", headers=MH, timeout=10, json={})
            if rr.status_code == 429:
                limited = True
                break
        check("G1 高频写请求触发 429 限流", limited, True)

        # 报告
        failed = [item for item in results if not item[0]]
        print("\n=== 安全卫士全场景模拟 ===")
        for ok, label, detail in results:
            print(f"  {'✓' if ok else '✗'} {label}" + ("" if ok else f" —— {detail}"))
        if GAPS:
            print("\n--- 已知缺口（不计失败，需后续修复）---")
            for label, detail in GAPS:
                print(f"  ! {label}\n    {detail}")
        print(f"\n结果：{len(results) - len(failed)}/{len(results)} 通过，"
              f"{len(GAPS)} 个已知缺口")
        return 1 if failed else 0
    finally:
        try:
            if original_enabled is not None:
                session.put(f"{base}/api/admin/monitor/guard/config",
                            headers={"Authorization": AH["Authorization"], "X-CSRF-Token": csrf},
                            json={"enabled": original_enabled}, timeout=20)
        except Exception:
            try:
                db.execute(text("UPDATE bi_app_setting SET value = :v, updated_at = now() "
                                "WHERE key = 'security.guard.enabled'"),
                           {"v": "1" if original_enabled else "0"})
                db.commit()
            except Exception:
                pass
        cleanup(db, member_id)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
