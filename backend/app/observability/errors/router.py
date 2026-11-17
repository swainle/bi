"""错误上报与查询 API.

    * `POST /api/report`：前端 ErrorBoundary / 全局 JS 错误（可选登录，CSRF 已豁免）；
    * `GET /api/bi/errors`：管理员查看最近错误（按来源 / 级别筛选 + 24h 计数）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.observability.errors import repository as repo
from app.middleware.auth import get_current_user, get_optional_user
from app.models.user import User

router = APIRouter(tags=["系统错误"])
logger = logging.getLogger("frontend")


@router.post("/report")
def report_error(
    request: Request,
    payload: dict = Body(default={}),
    current_user: User | None = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    """接收前端错误（同一时刻只记一条，前端已做 10s 去重）."""
    message = str(payload.get("message") or "").strip()
    if not message:
        return {"ok": True, "skipped": "empty"}
    url = str(payload.get("url") or request.headers.get("referer") or "")[:1000]
    user_agent = str(payload.get("user_agent") or request.headers.get("user-agent") or "")
    record = {
        "source": payload.get("source") or "frontend",
        "level": payload.get("level") or "error",
        "message": message,
        "stack": payload.get("stack") or "",
        "url": url,
        "user_id": current_user.id if current_user else None,
        "username": current_user.username if current_user else "",
        "user_agent": user_agent,
        "extra": payload.get("extra") if isinstance(payload.get("extra"), dict) else {},
    }
    try:
        row = repo.insert(db, record)
        repo.prune(db)
    except Exception as exc:  # 上报失败不能反过来影响页面
        db.rollback()
        logger.warning("错误上报落库失败：%s", str(exc)[:200])
        logger.error("%s | %s", message, str(record["stack"])[:800])
        return {"ok": False}
    logger.error(
        "前端错误 #%s | %s | %s", row["id"], message, str(record["stack"])[:800]
    )
    return {"ok": True, "id": row["id"]}


@router.get("/bi/errors")
def list_errors(
    source: str | None = None,
    level: str | None = None,
    limit: int = 100,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 管理员直通；其余人被授予「错误日志」(bi:error:view) 才能看（管理后台可分配）
    from app.admin.permissions import has_permission

    if not has_permission(db, current_user, "bi:error:view"):
        raise HTTPException(403, "只有管理员可以查看错误日志")
    source = (source or "").strip() or None
    level = (level or "").strip() or None
    return {
        "items": repo.list_errors(db, source=source, level=level, limit=limit, offset=offset),
        "stats": repo.counts(db),
        "retain_days": repo.retain_days(),
    }


__all__ = ["router"]
