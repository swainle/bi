"""数据库导入队列：按表预留，PG advisory lock 保证同一任务只由一个进程执行。"""

from __future__ import annotations

from app.timezone import time_text

import threading
import time
import uuid

from sqlalchemy import column, select, table, text
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal, engine
from app.sources import repository as repo

class ImportConflict(repo.SourceError):
    pass


def occupied(db, source_id: int) -> dict[str, str]:
    rows = db.execute(text(
        "SELECT source_table, 'done' AS state FROM bi_source_table WHERE source_id = :s "
        "UNION ALL SELECT source_table, state FROM bi_source_import "
        "WHERE source_id = :s AND state IN ('queued','reading','writing')"
    ), {"s": source_id}).fetchall()
    return {r[0]: r[1] for r in rows}


def create(db, source_id: int, names: list[str], owner_id: int) -> str:
    if not isinstance(names, list) or not names or len(names) > 200 or any(
        not isinstance(n, str) or not n.strip() or len(n) > 512 for n in names
    ):
        raise repo.SourceError("请选择 1 至 200 张表，表名不能为空或超过 512 字符")
    names = list(dict.fromkeys(n.strip() for n in names))
    source = table("bi_source", column("id"))
    exists = db.execute(select(source.c.id).where(source.c.id == source_id).with_for_update()).scalar()
    if exists is None:
        raise repo.SourceError("数据源不存在")
    blocked = occupied(db, source_id)
    conflicts = [n for n in names if n in blocked]
    if conflicts:
        raise ImportConflict(f"这些表已接入或正在等待/执行导入：{'、'.join(conflicts[:5])}")
    job_id = uuid.uuid4().hex
    try:
        db.execute(text(
            "INSERT INTO bi_source_import (job_id, source_id, owner_id, source_table) "
            "VALUES (:j, :s, :u, :t)"
        ), [{"j": job_id, "s": source_id, "u": owner_id, "t": name} for name in names])
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ImportConflict("选中的表已有导入任务，请刷新后重试") from exc
    return job_id


def list_jobs(db, owner_id: int) -> list[dict]:
    rows = db.execute(text(
        "SELECT t.*, s.name AS source_name FROM bi_source_import t "
        "JOIN bi_source s ON s.id = t.source_id WHERE t.owner_id = :u AND ("
        "t.job_id IN (SELECT DISTINCT job_id FROM bi_source_import WHERE owner_id = :u "
        "AND state IN ('queued','reading','writing')) OR t.job_id IN ("
        "SELECT job_id FROM bi_source_import WHERE owner_id = :u "
        "GROUP BY job_id ORDER BY max(created_at) DESC LIMIT 20)) "
        "ORDER BY t.created_at DESC, t.id"
    ), {"u": owner_id}).fetchall()
    jobs: dict[str, dict] = {}
    for row in rows:
        item = dict(row._mapping)
        job = jobs.setdefault(item["job_id"], {
            "id": item["job_id"], "source_id": item["source_id"], "source_name": item["source_name"],
            "created_at": time_text(item["created_at"]), "tables": [],
        })
        job["tables"].append({key: item[key] for key in
                              ("source_table", "state", "rows_read", "rows_written", "error")})
    return list(jobs.values())


def active_tables(db) -> list[dict]:
    return [dict(row._mapping) for row in db.execute(text(
        "SELECT source_id, source_table, state FROM bi_source_import "
        "WHERE state IN ('queued','reading','writing') ORDER BY id"
    ))]


def _update(item_id: int, **values) -> None:
    with SessionLocal() as db:
        assignments = ", ".join(f"{key} = :{key}" for key in values)
        db.execute(text(f"UPDATE bi_source_import SET {assignments}, updated_at = now() "
                        "WHERE id = :id AND state IN ('queued','reading','writing')"),
                   {**values, "id": item_id})
        db.commit()


def _run_job(job_id: str) -> None:
    with SessionLocal() as db:
        items = [dict(r._mapping) for r in db.execute(text(
            "SELECT * FROM bi_source_import WHERE job_id = :j ORDER BY id"
        ), {"j": job_id})]
        if not items:
            return
        src = repo.get_source(db, items[0]["source_id"])
    if src is None:
        for item in items:
            _update(item["id"], state="failed", error="数据源已删除")
        return

    # 拿到任务锁后仍为读取/写入态，说明旧执行进程中断；不静默重跑未知进度。
    for item in items:
        if item["state"] not in ("reading", "writing"):
            continue
        with SessionLocal() as db:
            existing = db.execute(text(
                "SELECT row_count FROM bi_source_table WHERE source_id = :s AND source_table = :t"
            ), {"s": src["id"], "t": item["source_table"]}).fetchone()
        if existing:
            _update(item["id"], state="done", rows_written=existing[0])
        else:
            _update(item["id"], state="failed", rows_written=0, error="任务执行中断，请重新创建导入任务")
    pending = [item for item in items if item["state"] == "queued"]
    if not pending:
        return
    _update(pending[0]["id"], state="reading")
    try:
        repo.run_refresh_sql(src)
    except Exception as exc:
        for item in pending:
            _update(item["id"], state="failed", error=str(exc)[:300], rows_written=0)
        return

    for item in pending:
        item_id = item["id"]
        _update(item_id, state="reading")
        last_time, last_stage, read_count = 0.0, "", 0

        def progress(stage, count):
            nonlocal last_time, last_stage, read_count
            if stage == "reading":
                read_count = count
            now = time.monotonic()
            if stage != last_stage or now - last_time >= 0.5:
                values = {"state": stage, "rows_read": read_count}
                if stage == "writing":
                    values["rows_written"] = count
                _update(item_id, **values)
                last_time, last_stage = now, stage

        try:
            with SessionLocal() as db:
                # 兼容旧同步入口已完成接入的竞争情况，不覆盖它的数据。
                existing = db.execute(text(
                    "SELECT row_count FROM bi_source_table WHERE source_id = :s AND source_table = :t"
                ), {"s": src["id"], "t": item["source_table"]}).fetchone()
                if existing:
                    _update(item_id, state="done", rows_written=existing[0])
                    continue
                result = repo.sync_tables(db, src, [item["source_table"]], item["owner_id"],
                                          on_progress=progress, refresh=False)
            rows = result["tables"][0]["rows_in_batch"]
            _update(item_id, state="done", rows_read=rows, rows_written=rows)
        except Exception as exc:
            _update(item_id, state="failed", error=str(exc)[:300], rows_written=0)


def run_once() -> bool:
    with engine.connect() as conn:
        jobs = conn.execute(text(
            "SELECT job_id FROM bi_source_import WHERE state IN ('queued','reading','writing') "
            "GROUP BY job_id ORDER BY min(created_at) LIMIT 20"
        )).scalars().all()
        conn.commit()
        for job_id in jobs:
            key = f"source-import:{job_id}"
            locked = conn.execute(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": key}).scalar()
            conn.commit()
            if not locked:
                continue
            try:
                _run_job(job_id)
            finally:
                conn.execute(text("SELECT pg_advisory_unlock(hashtext(:key))"), {"key": key})
                conn.commit()
            return True
    return False


def start_background() -> threading.Event:
    stop = threading.Event()

    def loop():
        while not stop.is_set():
            try:
                if run_once():
                    continue
            except Exception as exc:
                print(f"[source-import] 队列执行失败：{str(exc)[:200]}")
            stop.wait(2)

    threading.Thread(target=loop, name="source-import", daemon=True).start()
    return stop
