"""显式指定独立 import_test 数据库后运行，绝不使用业务 DATABASE_URL。"""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event, Barrier

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.sources import import_jobs as jobs, repository as repo


@pytest.mark.skipif(not os.getenv("IMPORT_TEST_DATABASE_URL"), reason="需要独立 PostgreSQL 测试数据库")
def test_postgres_queue_locks_real_import_and_rollback(monkeypatch):
    url = os.environ["IMPORT_TEST_DATABASE_URL"]
    assert make_url(url).database == "import_test", "只允许使用独立 import_test 数据库"
    eng = create_engine(url)
    sessions = sessionmaker(bind=eng)
    monkeypatch.setattr(jobs, "SessionLocal", sessions)
    monkeypatch.setattr(jobs, "engine", eng)
    monkeypatch.setattr(repo, "local_engine", eng)
    monkeypatch.setattr(repo, "engine_for", lambda src: eng)
    migrations = Path(__file__).resolve().parents[1] / "schema" / "migrations"
    with eng.begin() as conn:
        conn.execute(text("CREATE TABLE bi_dataset (id serial primary key)"))
        for filename in ["012_sources.sql", "013_source_dt.sql", "027_source_schema.sql", "028_source_sync.sql", "048_source_import_tasks.sql"]:
            conn.exec_driver_sql((migrations / filename).read_text(encoding="utf-8"))
        # 新迁移必须幂等。
        conn.exec_driver_sql((migrations / "048_source_import_tasks.sql").read_text(encoding="utf-8"))
        conn.execute(text("INSERT INTO bi_source(name,ds_type) VALUES ('导入测试','postgresql')"))
        conn.execute(text("CREATE TABLE source_orders (amount numeric)"))
        conn.execute(text("INSERT INTO source_orders VALUES (10.25),(20.5),(NULL)"))
    barrier = Barrier(2)
    def submit():
        with sessions() as db:
            barrier.wait(timeout=5)
            try:
                return jobs.create(db, 1, ["source_orders"], 7)
            except jobs.ImportConflict:
                db.rollback()
                return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert len([r for r in results if r]) == 1

    original_sync = repo.sync_tables
    entered, release = Event(), Event()
    calls = []
    def blocked_sync(*args, **kwargs):
        calls.append(1)
        entered.set()
        assert release.wait(5)
        return original_sync(*args, **kwargs)
    monkeypatch.setattr(repo, "sync_tables", blocked_sync)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(jobs.run_once)
        assert entered.wait(5)
        try:
            # 模拟另一 API 进程：即便看到同一 queued/running 任务，也拿不到任务锁。
            assert pool.submit(jobs.run_once).result(timeout=5) is False
        finally:
            release.set()
        assert first.result(timeout=10) is True
    assert len(calls) == 1
    with sessions() as db:
        item = jobs.list_jobs(db, 7)[0]["tables"][0]
        assert item["state"] == "done"
        assert item["rows_read"] == item["rows_written"] == 3
        with pytest.raises(jobs.ImportConflict):
            jobs.create(db, 1, ["source_orders"], 7)
        db.rollback()
        local_name = db.execute(text("SELECT local_table FROM bi_source_table")).scalar()
        assert float(db.execute(text(f'SELECT sum(amount) FROM "{local_name}"')).scalar()) == 30.75

    pd.DataFrame({"amount": [99]}).to_sql("rollback_check", eng, index=False)
    def fail(*args):
        raise RuntimeError("模拟写入失败")
    with pytest.raises(RuntimeError):
        repo._write_local(pd.DataFrame({"amount": range(600)}), "rollback_check", fail)
    with eng.connect() as conn:
        assert conn.execute(text("SELECT amount FROM rollback_check")).scalars().all() == [99]

    # dt 批次删除与写入也必须处于同一事务。
    dates = pd.to_datetime(["2026-11-17", "2026-11-18"])
    repo._write_local(pd.DataFrame({"dt": dates, "amount": [10, 20]}), "daily_check")
    with pytest.raises(RuntimeError):
        repo._write_local(pd.DataFrame({"dt": dates[1:], "amount": [30]}), "daily_check", fail)
    with eng.connect() as conn:
        assert conn.execute(text("SELECT amount FROM daily_check ORDER BY dt")).scalars().all() == [10, 20]

    # HTTP 创建立即返回 queued；另一个执行器随后完成任务，列表只暴露当前用户任务。
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from types import SimpleNamespace
    from app.database import get_db
    from app.middleware.auth import get_current_user
    from app.sources.router import router
    from app.security import nav_guard

    with eng.begin() as conn:
        conn.execute(text("INSERT INTO bi_source(name,ds_type) VALUES ('接口测试','postgresql')"))
    app = FastAPI()
    app.include_router(router, prefix="/api")
    user_id = [7]
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=user_id[0], role="admin")
    def db_dependency():
        with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = db_dependency
    monkeypatch.setattr(nav_guard, "has_nav", lambda *args: True)
    with TestClient(app) as client:
        response = client.post("/api/bi/sources/2/import-jobs", json={"tables": ["source_orders"]})
        assert response.status_code == 202
        api_job_id = response.json()["job_id"]
        response = client.get("/api/bi/sources/import-jobs").json()
        assert next(j for j in response["jobs"] if j["id"] == api_job_id)["tables"][0]["state"] == "queued"
        assert client.post("/api/bi/sources/2/import-jobs", json={"tables": ["source_orders"]}).status_code == 409
        assert client.post("/api/bi/sources/2/import-jobs", json={"tables": "source_orders"}).status_code == 400
        user_id[0] = 8
        assert client.get("/api/bi/sources/import-jobs").json()["jobs"] == []
        user_id[0] = 7
        monkeypatch.setattr(repo, "sync_tables", original_sync)
        assert jobs.run_once() is True
        response = client.get("/api/bi/sources/import-jobs").json()
        assert next(j for j in response["jobs"] if j["id"] == api_job_id)["tables"][0]["state"] == "done"
        monkeypatch.setattr(nav_guard, "has_nav", lambda *args: False)
        assert client.post("/api/bi/sources/2/import-jobs", json={"tables": ["source_orders"]}).status_code == 403
    eng.dispose()
