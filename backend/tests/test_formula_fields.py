import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.query.builder import build
from app.semantic.compiler import compile_query
from app.semantic.formulas import check_formula_masks, validate_formula
from app.semantic.importer import export_config, plan
from app.semantic.models import Dataset, DatasetField, DatasetMetric
from app.semantic.validator import SemanticError
from app.security.errors import SecurityError


def dataset():
    return Dataset(1, "订单", "orders", fields=[
        DatasetField(1, 1, "店铺", "store"),
        DatasetField(2, 1, "销售额", "revenue", role="measure", data_type="numeric"),
        DatasetField(3, 1, "成本", "cost", role="measure", data_type="numeric"),
        DatasetField(4, 1, "利润", "利润", role="measure", data_type="numeric",
                     expression='"revenue" - COALESCE("cost", 0)'),
    ])


@pytest.mark.parametrize("formula", [
    "", "SELECT revenue FROM orders", "revenue FROM orders", "revenue, cost",
    "(SELECT revenue FROM orders)", "SUM(revenue)", "COUNT(*)", "ROW_NUMBER() OVER ()",
    "revenue; SELECT 1", "pg_sleep(1)", "custom_function(revenue)", "orders.revenue",
    "revenue AS x", "missing + 1", "利润 + 1", "CAST(revenue AS custom_type)",
])
def test_reject_unsafe_or_non_row_formula(formula):
    with pytest.raises(SecurityError):
        validate_formula(formula, {"revenue", "cost"})


@pytest.mark.parametrize("formula", [
    "revenue - COALESCE(cost, 0)", "revenue * 1.0 / NULLIF(cost, 0)",
    "CASE WHEN revenue > 100 THEN '高' ELSE '低' END", "ROUND(revenue, 2)",
    "CAST(revenue AS numeric)", "UPPER('abc')", "DATE_TRUNC('month', CURRENT_DATE)",
])
def test_safe_formulas(formula):
    assert validate_formula(formula, {"revenue", "cost"})


def execute(request, rls=None, virtual=False):
    ds = dataset()
    if virtual:
        ds.sql_text = "SELECT * FROM orders"
        ds.physical_table = "custom_sql"
    query = compile_query(ds, request)
    built = build(query, rls_conditions=rls)
    with create_engine("sqlite://").begin() as conn:
        conn.execute(text("CREATE TABLE orders (store text, revenue numeric, cost numeric)"))
        conn.execute(text("INSERT INTO orders VALUES ('A',100,60),('A',200,NULL),('B',300,180)"))
        rows = [dict(row._mapping) for row in conn.execute(text(built.sql), built.params)]
    return rows, query, built


@pytest.mark.parametrize("virtual", [False, True])
def test_preview_calculates_formula_and_preserves_null_semantics(virtual):
    rows, _, _ = execute({"columns": ["销售额", "成本", "利润"]}, virtual=virtual)
    assert [r["利润"] for r in rows] == [40, 200, 120]
    assert rows[1]["成本"] is None


def test_aggregate_filter_order_and_rls():
    rows, _, built = execute({"dimensions": ["店铺"], "metrics": ["利润"],
                             "filters": [{"name": "利润", "op": ">", "value": 50}],
                             "order_by": ["利润"]}, rls=["store = 'A'"])
    assert rows == [{"店铺": "A", "利润": 200}]
    assert built.sql.index("store = 'A'") < built.sql.index('AS "__computed"')


def test_formula_dimension_grouping():
    ds = dataset()
    ds.fields.append(DatasetField(5, 1, "等级", "等级", expression="CASE WHEN revenue > 100 THEN '高' ELSE '低' END"))
    query = compile_query(ds, {"dimensions": ["等级"], "metrics": ["销售额"]})
    sql = build(query).sql
    assert 'GROUP BY "等级"' in sql


