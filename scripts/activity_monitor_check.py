"""操作监控回归（S7）—— 真实动作 → 审计落库 → 管理员视图可查，跑完清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/activity_monitor_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 登录成功 / 失败留痕；
    2. 看板新建 → 保存 → 发布 → 删除（敏感动作）；
    3. AI 整理 / AI 推荐调用留痕（source=ai）；
    4. MCP 工具调用留痕（source=mcp，来自 bi_mcp_audit）；
    5. 监控 API：来源过滤 / 关键词 / 敏感标记 / 汇总；
    6. 无 bi:audit:view 的普通账号 → 403。
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

CLIENT_NAME = "QA 监控校验"
USER_NAME = "qa_monitor_user"
PASSWORD = "Qa123456"
DASH_NAME = "QA-监控-草稿"
START_MAX = 0
START_SECURITY = 0
SCANNER_UA = "QA-Scanner/1.0"


def cleanup(db) -> None:
    users = [int(r[0]) for r in db.execute(
        text("SELECT id FROM users WHERE username = :u"), {"u": USER_NAME}
    ).fetchall()]
    clients = [int(r[0]) for r in db.execute(
        text("SELECT id FROM bi_mcp_client WHERE name = :n"), {"n": CLIENT_NAME}
    ).fetchall()]
    dashboards = [int(r[0]) for r in db.execute(
        text("SELECT id FROM bi_canvas WHERE name = :n"), {"n": DASH_NAME}
    ).fetchall()]
    if dashboards:
        ph = ", ".join(f":d{i}" for i in range(len(dashboards)))
        params = {f"d{i}": v for i, v in enumerate(dashboards)}
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE resource_type = 'canvas' "
                        f"AND resource_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM bi_dash_item_source WHERE dashboard_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM bi_canvas WHERE id IN ({ph})"), params)
    if users:
        ph = ", ".join(f":u{i}" for i in range(len(users)))
        params = {f"u{i}": v for i, v in enumerate(users)}
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE user_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM users WHERE id IN ({ph})"), params)
    if clients:
        ph = ", ".join(f":c{i}" for i in range(len(clients)))
        params = {f"c{i}": v for i, v in enumerate(clients)}
        db.execute(text(f"DELETE FROM bi_mcp_audit WHERE client_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM bi_mcp_client WHERE id IN ({ph})"), params)
    db.execute(text("DELETE FROM bi_audit_logs WHERE action = 'auth.login_failed' "
                    "AND detail->>'account' = :a"), {"a": USER_NAME})
    if START_MAX:
        db.execute(text("DELETE FROM bi_audit_logs WHERE id > :m AND action IN "
                        "('ai.layout', 'ai.recommend')"), {"m": START_MAX})
    if START_SECURITY:
        db.execute(text("DELETE FROM bi_security_event WHERE id > :m"), {"m": START_SECURITY})
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    global START_MAX, START_SECURITY
    START_MAX = int(db.execute(text("SELECT COALESCE(max(id), 0) FROM bi_audit_logs")).scalar() or 0)
    START_SECURITY = int(db.execute(
        text("SELECT COALESCE(max(id), 0) FROM bi_security_event")).scalar() or 0)
    results: list[tuple[bool, str, str]] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        cleanup(db)
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        admin_id, admin_ver = int(admin[0]), int(admin[1] or 0)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(admin_id, admin_ver)}",
              "X-CSRF-Token": csrf}

        # ── 造一个普通账号（用于登录 + 越权检查）───────────────
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'member', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER_NAME, "e": f"{USER_NAME}@example.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()

        r = session.post(f"{base}/api/auth/login", json={"account": USER_NAME, "password": PASSWORD},
                         timeout=20)
        check("普通账号登录成功", r.status_code, 200)
        r = session.post(f"{base}/api/auth/login", json={"account": USER_NAME, "password": "wrong"},
                         timeout=20)
        check("错误密码登录失败", r.status_code, 401)

        # ── 看板：新建 → 保存 → 发布 → 删除 ──────────────────
        dash = session.post(f"{base}/api/bi/dashboards", headers=AH,
                            json={"name": DASH_NAME}, timeout=20).json()
        dash_id = int(dash["id"])
        doc = session.get(f"{base}/api/bi/dashboards/{dash_id}", headers=AH, timeout=20).json()["doc"]
        check("保存看板", session.put(f"{base}/api/bi/dashboards/{dash_id}", headers=AH,
                                     json={"doc": doc, "publish": False}, timeout=20).status_code, 200)
        check("发布看板", session.put(f"{base}/api/bi/dashboards/{dash_id}", headers=AH,
                                     json={"doc": {**doc, "published": True}, "publish": True},
                                     timeout=20).status_code, 200)
        check("删除看板", session.delete(f"{base}/api/bi/dashboards/{dash_id}", headers=AH,
                                        timeout=20).status_code, 200)

        # ── AI：整理（纯算法也会记一条动作） + 推荐 ─────────
        items = [{"key": f"c{i}", "type": "chart", "kind": "kpi",
                  "x": i * 200, "y": 0, "w": 200, "h": 104} for i in range(3)]
        check("AI 整理", session.post(f"{base}/api/bi/ai/layout", headers=AH,
                                     json={"scope": "all", "items": items}, timeout=30).status_code, 200)
        datasets = session.get(f"{base}/api/bi/semantic/datasets", headers=AH,
                               timeout=20).json().get("datasets") or []
        rec_ok = False
        for dataset in datasets[:6]:
            resp = session.post(f"{base}/api/bi/ai/recommend", headers=AH,
                                json={"dataset_id": dataset["id"], "limit": 3}, timeout=30)
            if resp.status_code == 200:
                rec_ok = True
                break
        check("AI 推荐", rec_ok, True)

        # ── MCP：建客户端 → 授权 → 调一次只读工具 ────────────
        client = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                              json={"name": CLIENT_NAME, "description": "监控回归"}, timeout=20).json()
        grant = session.post(f"{base}/api/mcp/grants", headers=AH,
                             json={"client_id": client["client_id"]}, timeout=20).json()
        token = session.post(f"{base}/api/mcp/token", json={
            "client_id": client["client_id"], "client_secret": client["secret"],
            "refresh_token": grant["refresh_token"]}, timeout=20).json()["access_token"]
        mcp = session.post(f"{base}/api/mcp/rpc", headers={"Authorization": f"Bearer {token}"},
                           json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                                 "params": {"name": "bi_list_dashboards", "arguments": {}}},
                           timeout=60)
        check("MCP 工具调用", mcp.status_code, 200)

        # ── 管理员监控视图 ────────────────────────────────────
        summary = session.get(f"{base}/api/admin/monitor/summary?days=1", headers=AH,
                              timeout=30).json()
        totals = summary.get("totals") or {}
        check("汇总有操作记录", totals.get("op", 0) >= 5, True)
        check("汇总有 AI 记录", totals.get("ai", 0) >= 2, True)
        check("汇总有 MCP 记录", totals.get("mcp", 0) >= 1, True)
        check("汇总有敏感操作", totals.get("sensitive", 0) >= 1, True)

        def activity(**params) -> dict:
            return session.get(f"{base}/api/admin/monitor/activity",
                               headers=AH, params={"days": 1, **params}, timeout=30).json()

        all_items = activity(limit=200).get("items") or []
        actions = {item["action"] for item in all_items}
        check("登录留痕", {"auth.login", "auth.login_failed"} <= actions, True)
        check("看板动作留痕", {"dashboard.create", "dashboard.save", "dashboard.publish",
                              "dashboard.delete"} <= actions, True)
        check("AI 动作留痕", {"ai.layout", "ai.recommend"} <= actions, True)
        check("MCP 工具留痕", "bi_list_dashboards" in actions, True)

        delete_rows = [item for item in all_items if item["action"] == "dashboard.delete"]
        check("删除标记为敏感", bool(delete_rows) and delete_rows[0]["sensitive"], True)

        ai_rows = activity(source="ai", limit=50).get("items") or []
        check("来源过滤 ai", bool(ai_rows) and all(i["source"] == "ai" for i in ai_rows), True)
        mcp_rows = activity(source="mcp", limit=50).get("items") or []
        check("来源过滤 mcp", bool(mcp_rows) and all(i["source"] == "mcp" for i in mcp_rows), True)
        kw_rows = activity(keyword="dashboard.delete", limit=50).get("items") or []
        check("关键词过滤", any(i["action"] == "dashboard.delete" for i in kw_rows), True)

        # ── 越权：普通账号没有 bi:audit:view ──────────────────
        db.commit()
        ver = int(db.execute(text("SELECT token_version FROM users WHERE id = :i"),
                             {"i": user_id}).scalar() or 0)
        member_token = create_access_token(user_id, ver)
        forbidden = session.get(f"{base}/api/admin/monitor/summary?days=1",
                                headers={"Authorization": f"Bearer {member_token}"}, timeout=20)
        check("无权限账号 → 403", forbidden.status_code, 403)

        # ── 安全指纹：不是正常账号操作也要留痕 ─────────────────
        scan_headers = {"User-Agent": SCANNER_UA, "X-Device-Id": "qa-device-001",
                        "Accept-Language": "zh-CN,zh;q=0.9"}
        r = session.get(f"{base}/api/.env", headers=scan_headers, timeout=10)
        check("扫描器路径 404", r.status_code, 404)
        r = session.get(f"{base}/api/admin/monitor/summary", headers=scan_headers, timeout=10)
        check("匿名访问被拒", r.status_code in (401, 403), True)
        r = session.get(f"{base}/api/admin/monitor/summary",
                        headers={**scan_headers, "Authorization": "Bearer invalid-token"}, timeout=10)
        check("伪造令牌被拒", r.status_code, 401)

        sec_rows = session.get(f"{base}/api/admin/monitor/activity",
                               headers=AH, params={"days": 1, "source": "security", "limit": 100},
                               timeout=30).json().get("items") or []
        actions = {row["action"] for row in sec_rows}
        check("扫描路径留痕", "suspicious_path" in actions, True)
        check("匿名访问留痕", "denied_anonymous" in actions, True)
        check("伪造令牌留痕", "denied_invalid_token" in actions, True)
        ours = [row for row in sec_rows if row.get("user_agent") == SCANNER_UA]
        check("安全事件带指纹", bool(ours) and all(len(row["fingerprint"]) == 16 for row in ours), True)
        check("安全事件带 IP", bool(ours) and all(row["ip"] for row in ours), True)
        check("安全事件标记敏感", bool(ours) and all(row["sensitive"] for row in ours), True)

        summary2 = session.get(f"{base}/api/admin/monitor/summary?days=1", headers=AH,
                               timeout=30).json().get("totals") or {}
        check("汇总有安全事件", summary2.get("security", 0) >= 3, True)

        op_rows = activity(source="op", limit=100).get("items") or []
        check("普通操作也带指纹", bool(op_rows) and any(row["fingerprint"] for row in op_rows), True)

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\n操作监控回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
