"""数据源类型目录的回归用例.

守住的规则：
    1. 目录与 `TYPE_DIALECT` 必须一一对应 —— 不允许前端有、后端没；
    2. 驱动可用性靠真实探测，缺驱动时给出可执行的安装提示；
    3. 可用的排在前面，前端不用再排序；
    4. 探测函数抛异常时按「未安装」处理，不能把接口打挂。
"""

from __future__ import annotations

import pytest

from app.sources import types_catalog
from app.sources.repository import TYPE_DIALECT


def test_catalog_matches_dialects() -> None:
    ids = {t["id"] for t in types_catalog.SOURCE_TYPES}
    assert ids == set(TYPE_DIALECT), "目录与 TYPE_DIALECT 出现了只有一边有的类型"


def test_catalog_fields_complete() -> None:
    ids = [t["id"] for t in types_catalog.SOURCE_TYPES]
    assert len(ids) == len(set(ids)), "类型 id 重复"
    for item in types_catalog.SOURCE_TYPES:
        assert item["label"] and item["desc"]
        assert item["category"] in {"OLTP", "OLAP", "数据湖"}
        assert isinstance(item["default_port"], int) and item["default_port"] >= 0
        assert item["drivers"], f"{item['id']} 没有配置驱动模块"
        assert item["pip"], f"{item['id']} 没有配置 pip 包名"


def _finder(installed: set[str]):
    return lambda name: object() if name in installed else None


def test_available_follows_driver_probe() -> None:
    types = types_catalog.list_types(find_spec=_finder({"psycopg2"}))
    by_id = {t["id"]: t for t in types}

    assert by_id["postgresql"]["available"] is True
    assert by_id["kingbase"]["available"] is True
    assert by_id["mysql"]["available"] is False
    assert by_id["mysql"]["reason"] == "未安装驱动：PyMySQL"
    assert by_id["mysql"]["install"] == "pip install PyMySQL"


def test_available_sorted_first() -> None:
    types = types_catalog.list_types(find_spec=_finder({"psycopg2", "pymysql"}))
    flags = [t["available"] for t in types]
    assert flags == sorted(flags, reverse=True)
    # postgresql / mysql / mariadb / tidb / doris / starrocks / kingbase / redshift
    assert flags.count(True) == 8


def test_all_missing_still_returns_every_type() -> None:
    types = types_catalog.list_types(find_spec=_finder(set()))
    assert len(types) == len(types_catalog.SOURCE_TYPES)
    for t in types:
        assert t["available"] is False
        assert t["reason"].startswith("未安装驱动：")
        assert t["install"].startswith("pip install ")


def test_probe_error_is_treated_as_missing() -> None:
    def boom(name: str):
        raise ModuleNotFoundError(name)

    types = types_catalog.list_types(find_spec=boom)
    assert all(t["available"] is False for t in types)


def test_driver_names_match_runtime() -> None:
    """安装提示必须写真实驱动名（Oracle 用 python-oracledb，不是 cx_Oracle）."""
    types = {t["id"]: t for t in types_catalog.list_types(find_spec=_finder(set()))}
    assert "oracledb" in types["oracle"]["reason"]
    assert "PyMySQL" in types["mysql"]["reason"]
    assert "clickhouse-sqlalchemy" in types["clickhouse"]["reason"]
    assert "psycopg2-binary" in types["redshift"]["reason"]


@pytest.mark.parametrize("type_id", ["oracle", "db2", "presto", "hive", "impala"])
def test_types_without_driver_are_marked_unavailable(type_id: str) -> None:
    """只装了基础驱动时，这几类必须显示为不可用而不是假装能连（Redshift 走 psycopg2，始终可用）."""
    base = {"psycopg2", "pymysql", "clickhouse_driver", "clickhouse_sqlalchemy", "pyodbc"}
    types = {t["id"]: t for t in types_catalog.list_types(find_spec=_finder(base))}
    assert types[type_id]["available"] is False
    assert "未安装驱动" in types[type_id]["reason"]


def test_local_postgres_is_available() -> None:
    """requirements 里装了 psycopg2，默认环境必须能真连 PostgreSQL."""
    types = {t["id"]: t for t in types_catalog.list_types()}
    assert types["postgresql"]["available"] is True