def test_only_used_formulas_are_expanded():
    assert not compile_query(dataset(), {"columns": ["店铺"]}).calculated_columns
    ds = dataset()
    ds.metrics = [DatasetMetric(1, 1, "总利润", 'SUM("利润")')]
    assert "利润" in compile_query(ds, {"metrics": ["总利润"]}).calculated_columns


def test_config_round_trip_and_missing_source():
    ds = dataset()
    ds.metrics = [DatasetMetric(1, 1, "总利润", 'SUM("利润")')]
    exported = json.dumps(export_config(ds), ensure_ascii=False)
    result = plan("mingce", exported, [], [], {"store", "revenue", "cost"})
    formula = next(f for f in result["fields"] if f["name"] == "利润")
    assert formula["expression"] == ds.fields[-1].expression
    assert formula["action"] == "new"
    assert result["metrics"][0]["expression"] == 'SUM("利润")'
    assert all(f["action"] == "unchanged" for f in
               plan("mingce", exported, ds.metrics, ds.fields, {"store", "revenue", "cost"})["fields"])
    with pytest.raises(SemanticError):
        plan("mingce", exported, [], [], {"store"})


def test_formula_edit_changes_sql_cache_key():
    from dataclasses import replace
    ds = dataset()
    first = build(compile_query(ds, {"columns": ["利润"]})).sql
    ds.fields[-1] = replace(ds.fields[-1], expression="revenue - cost - 1")
    assert build(compile_query(ds, {"columns": ["利润"]})).sql != first


def test_formula_cannot_bypass_source_masks(monkeypatch):
    from app.security import masking
    monkeypatch.setattr(masking, "mask_rules", lambda db, table: [("revenue", "custom", "***")])
    with pytest.raises(SemanticError, match="脱敏"):
        check_formula_masks(None, compile_query(dataset(), {"columns": ["利润"]}))


def test_formula_storage_edit_sync_and_config_import(monkeypatch):
    from app import cache
    from app.semantic import repository as repo
    from app.semantic.importer import apply_plan

    monkeypatch.setattr(cache, "_redis", None)
    monkeypatch.setattr(repo, "physical_columns_typed", lambda db, table: [
        {"name": "revenue", "type": "numeric"}, {"name": "cost", "type": "numeric"},
    ])
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.connection.driver_connection.create_function("now", 0, lambda: "2026-11-18")
        conn.execute(text("CREATE TABLE bi_dataset (id integer primary key, updated_at text)"))
        conn.execute(text("INSERT INTO bi_dataset (id) VALUES (1),(2)"))
        conn.execute(text('''CREATE TABLE bi_dataset_field (
            id integer primary key, dataset_id integer, name text, source_column text,
            role text, data_type text, is_filterable boolean DEFAULT 1,
            is_groupable boolean DEFAULT 1, default_grain text, description text DEFAULT '',
            expression text NOT NULL DEFAULT '', UNIQUE(dataset_id,name))'''))
    with Session(engine) as db:
        ds = Dataset(1, "订单", "orders")
        cache.set("render:formula-test", {"old": True})
        field = repo.add_field(db, ds, "利润", "", expression="revenue - cost", role="measure", data_type="numeric")
        assert field.source_column == "利润"
        assert field.expression == '"revenue" - "cost"'
        assert cache.get("render:formula-test") is None
        updated = repo.update_field(db, ds, field.id, {"expression": "revenue - COALESCE(cost, 0)"})
        assert updated.expression == '"revenue" - COALESCE("cost", 0)'
        repo.sync_fields(db, ds)
        fields = repo.list_fields(db, 1)
        assert len(fields) == 3
        assert next(f for f in fields if f.id == field.id).expression == updated.expression
        with pytest.raises(SemanticError):
            repo.add_field(db, ds, "利润", "", expression="revenue + 1")
        with pytest.raises(SemanticError):
            repo.add_field(db, ds, "revenue", "", expression="cost + 1")
        # 配置只传公式：目标表已有源列，不创建或修改业务物理列。
        ds.fields = [updated]
        content = json.dumps(export_config(ds))
        target = Dataset(2, "目标", "orders")
        result = plan("mingce", content, [], [], {"revenue", "cost"})
        apply_plan(db, target, result)
        imported = repo.list_fields(db, 2)[0]
        assert imported.name == updated.name
        assert imported.expression == updated.expression


