from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.query import sql_lab
from app.query.table_catalog import is_queryable
from app.security.errors import SecurityError


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE orders_new (id int, owner_id int, amount int, phone text)"))
        conn.execute(text("INSERT INTO orders_new VALUES (1,1,10,'13812345678'),(2,2,90,'13987654321'),(3,1,20,'13712345678')"))
        conn.execute(text("CREATE TABLE bi_row_permissions (id int, table_name text, user_id int, role_name text, filter_rule text)"))
        conn.execute(text("INSERT INTO bi_row_permissions VALUES (1,'orders_new',1,NULL,'owner_id = 1')"))
        conn.execute(text("CREATE TABLE bi_column_masks (table_name text, column_name text, mask_type text, mask_pattern text)"))
    with Session(engine) as session:
        yield session
    engine.dispose()


USER = SimpleNamespace(id=1, role="user")


def test_unregistered_table_preview_limit_and_empty_columns(db):
    result = sql_lab.preview(db, "SELECT id, amount FROM orders_new ORDER BY id", USER, 1)
    assert result["rows"] == [{"id": 1, "amount": 10}]
    assert result["truncated"] is True
    assert result["count"] == 1
    assert sql_lab.preview(db, "SELECT id FROM orders_new LIMIT 1", USER, 1)["truncated"] is False
    empty = sql_lab.preview(db, "SELECT id, amount FROM orders_new WHERE id < 0", USER)
    assert empty["columns"] == ["id", "amount"] and empty["rows"] == []


@pytest.mark.parametrize("sql", [
    "SELECT SUM(amount) AS total FROM orders_new",
    "WITH sales AS (SELECT amount FROM orders_new) SELECT SUM(amount) AS total FROM sales",
    "SELECT SUM(a.amount) AS total FROM orders_new a JOIN orders_new b ON a.id=b.id",
    "SELECT SUM(amount) AS total FROM (SELECT amount FROM orders_new UNION ALL SELECT amount FROM orders_new) s",
])
def test_source_rules_apply_before_join_cte_union_and_aggregation(db, sql):
    total = sql_lab.preview(db, sql, USER)["rows"][0]["total"]
    assert total == (60 if "UNION" in sql else 30)


def test_bound_user_parameter_survives_sql_generation(db):
    assert sql_lab.preview(db, "SELECT id FROM orders_new WHERE owner_id=:uid", USER)["count"] == 2


@pytest.mark.parametrize("sql", [
    "DELETE FROM orders_new", "SELECT 1; SELECT 2", "SELECT pg_sleep(1)",
    "SELECT * FROM users", "SELECT * FROM other_schema.orders_new",
    "WITH users AS (SELECT * FROM users) SELECT * FROM users",
    "SELECT id, id FROM orders_new",
])
def test_unsafe_or_ambiguous_queries_rejected(db, sql):
    with pytest.raises(SecurityError):
        sql_lab.preview(db, sql, USER)


@pytest.mark.parametrize("limit", [0, -1, 1001, True, "500", None])
def test_preview_limit_is_validated(db, limit):
    with pytest.raises(SecurityError):
        sql_lab.preview(db, "SELECT * FROM orders_new", USER, limit)


def test_masking_survives_aliases_and_cte(db):
    db.execute(text("INSERT INTO bi_column_masks VALUES ('orders_new','phone','phone',NULL)"))
    result = sql_lab.preview(db, "WITH c AS (SELECT phone AS p FROM orders_new) SELECT p AS mobile FROM c", USER)
    assert result["rows"][0]["mobile"] == "138****5678"
    with pytest.raises(SecurityError, match="逐列"):
        sql_lab.preview(db, "WITH c(p) AS (SELECT phone FROM orders_new) SELECT p FROM c", USER)


def test_table_names_need_no_registration_but_internal_tables_remain_protected():
    assert is_queryable("new_sales_2026")
    assert not is_queryable("users")
    assert not is_queryable("orders; DROP TABLE users")
    from app.query.contract import QueryObject
    from app.query.executor import run
    with pytest.raises(SecurityError):
        run(Mock(), QueryObject(table="users"), USER)


def test_save_rechecks_query_and_dataset_permission(monkeypatch):
    from app.database import get_db
    from app.middleware.auth import get_current_user
    from app.security.nav import guard as nav_guard
    from app.semantic import router as api
    from app.semantic.models import Dataset

    user = SimpleNamespace(id=1, role="user", can_save=False)
    app = FastAPI()
    app.include_router(api.router)
    db = Mock()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    monkeypatch.setattr(nav_guard, "has_nav", lambda db, user, code: user.can_save)
    probe = Mock(return_value={"columns": ["amount"], "rows": [], "column_types": {"amount": "numeric"}})
    monkeypatch.setattr(sql_lab, "preview", probe)
    create = Mock(return_value=Dataset(7, "销售", "custom_sql"))
    monkeypatch.setattr(api.repo, "create_dataset", create)
    fields = Mock()
    monkeypatch.setattr(api.repo, "add_field", fields)
    monkeypatch.setattr(api.repo, "get_dataset", lambda *args: None)
    from app.security import sensitive_fields

    auto_mask = Mock(return_value=0)
    monkeypatch.setattr(sensitive_fields, "auto_mask_dataset", auto_mask)
    payload = {"name": "销售", "sql": "SELECT amount FROM orders_new"}
    with TestClient(app) as client:
        assert client.post("/bi/semantic/datasets", json=payload).status_code == 403
        create.assert_not_called()
        user.can_save = True
        response = client.post("/bi/semantic/datasets", json=payload)
        assert response.status_code == 200
        assert response.json()["id"] == 7
        assert "LIMIT" not in create.call_args.kwargs["sql_text"]
        assert fields.call_args.kwargs["data_type"] == "numeric"
        assert fields.call_args.kwargs["role"] == "measure"
        probe.assert_called_once_with(db, "SELECT amount FROM orders_new", user, 1)
        auto_mask.assert_called_once_with(db, 7, user.id)
        probe.side_effect = SecurityError("权限校验失败")
        create.reset_mock()
        assert client.post("/bi/semantic/datasets", json=payload).status_code == 400
        create.assert_not_called()
