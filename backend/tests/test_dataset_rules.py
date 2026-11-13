"""数据集行列权限：配置校验（P4）.

只测「不需要数据库就能判定」的部分：非法条件 / 非法类型在写库前被拒。
"""

from __future__ import annotations

import pytest

from app.security.dataset_rules import DatasetRuleError, add_row_rule, set_mask


def test_row_rule_requires_condition() -> None:
    with pytest.raises(DatasetRuleError):
        add_row_rule(None, 1, filter_rule="   ")


def test_row_rule_rejects_invalid_sql() -> None:
    with pytest.raises(DatasetRuleError):
        add_row_rule(None, 1, filter_rule="platform = ; DROP TABLE x")


def test_mask_requires_column() -> None:
    with pytest.raises(DatasetRuleError):
        set_mask(None, 1, column_name="", mask_type="phone")


def test_mask_type_validated() -> None:
    with pytest.raises(DatasetRuleError):
        set_mask(None, 1, column_name="手机号", mask_type="evil")


def test_custom_mask_requires_placeholder() -> None:
    with pytest.raises(DatasetRuleError):
        set_mask(None, 1, column_name="手机号", mask_type="custom", mask_pattern="***")
