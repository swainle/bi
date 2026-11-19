"""QueryObject —— 查询契约（Superset 的 QueryObject 思路，按本项目收敛）.

设计目标：
    1. 前端只描述「要什么」（维度 / 指标 / 粒度 / 筛选），不拼 SQL
    2. 服务端统一负责：系统表保护、行级权限、参数绑定、LIMIT
    3. 旧接口（扁平 payload）可以通过 from_legacy() 无损转换过来

这个文件只放数据结构与校验，不碰数据库。
"""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.query.grain import validate_grain

# 标识符一律双引号包裹后进 SQL，因此只需挡住能破坏引号结构的字符；
# 中文 / 空格列名是允许的（CSV 导入的业务列大多是中文，Superset 同样允许）。
_IDENT_FORBIDDEN = re.compile(r'^\s*$|[";\x00-\x1f]')
_IDENT_MAX = 120
# 输出别名要支持中文语义名（店铺 / 总收入），但一律走双引号包裹，
# 因此只需挡住引号、分号、注释符这些能破坏 SQL 结构的字符。
_ALIAS_FORBIDDEN = re.compile(r'["\';\n\r]|--|/\*')

AGGREGATES: tuple[str, ...] = ("SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT")

OPERATORS: tuple[str, ...] = (
    "=", "!=", "<>", ">", "<", ">=", "<=",
    "IN", "NOT IN", "BETWEEN", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL",
)


def _check_ident(value: str, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValueError(f"{field} 为空")
    if len(text) > _IDENT_MAX:
        raise ValueError(f"{field} 过长：{text[:20]}…")
    if _IDENT_FORBIDDEN.search(text):
        raise ValueError(f"{field} 含非法字符：{value}")
    return text


def _check_alias(value: str | None, field: str = "alias") -> str | None:
    """别名允许中文，但不允许能破坏 SQL 结构的字符."""
    if value in (None, ""):
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) > 64:
        raise ValueError(f"{field} 过长：{text[:20]}…")
    if _ALIAS_FORBIDDEN.search(text):
        raise ValueError(f"{field} 含非法字符：{text}")
    return text


class DimensionSpec(BaseModel):
    """维度：列 + 可选时间粒度."""

    column: str
    grain: str | None = None
    alias: str | None = None

    @field_validator("column")
    @classmethod
    def _column(cls, v: str) -> str:
        return _check_ident(v, "column")

    @field_validator("alias")
    @classmethod
    def _alias(cls, v: str | None) -> str | None:
        return _check_alias(v)

    @field_validator("grain")
    @classmethod
    def _grain(cls, v: str | None) -> str | None:
        return validate_grain(v)

    @property
    def output_name(self) -> str:
        return self.alias or self.column


class MetricSpec(BaseModel):
    """指标：聚合列，或直接给聚合表达式（来自语义层定义）."""

    column: str | None = None
    agg: str = "SUM"
    alias: str | None = None
    expression: str | None = None        # 例："SUM(revenue)"，仅允许语义层传入
    custom_expression: bool = False

    @field_validator("column")
    @classmethod
    def _column(cls, v: str | None) -> str | None:
        return None if v in (None, "") else _check_ident(v, "column")

    @field_validator("alias")
    @classmethod
    def _alias(cls, v: str | None) -> str | None:
        return _check_alias(v)

    @field_validator("agg")
    @classmethod
    def _agg(cls, v: str) -> str:
        up = (v or "").strip().upper()
        if up not in AGGREGATES:
            raise ValueError(f"不支持的聚合：{v}（可选 {', '.join(AGGREGATES)}）")
        return up

    def require_column(self) -> str:
        if not self.column:
            raise ValueError("指标缺少 column")
        return self.column

    @property
    def output_name(self) -> str:
        return self.alias or f"{self.agg}_{self.column or 'metric'}"


class KeywordSpec(BaseModel):
    """跨列模糊搜索：任意一列包含关键词即命中（OR），值走绑定参数."""

    columns: list[str] = Field(default_factory=list)
    value: str = ""


class FilterSpec(BaseModel):
    """筛选条件：值走绑定参数，永不拼进 SQL."""

    column: str
    op: str
    value: Any = None
    grain: str | None = None

    @field_validator("column")
    @classmethod
    def _column(cls, v: str) -> str:
        return _check_ident(v, "column")

    @field_validator("op")
    @classmethod
    def _op(cls, v: str) -> str:
        up = (v or "").strip().upper()
        if up not in OPERATORS:
            raise ValueError(f"不支持的运算符：{v}")
        return up

    @field_validator("grain")
    @classmethod
    def _grain(cls, v: str | None) -> str | None:
        return validate_grain(v)


