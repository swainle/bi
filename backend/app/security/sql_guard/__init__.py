"""SQL 只读安全网关.

对外 API：
    guard_readonly(sql)                    -> AST
    to_sql(ast)                            -> SQL 字符串
    parse_readonly(sql, dialect)           -> AST（只做只读校验）
    parse_condition(text)                  -> 条件表达式

内部结构（每个文件单一职责，互不依赖）：
    parser.py   解析 / 只读判定 / 危险函数
    tables.py   按作用域提取源表
    guard.py    只读校验与 SQL 输出
"""

from app.security.sql_guard.guard import (
    DEFAULT_DIALECT,
    guard_readonly,
    parse_condition,
    to_sql,
)
from app.security.sql_guard.parser import parse_readonly
from app.security.sql_guard.tables import referenced_tables

__all__ = [
    "guard_readonly",
    "to_sql",
    "parse_readonly",
    "parse_condition",
    "referenced_tables",
    "DEFAULT_DIALECT",
]
