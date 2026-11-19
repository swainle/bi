"""告警仓储 —— 读写 bi_alert_rule / bi_alert_event（纯 SQL，不引 ORM）."""

from __future__ import annotations

from app.timezone import time_text

from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

RULE_FIELDS = (
    "dashboard_id", "item_key", "name", "metric", "op", "threshold", "change_pct",
    "channel", "webhook_url", "email_to", "enabled", "cooldown_minutes", "created_by",
)

_EDITABLE = (
    "item_key", "name", "metric", "op", "threshold", "change_pct",
    "channel", "webhook_url", "email_to", "enabled", "cooldown_minutes",
)


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(Decimal(str(value)))
    except Exception:
        return None


def _rule_dict(row) -> dict:
    m = row._mapping
    return {
        "id": int(m["id"]),
        "dashboard_id": int(m["dashboard_id"]),
        "item_key": m["item_key"],
        "name": m["name"],
        "metric": m["metric"],
        "op": m["op"],
        "threshold": _num(m["threshold"]) or 0.0,
        "change_pct": _num(m["change_pct"]),
        "channel": m["channel"],
        "webhook_url": m["webhook_url"],
        "email_to": m.get("email_to") or "",
        "enabled": bool(m["enabled"]),
        "cooldown_minutes": int(m["cooldown_minutes"] or 0),
        "created_by": m["created_by"],
        "last_value": _num(m["last_value"]),
        "last_checked_at": time_text(m["last_checked_at"] or ""),
        "last_triggered_at": time_text(m["last_triggered_at"] or ""),
        "created_at": time_text(m["created_at"] or ""),
        "updated_at": time_text(m["updated_at"] or ""),
    }


def _event_dict(row) -> dict:
    m = row._mapping
    return {
        "id": int(m["id"]),
        "rule_id": int(m["rule_id"]) if m["rule_id"] is not None else None,
        "dashboard_id": int(m["dashboard_id"]) if m["dashboard_id"] is not None else None,
        "dashboard_name": m.get("dashboard_name") or "",
        "item_key": m["item_key"],
        "rule_name": m["rule_name"],
        "value": _num(m["value"]),
        "threshold": _num(m["threshold"]),
        "message": m["message"],
        "status": m["status"],
        "notified": m["notified"],
        "notify_error": m["notify_error"],
        "link": m.get("link") or "",
        "created_at": time_text(m["created_at"] or ""),
    }


# ── 规则 ────────────────────────────────────────────────────
def list_rules(db: Session, dashboard_id: int | None = None, limit: int = 500) -> list[dict]:
    sql = "SELECT * FROM bi_alert_rule"
    params: dict = {"limit": max(1, min(limit, 2000))}
    if dashboard_id is not None:
        sql += " WHERE dashboard_id = :dashboard_id"
        params["dashboard_id"] = dashboard_id
    sql += " ORDER BY id DESC LIMIT :limit"
    return [_rule_dict(r) for r in db.execute(text(sql), params).fetchall()]


def get_rule(db: Session, rule_id: int) -> dict | None:
    row = db.execute(text("SELECT * FROM bi_alert_rule WHERE id = :id"), {"id": rule_id}).fetchone()
    return _rule_dict(row) if row else None


def list_enabled_rules(db: Session) -> list[dict]:
    rows = db.execute(
        text("SELECT * FROM bi_alert_rule WHERE enabled IS TRUE ORDER BY id")
    ).fetchall()
    return [_rule_dict(r) for r in rows]


def create_rule(db: Session, payload: dict) -> dict:
    row = db.execute(
        text(
            "INSERT INTO bi_alert_rule "
            "(dashboard_id, item_key, name, metric, op, threshold, change_pct, "
            " channel, webhook_url, email_to, enabled, cooldown_minutes, created_by) "
            "VALUES (:dashboard_id, :item_key, :name, :metric, :op, :threshold, :change_pct, "
            "        :channel, :webhook_url, :email_to, :enabled, :cooldown_minutes, :created_by) "
            "RETURNING *"
        ),
        payload,
    ).fetchone()
    db.commit()
    return _rule_dict(row)


def update_rule(db: Session, rule_id: int, payload: dict) -> dict | None:
    sets = [f"{key} = :{key}" for key in payload if key in _EDITABLE]
    if not sets:
        return get_rule(db, rule_id)
    params = {**payload, "id": rule_id}
    db.execute(
        text(f"UPDATE bi_alert_rule SET {', '.join(sets)}, updated_at = now() WHERE id = :id"),
        params,
    )
    db.commit()
    return get_rule(db, rule_id)


def delete_rule(db: Session, rule_id: int) -> bool:
    result = db.execute(text("DELETE FROM bi_alert_rule WHERE id = :id"), {"id": rule_id})
    db.commit()
    return bool(result.rowcount)


def touch_state(db: Session, rule_id: int, value: float | None, *, triggered: bool) -> None:
    """每次评估后记录当前值与检查时间；触发时同时刷新冷却起点."""
    sql = (
        "UPDATE bi_alert_rule SET last_value = :value, last_checked_at = now()"
        + (", last_triggered_at = now()" if triggered else "")
        + " WHERE id = :id"
    )
    db.execute(text(sql), {"value": value, "id": rule_id})
    db.commit()


