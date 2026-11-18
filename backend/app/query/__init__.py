"""查询契约层 —— 从「意图」到「SQL + 结果」.

对外 API：
    QueryObject                查询契约（Pydantic，自带校验）
    build(query, ...)          → BuiltQuery（SQL + 绑定参数）
    run(db, query, user, ...)  → QueryResult（含 RLS / 脱敏）

内部结构：
    contract.py  数据结构与校验
    grain.py     时间粒度（多方言）
    builder.py   SQL 编译（参数绑定）
    executor.py  执行 + 行级权限 + 列脱敏
    table_catalog.py 内置演示表目录及系统内部表保护
    async_jobs/  异步任务（store / runner）
"""

from app.query.builder import BuiltQuery, build
from app.query.contract import (
    AGGREGATES,
    OPERATORS,
    DimensionSpec,
    FilterSpec,
    MetricSpec,
    OrderSpec,
    QueryObject,
)
from app.query.executor import QueryResult, run
from app.query.grain import GRAINS, grain_expression, supported_grains, validate_grain
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

__all__ = [
    "QueryObject",
    "DimensionSpec",
    "MetricSpec",
    "FilterSpec",
    "OrderSpec",
    "AGGREGATES",
    "OPERATORS",
    "build",
    "BuiltQuery",
    "run",
    "QueryResult",
    "GRAINS",
    "validate_grain",
    "grain_expression",
    "supported_grains",
    "BUILTIN_TABLES",
    "is_queryable",
]
