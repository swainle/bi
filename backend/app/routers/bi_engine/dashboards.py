"""BI 引擎 · 看板 CRUD（/dashboards）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
import json
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

@router.get("/dashboards")
def list_dashboards(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """获取当前用户的所有看板"""
    rows = db.execute(
        text("""
            SELECT DISTINCT d.id, d.name, d.panels, d.table_map, d.created_at, d.updated_at, d.owner_id
            FROM bi_dashboards d
            LEFT JOIN bi_resource_permissions p ON p.resource_type='dashboard' AND p.resource_id=d.id AND p.user_id=:uid
            WHERE d.owner_id = :uid OR p.user_id IS NOT NULL
            ORDER BY d.updated_at DESC
        """),
        {"uid": current_user.id}
    ).fetchall()
    return {
        "dashboards": [
            {"id": r[0], "name": r[1], "panels": r[2], "table_map": r[3], "created_at": str(r[4]),
             "updated_at": str(r[5]), "owner_id": r[6]}
            for r in rows
        ]
    }


@router.post("/dashboards")
def create_dashboard(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """创建新看板"""
    name = payload.get("name", "未命名看板")
    panels = json.dumps(payload.get("panels", []))
    result = db.execute(
        text("INSERT INTO bi_dashboards (name, owner_id, panels) VALUES (:name, :uid, :panels) RETURNING id"),
        {"name": name, "uid": current_user.id, "panels": panels}
    )
    dashboard_id = result.scalar()
    db.commit()
    return {"id": dashboard_id, "name": name, "panels": payload.get("panels", [])}


@router.put("/dashboards/{dashboard_id}")
def update_dashboard(
    dashboard_id: int,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """更新看板"""
    row = db.execute(
        text("SELECT id, owner_id FROM bi_dashboards WHERE id = :id"),
        {"id": dashboard_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[1] != current_user.id:
        raise HTTPException(403, "无权修改此看板")

    name = payload.get("name", row[0])
    panels = json.dumps(payload.get("panels", []))
    table_map = payload.get("table_map")
    if table_map is not None:
        table_map_json = table_map if isinstance(table_map, str) else json.dumps(table_map)
        db.execute(
            text("UPDATE bi_dashboards SET name = :name, panels = :panels, table_map = CAST(:tmap AS jsonb), updated_at = NOW() WHERE id = :id"),
            {"name": name, "panels": panels, "tmap": table_map_json, "id": dashboard_id}
        )
    else:
        db.execute(
            text("UPDATE bi_dashboards SET name = :name, panels = :panels, updated_at = NOW() WHERE id = :id"),
            {"name": name, "panels": panels, "id": dashboard_id}
        )
    db.commit()
    return {"id": dashboard_id, "name": name}


@router.delete("/dashboards/{dashboard_id}")
def delete_dashboard(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除看板"""
    row = db.execute(
        text("SELECT id, owner_id FROM bi_dashboards WHERE id = :id"),
        {"id": dashboard_id}
    ).fetchone()
    if not row:
        raise HTTPException(404, "看板不存在")
    if row[1] != current_user.id:
        raise HTTPException(403, "无权删除")

    db.execute(text("DELETE FROM bi_dashboards WHERE id = :id"), {"id": dashboard_id})
    db.execute(text("DELETE FROM bi_resource_permissions WHERE resource_type='dashboard' AND resource_id=:id"), {"id": dashboard_id})
    db.commit()
    return {"deleted": True}
