"""用户聚合表达式：校验后将数据集字段名转换为来源列。"""

from sqlglot import exp

from app.security.sql_guard import guard_readonly
from app.semantic.formulas import SAFE_FUNCTIONS
from app.semantic.validator import SemanticError


AGG_FUNCTIONS = {"SUM", "AVG", "MIN", "MAX", "COUNT", "STDDEV", "VARIANCE", "MEDIAN"}


def compile_aggregate(expression: str, dataset) -> str:
    if not isinstance(expression, str):
        raise SemanticError("聚合表达式必须是文本")
    raw = (expression or "").strip()
    if not raw or len(raw) > 4000 or ";" in raw:
        raise SemanticError("聚合表达式不能为空、超过 4000 字符或包含分号")
    root = guard_readonly(f"SELECT {raw}")
    if not isinstance(root, exp.Select) or len(root.expressions) != 1 or any(
        value for key, value in root.args.items() if key != "expressions"
    ):
        raise SemanticError("只允许一个聚合表达式，无需 SELECT / FROM")
    expression_node = root.expressions[0]
    aggregates = list(expression_node.find_all(exp.AggFunc))
    if not aggregates:
        raise SemanticError('请使用聚合函数，例如 SUM("销售额") 或 MEDIAN("销售额")')
    for node in expression_node.walk():
        if isinstance(node, (exp.Query, exp.Table, exp.Window, exp.Alias, exp.Dot,
                             exp.Placeholder, exp.Parameter, exp.WithinGroup)):
            raise SemanticError("聚合表达式不允许查询、窗口函数、表引用或参数")
        if isinstance(node, exp.Func):
            name = (str(node.this) if isinstance(node, exp.Anonymous) else node.sql_name()).upper()
            if name not in SAFE_FUNCTIONS | AGG_FUNCTIONS:
                raise SemanticError(f"聚合表达式暂不支持函数：{name}")
        if isinstance(node, exp.AggFunc) and node.find_ancestor(exp.AggFunc):
            raise SemanticError("聚合函数不能嵌套")
        if isinstance(node, exp.DataType) and node.this == exp.DataType.Type.USERDEFINED:
            raise SemanticError("聚合表达式不允许自定义类型")
        if isinstance(node, exp.Star) and not isinstance(node.parent, exp.Count):
            raise SemanticError("通配符只能用于 COUNT(*)")
        if isinstance(node, exp.Column):
            if node.table or node.db or node.catalog:
                raise SemanticError("请使用数据集字段名，不要添加表名前缀")
            if not node.find_ancestor(exp.AggFunc):
                raise SemanticError(f"字段「{node.name}」必须放在聚合函数内")
            field = dataset.field_by_name(node.name)
            if field is None:
                raise SemanticError(f"未知字段：{node.name}（请使用数据集字段名）")
            if field.role == "id" and not isinstance(node.find_ancestor(exp.AggFunc), exp.Count):
                raise SemanticError(f"标识字段「{field.name}」只能计数")
            node.set("this", exp.to_identifier(field.source_column, quoted=True))
    # 保留 MEDIAN，生成 SQL 时再按目标数据库转换。
    return expression_node.sql()


def compile_dimension_expression(expression: str, dataset) -> str:
    """维度表达式：允许字段 / 安全函数（如 to_char(date,'MM-DD')），不允许聚合、子查询、窗口。"""
    if not isinstance(expression, str):
        raise SemanticError("维度表达式必须是文本")
    raw = (expression or "").strip()
    if not raw or len(raw) > 4000 or ";" in raw:
        raise SemanticError("维度表达式不能为空、超过 4000 字符或包含分号")
    root = guard_readonly(f"SELECT {raw}")
    if not isinstance(root, exp.Select) or len(root.expressions) != 1 or any(
        value for key, value in root.args.items() if key != "expressions"
    ):
        raise SemanticError("只允许一个维度表达式，无需 SELECT / FROM")
    node = root.expressions[0]
    for child in node.walk():
        if isinstance(child, (exp.Query, exp.Table, exp.Window, exp.Alias, exp.Dot,
                              exp.Placeholder, exp.Parameter, exp.WithinGroup)):
            raise SemanticError("维度表达式不允许查询、窗口函数、表引用或参数")
        if isinstance(child, exp.AggFunc):
            raise SemanticError("维度表达式不允许聚合函数")
        if isinstance(child, exp.Func):
            name = (str(child.this) if isinstance(child, exp.Anonymous) else child.sql_name()).upper()
            if name not in SAFE_FUNCTIONS:
                raise SemanticError(f"维度表达式暂不支持函数：{name}")
        if isinstance(child, exp.Star):
            raise SemanticError("维度表达式不允许通配符")
        if isinstance(child, exp.Column):
            if child.table or child.db or child.catalog:
                raise SemanticError("请使用数据集字段名，不要添加表名前缀")
            field = dataset.field_by_name(child.name)
            if field is None:
                raise SemanticError(f"未知字段：{child.name}（请使用数据集字段名）")
            child.set("this", exp.to_identifier(field.source_column, quoted=True))
    return node.sql(dialect="postgres")
