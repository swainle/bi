"""看板结构操作：加页 / 删页 / 改名 / 发布 —— **只动结构，绝不写别的页的内容**.

为什么单独一组接口：编辑器原来用「整份文档保存」来落结构改动（新建/删除/改名/复制页、发布），
会把编辑器内存里那份旧副本整份写回 —— 别的设备刚改过的页会被覆盖成旧值
（2026-11-24 实测：设备B 改页2 后，设备A 新建页3 → 页2 回退）。实时协同下这条路必须拆掉。

这里每个动作都在 `SELECT doc ... FOR UPDATE` 下只改结构字段，其它页原样保留，
因此编辑器**不再需要发送整份文档**（`PUT /bi/dashboards/{id}` 仍保留给脚本 / MCP 使用）。
"""

from __future__ import annotations

import json
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dashboards import render_cache
from app.dashboards import repository as repo
from app.dashboards import sources
from app.dashboards.models import validate_doc
from app.dashboards.router import require_dashboard_edit
from app.database import get_db
from app.middleware.audit import log_audit
from app.middleware.auth import get_current_user
from app.models.user import User
from app.timezone import china_now

router = APIRouter(prefix="/bi/dashboards", tags=["BI看板结构"])

MAX_TITLE = 16


class StructureError(ValueError):
    """结构操作的业务错误（路由层统一转 400）."""


def _views(doc: dict) -> list[dict]:
    return [dict(view or {}) for view in (doc.get("views") or [])]


def _index_of(views: list[dict], key: str) -> int:
    return next((i for i, view in enumerate(views) if str(view.get("key")) == str(key)), -1)


def _clean_title(title: Any) -> str:
    return (str(title or "").strip()[:MAX_TITLE]) or "页面"


def add_view(doc: dict, view: Any, after: str | None = None) -> dict:
    """加一页；`after` 指定插在哪页之后（复制页面用），找不到就追加到末尾."""
    if not isinstance(view, dict):
        raise StructureError("缺少页面内容")
    key = str(view.get("key") or "").strip()
    if not key:
        raise StructureError("缺少页面 key")
    views = _views(doc)
    if _index_of(views, key) >= 0:
        raise StructureError("页面 key 已存在")
    page = dict(view)
    page["title"] = _clean_title(page.get("title"))
    views.append(page)
    if after:
        at = _index_of(views, after)
        if at >= 0:
            views.insert(at + 1, views.pop())
    return {**doc, "views": views}


def remove_view(doc: dict, key: str) -> dict:
    views = _views(doc)
    index = _index_of(views, key)
    if index < 0:
        raise StructureError("页面不存在")
    if len(views) <= 1:
        raise StructureError("至少要保留一页")
    views.pop(index)
    return {**doc, "views": views}


def rename_view(doc: dict, key: str, title: Any) -> dict:
    views = _views(doc)
    index = _index_of(views, key)
    if index < 0:
        raise StructureError("页面不存在")
    views[index]["title"] = _clean_title(title)
    return {**doc, "views": views}


def publish_doc(doc: dict, when: str | None = None) -> dict:
    return {**doc, "published": True, "published_at": when or china_now().isoformat(timespec="seconds")}


def _mutate(
    db: Session,
    dashboard_id: int,
    current_user: User,
    change: Callable[[dict], dict],
    action: str,
    detail: dict | None = None,
) -> dict:
    """锁行 → 读最新 doc → 只改结构 → 写回；顺带清缓存 / 重建数据源账本 / 写审计."""
    row = repo.get(db, dashboard_id)
    if row is None:
        raise HTTPException(404, "看板不存在")
    require_dashboard_edit(row, current_user, db)

    locked = db.execute(
        text("SELECT doc FROM bi_canvas WHERE id = :id AND deleted_at IS NULL FOR UPDATE"),
        {"id": dashboard_id},
    ).first()
    if locked is None:
        db.rollback()
        raise HTTPException(404, "看板不存在")

    try:
        doc = change(dict(locked[0] or {}))
        payload = validate_doc(doc).model_dump()   # 只校验，不 heal：不碰别人页里的内容
    except StructureError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # pydantic 校验失败也按 400 回，别抛 500
        db.rollback()
        raise HTTPException(400, f"页面结构不合法：{str(exc)[:200]}") from exc

    db.execute(
        text("UPDATE bi_canvas SET doc = :doc, updated_at = now() WHERE id = :id AND deleted_at IS NULL"),
        {"doc": json.dumps(payload, ensure_ascii=False), "id": dashboard_id},
    )
    db.commit()

    render_cache.invalidate(dashboard_id)
    try:
        sources.rebuild(db, dashboard_id, payload)
    except Exception as exc:   # 账本写失败不影响结构改动本身
        print(f"[dashboards] 数据源账本重建失败：{exc}")
    log_audit(current_user.id, action, "canvas", dashboard_id, detail or {})

    fresh = repo.get(db, dashboard_id)
    return fresh.to_dict() if fresh else {"id": dashboard_id}


@router.post("/{dashboard_id}/views")
def create_view(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新增一页（body: `{view: {...}, after?: 页面key}`）."""
    view = payload.get("view")
    return _mutate(
        db, dashboard_id, current_user,
        lambda doc: add_view(doc, view, payload.get("after")),
        "dashboard.add_view",
        {"view": str((view or {}).get("key") or "")[:40], "after": str(payload.get("after") or "")[:40]},
    )


@router.patch("/{dashboard_id}/views/{view_key}")
def update_view(
    dashboard_id: int,
    view_key: str,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """改页面标题（body: `{title}`）."""
    if "title" not in payload:
        raise HTTPException(400, "缺少 title")
    return _mutate(
        db, dashboard_id, current_user,
        lambda doc: rename_view(doc, view_key, payload.get("title")),
        "dashboard.rename_view",
        {"view": view_key[:40], "title": _clean_title(payload.get("title"))},
    )


@router.delete("/{dashboard_id}/views/{view_key}")
def delete_view(
    dashboard_id: int,
    view_key: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """删除一页（至少保留一页）."""
    return _mutate(
        db, dashboard_id, current_user,
        lambda doc: remove_view(doc, view_key),
        "dashboard.delete_view",
        {"view": view_key[:40]},
    )


@router.post("/{dashboard_id}/publish")
def publish_dashboard(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """发布（只置 published，不发整份文档 —— 否则会覆盖别人的页）."""
    wanted = bool(payload.get("published", True))
    if not wanted:
        raise HTTPException(400, "暂不支持取消发布")
    return _mutate(
        db, dashboard_id, current_user,
        lambda doc: publish_doc(doc),
        "dashboard.publish",
        {},
    )


__all__ = ["router", "add_view", "remove_view", "rename_view", "publish_doc", "StructureError"]
