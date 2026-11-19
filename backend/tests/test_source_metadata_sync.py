from types import SimpleNamespace
from unittest.mock import MagicMock, Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import SetColumnComment, SetTableComment

from app.sources import repository as repo


@pytest.fixture
def setup_sync(monkeypatch):
    db = Mock()
    db.execute.return_value.first.return_value = (2, "dm.orders", "bi_src_orders", "db")
    monkeypatch.setattr(repo, "get_source", lambda *args: {"id": 2})
    remote_engine = object()
    monkeypatch.setattr(repo, "engine_for", lambda source: remote_engine)
    monkeypatch.setattr(repo, "_remote_columns", lambda *args: [
        {"name": "amount", "comment": "客户's 销售额"}, {"name": "id", "comment": ""},
        {"name": "new_column", "comment": "尚未接入"},
    ])
    remote = Mock()
    remote.get_table_comment.return_value = {"text": "订单表"}
    local = Mock()
    local.get_columns.return_value = [{"name": "amount"}, {"name": "id"}]
    monkeypatch.setattr(repo, "inspect", lambda value: remote if value is remote_engine else local)
    engine = MagicMock()
    monkeypatch.setattr(repo, "local_engine", engine)
    return db, engine, remote


def test_metadata_sync_only_writes_comments_in_one_transaction(setup_sync):
    db, engine, remote = setup_sync
    result = repo.sync_table_metadata(db, 1)
    conn = engine.begin.return_value.__enter__.return_value
    statements = [call.args[0] for call in conn.execute.call_args_list]
    assert isinstance(statements[0], SetTableComment)
    assert all(isinstance(statement, SetColumnComment) for statement in statements[1:])
    sql = [str(statement.compile(dialect=postgresql.dialect())) for statement in statements]
    assert sql == [
        "COMMENT ON TABLE public.bi_src_orders IS '订单表'",
        "COMMENT ON COLUMN public.bi_src_orders.amount IS '客户''s 销售额'",
        "COMMENT ON COLUMN public.bi_src_orders.id IS NULL",
    ]
    assert result["columns_synced"] == 2
    assert result["missing_columns"] == ["new_column"]
    engine.begin.assert_called_once()
    db.commit.assert_not_called()
    remote.get_table_comment.assert_called_once_with("orders", schema="dm")


def test_remote_failure_does_not_touch_local_table(setup_sync):
    db, engine, remote = setup_sync
    remote.get_table_comment.side_effect = RuntimeError("source unavailable")
    with pytest.raises(repo.SourceError, match="未修改本地注释"):
        repo.sync_table_metadata(db, 1)
    engine.begin.assert_not_called()


def test_local_failure_exits_transaction_with_error(setup_sync):
    db, engine, remote = setup_sync
    engine.begin.return_value.__enter__.return_value.execute.side_effect = RuntimeError("DDL failed")
    with pytest.raises(RuntimeError, match="DDL failed"):
        repo.sync_table_metadata(db, 1)
    assert engine.begin.return_value.__exit__.call_args.args[0] is RuntimeError


@pytest.mark.parametrize("row, message", [(None, "不存在"), ((None, "file.csv", "bi_imp_file", "file"), "文件导入")])
def test_invalid_source_rejected_before_local_writes(setup_sync, row, message):
    db, engine, _ = setup_sync
    db.execute.return_value.first.return_value = row
    with pytest.raises(repo.SourceError, match=message):
        repo.sync_table_metadata(db, 1)
    engine.begin.assert_not_called()


def test_metadata_endpoint_requires_datasource_permission(monkeypatch):
    from app.database import get_db
    from app.middleware.auth import get_current_user
    from app.security.nav import guard as nav_guard
    from app.sources import router
    app = FastAPI()
    app.include_router(router.router)
    user = SimpleNamespace(id=1, allowed=False)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: Mock()
    monkeypatch.setattr(nav_guard, "has_nav", lambda db, user, code: user.allowed)
    sync = Mock(return_value={"columns_synced": 2})
    monkeypatch.setattr(repo, "sync_table_metadata", sync)
    with TestClient(app) as client:
        assert client.post("/bi/sources/files/1/sync-metadata").status_code == 403
        sync.assert_not_called()
        user.allowed = True
        assert client.post("/bi/sources/files/1/sync-metadata").json() == {"columns_synced": 2}
