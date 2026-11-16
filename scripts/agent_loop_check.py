"""Agent 死循环防护回归（R6）—— 步数上限 / 重复调用 / 无进展 / 任务豁免.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/agent_loop_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 同一工具同参数重复到阈值 → 中断；
    2. 带 task_id 的批量任务不被重复规则误杀；
    3. 连续相同结果 → 无进展中断；
    4. 单会话调用上限 → 中断；
    5. 真实 MCP 链路：重复调用第 5 次返回 429 / -32010，新会话恢复正常；
    6. 跑完清理客户端 / 授权 / 审计。
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
from app.mcp import loop_guard  # noqa: E402
from app.services.auth import create_access_token  # noqa: E402

CLIENT_NAME = "QA Agent 循环校验"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    client_ids: list[int] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    def expect_loop(fn, reason: str) -> bool:
        try:
            fn()
            return False
        except loop_guard.LoopGuardError as exc:
            return exc.reason == reason

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        # 1) 同一工具同参数重复
        loop_guard.reset()
        key = "qa-repeat"
        for _ in range(4):
            loop_guard.before_call(key, "bi_list_datasets", {"x": 1})
        check("第 5 次重复被中断",
              expect_loop(lambda: loop_guard.before_call(key, "bi_list_datasets", {"x": 1}),
                          "repeat"), True)

        # 2) task_id 豁免
        loop_guard.reset()
        ok = True
        for _ in range(10):
            try:
                loop_guard.before_call("qa-task", "bi_query_dataset",
                                       {"dataset_id": 1, "task_id": "batch-1"})
            except loop_guard.LoopGuardError:
                ok = False
        check("task_id 批量任务不被误杀", ok, True)

        # 3) 连续无进展
        loop_guard.reset()
        for _ in range(7):
            loop_guard.before_call("qa-noop", "bi_list_datasets", {"page": uuid.uuid4().hex})
            loop_guard.after_call("qa-noop", {"datasets": [], "count": 0})
        check("连续相同结果被中断",
              expect_loop(lambda: loop_guard.before_call("qa-noop", "bi_list_datasets",
                                                        {"page": uuid.uuid4().hex}),
                          "no_progress"), True)

        # 4) 单会话调用上限
        loop_guard.reset()
        old = os.environ.get("BI_MCP_SESSION_MAX_CALLS")
        os.environ["BI_MCP_SESSION_MAX_CALLS"] = "3"
        try:
            for index in range(3):
                loop_guard.before_call("qa-max", "bi_list_datasets", {"page": f"p{index}"})
            check("超过会话步数上限被中断",
                  expect_loop(lambda: loop_guard.before_call("qa-max", "bi_list_datasets",
                                                            {"page": "p9"}), "max_calls"), True)
        finally:
            if old is None:
                os.environ.pop("BI_MCP_SESSION_MAX_CALLS", None)
            else:
                os.environ["BI_MCP_SESSION_MAX_CALLS"] = old

        # 5) 真实 MCP 链路
        row = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                              "ORDER BY id LIMIT 1")).fetchone()
        admin_id, admin_ver = int(row[0]), int(row[1] or 0)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(admin_id, admin_ver)}",
              "X-CSRF-Token": csrf}
        cl = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                          json={"name": CLIENT_NAME, "description": "循环防护回归"}, timeout=20)
        check("创建 MCP 客户端", cl.status_code, 200)
        if cl.status_code == 200:
            data = cl.json()
            client_ids.append(int(data["id"]))
            grant = session.post(f"{base}/api/mcp/grants", headers=AH,
                                 json={"client_id": data["client_id"]}, timeout=20).json()
            tok = session.post(f"{base}/api/mcp/token", json={
                "client_id": data["client_id"], "client_secret": data["secret"],
                "refresh_token": grant["refresh_token"]}, timeout=20)
            access = tok.json().get("access_token", "")
            session_id = "qa-" + uuid.uuid4().hex[:10]

            def call(tool: str, arguments: dict, sid: str = session_id):
                return session.post(
                    f"{base}/api/mcp/rpc",
                    headers={"Authorization": f"Bearer {access}", "Mcp-Session-Id": sid},
                    json={"jsonrpc": "2.0", "id": 1, "method": "tools/call",
                          "params": {"name": tool, "arguments": arguments}}, timeout=30)

            statuses = [call("bi_list_datasets", {}).status_code for _ in range(4)]
            check("前 4 次正常", all(code == 200 for code in statuses), True)
            blocked = call("bi_list_datasets", {})
            check("第 5 次重复 429", blocked.status_code, 429)
            check("错误码 -32010", "-32010" in (blocked.text or ""), True)

            fresh = "qa-" + uuid.uuid4().hex[:10]
            check("新会话恢复", call("bi_list_datasets", {}, sid=fresh).status_code, 200)

            task_sid = "qa-" + uuid.uuid4().hex[:10]
            task_codes = [call("bi_list_datasets", {"task_id": "batch-9"}, sid=task_sid).status_code
                          for _ in range(6)]
            check("task_id 批量调用不中断", all(code == 200 for code in task_codes), True)
    finally:
        try:
            for cid in client_ids:
                db.execute(text("DELETE FROM bi_mcp_audit WHERE client_id = :i"), {"i": cid})
                db.execute(text("DELETE FROM bi_mcp_grant WHERE client_id = :i"), {"i": cid})
                db.execute(text("DELETE FROM bi_mcp_client WHERE id = :i"), {"i": cid})
            db.commit()
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            print("清理测试数据失败：", exc)
        db.close()
        loop_guard.reset()

    passed = sum(1 for ok, _, _ in results if ok)
    for ok, label, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}  ({detail})")
    print(f"\n{passed}/{len(results)} 通过")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