class OrderSpec(BaseModel):
    column: str
    desc: bool = True

    @field_validator("column")
    @classmethod
    def _column(cls, v: str) -> str:
        alias = _check_alias(v, "order_by")
        if alias is None:
            raise ValueError("order_by 不能为空")
        return alias


class QueryObject(BaseModel):
    """一次查询的完整意图描述."""

    table: str
    # 虚拟数据集（自定义 SQL）：FROM (subquery) AS __ds，此时 table 只作标识
    subquery: str | None = None
    calculated_columns: dict[str, str] = Field(default_factory=dict)
    dimensions: list[DimensionSpec] = Field(default_factory=list)
    # 明细列：原样 SELECT，不参与分组（榜单明细 / 导出这类场景）
    columns: list[DimensionSpec] = Field(default_factory=list)
    metrics: list[MetricSpec] = Field(default_factory=list)
    filters: list[FilterSpec] = Field(default_factory=list)
    having: list[FilterSpec] = Field(default_factory=list)
    keyword: KeywordSpec | None = None
    order_by: list[OrderSpec] = Field(default_factory=list)
    limit: int = 500
    offset: int = 0
    dialect: str = "postgres"

    @model_validator(mode="before")
    @classmethod
    def _coerce_shorthand(cls, data):
        """允许简写：["store"] / [{col,agg,val}] 都能归一成契约结构."""
        if not isinstance(data, dict):
            return data
        out = dict(data)

        if isinstance(out.get("dimensions"), list):
            out["dimensions"] = [
                {"column": x} if isinstance(x, str) else x for x in out["dimensions"]
            ]
        if isinstance(out.get("order_by"), list):
            out["order_by"] = [
                {"column": x} if isinstance(x, str) else x for x in out["order_by"]
            ]
        if isinstance(out.get("metrics"), list):
            out["metrics"] = [
                {"column": x} if isinstance(x, str) else
                ({"column": x.get("col", x.get("column")),
                  "agg": x.get("agg", "SUM"),
                  "alias": x.get("alias"),
                  "expression": x.get("expression"),
                  "custom_expression": x.get("custom_expression", False)}
                 if isinstance(x, dict) else x)
                for x in out["metrics"]
            ]
        if isinstance(out.get("filters"), list):
            out["filters"] = [
                ({"column": f.get("col", f.get("column", "")),
                  "op": f.get("op", "="),
                  "value": f.get("val", f.get("value"))}
                 if isinstance(f, dict) else f)
                for f in out["filters"]
            ]
        return out

    @field_validator("table")
    @classmethod
    def _table(cls, v: str) -> str:
        return _check_ident(v, "table")

    @field_validator("limit")
    @classmethod
    def _limit(cls, v: int) -> int:
        if v is None:
            return 500
        return max(1, min(int(v), 5000))

    @field_validator("offset")
    @classmethod
    def _offset(cls, v: int) -> int:
        return max(0, int(v or 0))

    @classmethod
    def from_legacy(cls, payload: dict) -> "QueryObject":
        """兼容旧 /query_builder 的扁平 payload."""
        return cls(
            table=payload.get("table", ""),
            dimensions=[
                d if isinstance(d, dict) else {"column": d}
                for d in payload.get("dimensions", [])
            ],
            metrics=[
                {"column": m.get("col", m.get("column")),
                 "agg": m.get("agg", "SUM"),
                 "alias": m.get("alias")}
                if isinstance(m, dict) else {"column": m}
                for m in payload.get("metrics", [])
            ],
            filters=[
                {
                    "column": f.get("col", f.get("column", "")),
                    "op": f.get("op", "="),
                    "value": f.get("val", f.get("value")),
                }
                for f in payload.get("filters", [])
            ],
            limit=payload.get("limit", 500),
            offset=payload.get("offset", 0),
        )


__all__ = [
    "QueryObject",
    "DimensionSpec",
    "MetricSpec",
    "FilterSpec",
    "KeywordSpec",
    "OrderSpec",
    "AGGREGATES",
    "OPERATORS",
]