# ── 事件 ────────────────────────────────────────────────────
def insert_event(db: Session, payload: dict) -> dict:
    row = db.execute(
        text(
            "INSERT INTO bi_alert_event "
            "(rule_id, dashboard_id, item_key, rule_name, value, threshold, message, status, notified, link) "
            "VALUES (:rule_id, :dashboard_id, :item_key, :rule_name, :value, :threshold, :message, "
            "        'unread', :notified, :link) RETURNING *"
        ),
        {**payload, "link": payload.get("link") or ""},
    ).fetchone()
    db.commit()
    return _event_dict(row)


def set_event_notified(db: Session, event_id: int, notified: str, error: str = "") -> None:
    db.execute(
        text("UPDATE bi_alert_event SET notified = :notified, notify_error = :error WHERE id = :id"),
        {"notified": notified, "error": error[:500], "id": event_id},
    )
    db.commit()


def list_events(db: Session, rule_ids: list[int], *, status: str | None = None,
                limit: int = 30) -> list[dict]:
    if not rule_ids:
        return []
    sql = (
        "SELECT e.*, c.name AS dashboard_name FROM bi_alert_event e "
        "LEFT JOIN bi_canvas c ON c.id = e.dashboard_id "
        "WHERE e.rule_id = ANY(:ids)"
    )
    params: dict = {"ids": rule_ids, "limit": max(1, min(limit, 200))}
    if status:
        sql += " AND e.status = :status"
        params["status"] = status
    sql += " ORDER BY e.created_at DESC, e.id DESC LIMIT :limit"
    return [_event_dict(r) for r in db.execute(text(sql), params).fetchall()]


def list_report_events(db: Session, dashboard_ids: list[int], *, status: str | None = None,
                       limit: int = 30) -> list[dict]:
    """报表就绪事件（rule_id 为空）—— 只有能看对应看板的人能看到."""
    if not dashboard_ids:
        return []
    sql = (
        "SELECT e.*, c.name AS dashboard_name FROM bi_alert_event e "
        "LEFT JOIN bi_canvas c ON c.id = e.dashboard_id "
        "WHERE e.rule_id IS NULL AND e.dashboard_id = ANY(:boards)"
    )
    params: dict = {"boards": dashboard_ids, "limit": max(1, min(limit, 200))}
    if status:
        sql += " AND e.status = :status"
        params["status"] = status
    sql += " ORDER BY e.created_at DESC, e.id DESC LIMIT :limit"
    return [_event_dict(r) for r in db.execute(text(sql), params).fetchall()]


def report_board_ids(db: Session, limit: int = 100) -> list[int]:
    """最近产生过报表事件的看板（用于按权限过滤可见性）."""
    rows = db.execute(
        text(
            "SELECT DISTINCT dashboard_id FROM bi_alert_event "
            "WHERE rule_id IS NULL AND dashboard_id IS NOT NULL "
            "ORDER BY dashboard_id LIMIT :limit"
        ),
        {"limit": max(1, limit)},
    ).fetchall()
    return [int(r[0]) for r in rows]


def unread_report_count(db: Session, dashboard_ids: list[int]) -> int:
    if not dashboard_ids:
        return 0
    row = db.execute(
        text(
            "SELECT count(*) FROM bi_alert_event "
            "WHERE rule_id IS NULL AND dashboard_id = ANY(:boards) AND status = 'unread'"
        ),
        {"boards": dashboard_ids},
    ).fetchone()
    return int(row[0] or 0)


def unread_count(db: Session, rule_ids: list[int]) -> int:
    if not rule_ids:
        return 0
    row = db.execute(
        text("SELECT count(*) FROM bi_alert_event WHERE rule_id = ANY(:ids) AND status = 'unread'"),
        {"ids": rule_ids},
    ).fetchone()
    return int(row[0] or 0)


def _readable_condition(rule_ids: list[int], dashboard_ids: list[int]) -> tuple[str, dict]:
    conditions: list[str] = []
    params: dict = {}
    if rule_ids:
        conditions.append("rule_id = ANY(:ids)")
        params["ids"] = rule_ids
    if dashboard_ids:
        conditions.append("(rule_id IS NULL AND dashboard_id = ANY(:boards))")
        params["boards"] = dashboard_ids
    return (" OR ".join(conditions), params)


def mark_event_read(db: Session, event_id: int, rule_ids: list[int],
                    dashboard_ids: list[int] | None = None) -> bool:
    condition, params = _readable_condition(rule_ids, list(dashboard_ids or []))
    if not condition:
        return False
    result = db.execute(
        text(
            f"UPDATE bi_alert_event SET status = 'read' "
            f"WHERE id = :id AND status = 'unread' AND ({condition})"
        ),
        {**params, "id": event_id},
    )
    db.commit()
    return bool(result.rowcount)


def mark_all_read(db: Session, rule_ids: list[int], dashboard_ids: list[int] | None = None) -> int:
    condition, params = _readable_condition(rule_ids, list(dashboard_ids or []))
    if not condition:
        return 0
    result = db.execute(
        text(
            f"UPDATE bi_alert_event SET status = 'read' "
            f"WHERE status = 'unread' AND ({condition})"
        ),
        params,
    )
    db.commit()
    return int(result.rowcount or 0)


__all__ = [
    "RULE_FIELDS", "list_rules", "get_rule", "list_enabled_rules", "create_rule",
    "update_rule", "delete_rule", "touch_state", "insert_event", "set_event_notified",
    "list_events", "list_report_events", "report_board_ids", "unread_count",
    "unread_report_count", "mark_event_read", "mark_all_read",
]
