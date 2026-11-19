"""BI 引擎 · 编辑器保存 / 快照 / 卡片操作（/editor/*）。"""

from __future__ import annotations

from fastapi import Depends, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
import json
from app.database import get_db
from app.middleware.auth import get_current_user
from app.middleware.audit import log_audit
from app.models.user import User
from app.services.bi_persistence_engine import incremental_update, save_layout_snapshot, batch_delete_cards

from fastapi import APIRouter

router = APIRouter()

@router.post("/editor/save")
def save_editor_layout(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """保存看板编辑器布局 — 支持新建和更新"""
    dashboard_id = payload.get("dashboard_id", 0)
    name = payload.get("name", "新建看板")
    cards = payload.get("cards", [])

    if dashboard_id and dashboard_id > 0:
        # Update existing
        db.execute(text("""
            UPDATE bi_dashboards SET name = :name, panels = CAST(:panels AS jsonb), updated_at = NOW()
            WHERE id = :id AND owner_id = :uid
        """), {"name": name, "panels": json.dumps(cards), "id": dashboard_id, "uid": current_user.id})
        db.commit()
        log_audit(current_user.id, "dashboard.update", "dashboard", dashboard_id,
                  {"name": name, "cards_count": len(cards)})
        return {"id": dashboard_id, "name": name, "message": "保存成功"}
    else:
        # Insert new
        result = db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:t AS jsonb), NOW(), NOW()) RETURNING id
        """), {
            "name": name, "uid": current_user.id,
            "panels": json.dumps(cards),
            "t": json.dumps({}),
        })
        db.commit()
        dashboard_id = result.scalar()
        log_audit(current_user.id, "dashboard.create", "dashboard", dashboard_id,
                  {"name": name, "cards_count": len(cards)})
        return {"id": dashboard_id, "name": name, "message": "新建并保存成功"}


@router.post("/editor/snapshot")
def editor_snapshot(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """保存布局快照"""
    return save_layout_snapshot(
        db, payload["dashboard_id"], payload.get("cards", []),
        payload.get("snapshot_name", ""),
    )


@router.delete("/editor/cards")
def editor_delete_cards(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """批量删除卡片"""
    return batch_delete_cards(db, payload.get("card_ids", []))


@router.put("/editor/card/{card_id}")
def editor_update_card(
    card_id: str,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """增量更新单卡片坐标或配置"""
    return incremental_update(
        db, card_id,
        layout_only=payload.get("layout_only", True),
        layout=payload.get("layout"),
        chart_config=payload.get("chart_config"),
    )
