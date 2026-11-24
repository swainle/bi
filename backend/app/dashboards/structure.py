"""看板结构操作：加页 / 删页 / 改名 / 发布 —— **只动结构，绝不写别的页的内容**.

为什么单独一组接口：编辑器原来用「整份文档保存」来落结构改动（新建/删除/改名/复制页、发布），
会把编辑器内存里那份旧副本整份写回 —— 别的设备刚改过的页会被覆盖成旧值
（2026-11-24 实测：设备B 改页2 后，设备A 新建页3 → 页2 回退）。实时协同下这条路必须拆掉。

这里每个动作都在 `SELECT doc ... FOR UPDATE` 下只改结构字段，其它页原样保留，
因此编辑器**不再需要发送整份文档**（`PUT /bi/dashboards/{id}` 仍保留给脚本 / MCP 使用）。
"""

from __future__ import annotations

import json
import uuid
from typing import Any, Callable, Iterable

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.dashboards import render_cache
from app.dashboards import repository as repo
from app.dashboards import sources
from app.dashboards.models import validate_doc
from app.dashboards.router import require_dashboard_edit, require_dashboard_read
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


def _fresh_key(prefix: str, stamp: str, index: int | None = None) -> str:
    return f"{prefix}_{stamp}" if index is None else f"{prefix}_{stamp}{index}"


def clone_view(view: Any, stamp: str, title: Any = None, existing_titles: Iterable[str] = ()) -> dict:
    """把一页深拷贝成「能安全放进另一个项目」的新页：页 key / 元素 key / 参考线 id 全部重新生成.

    数据集绑定**原样保留**（跨项目复制仍然指向源项目用的那份数据），所以页面内容与来源完全一致。
    """
    if not isinstance(view, dict):
        raise StructureError("缺少页面内容")
    page = json.loads(json.dumps(view))          # 深拷贝，别让两个项目共享同一份对象
    page["key"] = _fresh_key("page", stamp)
    taken = {str(item or "") for item in existing_titles}
    base = _clean_title(title if title is not None else page.get("title"))
    page["title"] = f"{base} 副本"[:MAX_TITLE] if base in taken else base[:MAX_TITLE]

    def remake(items: Any) -> list[dict]:
        out = []
        for index, item in enumerate(items or []):
            if not isinstance(item, dict):
                continue
            copy = dict(item)
            if copy.get("key"):
                copy["key"] = _fresh_key(str(copy["key"]).rstrip("0123456789") or "c", stamp, index)
            out.append(copy)
        return out

    page["items"] = remake(page.get("items"))
    if isinstance(page.get("items_map"), dict):
        page["items_map"] = {platform: remake(bucket) for platform, bucket in page["items_map"].items()}
    if isinstance(page.get("guides"), list):
        page["guides"] = [
            {**guide, "id": _fresh_key("g", stamp, index)}
            for index, guide in enumerate(page["guides"]) if isinstance(guide, dict)
        ]
    return page


def _load_locked(db: Session, dashboard_id: int) -> dict:
    locked = db.execute(
        text("SELECT doc FROM bi_canvas WHERE id = :id AND deleted_at IS NULL FOR UPDATE"),
        {"id": dashboard_id},
    ).first()
    if locked is None:
        raise HTTPException(404, "看板不存在")
    return dict(locked[0] or {})


def _commit(
    db: Session,
    dashboard_id: int,
    doc: dict,
    current_user: User,
    action: str,
    detail: dict | None = None,
) -> dict:
    """校验 → 写回 → 清缓存 / 重建账本 / 写审计；失败一律回滚成 400."""
    doc = dict(doc)
    try:
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
    return payload


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

    doc = _load_locked(db, dashboard_id)
    try:
        next_doc = change(doc)
    except StructureError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc
    payload = _commit(db, dashboard_id, next_doc, current_user, action, detail)

    fresh = repo.get(db, dashboard_id)
    return fresh.to_dict() if fresh else {"id": dashboard_id, "doc": payload}


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


@router.post("/{dashboard_id}/views/copy-from")
def copy_view_from(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """跨项目复制页面（body: `{source_dashboard_id, source_view_key, title?, after?}`）.

    源项目要**可读**、目标项目要**可编辑**；只往目标项目追加一页，目标已有的页一行不动。
    数据集绑定原样保留：新页仍然用源项目那份数据，内容与来源一致。
    """
    try:
        source_id = int(payload.get("source_dashboard_id") or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "源项目不正确") from None
    source_key = str(payload.get("source_view_key") or "").strip()
    if not source_id or not source_key:
        raise HTTPException(400, "缺少源项目或页面")
    if source_id == dashboard_id:
        raise HTTPException(400, "源和目标是同一个项目，直接用「复制页面」")

    target_row = repo.get(db, dashboard_id)
    if target_row is None:
        raise HTTPException(404, "看板不存在")
    require_dashboard_edit(target_row, current_user, db)
    require_dashboard_read(repo.get(db, source_id), current_user, db)

    source = db.execute(
        text("SELECT doc FROM bi_canvas WHERE id = :id AND deleted_at IS NULL"),
        {"id": source_id},
    ).first()
    if source is None:
        raise HTTPException(404, "源项目不存在")
    source_view = next(
        (view for view in ((source[0] or {}).get("views") or []) if str(view.get("key")) == source_key),
        None,
    )
    if source_view is None:
        raise HTTPException(404, "源页面不存在")

    target_doc = _load_locked(db, dashboard_id)
    titles = {str(view.get("title") or "") for view in target_doc.get("views") or []}
    page = clone_view(source_view, uuid.uuid4().hex[:8], payload.get("title"), titles)
    try:
        next_doc = add_view(target_doc, page, payload.get("after"))
    except StructureError as exc:
        db.rollback()
        raise HTTPException(400, str(exc)) from exc

    _commit(db, dashboard_id, next_doc, current_user, "dashboard.copy_view", {
        "from_dashboard": source_id,
        "from_view": source_key[:40],
        "view": page["key"],
    })
    fresh = repo.get(db, dashboard_id)
    out = fresh.to_dict() if fresh else {"id": dashboard_id}
    out["view_key"] = page["key"]
    return out


__all__ = ["router", "add_view", "remove_view", "rename_view", "publish_doc", "clone_view", "StructureError"]
