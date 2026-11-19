"""敏感字段自动识别回归（R13）—— 新数据集默认脱敏 + 三入口一致 + 手工关闭审计.

用法（后端 :8300 在跑）：
    DATABASE_URL="postgresql://.../mingcebi_dev" \
      backend/.venv/bin/python scripts/sensitive_field_check.py [--base-url http://127.0.0.1:8300]

覆盖：
    1. 新建含「手机号 / 邮箱 / 薪资」字段的数据集 → 自动写入脱敏规则；
    2. 数据集查询结果已脱敏（与导出 / AI / MCP 共用同一套规则）；
    3. 手工删除脱敏 → 审计留痕；再次查询恢复明文（负责人显式操作）。
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import requests
from sqlalchemy import text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from app.database import SessionLocal  # noqa: E402
from app.services.auth import create_access_token  # noqa: E402

PREFIX = "/api/bi/semantic"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8300")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    db = SessionLocal()
    results: list[tuple[bool, str, str]] = []
    dataset_id: int | None = None

    def check(label: str, actual, expected) -> None:
        results.append((actual == expected, label, f"期望 {expected}，实际 {actual}"))

    session = requests.Session()
    try:
        if session.get(f"{base}/api/health", timeout=5).status_code != 200:
            print("后端没在跑？先启动 :8300")
            return 1
        row = db.execute(text("SELECT id, token_version FROM users WHERE role = 'admin' "
                              "ORDER BY id LIMIT 1")).fetchone()
        csrf = session.get(f"{base}/api/auth/csrf-token", timeout=10).json().get("csrf_token", "")
        AH = {"Authorization": f"Bearer {create_access_token(int(row[0]), int(row[1] or 0))}",
              "X-CSRF-Token": csrf}

        name = f"QA-敏感字段-{uuid.uuid4().hex[:6]}"
        created = session.post(f"{base}{PREFIX}/datasets", headers=AH, json={
            "name": name, "conn_mode": "extract",
            "sql": "SELECT '13800138000' AS 手机号, 'alice@corp.com' AS 邮箱, 18000 AS 薪资",
        }, timeout=60)
        check("创建数据集 200", created.status_code, 200)
        if created.status_code == 200:
            dataset_id = int(created.json().get("id") or 0)
            masks = db.execute(text(
                "SELECT column_name, mask_type FROM bi_dataset_column_mask "
                "WHERE dataset_id = :d ORDER BY column_name"), {"d": dataset_id}).fetchall()
            columns = {r[0]: r[1] for r in masks}
            check("手机号自动脱敏", columns.get("手机号"), "phone")
            check("邮箱自动脱敏", columns.get("邮箱"), "email")
            check("薪资自动脱敏", columns.get("薪资"), "custom")

            queried = session.post(f"{base}{PREFIX}/datasets/{dataset_id}/query", headers=AH,
                                   json={"columns": [{"name": "手机号"}, {"name": "邮箱"},
                                                     {"name": "薪资"}], "limit": 10}, timeout=60)
            check("查询 200", queried.status_code, 200)
            rows = (queried.json() or {}).get("rows") or []
            flat = str(rows)
            check("查询结果手机号已打码", "13800138000" in flat, False)
            check("查询结果邮箱已打码", "alice@corp.com" in flat, False)
            check("查询结果薪资已打码", "18000" in flat, False)

            deleted = session.delete(f"{base}{PREFIX}/datasets/{dataset_id}/security/masks/手机号",
                                     headers=AH, timeout=20)
            check("手工关闭脱敏 200", deleted.status_code, 200)
            audit = db.execute(text(
                "SELECT count(*) FROM bi_audit_logs WHERE action = 'dataset.mask.delete' "
                "AND resource_id = :d"), {"d": dataset_id}).scalar() or 0
            check("关闭脱敏写审计", int(audit) >= 1, True)
            again = session.post(f"{base}{PREFIX}/datasets/{dataset_id}/query", headers=AH,
                                 json={"columns": [{"name": "手机号"}], "limit": 10}, timeout=60)
            check("关闭后恢复明文", "13800138000" in str((again.json() or {}).get("rows")), True)
    finally:
        try:
            if dataset_id:
                from app.semantic import repository as sem_repo

                sem_repo.delete_dataset(db, dataset_id)
            db.execute(text("DELETE FROM bi_audit_logs WHERE action = 'dataset.mask.auto' "
                            "AND detail::text LIKE '%QA-敏感字段%'"))
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
