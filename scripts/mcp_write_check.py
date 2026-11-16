"""MCP 写工具回归（S5）—— Agent 编排看板的全部正例 + 拒绝路径，跑完自己清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/mcp_write_check.py [--base-url http://127.0.0.1:8300]

覆盖（对照 docs/MCP与Agent权限接入方案.md §13.6）：
    1. bi_list_components / bi_create_dashboard / bi_add_item / bi_set_layout /
       bi_preview_dashboard / bi_save_dashboard 的正常链路
    2. 草稿隔离：只出现在 owner「我的看板」（带 agent_generated），团队页不可见
    3. 拒绝：越界/间距错 400、编造字段 400、乐观锁 409、Agent 发布 403、改手工看板 403
    4. 保存前渲染自检：含错误卡片的草稿无法保存
    5. 每日新建额度：超限 429
    6. 审计：写操作与拒绝都有记录，参数不含 secret

自建 `QA MCP 写工具校验` 客户端 + `QA-S5-*` 草稿，结束时全部删除。
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

CLIENT_NAME = "QA MCP 写工具校验"
DRAFT_PREFIX = "QA-S5-"
WRITE_TOOLS = [
    "bi_list_components",
    "bi_create_dashboard",
    "bi_add_item",
    "bi_set_layout",
    "bi_preview_dashboard",
    "bi_save_dashboard",
    "bi_publish_dashboard",
]


def _created_ids(db) -> list[int]:
    return [int(r[0]) for r in db.execute(
        text("SELECT id FROM bi_canvas WHERE name LIKE :p"), {"p": f"{DRAFT_PREFIX}%"}
    ).fetchall()]


def _cleanup(db) -> None:
    ids = _created_ids(db)
    if ids:
        placeholders = ", ".join(f":i{n}" for n in range(len(ids)))
        params = {f"i{n}": value for n, value in enumerate(ids)}
        db.execute(text(f"DELETE FROM bi_dash_item_source WHERE dashboard_id IN ({placeholders})"), params)
        db.execute(text(f"DELETE FROM bi_audit_logs WHERE resource_type = 'canvas' "
                        f"AND resource_id IN ({placeholders})"), params)
        db.execute(text(f"DELETE FROM bi_canvas WHERE id IN ({placeholders})"), params)
    clients = [int(r[0]) for r in db.execute(
        text("SELECT id FROM bi_mcp_client WHERE name = :n"), {"n": CLIENT_NAME}
    ).fetchall()]
    if clients:
        placeholders = ", ".join(f":c{n}" for n in range(len(clients)))
        params = {f"c{n}": value for n, value in enumerate(clients)}
        db.execute(text(f"DELETE FROM bi_mcp_audit WHERE client_id IN ({placeholders})"), params)
        db.execute(text(f"DELETE FROM bi_mcp_client WHERE id IN ({placeholders})"), params)
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
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        row = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                              "ORDER BY id LIMIT 1")).fetchone()
        if row is None:
            print("数据库里没有 admin 账号")
            return 1
        admin_id, admin_ver = int(row[0]), int(row[1] or 0)
        token = create_access_token(admin_id, admin_ver)
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {token}", "X-CSRF-Token": csrf}

        # ── 客户端 + 授权 + 令牌 + 打开写工具策略 ──
        client = session.post(f"{base}/api/admin/mcp/clients", headers=AH,
                              json={"name": CLIENT_NAME, "description": "写工具回归"}, timeout=20).json()
        client_pk, client_key, secret = client["id"], client["client_id"], client["secret"]
        grant = session.post(f"{base}/api/mcp/grants", headers=AH,
                             json={"client_id": client_key}, timeout=20).json()
        issued = session.post(f"{base}/api/mcp/token", json={
            "client_id": client_key, "client_secret": secret,
            "refresh_token": grant["refresh_token"]}, timeout=20).json()
        access = issued["access_token"]
        for code in WRITE_TOOLS:
            session.put(f"{base}/api/admin/mcp/clients/{client_pk}/tools", headers=AH,
                        json={"tool_code": code, "enabled": True}, timeout=20)

        def rpc(method: str, params: dict | None = None):
            return session.post(f"{base}/api/mcp/rpc",
                                headers={"Authorization": f"Bearer {access}"},
                                json={"jsonrpc": "2.0", "id": 1, "method": method,
                                      "params": params or {}}, timeout=120)

        def call(name: str, arguments: dict | None = None):
            return rpc("tools/call", {"name": name, "arguments": arguments or {}})

        def payload(resp):
            try:
                return json.loads(resp.json()["result"]["content"][0]["text"])
            except Exception:
                return {}

        names = [item["name"] for item in rpc("tools/list").json()["result"]["tools"]]
        check("写工具已按客户端策略下发", all(code in names for code in WRITE_TOOLS), True)
        check("发布工具也在目录里", "bi_publish_dashboard" in names, True)

        # ── 数据集：挑一个有维度 + 指标的 ──
        datasets = payload(call("bi_list_datasets"))["datasets"]
        target = next((d for d in datasets if "测试" in d["name"]), datasets[0])
        schema = payload(call("bi_get_dataset_schema", {"dataset_id": target["id"]}))
        check("数据集有可用字段", bool(schema["fields"]), True)

        components = payload(call("bi_list_components", {"dataset_id": target["id"], "limit": 5}))
        check("组件目录非空", len(components.get("catalog") or []) > 0, True)
        check("按字段给出推荐组件", len(components.get("recommended") or []) >= 3, True)

        # ── 新建草稿 + 草稿隔离 ──
        created = payload(call("bi_create_dashboard", {"name": f"{DRAFT_PREFIX}编排", "view_title": "总览"}))
        draft_id = created.get("dashboard_id")
        check("新建草稿", bool(draft_id), True)
        check("新草稿未发布", created.get("published"), False)

        mine = session.get(f"{base}/api/bi/dashboards", headers=AH, timeout=20).json()["dashboards"]
        card = next((d for d in mine if d["id"] == draft_id), None)
        check("草稿出现在「我的看板」", card is not None, True)
        check("草稿带 Agent 生成标", bool(card and card.get("agent_generated")), True)
        check("草稿仍是未发布", bool(card and card.get("published") is False), True)

        team = session.get(f"{base}/api/bi/dashboards/team", headers=AH, timeout=20).json()
        team_ids = {d["id"] for d in (team.get("my_shared") or []) + (team.get("shared_with_me") or [])}
        check("团队页看不到 Agent 草稿", draft_id in team_ids, False)

        detail = session.get(f"{base}/api/bi/dashboards/{draft_id}", headers=AH, timeout=20).json()
        check("详情带 agent_generated", detail.get("agent_generated"), True)

        # ── 加元素 ──
        first = call("bi_add_item", {"dashboard_id": draft_id, "component": "kpi.value",
                                     "dataset_id": target["id"], "title": "总销量"})
        check("加指标卡", first.status_code, 200)
        key1 = payload(first).get("item_key")
        second = call("bi_add_item", {"dashboard_id": draft_id, "component": "bar.dim",
                                      "dataset_id": target["id"], "title": "按维度分布"})
        third = call("bi_add_item", {"dashboard_id": draft_id, "component": "table.detail",
                                     "dataset_id": target["id"], "title": "明细"})
        check("连续加元素", second.status_code, 200)
        check("加明细表", third.status_code, 200)
        key2 = payload(second).get("item_key")
        key3 = payload(third).get("item_key")
        check("元素 key 由后端生成且不重复", len({key1, key2, key3}) == 3, True)

        t1 = payload(third).get("updated_at")
        bad = call("bi_add_item", {"dashboard_id": draft_id, "component": "bar.dim",
                                   "dataset_id": target["id"],
                                   "spec": {"binding": {"dimension": "不存在的字段"}}})
        check("编造字段 → 400", bad.status_code, 400)

        # ── 预览 ──
        preview = payload(call("bi_preview_dashboard", {"dashboard_id": draft_id}))
        check("预览通过", preview.get("ok"), True)
        check("预览卡片数 = 3", preview.get("cards_total"), 3)

        # ── 版面 ──
        laid = call("bi_set_layout", {
            "dashboard_id": draft_id,
            "items": [
                {"key": key1, "x": 0, "y": 0, "w": 464, "h": 104},
                {"key": key2, "x": 480, "y": 0, "w": 464, "h": 260},
            ],
        })
        check("auto 归一版面", laid.status_code, 200)
        ops = payload(laid).get("ops") or []
        check("归一后不越界", all(op["x"] + op["w"] <= 1440 for op in ops), True)
        check("归一后同排间距 16",
              all(b["x"] - (a["x"] + a["w"]) == 16
                  for a, b in zip(sorted(ops, key=lambda o: o["x"]), sorted(ops, key=lambda o: o["x"])[1:])
                  if a["y"] == b["y"]), True)

        over = call("bi_set_layout", {"dashboard_id": draft_id,
                                      "items": [{"key": key1, "x": 1200, "y": 0, "w": 400, "h": 104}]})
        check("越界 → 400", over.status_code, 400)

        gap = call("bi_set_layout", {
            "dashboard_id": draft_id, "mode": "exact",
            "items": [
                {"key": key1, "x": 0, "y": 0, "w": 464, "h": 104},
                {"key": key2, "x": 500, "y": 0, "w": 464, "h": 260},
            ],
        })
        check("间距错（exact）→ 400", gap.status_code, 400)

        # ── 乐观锁：用第一次写入前的 updated_at 保存 → 409 ──
        stale = call("bi_save_dashboard", {"dashboard_id": draft_id,
                                           "expected_updated_at": created.get("updated_at")})
        check("过期 updated_at → 409", stale.status_code, 409)

        latest = session.get(f"{base}/api/bi/dashboards/{draft_id}", headers=AH, timeout=20).json()
        saved = call("bi_save_dashboard", {"dashboard_id": draft_id,
                                           "expected_updated_at": latest["updated_at"]})
        check("最新 updated_at 保存成功", saved.status_code, 200)
        check("保存后仍未发布", payload(saved).get("published"), False)

        # ── 含错误卡片的草稿无法保存 ──
        broken = payload(call("bi_create_dashboard", {"name": f"{DRAFT_PREFIX}坏卡"}))["dashboard_id"]
        payload(call("bi_add_item", {"dashboard_id": broken, "component": "kpi.value",
                                     "dataset_id": target["id"]}))
        db.execute(
            text("UPDATE bi_canvas SET doc = jsonb_set(doc, '{views,0,items,0,spec,binding,dataset_id}', "
                 "'999999'::jsonb) WHERE id = :id"),
            {"id": broken},
        )
        db.commit()
        broken_row = session.get(f"{base}/api/bi/dashboards/{broken}", headers=AH, timeout=20).json()
        refused = call("bi_save_dashboard", {"dashboard_id": broken,
                                             "expected_updated_at": broken_row["updated_at"]})
        check("含错误卡片拒绝保存 → 400", refused.status_code, 400)

        # ── 发布必须用户点：Agent 单独调用 → 403 ──
        publish = call("bi_publish_dashboard", {"dashboard_id": draft_id})
        check("Agent 发布 → 403", publish.status_code, 403)

        # ── 用户手工看板：Agent 改 → 403 ──
        manual = session.post(f"{base}/api/bi/dashboards", headers=AH,
                              json={"name": f"{DRAFT_PREFIX}手工"}, timeout=20).json()
        manual_edit = call("bi_add_item", {"dashboard_id": manual["id"], "component": "kpi.value",
                                            "dataset_id": target["id"]})
        check("改手工看板 → 403", manual_edit.status_code, 403)

        # ── 每日额度（默认 20）：一直建到 429 ──
        quota_hit = False
        for index in range(30):
            resp = call("bi_create_dashboard", {"name": f"{DRAFT_PREFIX}额度{index:02d}"})
            if resp.status_code == 429:
                quota_hit = True
                break
        check("超出每日额度 → 429", quota_hit, True)

        # ── 审计 ──
        audits = session.get(f"{base}/api/admin/mcp/audit?limit=200", headers=AH,
                             timeout=20).json()["items"]
        tools = {item["tool"] for item in audits}
        check("写操作有审计", {"bi_create_dashboard", "bi_add_item", "bi_save_dashboard"} <= tools, True)
        check("拒绝也有审计", any(item["status"] in ("denied", "error") for item in audits), True)
        check("审计不含 secret", any("secret" in json.dumps(item) for item in audits), False)

        failed = [item for item in results if not item[0]]
        for ok, label, detail in results:
            if not ok:
                print(f"  ✗ {label} —— {detail}")
        print(f"\nMCP 写工具回归：{len(results) - len(failed)}/{len(results)} 通过")
        return 1 if failed else 0
    finally:
        _cleanup(db)
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
