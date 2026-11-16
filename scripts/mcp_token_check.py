"""MCP 令牌治理回归（R12）—— scopes / 设备名 / 授权上限 / 一键撤销 / TTL / 服务账号.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/mcp_token_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 授权记录带设备名 / 最近使用 IP / UA；
    2. scopes 真正限制可用工具（越权调用 403）；
    3. 每用户活跃授权上限（默认 5）→ 第 6 条 429；
    4. 访问令牌 15–60 分钟、令牌内不含部门；
    5. 一键撤销我的全部授权后旧令牌立即失效；管理员可撤销指定用户；
    6. 服务账号客户端只能用服务授权，个人授权不能借用。
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import requests
from jose import jwt
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token, hash_password  # noqa: E402

USER = "qa_token_member"
PASSWORD = "Qa123456"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    user_id: int | None = None
    client_ids: list[int] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 临时管理员（隔离授权，避免动到真实账号）
        user_id = int(db.execute(text(
            "INSERT INTO users (username, email, password_hash, role, is_active, "
            "  approval_status, token_version, created_at) "
            "VALUES (:u, :e, :h, 'admin', true, 'approved', 0, now()) RETURNING id"),
            {"u": USER, "e": f"{USER}@corp.com", "h": hash_password(PASSWORD)}
        ).scalar())
        db.commit()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(user_id, 0)}",
              "X-CSRF-Token": csrf}

        def new_client(name: str, service: bool = False) -> dict:
            resp = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                                json={"name": name, "is_service": service}, timeout=20)
            data = resp.json() if resp.status_code == 200 else {}
            if data.get("id"):
                client_ids.append(int(data["id"]))
            return data

        def grant(client: dict, scopes: list | None = None, device: str = "QA 测试机",
                  kind: str = "personal"):
            return session.post(f"{base}/api/mcp/grants", headers=AH, json={
                "client_id": client["client_id"], "scopes": scopes or [],
                "device_name": device, "kind": kind}, timeout=20)

        def token(client: dict, grant_data: dict):
            return session.post(f"{base}/api/mcp/token", json={
                "client_id": client["client_id"], "client_secret": client["secret"],
                "refresh_token": grant_data["refresh_token"]}, timeout=20)

        # 1) 授权上限（默认 5）+ 一键撤销
        limit_client = new_client("QA 授权上限")
        codes = []
        first_grant: dict = {}
        for index in range(6):
            resp = grant(limit_client, device=f"device-{index}")
            codes.append(resp.status_code)
            if index == 0 and resp.status_code == 200:
                first_grant = resp.json()
        check("前 5 条正常", codes[:5], [200] * 5)
        check("第 6 条授权 429", codes[-1], 429)
        old_tok = token(limit_client, first_grant)
        old_access = old_tok.json().get("access_token", "")
        revoked = session.delete(f"{base}/api/mcp/grants/mine", headers=AH, timeout=20)
        check("一键撤销我的授权", revoked.status_code, 200)
        after = session.post(
            f"{base}/api/mcp/rpc", headers={"Authorization": f"Bearer {old_access}"},
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/list"}, timeout=20)
        check("旧令牌立即失效", after.status_code, 403)

        # 2) 设备名 / 最近使用
        main_client = new_client("QA Token 治理")
        g = grant(main_client, device="张三的 MacBook / Cursor")
        check("创建设备授权", g.status_code, 200)
        grant_data = g.json() if g.status_code == 200 else {}
        tok = token(main_client, grant_data)
        check("换访问令牌", tok.status_code, 200)
        access = tok.json().get("access_token", "")
        mine = session.get(f"{base}/api/mcp/grants/mine", headers=AH, timeout=20).json()["grants"]
        hit = next((item for item in mine if item["device_name"] == "张三的 MacBook / Cursor"), None)
        check("授权带设备名", bool(hit), True)
        check("授权记录最近 IP", bool(hit and hit.get("last_ip")), True)

        # 3) 令牌 TTL / 无部门
        claims = jwt.get_unverified_claims(access)
        ttl = int(claims.get("exp", 0)) - int(claims.get("iat", 0))
        check("访问令牌 15–60 分钟", 900 <= ttl <= 3600, True)
        check("令牌不含部门", "department_id" in claims or "dept" in claims, False)

        # 4) scopes 限制工具
        scope_client = new_client("QA Scope 限制")
        sg = grant(scope_client, scopes=["bi_list_datasets"], device="scope-bot")
        stok = token(scope_client, sg.json() if sg.status_code == 200 else {})
        s_access = stok.json().get("access_token", "")
        names = [t["name"] for t in session.post(
            f"{base}/api/mcp/rpc", headers={"Authorization": f"Bearer {s_access}"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, timeout=20
        ).json()["result"]["tools"]]
        check("scopes 只下发允许的工具", names, ["bi_list_datasets"])
        denied = session.post(
            f"{base}/api/mcp/rpc", headers={"Authorization": f"Bearer {s_access}"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                  "params": {"name": "bi_query_dataset", "arguments": {"dataset_id": 1}}},
            timeout=20,
        )
        check("scopes 越权调用 403", denied.status_code, 403)

        # 6) 服务账号分离
        svc = new_client("QA 服务账号", service=True)
        personal = grant(svc, kind="personal")
        bad = token(svc, personal.json() if personal.status_code == 200 else {})
        check("服务客户端拒绝个人授权", bad.status_code, 403)
        service_grant = grant(svc, kind="service")
        good = token(svc, service_grant.json() if service_grant.status_code == 200 else {})
        check("服务授权可换令牌", good.status_code, 200)

        # 7) 管理员撤销指定用户
        admin_revoke = session.delete(f"{base}/api/admin/mcp/grants",
                                     headers=AH, params={"user_id": user_id}, timeout=20)
        check("管理员撤销指定用户", admin_revoke.status_code, 200)
    finally:
        try:
            for cid in client_ids:
                db.execute(text("DELETE FROM bi_mcp_audit WHERE client_id = :i"), {"i": cid})
                db.execute(text("DELETE FROM bi_mcp_grant WHERE client_id = :i"), {"i": cid})
                db.execute(text("DELETE FROM bi_mcp_client WHERE id = :i"), {"i": cid})
            if user_id:
                db.execute(text("DELETE FROM bi_audit_logs WHERE user_id = :i"), {"i": user_id})
                db.execute(text("DELETE FROM users WHERE id = :i"), {"i": user_id})
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
