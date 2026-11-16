"""看板冒烟：两个业务看板 × 全部视图 × 参数切换 × 浮层动作.

用法：
    cd backend && ./.venv/bin/python -m scripts.smoke_dashboards
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

BASE = "http://127.0.0.1:8300"
ACCOUNT = ("admin", "Admin@123456")


class Client:
    def __init__(self) -> None:
        self.jar = CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token = ""
        self.csrf = ""

    def call(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(f"{BASE}{path}", data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.token:
            req.add_header("Authorization", f"Bearer {self.token}")
        if self.csrf and method not in ("GET", "HEAD"):
            req.add_header("X-CSRF-Token", self.csrf)
        try:
            with self.opener.open(req) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode()
            raise RuntimeError(f"{method} {path} -> {exc.code}: {detail[:300]}") from exc

    def login(self) -> None:
        self.csrf = self.call("GET", "/api/auth/csrf-token").get("csrf_token", "")
        data = self.call("POST", "/api/auth/login", {"account": ACCOUNT[0], "password": ACCOUNT[1]})
        self.token = data["data"]["access_token"]


def main() -> int:
    client = Client()
    client.login()

    failures: list[str] = []
    dashboards = client.call("GET", "/api/bi/dashboards")["dashboards"]
    for brief in dashboards:
        dash_id = brief["id"]
        doc = client.call("GET", f"/api/bi/dashboards/{dash_id}")["doc"]
        print(f"\n== {brief['name']} (id={dash_id}, views={len(doc['views'])})")
        for view in doc["views"]:
            out = client.call("POST", f"/api/bi/dashboards/{dash_id}/render",
                              {"view": view["key"], "params": {}})
            cards = out["cards"]
            errors = {k: v.get("error") for k, v in cards.items() if v.get("error")}
            total = len(cards)
            print(f"  - {view['key']:<8} cards={total:<3} errors={len(errors)} "
                  f"params={list(out['params'])[:5]}")
            if errors:
                failures.append(f"{brief['name']} / {view['key']}: {list(errors.items())[:2]}")

            # 参数切换必须改变 SQL
            first_code = next((i["component"] for i in view["items"]
                               if cards.get(i["key"], {}).get("sql")), None)
            if first_code and out["params"]:
                key = next(iter(out["params"]))
                current = out["params"][key]
                option_field = next((f for f in out["param_defs"] if f["id"] == key), None)
                if option_field and option_field["options"]:
                    alt = next((o["v"] for o in option_field["options"] if o["v"] != current), None)
                    if alt is not None:
                        out2 = client.call("POST", f"/api/bi/dashboards/{dash_id}/render",
                                           {"view": view["key"], "params": {**out["params"], key: alt}})
                        used = [c.get("params_used", {}).get(key)
                                for c in out2["cards"].values() if c.get("params_used")]
                        if used and all(value != alt for value in used):
                            failures.append(f"{brief['name']} / {view['key']}: 参数 {key}={alt} 未注入任何卡片")

            # 动作：打开第一个带动作的卡片
            action_item = next((i for i in view["items"] if i.get("action")), None)
            if action_item:
                row_params = {}
                if action_item.get("row_action"):
                    rows = cards[action_item["key"]].get("rows") or []
                    if rows:
                        rule = (action_item["row_action"].get("params") or {})
                        for k, v in rule.items():
                            if isinstance(v, str) and v.startswith("$row."):
                                row_params[k] = rows[0].get(v[5:])
                        ov = client.call("POST", f"/api/bi/dashboards/{dash_id}/overlay", {
                            "item_key": action_item["key"], "view": view["key"], "trigger": "row",
                            "params": out["params"], "action_params": row_params,
                        })
                        print(f"    drawer → {ov['title']} rows={len(ov['payload'].get('rows') or [])}")
                else:
                    ov = client.call("POST", f"/api/bi/dashboards/{dash_id}/overlay", {
                        "item_key": action_item["key"], "view": view["key"], "trigger": "primary",
                        "params": out["params"], "action_params": {},
                    })
                    print(f"    modal  → {ov['title']} kind={ov['payload'].get('kind')}")

    if failures:
        print("\n[FAIL]")
        for item in failures:
            print("  -", item)
        return 1
    print("\n[PASS] 两个看板全部视图渲染通过，参数切换与浮层动作可用")
    return 0


if __name__ == "__main__":
    sys.exit(main())
