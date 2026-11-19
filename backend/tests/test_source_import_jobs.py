from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.sources import import_jobs as jobs, repository as repo


@pytest.fixture
def environment(monkeypatch):
    meta = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    local = create_engine("sqlite://")
    remote = create_engine("sqlite://")
    @event.listens_for(meta, "connect")
    def now(conn, record):
        conn.create_function("now", 0, lambda: "2026-11-18 12:00:00")
    @event.listens_for(local, "connect")
    def transactional_ddl(conn, record):
        conn.isolation_level = None
    @event.listens_for(local, "begin")
    def begin(conn):
        conn.exec_driver_sql("BEGIN")
    with meta.begin() as conn:
        conn.execute(text("CREATE TABLE bi_source (id integer primary key, name text)"))
        conn.execute(text("INSERT INTO bi_source VALUES (1,'测试源'),(2,'其他源')"))
        conn.execute(text("CREATE TABLE bi_source_table (source_id integer, source_table text, local_table text, row_count integer)"))
        conn.execute(text("""CREATE TABLE bi_source_import (
            id integer primary key, job_id text, source_id integer, owner_id integer,
            source_table text, state text DEFAULT 'queued', rows_read integer DEFAULT 0,
            rows_written integer DEFAULT 0, error text DEFAULT '',
            created_at text DEFAULT CURRENT_TIMESTAMP, updated_at text DEFAULT CURRENT_TIMESTAMP)"""))
        conn.execute(text("""CREATE UNIQUE INDEX uq_source_import_active ON bi_source_import(source_id,source_table)
            WHERE state IN ('queued','reading','writing')"""))
    with remote.begin() as conn:
        conn.execute(text("CREATE TABLE orders (amount integer)"))
        conn.execute(text("INSERT INTO orders VALUES (10),(20),(30)"))
        conn.execute(text("CREATE TABLE products (name text)"))
        conn.execute(text("INSERT INTO products VALUES ('A')"))
    sessions = sessionmaker(bind=meta)
    monkeypatch.setattr(jobs, "SessionLocal", sessions)
    monkeypatch.setattr(repo, "local_engine", local)
    monkeypatch.setattr(repo, "engine_for", lambda src: remote)
    monkeypatch.setattr(repo, "get_source", lambda db, id: {"id": id, "name": "测试源"})
    refreshed = []
    monkeypatch.setattr(repo, "run_refresh_sql", lambda src: refreshed.append(src["id"]))
    def local_columns(name):
        inspector = inspect(local)
        return {c["name"] for c in inspector.get_columns(name)} if inspector.has_table(name) else set()
    monkeypatch.setattr(repo, "_local_columns", local_columns)
    def register(db, *, source_id, source_table, local_table, stats, **kwargs):
        db.execute(text("INSERT INTO bi_source_table VALUES (:s,:t,:l,:r)"),
                   {"s": source_id, "t": source_table, "l": local_table, "r": stats["rows"]})
        db.commit()
    monkeypatch.setattr(repo, "_register", register)
    yield SimpleNamespace(meta=meta, local=local, remote=remote, sessions=sessions, refreshed=refreshed)
    meta.dispose(); local.dispose(); remote.dispose()


def test_durable_queue_duplicate_protection_and_owner_scope(environment):
    with environment.sessions() as db:
        job_id = jobs.create(db, 1, ["orders", "orders", "products"], 7)
        items = jobs.list_jobs(db, 7)[0]
        assert items["id"] == job_id
        assert len(items["tables"]) == 2
        assert jobs.list_jobs(db, 8) == []
        assert jobs.occupied(db, 1) == {"orders": "queued", "products": "queued"}
        assert len(jobs.active_tables(db)) == 2
        with pytest.raises(jobs.ImportConflict):
            jobs.create(db, 1, ["orders"], 8)
        db.rollback()
    # 记录来自数据库；换 Session 仍能读到，不依赖创建请求生命周期。
    with environment.sessions() as db:
        assert jobs.list_jobs(db, 7)[0]["tables"][0]["state"] == "queued"


def test_real_import_continues_after_failure_and_retry(environment):
    with environment.sessions() as db:
        job_id = jobs.create(db, 1, ["orders", "missing", "products"], 7)
    jobs._run_job(job_id)
    with environment.sessions() as db:
        result = jobs.list_jobs(db, 7)[0]
        items = {t["source_table"]: t for t in result["tables"]}
        assert items["orders"]["state"] == "done"
        assert items["orders"]["rows_read"] == items["orders"]["rows_written"] == 3
        assert items["missing"]["state"] == "failed"
        assert items["missing"]["error"]
        assert items["products"]["rows_written"] == 1
        assert jobs.active_tables(db) == []
        with pytest.raises(jobs.ImportConflict):
            jobs.create(db, 1, ["orders"], 7)
        db.rollback()
        retry_id = jobs.create(db, 1, ["missing"], 7)
    with environment.remote.begin() as conn:
        conn.execute(text("CREATE TABLE missing (value integer)"))
        conn.execute(text("INSERT INTO missing VALUES (42)"))
    jobs._run_job(retry_id)
    with environment.sessions() as db:
        assert any(j["id"] == retry_id and j["tables"][0]["state"] == "done" for j in jobs.list_jobs(db, 7))
    assert environment.refreshed == [1, 1]
    with environment.local.connect() as conn:
        name = repo._local_name("bi_src", 1, "orders")
        assert conn.execute(text(f'SELECT sum(amount) FROM "{name}"')).scalar() == 60


def test_row_limit_is_failure_not_silent_truncation(environment, monkeypatch):
    monkeypatch.setattr(repo, "MAX_ROWS", 2)
    with environment.sessions() as db:
        job_id = jobs.create(db, 1, ["orders"], 7)
    jobs._run_job(job_id)
    with environment.sessions() as db:
        item = jobs.list_jobs(db, 7)[0]["tables"][0]
        assert item["state"] == "failed"
        assert "上限" in item["error"]
        assert item["rows_written"] == 0
        assert db.execute(text("SELECT count(*) FROM bi_source_table")).scalar() == 0
    assert not inspect(environment.local).has_table(repo._local_name("bi_src", 1, "orders"))


def test_failed_write_rolls_back_old_table(environment):
    pd.DataFrame({"amount": [99]}).to_sql("existing", environment.local, index=False)
    def fail(stage, count):
        raise RuntimeError("模拟写入中断")
    with pytest.raises(RuntimeError):
        repo._write_local(pd.DataFrame({"amount": list(range(600))}), "existing", fail)
    with environment.local.connect() as conn:
        assert conn.execute(text("SELECT amount FROM existing")).scalars().all() == [99]


def test_interrupted_work_is_recovered_without_reimport(environment):
    with environment.sessions() as db:
        job_id = jobs.create(db, 1, ["orders", "products"], 7)
        db.execute(text("UPDATE bi_source_import SET state='reading' WHERE job_id=:j"), {"j": job_id})
        db.execute(text("INSERT INTO bi_source_table VALUES (1,'orders','local_orders',3)"))
        db.commit()
    jobs._run_job(job_id)
    with environment.sessions() as db:
        items = {t["source_table"]: t for t in jobs.list_jobs(db, 7)[0]["tables"]}
        assert items["orders"]["state"] == "done"
        assert items["products"]["state"] == "failed"
        assert "中断" in items["products"]["error"]
    assert environment.refreshed == []


@pytest.mark.parametrize("names", [None, [], "orders", [""], [None], ["x" * 513]])
def test_invalid_job_payload(environment, names):
    with environment.sessions() as db:
        with pytest.raises(repo.SourceError):
            jobs.create(db, 1, names, 7)
