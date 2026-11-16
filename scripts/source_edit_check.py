"""数据源「编辑」回归（2026-11-15）—— 真实接口 + 真实源库，跑完自动清场.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://cavan-m4max@127.0.0.1:5432/mingcebi_dev" \
      backend/.venv/bin/python scripts/source_edit_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 改主机 / 端口后真的连到新地址（测连通 + 读源库表清单），改错地址就连接失败；
    2. 「测连通」带 body 时按「已存配置 + 本次修改」测，不必重填密码（改完即测、不落库）；
    3. 名称校验：空名 / 重名拒绝；只改名不动别的字段；
    4. 归属部门可改、返回 dept_name；地址 / 密码 / 连接串不会出现在列表里；
    5. 连接串数据源：只改名称不会把 URI 清空（旧实现 payload 缺 uri 就写空串），显式清空才切回主机模式；
    6. 编辑写审计 source.update（detail 不含密码 / 连接串）。
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

NAME_A = "QA 编辑数据源"
NAME_B = "QA 编辑连接串数据源"
DEPT_NAME = "QA 编辑部门"
LOCAL_DB = "mingcebi_dev"
PG_USER = "cavan-m4max"
DEAD_PORT = 5999  # 本机没人监听，连接被拒（不走 DNS 超时）


def cleanup(db) -> None:
    db.execute(text("DELETE FROM bi_source WHERE name = ANY(:n)"), {"n": [NAME_A, NAME_B]})
    db.execute(text("DELETE FROM departments WHERE name = :n"), {"n": DEPT_NAME})
    db.execute(text("DELETE FROM bi_audit_logs WHERE resource_type = 'source' AND action = 'source.update' "
                    "AND resource_id NOT IN (SELECT id FROM bi_source)"))
    db.commit()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    session = requests.Session()
    results: list[tuple[bool, str, str]] = []

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    try:
        cleanup(db)
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1

        dept_id = int(db.execute(text(
            "INSERT INTO departments (name, is_deleted) VALUES (:n, false) RETURNING id"),
            {"n": DEPT_NAME}).scalar())
        admin = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                                "ORDER BY id LIMIT 1")).fetchone()
        db.commit()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        H = {"Authorization": f"Bearer {create_access_token(int(admin[0]), int(admin[1] or 0))}",
             "X-CSRF-Token": csrf}

        def create(**body) -> requests.Response:
            payload = {"name": NAME_A, "ds_type": "postgresql", "host": "127.0.0.1",
                       "port": 5432, "db_name": LOCAL_DB, "username": PG_USER,
                       "password": "", "uri": "", "dept_id": None, **body}
            return session.post(f"{base}/api/bi/sources", headers=H, json=payload, timeout=30)

        def src_row(name: str) -> dict:
            res = session.get(f"{base}/api/bi/sources", headers=H, timeout=30)
            return next((s for s in res.json().get("sources", []) if s["name"] == name), {})

        # ── 1. 建一个「地址是错的」数据源 ────────────────────────
        r = create(port=DEAD_PORT)
        check("新建数据源", r.status_code, 200)
        sid = r.json().get("id")
        bad = session.post(f"{base}/api/bi/sources/{sid}/test", headers=H, timeout=40)
        check("原始地址连不上（反例）", bad.status_code, 400)
        check("错误信息是人话", "连接失败" in bad.json().get("detail", ""), True)

        # ── 2. 编辑主机 / 端口 → 真的连得上 ──────────────────────
        r = session.patch(f"{base}/api/bi/sources/{sid}", headers=H,
                          json={"port": 5432}, timeout=30)
        check("改端口", r.status_code, 200)
        check("响应带回新端口", (r.json() or {}).get("port"), 5432)
        check("响应带回 dept_name 键", "dept_name" in (r.json() or {}), True)
        ok = session.post(f"{base}/api/bi/sources/{sid}/test", headers=H, timeout=40)
        check("改完能连上", ok.json().get("ok"), True)
        tables = session.get(f"{base}/api/bi/sources/{sid}/tables", headers=H, timeout=60)
        names = [t["table"] for t in tables.json().get("tables", [])]
        check("从新地址读到源库表", len(names) > 0, True)

        # ── 3. 「测连通」按未保存的修改测，不落库 ────────────────
        r = session.post(f"{base}/api/bi/sources/{sid}/test", headers=H,
                         json={"host": "127.0.0.1", "port": DEAD_PORT}, timeout=40)
        check("带 body 测未保存地址（反例）", r.status_code, 400)
        check("测完不改库", src_row(NAME_A).get("port"), 5432)

        # ── 4. 名称校验 ─────────────────────────────────────────
        r = session.patch(f"{base}/api/bi/sources/{sid}", headers=H, json={"name": "  "}, timeout=30)
        check("空名拒绝", r.status_code, 400)
        check("空名原因", "名称不能为空" in r.json().get("detail", ""), True)
        r = session.patch(f"{base}/api/bi/sources/{sid}", headers=H,
                          json={"name": NAME_A + "改"}, timeout=30)
        check("改名成功", r.status_code, 200)
        check("改名落库", src_row(NAME_A + "改").get("id"), sid)
        session.patch(f"{base}/api/bi/sources/{sid}", headers=H, json={"name": NAME_A}, timeout=30)
        r = create(name=NAME_B, uri="postgresql://cavan-m4max@127.0.0.1:5432/" + LOCAL_DB)
        check("建连接串数据源", r.status_code, 200)
        sid_uri = r.json().get("id")
        r = session.patch(f"{base}/api/bi/sources/{sid}", headers=H,
                          json={"name": NAME_B}, timeout=30)
        check("重名拒绝", r.status_code, 400)
        check("重名原因", "名称已存在" in r.json().get("detail", ""), True)

        # ── 5. 归属部门 ─────────────────────────────────────────
        r = session.patch(f"{base}/api/bi/sources/{sid}", headers=H, json={"dept_id": dept_id},
                          timeout=30)
        check("改归属部门", (r.json() or {}).get("dept_name"), DEPT_NAME)
        check("列表带部门名", src_row(NAME_A).get("dept_name"), DEPT_NAME)
        session.patch(f"{base}/api/bi/sources/{sid}", headers=H, json={"dept_id": None}, timeout=30)
        check("可以清回全局", src_row(NAME_A).get("dept_name"), "")

        # ── 6. 连接串：只改名不能把 URI 清空 ─────────────────────
        check("列表只暴露 uri 布尔", src_row(NAME_B).get("uri"), True)
        session.patch(f"{base}/api/bi/sources/{sid_uri}", headers=H,
                      json={"name": NAME_B + "改"}, timeout=30)
        check("只改名保住连接串", src_row(NAME_B + "改").get("uri"), True)
        r = session.post(f"{base}/api/bi/sources/{sid_uri}/test", headers=H, timeout=40)
        check("连接串仍可用", r.json().get("ok"), True)
        session.patch(f"{base}/api/bi/sources/{sid_uri}", headers=H,
                      json={"uri": "", "host": "127.0.0.1", "port": 5432, "db_name": LOCAL_DB,
                            "username": PG_USER}, timeout=30)
        check("显式清空连接串", src_row(NAME_B + "改").get("uri"), False)
        r = session.post(f"{base}/api/bi/sources/{sid_uri}/test", headers=H, timeout=40)
        check("切回主机模式仍可用", r.json().get("ok"), True)

        # ── 7. 响应 / 审计不泄露凭据 ────────────────────────────
        raw = session.get(f"{base}/api/bi/sources", headers=H, timeout=30).text
        check("列表不含密码字段", '"password"' in raw, False)
        check("列表不含连接串原文", "postgresql://cavan-m4max" in raw, False)
        audit = db.execute(text(
            "SELECT detail FROM bi_audit_logs WHERE action = 'source.update' "
            "AND resource_id = :i ORDER BY id DESC LIMIT 1"), {"i": sid}).fetchone()
        check("写了编辑审计", bool(audit), True)
        detail = audit[0] if audit else {}
        detail_text = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
        check("审计只记改了哪些键", "fields" in detail_text, True)
        check("审计不含密码", "password" in detail_text.lower(), False)
        check("审计不含连接串", "postgresql://" in detail_text, False)

        # ── 8. 清场 ────────────────────────────────────────────
        for ident in (sid, sid_uri):
            r = session.delete(f"{base}/api/bi/sources/{ident}", headers=H, timeout=30)
            check(f"清理数据源 {ident}", r.status_code, 200)
        check("清场干净", src_row(NAME_A).get("name"), None)
    finally:
        cleanup(db)
        db.close()

    passed = sum(1 for ok, _, _ in results if ok)
    for ok, label, extra in results:
        print(("  ✓ " if ok else "  ✗ ") + label + ("" if ok else f"  — {extra}"))
    print(f"\n{passed}/{len(results)} 通过")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
