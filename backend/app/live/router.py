"""实时同步（最小实现）：版本轮询 + 按页取内容.

为什么单独一个模块：`dashboards/router.py` 已经 900 行，新增接口放子文件（开发规范 §4.1）。

设计约束（1 秒轮询的前提）：
1. `/version` **只读一行**，不解析 doc —— 否则每秒读一次几百 KB 的 JSONB；
2. `/views/{key}` 才取内容，只在版本变化时调用；
3. 两个都是 GET，不受写接口的限流影响（限流中间件只拦写请求）；
4. 权限结果短缓存 60 秒 —— 1 秒一次就别每次都查权限表了。
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import cache
from app.auth.deps import get_current_user
from app.database import get_db
from app.models.user import User

router = APIRouter()

# 权限结果缓存秒数：越短越安全（撤权最迟这么久后生效），越长越省
_PERMISSION_TTL = 60
_ADMIN_ROLES = ("admin", "super_admin")


def version_token(updated_at: Any) -> str:
    """版本令牌：直接用 updated_at 的 ISO 串（保存时一定被写成 now()）."""
    if updated_at is None:
        return ""
    iso = getattr(updated_at, "isoformat", None)
    return str(iso() if callable(iso) else updated_at)


def can_read_live(*, owner_id: int | None, team_shared: bool, role: str,
                  user_id: int, has_grant: bool) -> bool:
    """与 `dashboards/router._can_read` 同口径（纯函数，便于单测）.

    管理员 / 公共看板 / 自己 / 协同看板（全团队可看）/ 有显式授权记录 → 可读。
    """
    if role in _ADMIN_ROLES:
        return True
    if owner_id is None or owner_id == user_id:
        return True
    return bool(team_shared) or has_grant


def pick_view(doc: Any, view_key: str) -> dict | None:
    """从文档里取出某一页（找不到返回 None）."""
    for view in (doc or {}).get("views") or []:
        if str((view or {}).get("key")) == str(view_key):
            return view
    return None


def _load_row(db: Session, dashboard_id: int) -> Any:
    """只取权限与版本需要的列，不读 doc."""
    return db.execute(
        text(
            "SELECT id, owner_id, team_shared, updated_at FROM bi_canvas "
            "WHERE id = :id AND deleted_at IS NULL"
        ),
        {"id": dashboard_id},
    ).first()


def _grant(db: Session, dashboard_id: int, user_id: int) -> bool:
    """协同看板的显式授权（只查一次，结果缓存 60 秒）."""
    key = f"live:grant:{user_id}:{dashboard_id}"
    cached = cache.get(key)
    if cached is not None:
        return bool(cached)
    row = db.execute(
        text(
            "SELECT 1 FROM bi_resource_permissions "
            "WHERE resource_type = 'canvas' AND resource_id = :id AND user_id = :uid LIMIT 1"
        ),
        {"id": dashboard_id, "uid": user_id},
    ).first()
    granted = row is not None
    cache.set(key, granted, ttl=_PERMISSION_TTL)
    return granted


def _require_read(db: Session, row: Any, current_user: User) -> None:
    grant = _grant(db, int(row[0]), current_user.id) if not row[2] else False
    allowed = can_read_live(
        owner_id=row[1], team_shared=bool(row[2]), role=str(current_user.role or ""),
        user_id=current_user.id, has_grant=grant,
    )
    if not allowed:
        raise HTTPException(403, "没有该看板的查看权限")


@router.get("/version/{dashboard_id}")
def live_version(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """当前版本号（保存时变化）。前端 1 秒轮询这个接口。

    返回体刻意只有两个字段：轮询要便宜，内容等版本变了再单独拉。
    """
    row = _load_row(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    _require_read(db, row, current_user)
    token = version_token(row[3])
    return {"id": dashboard_id, "version": token, "updated_at": token}


@router.get("/views/{dashboard_id}/{view_key}")
def live_view(
    dashboard_id: int,
    view_key: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """取某一页的最新内容（只在版本变化时调用）."""
    row = _load_row(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    _require_read(db, row, current_user)
    doc = db.execute(
        text("SELECT doc FROM bi_canvas WHERE id = :id AND deleted_at IS NULL"),
        {"id": dashboard_id},
    ).scalar()
    view = pick_view(doc, view_key)
    if view is None:
        raise HTTPException(404, "页面不存在")
    token = version_token(row[3])
    return {"id": dashboard_id, "view": view, "version": token}


__all__ = ["router", "can_read_live", "pick_view", "version_token"]
