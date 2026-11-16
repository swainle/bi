"""看板画布 API.

    GET    /api/bi/canvas/mine          我的默认画布（没有自动创建）
    PUT    /api/bi/canvas/{id}          保存整块布局（卡片 + spec + 位置）
    POST   /api/bi/canvas/{id}/render   批量渲染画布上所有卡片
    GET    /api/bi/canvas               画布列表
    POST   /api/bi/canvas               新建画布
    DELETE /api/bi/canvas/{id}
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.canvas import repository as repo
from app.components.resolver import resolve
from app.components.spec import ComponentSpecError, validate_kind, validate_spec
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.security.errors import SecurityError

router = APIRouter(prefix="/bi/canvas", tags=["BI看板画布"])


def _guard(exc: Exception) -> HTTPException:
    if isinstance(exc, SecurityError):
        return HTTPException(exc.http_status, exc.message)
    return HTTPException(400, f"画布操作失败：{str(exc)[:200]}")


@router.get("/mine")
def my_canvas(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    canvas = repo.get_or_create_default(db, current_user.id)
    return canvas.to_dict()


@router.put("/{canvas_id}")
def save_canvas(
    canvas_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    existing = repo.get_canvas(db, canvas_id)
    if existing is None:
        raise HTTPException(404, "画布不存在")
    items = payload.get("items") or []
    if not isinstance(items, list):
        raise HTTPException(400, "items 必须是数组")
    try:
        saved = repo.save_layout(db, canvas_id, items, name=payload.get("name"))
    except Exception as exc:
        raise _guard(exc) from exc
    return saved.to_dict() if saved else {"id": canvas_id}


@router.post("/{canvas_id}/render")
def render_canvas(
    canvas_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """一次把画布上所有卡片算出来（失败的单张不影响其它）."""
    canvas = repo.get_canvas(db, canvas_id)
    if canvas is None:
        raise HTTPException(404, "画布不存在")

    # 前端可以传当前（未保存）的 items，这样边改边看
    raw_items = payload.get("items")
    if isinstance(raw_items, list) and raw_items:
        parsed = [it for it in (repo.CanvasItem.from_dict(d) for d in raw_items) if it]
    else:
        parsed = canvas.items

    results: dict[str, dict] = {}
    errors: dict[str, str] = {}
    for item in parsed:
        try:
            kind = validate_kind(item.kind)
            spec = validate_spec(kind, item.spec)
            results[item.key] = resolve(db, spec, kind, current_user)
        except Exception as exc:  # 单张失败不影响整块画布
            errors[item.key] = (
                exc.message if isinstance(exc, SecurityError) else str(exc)[:160]
            )
    return {"canvas_id": canvas.id, "cards": results, "errors": errors}


@router.post("/{canvas_id}/publish")
def publish_canvas(
    canvas_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """把画布发布成一张看板 —— 出现在「我的看板」里.

    重复发布会更新同一张看板（按 bi_canvas.dashboard_id 关联）。
    """
    from sqlalchemy import text

    canvas = repo.get_canvas(db, canvas_id)
    if canvas is None:
        raise HTTPException(404, "画布不存在")
    if not canvas.items:
        raise HTTPException(400, "画布是空的，先拖几张卡再发布")

    name = str(payload.get("name") or canvas.name or "未命名看板")
    panels = [item.to_dict() for item in canvas.items]
    table_map = {"canvas_id": canvas.id, "mode": "canvas"}

    row = db.execute(
        text("SELECT dashboard_id FROM bi_canvas WHERE id = :id"), {"id": canvas_id}
    ).fetchone()
    dashboard_id = row[0] if row else None

    if dashboard_id:
        updated = db.execute(
            text(
                "UPDATE bi_dashboards SET name = :n, panels = CAST(:p AS jsonb), "
                "table_map = CAST(:m AS jsonb), updated_at = now() WHERE id = :d RETURNING id"
            ),
            {"n": name, "p": json.dumps(panels, ensure_ascii=False),
             "m": json.dumps(table_map), "d": dashboard_id},
        ).fetchone()
        if updated is None:
            dashboard_id = None

    if not dashboard_id:
        created = db.execute(
            text(
                "INSERT INTO bi_dashboards (name, owner_id, panels, table_map) "
                "VALUES (:n, :o, CAST(:p AS jsonb), CAST(:m AS jsonb)) RETURNING id"
            ),
            {"n": name, "o": current_user.id, "p": json.dumps(panels, ensure_ascii=False),
             "m": json.dumps(table_map)},
        ).fetchone()
        dashboard_id = created[0]

    db.execute(
        text("UPDATE bi_canvas SET dashboard_id = :d, updated_at = now() WHERE id = :id"),
        {"d": dashboard_id, "id": canvas_id},
    )
    db.commit()
    return {"dashboard_id": dashboard_id, "name": name, "cards": len(panels)}


@router.get("")
def list_canvases(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    items = repo.list_canvases(db, owner_id=current_user.id)
    return {"canvases": [{"id": c.id, "name": c.name, "cards": len(c.items)} for c in items]}


@router.post("")
def create_canvas(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    canvas = repo.create_canvas(db, str(payload.get("name") or "未命名画布"), current_user.id)
    return canvas.to_dict()


@router.delete("/{canvas_id}")
def delete_canvas(
    canvas_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {"deleted": repo.delete_canvas(db, canvas_id), "id": canvas_id}


__all__ = ["router", "ComponentSpecError"]
