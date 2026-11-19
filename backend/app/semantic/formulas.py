"""逐行 SQL 表达式校验；不接受子查询、聚合或自定义函数。"""

from sqlglot import exp

from app.security.sql_guard import guard_readonly
from app.semantic.validator import SemanticError

SAFE_FUNCTIONS = {
    "ABS", "ROUND", "CEIL", "FLOOR", "POWER", "SQRT", "MOD", "GREATEST", "LEAST",
    "COALESCE", "NULLIF", "CASE", "IF", "CAST", "TRY_CAST", "EXTRACT", "DATE_TRUNC",
    "TIMESTAMP_TRUNC", "TIME_TO_STR", "TO_CHAR", "STR_TO_DATE", "TO_DATE",
    "LOWER", "UPPER", "TRIM", "LTRIM", "RTRIM", "LENGTH", "CHAR_LENGTH",
    "CONCAT", "CONCAT_WS", "SUBSTRING", "LEFT", "RIGHT", "REPLACE", "SPLIT_PART",
    "CURRENT_DATE", "CURRENT_TIMESTAMP", "NOW",
}


def validate_formula(expression: str, columns: set[str] | None = None) -> str:
    raw = (expression or "").strip()
    if not raw or len(raw) > 4000 or ";" in raw:
        raise SemanticError("公式不能为空、超过 4000 字符或包含分号")
    root = guard_readonly(f"SELECT {raw}")
    if not isinstance(root, exp.Select) or len(root.expressions) != 1 or any(
        value for key, value in root.args.items() if key != "expressions"
    ):
        raise SemanticError("只允许一个逐行 SQL 表达式，无需 SELECT / FROM")
    expression_node = root.expressions[0]
    for node in expression_node.walk():
        if isinstance(node, (exp.Query, exp.Table, exp.AggFunc, exp.Window, exp.Alias,
                             exp.Star, exp.Dot, exp.Placeholder, exp.Parameter)):
            raise SemanticError("公式不允许查询、聚合、窗口函数、通配符或参数")
        if isinstance(node, exp.Func):
            name = (str(node.this) if isinstance(node, exp.Anonymous) else node.sql_name()).upper()
            if name not in SAFE_FUNCTIONS:
                raise SemanticError(f"公式暂不支持函数：{name}")
        if isinstance(node, exp.DataType) and node.this == exp.DataType.Type.USERDEFINED:
            raise SemanticError("公式不允许转换为自定义类型")
        if isinstance(node, exp.Column):
            if node.table or node.db or node.catalog:
                raise SemanticError("公式请直接使用列名，不要添加表名前缀")
            name = node.name if node.this.args.get("quoted") else node.name.lower()
            if columns is not None and name not in columns:
                raise SemanticError(f"公式引用的源列不存在：{name}（不支持引用其他公式）")
            node.set("this", exp.to_identifier(name, quoted=True))
    return expression_node.sql(dialect="postgres")


def check_formula_masks(db, query, dataset_id: int | None = None) -> None:
    """禁止公式通过新别名绕开已有的源列脱敏。"""
    expressions = list(query.calculated_columns.values()) + [
        metric.expression for metric in query.metrics if metric.custom_expression and metric.expression
    ]
    if not expressions:
        return
    from sqlalchemy import text
    from sqlglot import parse_one
    from app.security.masking import mask_rules

    protected = {r[0] for r in mask_rules(db, query.table)}
    if query.subquery:
        from app.query.sql_lab import sql_mask_rules

        protected.update(sql_mask_rules(db, query.subquery))
    if dataset_id:
        rules = db.execute(text("SELECT column_name FROM bi_dataset_column_mask WHERE dataset_id = :d"),
                           {"d": dataset_id}).fetchall()
        names = {r[0] for r in rules}
        protected.update(names)
        fields = db.execute(text("SELECT name, source_column FROM bi_dataset_field WHERE dataset_id = :d"),
                            {"d": dataset_id}).fetchall()
        protected.update(r[1] for r in fields if r[0] in names)
    for expression in expressions:
        columns = {c.name for c in parse_one(expression, read="postgres").find_all(exp.Column)}
        if columns & protected:
            raise SemanticError("公式或自定义汇总不能引用已设置脱敏规则的源列")
