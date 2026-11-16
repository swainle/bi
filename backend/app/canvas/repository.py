"""看板画布仓储 —— 一张画布 = 多个卡片（每张卡内嵌自己的 kind + spec）.

布局结构（layout jsonb）：
    [{"key": "c1", "kind": "bar", "spec": {...}, "x": 40, "y": 40, "w": 420, "h": 260}]
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.components.spec import ComponentSpecError, validate_kind, validate_spec


@dataclass
class CanvasItem:
    key: str
    kind: str
    spec: dict
    x: int = 40
    y: int = 40
    w: int = 420
    h: int = 260

    @classmethod
    def from_dict(cls, raw: dict) -> "CanvasItem | None":
        try:
            key = str(raw.get("key") or uuid.uuid4().hex[:8])
            kind = validate_kind(str(raw.get("kind") or "kpi"))
            spec = validate_spec(kind, raw.get("spec") or {"title": "未命名"}).model_dump()
            return cls(
                key=key, kind=kind, spec=spec,
                x=max(0, int(raw.get("x") or 0)),
                y=max(0, int(raw.get("y") or 0)),
                w=max(160, int(raw.get("w") or 420)),
                h=max(110, int(raw.get("h") or 260)),
            )
        except (TypeError, ValueError, ComponentSpecError):
            return None

    def to_dict(self) -> dict:
        return {"key": self.key, "kind": self.kind, "spec": self.spec,
                "x": self.x, "y": self.y, "w": self.w, "h": self.h}


@dataclass
class Canvas:
    id: int
    name: str
    owner_id: int | None = None
    items: list[CanvasItem] = field(default_factory=list)

    @classmethod
    def from_row(cls, row: Any) -> "Canvas":
        m = row._mapping
        raw = m["layout"] or []
        if isinstance(raw, str):
            raw = json.loads(raw)
        items = [it for it in (CanvasItem.from_dict(d) for d in raw if isinstance(d, dict)) if it]
        return cls(id=m["id"], name=m["name"], owner_id=m["owner_id"], items=items)

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name, "owner_id": self.owner_id,
                "items": [i.to_dict() for i in self.items]}


SELECT = "SELECT * FROM bi_canvas"


def list_canvases(db: Session, owner_id: int | None = None, limit: int = 50) -> list[Canvas]:
    sql = SELECT
    params: dict = {"limit": max(1, min(limit, 200))}
    if owner_id is not None:
        sql += " WHERE owner_id IS NULL OR owner_id = :owner"
        params["owner"] = owner_id
    sql += " ORDER BY updated_at DESC, id DESC LIMIT :limit"
    return [Canvas.from_row(r) for r in db.execute(text(sql), params).fetchall()]


def get_canvas(db: Session, canvas_id: int) -> Canvas | None:
    row = db.execute(text(SELECT + " WHERE id = :id"), {"id": canvas_id}).fetchone()
    return Canvas.from_row(row) if row else None


def create_canvas(db: Session, name: str, owner_id: int | None = None) -> Canvas:
    row = db.execute(
        text("INSERT INTO bi_canvas (name, owner_id, layout) VALUES (:n, :o, '[]'::jsonb) RETURNING *"),
        {"n": name or "未命名画布", "o": owner_id},
    ).fetchone()
    db.commit()
    return Canvas.from_row(row)


def get_or_create_default(db: Session, owner_id: int) -> Canvas:
    """每个用户一块默认画布（没有就建）."""
    row = db.execute(
        text(SELECT + " WHERE owner_id = :o ORDER BY id LIMIT 1"), {"o": owner_id}
    ).fetchone()
    if row:
        return Canvas.from_row(row)
    return create_canvas(db, "我的看板画布", owner_id)


def save_layout(
    db: Session,
    canvas_id: int,
    raw_items: list[dict],
    name: str | None = None,
) -> Canvas | None:
    items = [it for it in (CanvasItem.from_dict(d) for d in raw_items) if it]
    sets = ["layout = CAST(:layout AS jsonb)", "updated_at = now()"]
    params: dict = {
        "id": canvas_id,
        "layout": json.dumps([i.to_dict() for i in items], ensure_ascii=False),
    }
    if name:
        sets.append("name = :name")
        params["name"] = name
    row = db.execute(
        text(f"UPDATE bi_canvas SET {', '.join(sets)} WHERE id = :id RETURNING *"),
        params,
    ).fetchone()
    db.commit()
    return Canvas.from_row(row) if row else None


def delete_canvas(db: Session, canvas_id: int) -> bool:
    result = db.execute(text("DELETE FROM bi_canvas WHERE id = :id"), {"id": canvas_id})
    db.commit()
    return result.rowcount > 0


__all__ = [
    "Canvas", "CanvasItem", "list_canvases", "get_canvas", "get_or_create_default",
    "create_canvas", "save_layout", "delete_canvas",
]
