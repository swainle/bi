"""定时报表 API —— 订阅 CRUD / 立即生成 / 生成记录 / 下载.

权限口径与看板一致：看订阅与记录 = 能看这块看板；建/改/删/立即生成 = 能编辑这块看板。
下载：站内用 JWT；通知里的链接用 HMAC 签名 token（7 天有效），可在浏览器直接打开。
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.dashboards import repository as dash_repo
from app import notifications
from app.dashboards.models import validate_doc
from app.dashboards.router import _require_edit, _require_read
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.reports import generate, scheduler, tokens
from app.reports import repository as repo

router = APIRouter(prefix="/bi/reports", tags=["BI定时报表"])

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_FREQ_LABEL = {"daily": "每天", "weekly": "每周"}


def _as_int(value, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name}必须是整数")


def _board_views(doc) -> list[dict]:
    return [{"key": view.key, "title": view.title} for view in doc.views]


def _clean(payload: dict, *, base: dict | None = None) -> dict:
    merged = {**(base or {}), **payload}

    name = str(merged.get("name") or "").strip()[:120]
    if not name:
        raise HTTPException(400, "报表名称不能为空")

    frequency = str(merged.get("frequency") or "daily").strip()
    if frequency not in scheduler.FREQUENCIES:
        raise HTTPException(400, "频率只能是每天或每周")

    send_time = str(merged.get("send_time") or "09:00").strip()
    if not _TIME_RE.match(send_time):
        raise HTTPException(400, "发送时间格式应为 HH:MM（00:00 ~ 23:59）")

    week_day = _as_int(merged.get("week_day", 1), "星期")
    if week_day < 1 or week_day > 7:
        raise HTTPException(400, "星期需在 1~7 之间（1 = 周一）")

    channel = str(merged.get("channel") or "inapp").strip()
    if channel not in scheduler.CHANNELS:
        raise HTTPException(400, "通知渠道只能是站内 / 自定义 Webhook / 钉钉 / 企业微信 / 邮件")
    webhook_url = str(merged.get("webhook_url") or "").strip()[:500]
    email_to = str(merged.get("email_to") or "").strip()[:500]
    if channel == "email":
        emails = notifications.valid_emails(email_to)
        if not emails:
            raise HTTPException(400, "请填写收件人邮箱")
        email_to = ", ".join(emails)
    elif channel != "inapp" and not webhook_url.startswith(("http://", "https://")):
        raise HTTPException(400, "通知地址必须以 http:// 或 https:// 开头")

    view_key = str(merged.get("view_key") or "").strip()[:80]
    enabled = merged.get("enabled", True)

    return {
        "name": name,
        "view_key": view_key,
        "frequency": frequency,
        "send_time": send_time,
        "week_day": week_day,
        "channel": channel,
        "webhook_url": webhook_url if channel not in ("inapp", "email") else "",
        "email_to": email_to if channel == "email" else "",
        "enabled": bool(enabled),
    }


def _sub_or_404(db: Session, sub_id: int) -> dict:
    sub = repo.get_subscription(db, sub_id)
    if sub is None:
        raise HTTPException(404, "定时报表不存在")
    return sub


def _require_sub_edit(db: Session, sub: dict, user: User) -> None:
    _require_edit(dash_repo.get(db, sub["dashboard_id"]), user, db)


@router.get("/views")
def list_views(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    return {"dashboard": {"id": row.id, "name": row.name},
            "views": _board_views(validate_doc(row.doc))}


@router.get("/subscriptions")
def list_subscriptions(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    return {"subscriptions": repo.list_subscriptions(db, dashboard_id=dashboard_id)}


@router.post("/subscriptions")
def create_subscription(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dashboard_id = _as_int(payload.get("dashboard_id"), "看板")
    row = _require_edit(dash_repo.get(db, dashboard_id), current_user, db)
    data = _clean(payload)

    views = {view["key"] for view in _board_views(validate_doc(row.doc))}
    if data["view_key"] and data["view_key"] not in views:
        raise HTTPException(400, "选择的视图不存在")

    data.update({
        "dashboard_id": dashboard_id,
        "created_by": current_user.id,
        "next_run_at": scheduler.next_run_at(data["frequency"], data["send_time"], data["week_day"]),
    })
    return repo.create_subscription(db, data)


@router.put("/subscriptions/{sub_id}")
def update_subscription(
    sub_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = _sub_or_404(db, sub_id)
    _require_sub_edit(db, sub, current_user)
    data = _clean(payload, base=sub)

    row = dash_repo.get(db, sub["dashboard_id"])
    views = {view["key"] for view in _board_views(validate_doc(row.doc))} if row else set()
    if data["view_key"] and data["view_key"] not in views:
        raise HTTPException(400, "选择的视图不存在")

    changed_schedule = any(data[key] != sub[key] for key in
                           ("frequency", "send_time", "week_day", "enabled"))
    if changed_schedule or not sub.get("next_run_at"):
        data["next_run_at"] = scheduler.next_run_at(
            data["frequency"], data["send_time"], data["week_day"])
    return repo.update_subscription(db, sub_id, data)


@router.delete("/subscriptions/{sub_id}")
def delete_subscription(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    sub = _sub_or_404(db, sub_id)
    _require_sub_edit(db, sub, current_user)
    repo.delete_subscription(db, sub_id)
    return {"ok": True}


@router.post("/subscriptions/{sub_id}/run")
def run_now(
    sub_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """立即生成一次（不改变固定排期，只多一条记录）."""
    sub = _sub_or_404(db, sub_id)
    _require_sub_edit(db, sub, current_user)
    return scheduler.run_subscription(db, sub, triggered_by="manual", user=current_user)


@router.post("/export/{dashboard_id}")
def export_dashboard(
    dashboard_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """整页导出：按当前视图 + 当前筛选参数生成（Excel / HTML / PDF / PNG），不落订阅记录."""
    row = _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    kind = str(payload.get("format") or "xlsx").strip().lower()
    if kind not in ("xlsx", "html", "pdf", "png"):
        raise HTTPException(400, "导出格式只支持 xlsx / html / pdf / png")
    try:
        files = generate.export_dashboard(
            db, row, current_user,
            view_key=str(payload.get("view") or ""),
            params=payload.get("params") or {},
            title=str(payload.get("title") or ""),
            cross_filters=payload.get("cross_filters") or [],
        )
        path = (generate.render_artifact(kind, files["html_path"])
                if kind in ("pdf", "png") else
                files["xlsx_path"] if kind == "xlsx" else files["html_path"])
    except Exception as exc:
        raise HTTPException(400, f"导出失败：{str(exc)[:200]}") from exc

    stamp = datetime.now().strftime("%Y%m%d-%H%M")
    base = re.sub(r'[\\/:*?"<>|]', "-", row.name or "看板")[:40]
    filename = f"{base}-{stamp}.{kind}"
    if kind == "html":
        return FileResponse(path, media_type="text/html; charset=utf-8",
                            headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"})
    if kind == "pdf":
        return FileResponse(path, media_type="application/pdf", filename=filename)
    if kind == "png":
        return FileResponse(path, media_type="image/png", filename=filename)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
    )


@router.get("/runs")
def list_runs(
    subscription_id: int | None = None,
    dashboard_id: int | None = None,
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if subscription_id is not None:
        sub = _sub_or_404(db, subscription_id)
        _require_read(dash_repo.get(db, sub["dashboard_id"]), current_user, db)
    elif dashboard_id is not None:
        _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    else:
        raise HTTPException(400, "请指定看板或订阅")
    return {"runs": repo.list_runs(db, subscription_id=subscription_id,
                                   dashboard_id=dashboard_id, limit=limit)}


def _serve(db: Session, run_id: int, kind: str) -> FileResponse:
    if kind not in tokens.KINDS:
        raise HTTPException(400, "只支持 html / xlsx / pdf")
    files = repo.get_run_files(db, run_id)
    if files is None:
        raise HTTPException(404, "报表不存在")
    relative = {"html": files["html_path"], "xlsx": files["xlsx_path"],
                "pdf": files["pdf_path"]}.get(kind) or ""
    if not relative:
        raise HTTPException(404, "这份报表没有该格式的文件")
    path = generate.absolute_path(relative)
    if not os.path.exists(path):
        raise HTTPException(404, "报表文件已不存在")

    board = dash_repo.get(db, files["dashboard_id"]) if files["dashboard_id"] else None
    stamp = (files["created_at"] or "").replace("-", "").replace(":", "").replace(" ", "-")[:13]
    base = (board.name if board else "report").replace("/", "-")[:40]
    filename = f"{base}-{stamp}.{kind}"
    if kind == "html":
        return FileResponse(path, media_type="text/html; charset=utf-8",
                            headers={"Content-Disposition": f"inline; filename*=UTF-8''{quote(filename)}"})
    if kind == "pdf":
        return FileResponse(path, media_type="application/pdf", filename=filename)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
    )


@router.get("/runs/{run_id}/download")
def download_run(
    run_id: int,
    kind: str = Query("html"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    files = repo.get_run_files(db, run_id)
    if files is None:
        raise HTTPException(404, "报表不存在")
    _require_read(dash_repo.get(db, files["dashboard_id"]), current_user, db)
    return _serve(db, run_id, kind)


@router.get("/download/{run_id}/{kind}")
def download_signed(
    run_id: int,
    kind: str,
    token: str = Query(""),
    db: Session = Depends(get_db),
):
    """签名链接（站内通知 / Webhook 使用），无需登录，7 天有效."""
    verified = tokens.verify_run(token)
    if verified is None or verified[0] != run_id or verified[1] != kind:
        raise HTTPException(403, "下载链接无效或已过期")
    return _serve(db, run_id, kind)


__all__ = ["router"]
