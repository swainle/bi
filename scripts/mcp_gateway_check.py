"""MCP 网关回归（S2）—— 正例 + 所有拒绝路径，跑完自己清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/mcp_gateway_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 建客户端 → 授权 → 换令牌 → initialize / tools/list / tools/call
    2. MCP 查询结果 = UI 查询结果（同一用户、同一数据集行列规则）
    3. 拒绝：无令牌 / 错误 secret / 高危工具未启用 / 客户端停用 / 工具被关 / 授权撤销
    4. 审计：有记录、含 denied、参数不含 secret

只创建一条 `QA MCP 网关校验` 客户端；结束时删客户端 + 授权 + 审计（cascade）。
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
from app.services.auth import create_access_token  # noqa: E402

CLIENT_NAME = "QA MCP 网关校验"


def _cleanup(db) -> None:
    ids = [r[0] for r in db.execute(
        text("SELECT id FROM bi_mcp_client WHERE name = :n"), {"n": CLIENT_NAME}
    ).fetchall()]
    if ids:
        ph = ", ".join(f":i{i}" for i in range(len(ids)))
        params = {f"i{i}": v for i, v in enumerate(ids)}
        db.execute(text(f"DELETE FROM bi_mcp_audit WHERE client_id IN ({ph})"), params)
        db.execute(text(f"DELETE FROM bi_mcp_client WHERE id IN ({ph})"), params)
    db.execute(text("DELETE FROM bi_audit_logs WHERE action LIKE 'mcp.%' "
                    "AND resource_type = 'mcp_client' "
                    "AND resource_id NOT IN (SELECT id FROM bi_mcp_client)"))
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

    session = requests.Session()
    try:
        _cleanup(db)
        row = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                              "ORDER BY id LIMIT 1")).fetchone()
        if row is None:
            print("数据库里没有 admin 账号")
            return 1
        admin_id, admin_ver = int(row[0]), int(row[1] or 0)
        token = create_access_token(admin_id, admin_ver)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf}

        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 1) 客户端 + 授权 + 令牌
        cl = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                          json={"name": CLIENT_NAME, "description": "网关回归"}, timeout=20).json()
        client_pk, client_key, secret = cl["id"], cl["client_id"], cl["secret"]
        grant = session.post(f"{base}/api/mcp/grants", headers=AH,
                             json={"client_id": client_key}, timeout=20).json()
        refresh, grant_id = grant["refresh_token"], grant["grant_id"]

        def issue(sec: str = secret, ref: str = refresh):
            return session.post(f"{base}/api/mcp/token", json={
                "client_id": client_key, "client_secret": sec, "refresh_token": ref}, timeout=20)

        r = issue()
        check("换访问令牌", r.status_code, 200)
        access = r.json().get("access_token", "")

        def rpc(method: str, params: dict | None = None, tok: str | None = access):
            headers = {"Authorization": f"Bearer {tok}"} if tok else {}
            return session.post(f"{base}/api/mcp/rpc", headers=headers, json={
                "jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}, timeout=120)

        def call_tool(name: str, arguments: dict | None = None, tok: str | None = access):
            return rpc("tools/call", {"name": name, "arguments": arguments or {}}, tok)

        check("initialize", rpc("initialize").status_code, 200)
        names = [t["name"] for t in rpc("tools/list").json()["result"]["tools"]]
        check("tools/list 只给已实现且有权限的工具", len(names), 10)
        check("高危工具不在列表", "bi_delete_resource" in names, False)

        # 2) 查询结果与 UI 一致
        datasets = json.loads(call_tool("bi_list_datasets").json()["result"]["content"][0]["text"])["datasets"]
        target = next((d for d in datasets if "测试" in d["name"]), datasets[0])
        schema = json.loads(call_tool("bi_get_dataset_schema", {"dataset_id": target["id"]})
                            .json()["result"]["content"][0]["text"])
        dim = next((f["name"] for f in schema["fields"]
                    if f["role"] == "dimension" and f.get("is_groupable")), None)
        metric = (schema["metrics"][0]["name"] if schema["metrics"] else None) or next(
            (f["name"] for f in schema["fields"] if f["role"] == "measure"), None)
        payload = {"dimensions": [dim], "metrics": [metric], "limit": 5}
        mcp_rows = json.loads(call_tool("bi_query_dataset", {"dataset_id": target["id"], **payload})
                              .json()["result"]["content"][0]["text"])
        ui = session.post(f"{base}/api/bi/semantic/datasets/{target['id']}/query",
                          headers=AH, json=payload, timeout=60)
        check("MCP 查询结果 = UI 查询结果",
              bool(ui.status_code == 200 and ui.json().get("rows") == mcp_rows.get("rows")), True)

        # 3) 拒绝路径
        check("无令牌调用", rpc("tools/list", tok=None).status_code, 403)
        check("错误 secret 换令牌", issue(sec="wrong-secret").status_code, 403)
        check("高危工具（未启用）拒绝", call_tool("bi_delete_resource", {"id": 1}).status_code, 403)

        session.patch(f"{base}/api/admin/mcp/clients/{client_pk}", headers=AH,
                      json={"enabled": False}, timeout=20)
        check("客户端停用后 token 失效", rpc("tools/list").status_code, 403)
        session.patch(f"{base}/api/admin/mcp/clients/{client_pk}", headers=AH,
                      json={"enabled": True}, timeout=20)

        session.put(f"{base}/api/admin/mcp/clients/{client_pk}/tools", headers=AH,
                    json={"tool_code": "bi_list_datasets", "enabled": False}, timeout=20)
        left = [t["name"] for t in rpc("tools/list").json()["result"]["tools"]]
        check("工具关闭后从列表消失", "bi_list_datasets" in left, False)
        check("工具关闭后调用被拒", call_tool("bi_list_datasets").status_code, 403)
        session.put(f"{base}/api/admin/mcp/clients/{client_pk}/tools", headers=AH,
                    json={"tool_code": "bi_list_datasets", "enabled": True}, timeout=20)

        session.delete(f"{base}/api/mcp/grants/{grant_id}", headers=AH, timeout=20)
        check("撤销授权后 token 失效", rpc("tools/list").status_code, 403)

        # 4) 审计
        items = session.get(f"{base}/api/admin/mcp/audit?limit=50", headers=AH, timeout=20).json()["items"]
        check("审计有记录", len(items) > 0, True)
        check("审计含被拒", any(i["status"] == "denied" for i in items), True)
        check("审计不含 secret", any("secret" in json.dumps(i) for i in items), False)

        failed = [r for r in results if not r[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\nMCP 网关回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        _cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
