from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from app.semantic import repository as repo, router_items
from app.sources import repository as sources


def test_local_columns_include_database_comment():
    db = Mock()
    db.execute.return_value.fetchall.return_value = [("amount", "numeric", "销售收入"), ("id", "integer", None)]
    assert repo.physical_columns_typed(db, "orders") == [
        {"name": "amount", "type": "numeric", "comment": "销售收入"},
        {"name": "id", "type": "integer", "comment": ""},
    ]
    assert "col_description" in str(db.execute.call_args.args[0])
    assert db.execute.call_args.args[1] == {"t": "orders"}


def test_remote_columns_keep_comments(monkeypatch):
    inspector = Mock()
    inspector.get_columns.return_value = [
        {"name": "amount", "type": "NUMERIC", "comment": "源库收入"},
        {"name": "id", "type": "INTEGER"},
    ]
    monkeypatch.setattr(sources, "inspect", lambda engine: inspector)
    columns = sources._remote_columns(Mock(), "dm.orders")
    assert columns[0]["comment"] == "源库收入"
    assert columns[1]["comment"] == ""
    inspector.get_columns.assert_called_once_with("orders", schema="dm")


@pytest.mark.parametrize("mode", ["extract", "live", "virtual"])
def test_dataset_column_endpoint_selects_correct_database(monkeypatch, mode):
    dataset = SimpleNamespace(sql_text="SELECT 1" if mode == "virtual" else "",
                              conn_mode=mode, physical_table="orders", source_id=3)
    monkeypatch.setattr(router_items, "_dataset_or_404", lambda *args: dataset)
    local = Mock(return_value=[{"name": "amount", "comment": "本地注释"}])
    remote = Mock(return_value=[{"name": "amount", "comment": "源库注释"}])
    monkeypatch.setattr(repo, "physical_columns_typed", local)
    monkeypatch.setattr(sources, "get_source", lambda *args: {"id": 3})
    monkeypatch.setattr(sources, "engine_for", lambda source: "remote-engine")
    monkeypatch.setattr(sources, "_remote_columns", remote)
    result = router_items.database_columns(7, current_user=Mock(), db=Mock())
    if mode == "virtual":
        assert result == {"columns": []}
        local.assert_not_called(); remote.assert_not_called()
    else:
        assert result["columns"][0]["comment"] == ("源库注释" if mode == "live" else "本地注释")


def test_remote_comment_failure_is_reported(monkeypatch):
    dataset = SimpleNamespace(sql_text="", conn_mode="live", physical_table="orders", source_id=3)
    monkeypatch.setattr(router_items, "_dataset_or_404", lambda *args: dataset)
    monkeypatch.setattr(sources, "get_source", lambda *args: {"id": 3})
    monkeypatch.setattr(sources, "engine_for", Mock(side_effect=RuntimeError("connection failed")))
    with pytest.raises(HTTPException, match="读取源库"):
        router_items.database_columns(7, current_user=Mock(), db=Mock())
