"""按 SQL 作用域提取真实源表，排除 CTE 引用。"""

from sqlglot import exp
from sqlglot.optimizer.scope import traverse_scope


def referenced_tables(root: exp.Expression) -> set[str]:
    return {
        source.name
        for scope in traverse_scope(root)
        for source in scope.sources.values()
        if isinstance(source, exp.Table)
    }