def test_dataset_mask_alias_cannot_be_bypassed(monkeypatch):
    from app.security import masking
    monkeypatch.setattr(masking, "mask_rules", lambda db, table: [])
    class DB:
        def execute(self, statement, params):
            class Result:
                def fetchall(self):
                    if "column_mask" in str(statement):
                        return [("销售额",)]
                    return [("销售额", "revenue")]
            return Result()
    with pytest.raises(SemanticError, match="脱敏"):
        check_formula_masks(DB(), compile_query(dataset(), {"columns": ["利润"]}), 1)


@pytest.mark.parametrize("fails", [False, True])
def test_native_import_commits_atomically(monkeypatch, fails):
    from fastapi import HTTPException
    from app.semantic import importer, router_items

    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE imported (name text)"))
    result = {"format": "mingce", "fields": [{"name": "利润"}], "metrics": []}
    monkeypatch.setattr(router_items, "_plan_import", lambda *args: (dataset(), result))
    def apply(db, *args, **kwargs):
        db.execute(text("INSERT INTO imported VALUES ('利润')"))
        db.commit()
        if fails:
            raise SemanticError("第二个字段不合法")
        return {"created": 0, "fields_updated": 1}
    monkeypatch.setattr(importer, "apply_plan", apply)
    with Session(engine) as db:
        user = SimpleNamespace(id=1, username="test")
        if fails:
            with pytest.raises(HTTPException):
                router_items.run_model_import(1, {}, user, db)
        else:
            router_items.run_model_import(1, {}, user, db)
        assert db.execute(text("SELECT COUNT(*) FROM imported")).scalar() == (0 if fails else 1)


def test_formula_test_api_checks_without_saving(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from app.database import get_db
    from app.middleware.auth import get_current_user
    from app.semantic import repository as repo, router_items
    from app.security import nav_guard

    app = FastAPI()
    app.include_router(router_items.router, prefix="/api")
    ds = dataset()
    monkeypatch.setattr(repo, "get_dataset", lambda *args, **kwargs: ds)
    monkeypatch.setattr(repo, "formula_columns", lambda *args: {"revenue", "cost", "order", "Sales Amount"})
    def no_save(*args, **kwargs):
        pytest.fail("测试公式不应写入字段")
    monkeypatch.setattr(repo, "add_field", no_save)
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1, role="admin")
    app.dependency_overrides[get_db] = lambda: None
    monkeypatch.setattr(nav_guard, "has_nav", lambda *args: True)
    with TestClient(app) as client:
        prefix = "/api/bi/semantic/datasets/1"
        good = client.post(prefix + "/formula-test", json={"expression": "revenue - COALESCE(cost, 0)"})
        assert good.status_code == 200
        assert good.json()["valid"] is True
        for expression in ["missing - cost", "revenue -", "SUM(revenue)", "pg_sleep(1)", ""]:
            bad = client.post(prefix + "/formula-test", json={"expression": expression})
            assert bad.status_code == 400
            assert bad.json()["detail"]
        columns = client.get(prefix + "/formula-columns").json()["columns"]
        identifiers = {c["name"]: c["identifier"] for c in columns}
        assert identifiers["revenue"] == "revenue"
        assert identifiers["order"] == '"order"'
        assert identifiers["Sales Amount"] == '"Sales Amount"'
        monkeypatch.setattr(nav_guard, "has_nav", lambda *args: False)
        assert client.post(prefix + "/formula-test", json={"expression": "revenue - cost"}).status_code == 403
