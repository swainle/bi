"""SQL 只读安全网关.

对外 API：
    guard_readonly(sql, allowed_tables=...) -> AST
    governed_tables(ast, allowed)          -> 受管辖表列表
    to_sql(ast)                            -> SQL 字符串
    parse_readonly(sql, dialect)           -> AST（只做只读校验，不查白名单）
    parse_condition(text)                  -> 条件表达式

内部结构（每个文件单一职责，互不依赖）：
    parser.py   解析 / 只读判定 / 危险函数
    tables.py   表名提取 / 白名单
    guard.py    组合上述两件，向上暴露
"""

from app.security.sql_guard.guard import (
    DEFAULT_DIALECT,
    governed_tables,
    guard_readonly,
    parse_condition,
    to_sql,
)
from app.security.sql_guard.parser import parse_readonly
from app.security.sql_guard.tables import referenced_tables

__all__ = [
    "guard_readonly",
    "governed_tables",
    "to_sql",
    "parse_readonly",
    "parse_condition",
    "referenced_tables",
    "DEFAULT_DIALECT",
]
