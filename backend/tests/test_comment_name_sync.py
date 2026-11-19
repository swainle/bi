import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.semantic import repository as repo
from app.semantic.models import Dataset


@pytest.fixture
def db(monkeypatch):
    from app import cache
    monkeypatch.setattr(cache, "invalidate_prefix", lambda *args: None)
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.connection.driver_connection.create_function("now", 0, lambda: "2026-11-19")
        for sql in [
            "CREATE TABLE bi_dataset (id integer primary key, updated_at text)",
            "INSERT INTO bi_dataset VALUES (7,NULL)",
            "CREATE TABLE bi_dataset_field (id integer primary key, dataset_id int, name text, source_column text, expression text DEFAULT '', role text DEFAULT 'dimension', data_type text DEFAULT 'text', is_filterable boolean DEFAULT 1, is_groupable boolean DEFAULT 1, default_grain text, description text DEFAULT '', UNIQUE(dataset_id,name))",
            "CREATE TABLE bi_dataset_metric (id integer, dataset_id integer, name text, expression text, format text, description text)",
            "CREATE TABLE bi_dataset_column_mask (dataset_id integer, column_name text)",
            "CREATE TABLE bi_column_masks (table_name text, column_name text)",
            "CREATE TABLE bi_canvas (id integer, name text, doc text, deleted_at text)",
        ]:
            conn.execute(text(sql))
    with Session(engine) as session:
        yield session
    engine.dispose()


def add_field(db, name, expression=""):
    db.execute(text("INSERT INTO bi_dataset_field (dataset_id,name,source_column,expression) VALUES (7,:n,:n,:e)"), {"n": name, "e": expression})


def test_batch_sync_skips_conflicts_used_fields_masks_and_empty_comments(db):
    for name in ("amount", "empty", "used", "duplicate_a", "duplicate_b", "long", "bad", "dot", "masked", "tablemasked", "already", "reserved", "collision"):
        add_field(db, name)
    add_field(db, "formula", "amount - 1")
    doc = {"views": [{"key": "main", "items": [{"key": "bar", "type": "chart",
            "spec": {"kind": "bar", "binding": {"dataset_id": 7, "dimension": "used"}}}]}]}
    db.execute(text("INSERT INTO bi_canvas VALUES (1,'看板',:doc,NULL)"), {"doc": json.dumps(doc)})
    db.execute(text("INSERT INTO bi_dataset_column_mask VALUES (7,'masked')"))
    db.execute(text("INSERT INTO bi_column_masks VALUES ('orders','tablemasked')"))
    db.commit()
    comments = {"amount": "销售额", "empty": "  ", "used": "使用中", "duplicate_a": "重复",
                "duplicate_b": "重复", "long": "长" * 22, "bad": "bad;name", "masked": "脱敏",
                "already": "already", "reserved": "", "collision": "reserved", "formula": "计算利润",
                "dot": "有.点", "tablemasked": "表级脱敏"}
    result = repo.sync_comment_names(db, Dataset(7, "订单", "orders"),
                                    [{"name": name, "comment": comment} for name, comment in comments.items()])
    assert result["renamed"] == 1 and result["unchanged"] == 1
    fields = {field.source_column: field for field in repo.list_fields(db, 7)}
    assert fields["amount"].name == "销售额"
    assert fields["amount"].source_column == "amount"
    for name in comments.keys() - {"amount"}:
        assert fields[name].name == name
    reasons = {item["name"]: item["reason"] for item in result["skipped"]}
    assert "引用" in reasons["used"]
    assert "脱敏" in reasons["masked"]
    assert "脱敏" in reasons["tablemasked"]
    assert "重复" in reasons["duplicate_a"] and "重复" in reasons["duplicate_b"]
    assert "过长" in reasons["long"]
    assert "字符" in reasons["bad"]
    assert "字符" in reasons["dot"]
    assert "非空" in reasons["formula"]


def test_failed_batch_rolls_back_all_names(db):
    add_field(db, "a"); add_field(db, "b")
    db.execute(text("CREATE TRIGGER fail_name BEFORE UPDATE OF name ON bi_dataset_field WHEN NEW.name='失败' BEGIN SELECT RAISE(ABORT,'test failure'); END"))
    db.commit()
    with pytest.raises(Exception, match="test failure"):
        repo.sync_comment_names(db, Dataset(7, "订单", "orders"),
                                [{"name": "a", "comment": "成功"}, {"name": "b", "comment": "失败"}])
    assert [field.name for field in repo.list_fields(db, 7)] == ["a", "b"]


def test_sync_endpoint_checks_permission_owner_and_uses_database_comments(monkeypatch):
    from app.database import get_db
    from app.middleware.auth import get_current_user
    from app.security.nav import guard as nav_guard
    from app.semantic import router_items
    user = SimpleNamespace(id=1, role="user", allowed=False)
    dataset = Dataset(7, "订单", "orders", owner_id=2)
    app = FastAPI()
    app.include_router(router_items.router)
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: Mock()
    monkeypatch.setattr(nav_guard, "has_nav", lambda db, user, code: user.allowed)
    monkeypatch.setattr(repo, "get_dataset", lambda *args, **kwargs: dataset)
    columns = [{"name": "amount", "comment": "数据库注释"}]
    monkeypatch.setattr(router_items, "database_columns", lambda *args: {"columns": columns})
    sync = Mock(return_value={"renamed": 1, "skipped": [], "unchanged": 0})
    monkeypatch.setattr(repo, "sync_comment_names", sync)
    with TestClient(app) as client:
        url = "/bi/semantic/datasets/7/sync-comment-names"
        assert client.post(url).status_code == 403
        user.allowed = True
        assert client.post(url).status_code == 403
        sync.assert_not_called()
        dataset.owner_id = 1
        assert client.post(url, json={"comment": "客户端伪造注释"}).status_code == 200
        assert sync.call_args.args[2] == columns
