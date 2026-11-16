"""语义治理：指标口径变更判定（P4）."""

from __future__ import annotations

from app.semantic.models import DatasetMetric
from app.semantic.repository import metric_spec_changed

CURRENT = DatasetMetric(
    id=1, dataset_id=2, name="日销量", expression="SUM(sales)", format="number", version=3,
)


def test_same_spec_not_changed() -> None:
    assert metric_spec_changed(CURRENT, "SUM(sales)", "number") is False


def test_expression_change_counts() -> None:
    assert metric_spec_changed(CURRENT, "SUM(sales_lower)", "number") is True


def test_format_change_counts() -> None:
    assert metric_spec_changed(CURRENT, "SUM(sales)", "percent") is True
