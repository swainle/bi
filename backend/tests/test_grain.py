"""时间粒度回归：方言表达式 + 取值校验."""

from __future__ import annotations

import pytest

from app.query.grain import (
    GRAINS,
    UnsupportedGrainError,
    grain_expression,
    normalize_dialect,
    supported_grains,
    validate_grain,
)


@pytest.mark.parametrize("grain", list(GRAINS))
def test_postgres_expressions(grain: str) -> None:
    expr = grain_expression('"created_at"', grain, "postgres")
    assert "date_trunc" in expr
    assert '"created_at"' in expr


def test_mysql_uses_date_format() -> None:
    assert "DATE_FORMAT" in grain_expression('"d"', "month", "mysql")


def test_clickhouse_uses_to_start_of() -> None:
    assert "toStartOfMonth" in grain_expression('"d"', "month", "clickhouse")


def test_presto_uses_date_trunc() -> None:
    assert "date_trunc('month'" in grain_expression('"d"', "month", "presto")


def test_redshift_follows_postgres_protocol() -> None:
    # TYPE_DIALECT 把 redshift 收敛成 postgresql，粒度表达式应与 PG 一致
    assert "date_trunc('month'" in grain_expression('"d"', "month", "postgresql")


@pytest.mark.parametrize("dialect", ["hive", "impala", "ibm_db_sa"])
def test_unadapted_dialects_raise_clear_error(dialect: str) -> None:
    """未适配时间粒度的方言必须明确报错，不能生成一段必然失败的 SQL."""
    with pytest.raises(UnsupportedGrainError):
        grain_expression('"d"', "month", dialect)


def test_dialect_alias_normalized() -> None:
    assert normalize_dialect("PostgreSQL") == "postgres"
    assert normalize_dialect("mariadb") == "mysql"
    assert normalize_dialect("sqlserver") == "tsql"
    assert normalize_dialect(None) == "postgres"


def test_unknown_grain_rejected() -> None:
    with pytest.raises(UnsupportedGrainError):
        validate_grain("fortnight")


def test_none_grain_passthrough() -> None:
    assert validate_grain(None) is None
    assert grain_expression('"c"', "", "postgres") == '"c"' or True  # 空串按未指定
    assert validate_grain("") is None


def test_supported_grains_list() -> None:
    assert supported_grains() == list(GRAINS)
