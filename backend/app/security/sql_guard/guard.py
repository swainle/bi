"""只读 SQL 网关；不再限制业务表名或前缀。"""

from sqlglot import exp
from app.security.sql_guard.parser import parse_readonly

DEFAULT_DIALECT = "postgres"


def guard_readonly(sql: str, *, dialect: str | None = DEFAULT_DIALECT) -> exp.Expression:
    return parse_readonly(sql, dialect=dialect)


def to_sql(root: exp.Expression, dialect: str = DEFAULT_DIALECT) -> str:
    if dialect in ("postgres", "postgresql"):
        # SQLAlchemy text() 接收 :name；不要生成驱动专用的 %(name)s。
        root = root.transform(lambda node: exp.Var(this=f":{node.name}")
                              if isinstance(node, exp.Placeholder) and node.name else node)
    return root.sql(dialect=dialect)


def parse_condition(condition: str, dialect: str = DEFAULT_DIALECT) -> exp.Expression:
    import sqlglot
    root = sqlglot.parse_one(f"SELECT 1 WHERE {condition}", read=dialect)
    where = root.args.get("where")
    if where is None:
        raise ValueError(f"无法解析条件：{condition}")
    return where.this
