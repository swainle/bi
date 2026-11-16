"""数据源类型目录 —— 「界面能选的」与「后端能连的」共用这一份.

背景：前端原来在 `constants.tsx` 硬编码了 21 种类型，后端 `TYPE_DIALECT` 只映射 15 个，
requirements 又只装了 4 类驱动，于是出现「界面能选、点测试连接报不支持」的花架子。
现在统一由本目录给出类型与驱动可用性，前端只负责渲染，不再维护第二份清单。

新增一种数据源 = 这里加一条 + `repository.TYPE_DIALECT` 加方言 + requirements 加驱动 +
真机验证（建连接 / 读表结构 / 查询 / 方言 SQL），缺一不可。
"""

from __future__ import annotations

import importlib.util
from typing import Callable

FindSpec = Callable[[str], object | None]

# 分类只用于界面分组 / 排序，不影响取数
_CATEGORY_OLTP = "OLTP"
_CATEGORY_OLAP = "OLAP"
_CATEGORY_DW = "数据湖"

SOURCE_TYPES: tuple[dict, ...] = (
    {
        "id": "postgresql",
        "label": "PostgreSQL",
        "desc": "开源关系型数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 5432,
        "drivers": ("psycopg2",),
        "pip": "psycopg2-binary",
    },
    {
        "id": "mysql",
        "label": "MySQL",
        "desc": "开源关系型数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 3306,
        "drivers": ("pymysql",),
        "pip": "PyMySQL",
    },
    {
        "id": "mariadb",
        "label": "MariaDB",
        "desc": "MySQL 分支",
        "category": _CATEGORY_OLTP,
        "default_port": 3306,
        "drivers": ("pymysql",),
        "pip": "PyMySQL",
    },
    {
        "id": "tidb",
        "label": "TiDB",
        "desc": "分布式 HTAP 数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 4000,
        "drivers": ("pymysql",),
        "pip": "PyMySQL",
    },
    {
        "id": "sqlserver",
        "label": "SQL Server",
        "desc": "微软关系型数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 1433,
        "drivers": ("pyodbc",),
        "pip": "pyodbc",
    },
    {
        "id": "oracle",
        "label": "Oracle",
        "desc": "企业级关系型数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 1521,
        # `oracle://` 默认找 cx_Oracle；仓库装的是 python-oracledb，连接串走 oracle+oracledb
        "drivers": ("oracledb",),
        "pip": "oracledb",
    },
    {
        "id": "db2",
        "label": "Db2",
        "desc": "IBM 企业级数据库",
        "category": _CATEGORY_OLTP,
        "default_port": 50000,
        "drivers": ("ibm_db_sa",),
        "pip": "ibm-db-sa",
    },
    {
        "id": "kingbase",
        "label": "人大金仓",
        "desc": "国产关系型数据库（PostgreSQL 协议）",
        "category": _CATEGORY_OLTP,
        "default_port": 54321,
        "drivers": ("psycopg2",),
        "pip": "psycopg2-binary",
    },
    {
        "id": "clickhouse",
        "label": "ClickHouse",
        "desc": "列式 OLAP 引擎",
        "category": _CATEGORY_OLAP,
        "default_port": 9000,
        "drivers": ("clickhouse_driver", "clickhouse_sqlalchemy"),
        "pip": "clickhouse-sqlalchemy clickhouse-driver",
    },
    {
        "id": "doris",
        "label": "Apache Doris",
        "desc": "MPP 实时分析数据库",
        "category": _CATEGORY_OLAP,
        "default_port": 9030,
        "drivers": ("pymysql",),
        "pip": "PyMySQL",
    },
    {
        "id": "starrocks",
        "label": "StarRocks",
        "desc": "极速全场景 MPP 数据库",
        "category": _CATEGORY_OLAP,
        "default_port": 9030,
        "drivers": ("pymysql",),
        "pip": "PyMySQL",
    },
    {
        "id": "presto",
        "label": "Presto",
        "desc": "分布式 SQL 查询引擎",
        "category": _CATEGORY_OLAP,
        "default_port": 8080,
        # SQLAlchemy 的 presto 方言由 PyHive 提供（HTTP /v1/statement）
        "drivers": ("pyhive",),
        "pip": "PyHive",
    },
    {
        "id": "impala",
        "label": "Apache Impala",
        "desc": "实时 SQL 查询引擎",
        "category": _CATEGORY_OLAP,
        "default_port": 21050,
        # pip 包叫 impyla，import 名是 impala
        "drivers": ("impala",),
        "pip": "impyla",
    },
    {
        "id": "hive",
        "label": "Apache Hive",
        "desc": "Hadoop 数据仓库",
        "category": _CATEGORY_DW,
        "default_port": 10000,
        "drivers": ("pyhive",),
        "pip": "PyHive",
    },
    {
        "id": "redshift",
        "label": "AWS RedShift",
        "desc": "云数仓（PostgreSQL 协议）",
        "category": _CATEGORY_DW,
        "default_port": 5439,
        # Redshift 兼容 PG 协议，直接走 psycopg2，不装第三方方言
        "drivers": ("psycopg2",),
        "pip": "psycopg2-binary",
    },
)


def _default_find_spec(name: str) -> object | None:
    try:
        return importlib.util.find_spec(name)
    except (ImportError, ValueError):
        return None


def _installed(name: str, finder: FindSpec) -> bool:
    """探测失败一律按「未安装」处理 —— 目录接口不能被单个驱动探测搞挂."""
    try:
        return finder(name) is not None
    except Exception:
        return False


def list_types(find_spec: FindSpec | None = None) -> list[dict]:
    """返回全部类型，可用的排在前面；`available=False` 时带 `reason`（缺什么）."""
    finder = find_spec or _default_find_spec
    out: list[dict] = []
    for item in SOURCE_TYPES:
        missing = [name for name in item["drivers"] if not _installed(name, finder)]
        out.append({
            "id": item["id"],
            "label": item["label"],
            "desc": item["desc"],
            "category": item["category"],
            "default_port": item["default_port"],
            "available": not missing,
            "reason": "" if not missing else f"未安装驱动：{item['pip']}",
            "install": "" if not missing else f"pip install {item['pip']}",
        })
    out.sort(key=lambda t: not t["available"])
    return out


def get_type(type_id: str) -> dict | None:
    for item in SOURCE_TYPES:
        if item["id"] == type_id:
            return dict(item)
    return None


__all__ = ["SOURCE_TYPES", "list_types", "get_type"]
