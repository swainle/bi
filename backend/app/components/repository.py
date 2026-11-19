"""组件仓储 —— 只在这一层写 SQL."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.components.spec import ComponentSpec, validate_kind, validate_spec


@dataclass
class Component:
    id: int
    code: str
    name: str
    category: str
    kind: str
    description: str
    spec: dict
    is_builtin: bool
    owner_id: int | None = None
    parsed: ComponentSpec | None = field(default=None)

    @classmethod
    def from_row(cls, row: Any) -> "Component":
        m = row._mapping
        spec = m["spec"] or {}
        if isinstance(spec, str):
            spec = json.loads(spec)
        return cls(
            id=m["id"], code=m["code"], name=m["name"],
            category=m["category"], kind=m["kind"],
            description=m["description"] or "", spec=spec,
            is_builtin=m["is_builtin"], owner_id=m["owner_id"],
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id, "code": self.code, "name": self.name,
            "category": self.category, "kind": self.kind,
            "description": self.description, "spec": self.spec,
            "is_builtin": self.is_builtin, "owner_id": self.owner_id,
        }


SELECT = "SELECT * FROM bi_component"


def list_components(
    db: Session,
    *,
    kind: str | None = None,
    category: str | None = None,
    keyword: str | None = None,
    limit: int = 200,
    include_archived: bool = False,
) -> list[Component]:
    sql = SELECT + " WHERE 1 = 1"
    if not include_archived:
        sql += " AND archived = false"
    params: dict = {"limit": max(1, min(limit, 500))}
    if kind:
        sql += " AND kind = :kind"
        params["kind"] = kind
    if category:
        sql += " AND category = :category"
        params["category"] = category
    if keyword:
        sql += " AND (name ILIKE :kw OR description ILIKE :kw OR code ILIKE :kw)"
        params["kw"] = f"%{keyword}%"
    sql += " ORDER BY is_builtin DESC, category, id LIMIT :limit"
    return [Component.from_row(r) for r in db.execute(text(sql), params).fetchall()]


def get_component(db: Session, component_id: int) -> Component | None:
    row = db.execute(text(SELECT + " WHERE id = :id"), {"id": component_id}).fetchone()
    return Component.from_row(row) if row else None


def get_by_code(db: Session, code: str) -> Component | None:
    row = db.execute(text(SELECT + " WHERE code = :c"), {"c": code}).fetchone()
    return Component.from_row(row) if row else None


def create_component(
    db: Session,
    *,
    code: str,
    name: str,
    kind: str,
    spec: dict,
    category: str = "通用",
    description: str = "",
    owner_id: int | None = None,
    is_builtin: bool = False,
) -> Component:
    kind = validate_kind(kind)
    parsed = validate_spec(kind, spec)
    row = db.execute(
        text(
            "INSERT INTO bi_component (code, name, category, kind, description, spec, "
            "is_builtin, owner_id) VALUES (:code, :name, :cat, :kind, :desc, "
            "CAST(:spec AS jsonb), :builtin, :owner) RETURNING *"
        ),
        {
            "code": code, "name": name, "cat": category, "kind": kind,
            "desc": description, "spec": json.dumps(parsed.model_dump(), ensure_ascii=False),
            "builtin": is_builtin, "owner": owner_id,
        },
    ).fetchone()
    db.commit()
    return Component.from_row(row)


def update_component(
    db: Session,
    component_id: int,
    *,
    name: str | None = None,
    category: str | None = None,
    description: str | None = None,
    spec: dict | None = None,
) -> Component | None:
    current = get_component(db, component_id)
    if current is None:
        return None

    payload: dict = {"id": component_id}
    sets: list[str] = []
    if name is not None:
        sets.append("name = :name")
        payload["name"] = name
    if category is not None:
        sets.append("category = :cat")
        payload["cat"] = category
    if description is not None:
        sets.append("description = :desc")
        payload["desc"] = description
    if spec is not None:
        parsed = validate_spec(current.kind, spec)
        sets.append("spec = CAST(:spec AS jsonb)")
        payload["spec"] = json.dumps(parsed.model_dump(), ensure_ascii=False)
    if not sets:
        return current

    sets.append("updated_at = now()")
    row = db.execute(
        text(f"UPDATE bi_component SET {', '.join(sets)} WHERE id = :id RETURNING *"),
        payload,
    ).fetchone()
    db.commit()
    return Component.from_row(row) if row else None


def delete_component(db: Session, component_id: int) -> bool:
    result = db.execute(
        text("DELETE FROM bi_component WHERE id = :id AND is_builtin = false"),
        {"id": component_id},
    )
    db.commit()
    return result.rowcount > 0


def upsert_builtin(db: Session, *, code: str, name: str, kind: str, spec: dict,
                   category: str, description: str = "",
                   overwrite_spec: bool = False) -> Component:
    """内置组件幂等写入。

    默认**只插入缺失的组件、绝不覆盖已存在组件的 spec** —— 库里那张卡可能已经被用户调过
    （改字段、加选项、设默认值），启动时被种子冲掉是不可接受的。
    需要让种子改动生效（开发环境）时，用环境变量 `MINGCEBI_RESEED=1` 或显式传 overwrite_spec=True。
    """
    import os

    existing = get_by_code(db, code)
    if existing:
        force = overwrite_spec or os.getenv("MINGCEBI_RESEED", "") in ("1", "true", "yes")
        if not force:
            return existing
        # 重写种子时保留画布位置，避免重启把用户拖好的布局冲掉
        kept = (existing.spec or {}).get("layout")
        if kept:
            spec = {**spec, "layout": kept}
        updated = update_component(db, existing.id, name=name, category=category,
                                   description=description, spec=spec)
        if updated:
            return updated
    return create_component(db, code=code, name=name, kind=kind, spec=spec,
                            category=category, description=description,
                            is_builtin=True)


__all__ = [
    "Component", "list_components", "get_component", "get_by_code",
    "create_component", "update_component", "delete_component", "upsert_builtin",
]
