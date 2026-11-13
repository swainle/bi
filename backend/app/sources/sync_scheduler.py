"""已接入表的自动同步调度（P4：数据新鲜度 / 定时同步）.

口径：
    * 只有 `sync_interval_minutes > 0` 且 `synced_at + 间隔 <= now` 的表会被重拉；
    * 每轮有上限（`BI_SYNC_MAX_PER_RUN`，默认 3），避免一次把源库和本地库同时打满；
    * 每张表独立 Session：一张失败不影响其它表，失败原因落 `last_sync_error`；
    * 多进程部署用 PG advisory lock 保证同一时刻只有一个实例在同步。

旋钮：
    BI_SYNC_INTERVAL_SECONDS  检查间隔，默认 60；0 = 关闭调度（表上的配置保留）
    BI_SYNC_MAX_PER_RUN       每轮最多同步几张表，默认 3
"""

from __future__ import annotations

import os
import threading
import time

from sqlalchemy import text

from app.database import SessionLocal, engine
from app.sources import repository as repo

LOCK_KEY = 872302


def interval_seconds() -> int:
    try:
        return max(0, int(os.getenv("BI_SYNC_INTERVAL_SECONDS", "60") or "60"))
    except ValueError:
        return 60


def max_per_run() -> int:
    try:
        return max(1, int(os.getenv("BI_SYNC_MAX_PER_RUN", "3") or "3"))
    except ValueError:
        return 3


def run_once(limit: int | None = None) -> dict:
    """同步一轮到期表；返回本轮结果（真实行数 / 失败原因）."""
    db = SessionLocal()
    try:
        due = repo.due_tables(db, limit or max_per_run())
    finally:
        db.close()

    results: list[dict] = []
    for item in due:
        session = SessionLocal()
        try:
            res = repo.resync_table(session, int(item["id"]), None)
            synced = res.get("synced") or {}
            results.append({
                "id": item["id"], "source_table": item["source_table"],
                "ok": True, "rows": synced.get("rows") or 0,
            })
        except Exception as exc:  # 单表失败不影响其它表
            results.append({
                "id": item["id"], "source_table": item["source_table"],
                "ok": False, "error": str(exc)[:200],
            })
        finally:
            session.close()
    return {
        "due": len(due),
        "synced": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }


def run_once_locked() -> dict:
    """带 PG advisory lock 的一轮同步（多 worker 只有一个真正执行）."""
    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}).scalar()
        if not got:
            return {"skipped": "locked", "due": 0, "synced": 0, "failed": 0, "results": []}
        try:
            return run_once()
        finally:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})
                conn.commit()
            except Exception:
                pass


def loop_forever() -> None:
    while True:
        interval = interval_seconds()
        if interval <= 0:
            return
        try:
            summary = run_once_locked()
            if summary.get("due"):
                print(f"[sync] {summary['synced']} 成功 / {summary['failed']} 失败")
        except Exception as exc:  # 调度失败不能拖垮进程
            print(f"[sync] 调度失败：{str(exc)[:200]}")
        time.sleep(interval)


def start_background() -> threading.Thread | None:
    interval = interval_seconds()
    if interval <= 0:
        print("[sync] 自动同步已关闭（BI_SYNC_INTERVAL_SECONDS=0）")
        return None
    thread = threading.Thread(target=loop_forever, name="source-sync", daemon=True)
    thread.start()
    print(f"[sync] 自动同步已启动：每 {interval}s 检查一次，每轮最多 {max_per_run()} 张表")
    return thread


__all__ = ["interval_seconds", "max_per_run", "run_once", "run_once_locked",
           "loop_forever", "start_background"]
