"""行级权限（RLS）子系统.

对外 API：
    decide(db, table, user)              -> RlsDecision
    apply_to_sql(sql, decision)          -> SQL 字符串
    where_sql(decision)                  -> "(a) AND (b)" 片段
    compile_rule_text(text)              -> 规范化片段（存库前把关）

内部结构：
    models.py      数据结构
    repository.py  读规则（只读 DB）
    compiler.py    规则校验 / 编译
    injector.py    注入 SQL（WHERE 下推）
    fingerprint.py 规则指纹（缓存键）
    apply.py       组合上述，向上暴露
"""

from app.security.rls.apply import apply_to_sql, decide, where_sql
from app.security.rls.compiler import compile_condition, compile_rule_text
from app.security.rls.models import RlsDecision, RowRule

__all__ = [
    "decide",
    "apply_to_sql",
    "where_sql",
    "compile_condition",
    "compile_rule_text",
    "RlsDecision",
    "RowRule",
]
