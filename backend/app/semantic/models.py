"""语义层数据结构（纯 dataclass，不依赖 ORM）."""

from __future__ import annotations

from app.timezone import time_text

from dataclasses import dataclass, field
from typing import Any

# id：标识类（链接 id / sku_id / 详情图 id …）—— 可筛选，但不参与分组与聚合
FIELD_ROLES = ("dimension", "time", "measure", "id")
METRIC_FORMATS = ("number", "percent", "currency")


@dataclass(frozen=True)
class DatasetField:
    id: int
    dataset_id: int
    name: str
    source_column: str
    role: str = "dimension"
    data_type: str = "text"
    is_filterable: bool = True
    is_groupable: bool = True
    default_grain: str | None = None
    description: str = ""
    expression: str = ""

    @classmethod
    def from_row(cls, row: Any) -> "DatasetField":
        m = row._mapping
        return cls(
            id=m["id"], dataset_id=m["dataset_id"], name=m["name"],
            source_column=m["source_column"], role=m["role"],
            data_type=m["data_type"], is_filterable=m["is_filterable"],
            is_groupable=m["is_groupable"], default_grain=m["default_grain"],
            description=m["description"] or "",
            expression=m.get("expression") or "",
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "source_column": self.source_column,
            "role": self.role, "data_type": self.data_type,
            "is_filterable": self.is_filterable, "is_groupable": self.is_groupable,
            "default_grain": self.default_grain, "description": self.description,
            "expression": self.expression,
        }


@dataclass(frozen=True)
class DatasetMetric:
    id: int
    dataset_id: int
    name: str
    expression: str
    format: str = "number"
    description: str = ""
    certified: bool = False
    certified_by: int | None = None
    certified_at: Any = None
    version: int = 1

    @classmethod
    def from_row(cls, row: Any) -> "DatasetMetric":
        m = row._mapping
        return cls(
            id=m["id"], dataset_id=m["dataset_id"], name=m["name"],
            expression=m["expression"], format=m["format"],
            description=m["description"] or "",
            certified=bool(m.get("certified") or False),
            certified_by=m.get("certified_by"),
            certified_at=m.get("certified_at"),
            version=int(m.get("version") or 1),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "name": self.name, "expression": self.expression,
            "format": self.format, "description": self.description,
            "certified": self.certified,
            "certified_by": self.certified_by,
            "certified_at": time_text(self.certified_at or ""),
            "version": self.version,
        }


@dataclass
class Dataset:
    id: int
    name: str
    physical_table: str
    description: str = ""
    owner_id: int | None = None
    is_active: bool = True
    sql_text: str = ""
    conn_mode: str = "extract"      # extract 抽取 / live 直连
    source_id: int | None = None    # live 模式下绑定的数据源
    is_sandbox: bool = False        # 「测试数据集」页自建的公共测试数据集
    updated_at: Any = None
    field_count: int = 0
    metric_count: int = 0
    fields: list[DatasetField] = field(default_factory=list)
    metrics: list[DatasetMetric] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: Any) -> "Dataset":
        m = row._mapping
        return cls(
            id=m["id"], name=m["name"], physical_table=m["physical_table"],
            description=m["description"] or "", owner_id=m["owner_id"],
            is_active=m["is_active"],
            sql_text=m.get("sql_text") or "",
            conn_mode=(m.get("conn_mode") or "extract"),
            source_id=m.get("source_id"),
            is_sandbox=bool(m.get("is_sandbox") or False),
            updated_at=m.get("updated_at"),
            field_count=int(m.get("field_count") or 0),
            metric_count=int(m.get("metric_count") or 0),
        )

    def field_by_name(self, name: str) -> DatasetField | None:
        return next((f for f in self.fields if f.name == name), None)

    def metric_by_name(self, name: str) -> DatasetMetric | None:
        return next((m for m in self.metrics if m.name == name), None)

    def to_dict(self, with_items: bool = True) -> dict:
        payload = {
            "id": self.id, "name": self.name,
            "physical_table": self.physical_table,
            "description": self.description, "owner_id": self.owner_id,
            "is_active": self.is_active,
            "sql_text": self.sql_text,
            "is_virtual": bool(self.sql_text),
            "conn_mode": self.conn_mode or "extract",
            "source_id": self.source_id,
            "is_sandbox": bool(self.is_sandbox),
            "updated_at": time_text(self.updated_at or ""),
            "field_count": self.field_count or len(self.fields),
            "metric_count": self.metric_count or len(self.metrics),
        }
        if with_items:
            payload["fields"] = [f.to_dict() for f in self.fields]
            payload["metrics"] = [m.to_dict() for m in self.metrics]
        return payload


__all__ = [
    "Dataset", "DatasetField", "DatasetMetric",
    "FIELD_ROLES", "METRIC_FORMATS",
]
