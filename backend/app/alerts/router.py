"""告警 API —— 规则 CRUD / 立即测试 / 事件（未读 + 已读）.

权限口径与看板一致：
    看规则 / 看事件 = 能看这块看板（团队协同看板对成员可见）；
    建 / 改 / 删规则 = 能编辑这块看板（owner / 管理员 / 被设为可编辑的成员）。
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from app.alerts import evaluate
from app.alerts import repository as repo
from app import notifications
from app.dashboards import render as renderer
from app.dashboards import repository as dash_repo
from app.dashboards.models import validate_doc
from app.dashboards.router import _can_read, _require_edit, _require_read
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/bi/alerts", tags=["BI告警"])

_CHANNELS = ("inapp", "webhook", "dingtalk", "wecom", "email")


def _as_float(value, name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name}必须是数字")


def _as_int(value, name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise HTTPException(400, f"{name}必须是整数")


def _kpi_cards(db: Session, doc) -> list[dict]:
    """看板里可做告警的卡片（只列指标卡）."""
    out: list[dict] = []
    for view, item in doc.all_items():
        if item.type in ("heading", "text", "divider", "board", "filter"):
            continue
        try:
            kind, spec = renderer._item_spec(db, item)
        except Exception:
            continue
        if kind != "kpi":
            continue
        out.append({
            "view_key": view.key,
            "item_key": item.key,
            "title": item.title or spec.title or item.key,
            "metric": spec.binding.metric or "",
            "unit": spec.unit or "",
        })
    return out


def _clean(payload: dict, *, base: dict | None = None) -> dict:
    """校验并归一化规则字段（新建 / 修改共用）."""
    merged = {**(base or {}), **payload}

    item_key = str(merged.get("item_key") or "").strip()
    if not item_key:
        raise HTTPException(400, "请选择要监控的指标卡")
    name = str(merged.get("name") or "").strip()[:120]
    if not name:
        raise HTTPException(400, "规则名称不能为空")

    op = str(merged.get("op") or ">").strip()
    if op not in evaluate.OPS:
        raise HTTPException(400, f"不支持的比较符：{op}")

    threshold = _as_float(merged.get("threshold"), "阈值")

    change_raw = merged.get("change_pct")
    change_pct = None
    if change_raw not in (None, "", False):
        change_pct = _as_float(change_raw, "波动百分比")
        if change_pct < 0:
            raise HTTPException(400, "波动百分比不能为负")

    channel = str(merged.get("channel") or "inapp").strip()
    if channel not in _CHANNELS:
        raise HTTPException(400, "通知渠道只能是站内 / 自定义 Webhook / 钉钉 / 企业微信 / 邮件")
    webhook_url = str(merged.get("webhook_url") or "").strip()[:500]
    email_to = str(merged.get("email_to") or "").strip()[:500]
    if channel == "email":
        emails = notifications.valid_emails(email_to)
        if not emails:
            raise HTTPException(400, "请填写收件人邮箱")
        email_to = ", ".join(emails)
    elif channel != "inapp":
        if not webhook_url.startswith(("http://", "https://")):
            raise HTTPException(400, "通知地址必须以 http:// 或 https:// 开头")
    if channel != "email":
        email_to = ""

    cooldown = _as_int(merged.get("cooldown_minutes", 30), "冷却时间")
    if cooldown < 0 or cooldown > 1440:
        raise HTTPException(400, "冷却时间需在 0~1440 分钟之间")

    enabled = merged.get("enabled", True)
    metric = str(merged.get("metric") or "").strip()[:120]

    return {
        "item_key": item_key,
        "name": name,
        "metric": metric,
        "op": op,
        "threshold": threshold,
        "change_pct": change_pct,
        "channel": channel,
        "webhook_url": webhook_url,
        "email_to": email_to,
        "enabled": bool(enabled),
        "cooldown_minutes": cooldown,
    }


def _rule_or_404(db: Session, rule_id: int) -> dict:
    rule = repo.get_rule(db, rule_id)
    if rule is None:
        raise HTTPException(404, "告警规则不存在")
    return rule


def _require_rule_edit(db: Session, rule: dict, user: User) -> None:
    row = dash_repo.get(db, rule["dashboard_id"])
    _require_edit(row, user, db)


def _visible_rules(db: Session, user: User) -> list[dict]:
    """当前用户能看到的规则：自己建的 + 能看的看板上的（管理员全部）."""
    rules = repo.list_rules(db, limit=1000)
    cache: dict[int, bool] = {}
    out: list[dict] = []
    for rule in rules:
        if user.role in ("admin", "super_admin") or rule["created_by"] == user.id:
            out.append(rule)
            continue
        dashboard_id = rule["dashboard_id"]
        if dashboard_id not in cache:
            row = dash_repo.get(db, dashboard_id)
            cache[dashboard_id] = bool(row and _can_read(row, user, db))
        if cache[dashboard_id]:
            out.append(rule)
    return out


@router.get("/cards")
def list_alert_cards(
    dashboard_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    doc = validate_doc(row.doc)
    return {"dashboard": {"id": row.id, "name": row.name}, "cards": _kpi_cards(db, doc)}


@router.get("/rules")
def list_rules(
    dashboard_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if dashboard_id is not None:
        _require_read(dash_repo.get(db, dashboard_id), current_user, db)
        return {"rules": repo.list_rules(db, dashboard_id=dashboard_id)}
    ids = {rule["id"] for rule in _visible_rules(db, current_user)}
    return {"rules": [rule for rule in repo.list_rules(db, limit=1000) if rule["id"] in ids]}


@router.post("/rules")
def create_rule(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    dashboard_id = _as_int(payload.get("dashboard_id"), "看板")
    row = _require_edit(dash_repo.get(db, dashboard_id), current_user, db)
    data = _clean(payload)

    doc = validate_doc(row.doc)
    cards = {card["item_key"]: card for card in _kpi_cards(db, doc)}
    card = cards.get(data["item_key"])
    if card is None:
        raise HTTPException(400, "这张卡片不存在或不是指标卡，无法告警")

    data.update({
        "dashboard_id": dashboard_id,
        "metric": data["metric"] or card["metric"],
        "created_by": current_user.id,
    })
    return repo.create_rule(db, data)


@router.put("/rules/{rule_id}")
def update_rule(
    rule_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = _rule_or_404(db, rule_id)
    _require_rule_edit(db, rule, current_user)

    data = _clean(payload, base=rule)
    if data["item_key"] != rule["item_key"]:
        row = _require_read(dash_repo.get(db, rule["dashboard_id"]), current_user, db)
        cards = {card["item_key"]: card for card in _kpi_cards(db, validate_doc(row.doc))}
        card = cards.get(data["item_key"])
        if card is None:
            raise HTTPException(400, "这张卡片不存在或不是指标卡，无法告警")
        data["metric"] = data["metric"] or card["metric"]
    return repo.update_rule(db, rule_id, data)


@router.delete("/rules/{rule_id}")
def delete_rule(
    rule_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule = _rule_or_404(db, rule_id)
    _require_rule_edit(db, rule, current_user)
    if not repo.delete_rule(db, rule_id):
        raise HTTPException(404, "告警规则不存在")
    return {"ok": True}


@router.post("/rules/{rule_id}/test")
def test_rule(
    rule_id: int,
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """立即测试：按当前真实数据评估一次，不写事件；可选真的发一条 webhook."""
    rule = _rule_or_404(db, rule_id)
    _require_rule_edit(db, rule, current_user)
    result = evaluate.check(db, rule)
    if payload.get("send_webhook") and str(rule.get("channel") or "inapp") != "inapp":
        message = f"[测试] {rule.get('name') or '指标告警'}：{result.get('reason') or result.get('error')}"
        notified, error = evaluate.notify_webhook(rule, result.get("value"), message)
        result["notified"] = notified
        result["notify_error"] = error
    return result


@router.post("/preview")
def preview_rule(
    payload: dict = Body(default={}),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """新建规则前试算：用当前用户身份取这张卡的值，判断条件会不会命中."""
    dashboard_id = _as_int(payload.get("dashboard_id"), "看板")
    row = _require_read(dash_repo.get(db, dashboard_id), current_user, db)
    doc = validate_doc(row.doc)
    cards = {card["item_key"]: card for card in _kpi_cards(db, doc)}
    item_key = str(payload.get("item_key") or "").strip()
    if item_key not in cards:
        raise HTTPException(400, "这张卡片不存在或不是指标卡，无法告警")
    draft = _clean({**payload, "name": payload.get("name") or cards[item_key]["title"]})
    return evaluate.check(db, {
        "id": None,
        "dashboard_id": dashboard_id,
        "item_key": draft["item_key"],
        "name": draft["name"],
        "op": draft["op"],
        "threshold": draft["threshold"],
        "change_pct": draft["change_pct"],
        "last_value": None,
        "created_by": current_user.id,
    }, user=current_user)


def _readable_report_boards(db: Session, user: User) -> list[int]:
    """最近有报表事件的看板里，当前用户能看的那些（报表事件没有规则，按看板权限判断）."""
    out: list[int] = []
    for dashboard_id in repo.report_board_ids(db):
        if user.role in ("admin", "super_admin"):
            out.append(dashboard_id)
            continue
        row = dash_repo.get(db, dashboard_id)
        if row is not None and _can_read(row, user, db):
            out.append(dashboard_id)
    return out


@router.get("/events")
def list_events(
    status: str | None = None,
    limit: int = 30,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limit = max(1, min(limit, 200))
    rule_ids = [rule["id"] for rule in _visible_rules(db, current_user)]
    report_boards = _readable_report_boards(db, current_user)
    events = repo.list_events(db, rule_ids, status=status, limit=limit)
    events += repo.list_report_events(db, report_boards, status=status, limit=limit)
    events.sort(key=lambda item: (item.get("created_at") or "", item.get("id") or 0), reverse=True)
    unread = repo.unread_count(db, rule_ids) + repo.unread_report_count(db, report_boards)
    return {"events": events[:limit], "unread": unread}


@router.post("/events/{event_id}/read")
def read_event(
    event_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule_ids = [rule["id"] for rule in _visible_rules(db, current_user)]
    report_boards = _readable_report_boards(db, current_user)
    if not repo.mark_event_read(db, event_id, rule_ids, report_boards):
        raise HTTPException(404, "告警不存在或已读")
    return {"ok": True}


@router.post("/events/read-all")
def read_all_events(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rule_ids = [rule["id"] for rule in _visible_rules(db, current_user)]
    report_boards = _readable_report_boards(db, current_user)
    return {"ok": True, "updated": repo.mark_all_read(db, rule_ids, report_boards)}


__all__ = ["router"]
