"""每日刷新 + 增量同步（方案 A 的定时任务）.

做两件事，按数据源逐个执行：
    1. 跑数据源上配置的 refresh_sql（如 select dm.refresh_bangdan()），把远端新增的那一天并进视图；
    2. 把该数据源已接入的表重新同步 —— 有 dt 的表按 dt 幂等追加，历史快照保留。

用法（在 backend 目录下）：
    .venv/bin/python scripts/daily_refresh.py                # 跑全部数据库类数据源
    .venv/bin/python scripts/daily_refresh.py --source-id 3  # 只跑某个数据源
    .venv/bin/python scripts/daily_refresh.py --dry-run      # 只看计划，不动数据

退出码：全部成功 0；有任一数据源失败 1（失败的会打印原因，不影响其它数据源）。
"""

from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.sources import repository as repo  # noqa: E402

DB_TYPES = {"postgresql", "mysql", "mariadb", "tidb", "doris", "starrocks", "clickhouse",
            "sqlserver", "oracle", "db2", "kingbase", "redshift", "presto", "hive", "impala"}


def registered_tables(db, source_id: int) -> list[str]:
    rows = db.execute(
        text("SELECT source_table FROM bi_source_table WHERE source_id = :s ORDER BY id"),
        {"s": source_id},
    ).fetchall()
    return [r[0] for r in rows]


def main() -> int:
    ap = argparse.ArgumentParser(description="每日刷新远端视图 + 增量同步已接入表")
    ap.add_argument("--source-id", type=int, action="append", help="只跑指定数据源（可重复）")
    ap.add_argument("--dry-run", action="store_true", help="只打印计划，不执行")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        ids = args.source_id or [
            r[0] for r in db.execute(text("SELECT id FROM bi_source ORDER BY id")).fetchall()
        ]
        print(f"[daily-refresh] {time.strftime('%Y-%m-%d %H:%M:%S')} 开始，数据源 {ids}")
        failed = 0

        for sid in ids:
            src = repo.get_source(db, sid)
            if src is None:
                print(f"  - 数据源 {sid}：不存在，跳过")
                continue
            name = src.get("name") or sid
            if str(src.get("ds_type") or "") not in DB_TYPES:
                print(f"  - [{name}] 非数据库类数据源，跳过")
                continue

            sql_text = str(src.get("refresh_sql") or "").strip()
            tables = registered_tables(db, sid)
            plan = f"refresh={'有' if sql_text else '无'} 表={len(tables)}"
            if args.dry_run:
                print(f"  - [{name}] {plan}（dry-run）")
                continue

            try:
                if sql_text:
                    fresh = repo.run_refresh_sql(src)
                    print(f"  - [{name}] 远端刷新：{fresh.get('result') or '已执行'}")
                if not tables:
                    print(f"  - [{name}] 没有已接入表，跳过同步")
                    continue
                result = repo.sync_tables(db, src, tables, src.get("owner_id"))
                for t in result["tables"]:
                    print(
                        f"  - [{name}] {t['source_table']} → {t['mode']} "
                        f"共 {t['rows']} 行（本批 {t['rows_in_batch']}，dt {t['dt_min']}~{t['dt_max']} "
                        f"共 {t['dt_count']} 天）"
                    )
            except Exception as exc:  # 单个数据源失败不拖垮其它源
                failed += 1
                print(f"  - [{name}] 失败：{str(exc)[:200]}")

        print(f"[daily-refresh] 结束，失败 {failed} 个")
        return 1 if failed else 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
