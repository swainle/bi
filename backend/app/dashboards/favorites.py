"""看板收藏视图 —— 把「当前视图 + 当前筛选」按用户个人存起来，一键恢复.

权限：能看这块看板就能收藏自己的视图；列表 / 删除只看自己的。
"""

from __future__ import annotations

from app.timezone import time_text

import json

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dashboards import repository as dash_repo
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/bi/dashboards", tags=["BI看板收藏视图"])

MAX_FAVORITES = 30


def clean_payload(payload: dict) -> tuple[str, str, dict]:
    """名称 / 视图 / 参数归一化（便于单测）."""
    name = str(payload.get("name") or "").strip()[:80]
    if not name:
        raise HTTPException(400, "收藏名称不能为空")
    view_key = str(payload.get("view") or "").strip()[:80]
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise HTTPException(400, "筛选参数格式不正确")
    encoded = json.dumps(params, ensure_ascii=False)
    if len(encoded) > 4000:
        raise HTTPException(400, "筛选参数过大，无法保存")
    return name, view_key, params


def _row_dict(row) -> dict:
    m = row._mapping
    raw = m["params"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    return {
        "id": int(m["id"]),
        "name": m["name"],
        "view_key": m["view_key"],
        "params": raw or {},
        "updated_at": time_text(m["updated_at"] or ""),
    }


def _require_board(db: Session, dashboard_id: int, user: User):
    from app.dashboards.router import _require_read

    return _require_read(dash_repo.get(db, dashboard_id), user, db)


def list_favorites(db: Session, dashboard_id: int, user_id: int) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT * FROM bi_board_favorite WHERE dashboard_id = :d AND created_by = :u "
            "ORDER BY updated_at DESC, id DESC LIMIT :limit"
        ),
        {"d": dashboard_id, "u": user_id, "limit": MAX_FAVORITES},
    ).fetchall()
    return [_row_dict(r) for r in rows]


@router.get("/{dashboard_id}/favorites")
def get_favorites(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_board(db, dashboard_id, current_user)
    return {"favorites": list_favorites(db, dashboard_id, current_user.id)}


@router.post("/{dashboard_id}/favorites")
def save_favorite(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_board(db, dashboard_id, current_user)
    name, view_key, params = clean_payload(payload)

    existing = db.execute(
        text(
            "SELECT id FROM bi_board_favorite WHERE dashboard_id = :d AND created_by = :u AND name = :n"
        ),
        {"d": dashboard_id, "u": current_user.id, "n": name},
    ).fetchone()
    if existing is None:
        count = db.execute(
            text("SELECT count(*) FROM bi_board_favorite WHERE dashboard_id = :d AND created_by = :u"),
            {"d": dashboard_id, "u": current_user.id},
        ).scalar()
        if int(count or 0) >= MAX_FAVORITES:
            raise HTTPException(400, f"最多保存 {MAX_FAVORITES} 个收藏视图，请先删除不用的")

    row = db.execute(
        text(
            "INSERT INTO bi_board_favorite (dashboard_id, name, view_key, params, created_by) "
            "VALUES (:d, :n, :v, CAST(:p AS jsonb), :u) "
            "ON CONFLICT (dashboard_id, created_by, name) DO UPDATE SET "
            "view_key = EXCLUDED.view_key, params = EXCLUDED.params, updated_at = now() RETURNING *"
        ),
        {"d": dashboard_id, "n": name, "v": view_key,
         "p": json.dumps(params, ensure_ascii=False), "u": current_user.id},
    ).fetchone()
    db.commit()
    return _row_dict(row)


@router.delete("/{dashboard_id}/favorites/{fav_id}")
def delete_favorite(
    dashboard_id: int,
    fav_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_board(db, dashboard_id, current_user)
    result = db.execute(
        text(
            "DELETE FROM bi_board_favorite WHERE id = :id AND dashboard_id = :d AND created_by = :u"
        ),
        {"id": fav_id, "d": dashboard_id, "u": current_user.id},
    )
    db.commit()
    if not result.rowcount:
        raise HTTPException(404, "收藏不存在")
    return {"ok": True}


__all__ = ["router", "clean_payload", "list_favorites", "MAX_FAVORITES"]
