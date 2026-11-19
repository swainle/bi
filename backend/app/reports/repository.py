"""定时报表仓储 —— 订阅与生成记录（纯 SQL）."""

from __future__ import annotations

from app.timezone import time_text

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

_SUB_EDITABLE = (
    "name", "view_key", "frequency", "send_time", "week_day",
    "channel", "webhook_url", "email_to", "enabled", "next_run_at",
)


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return {}
    return value or {}


def _sub_dict(row) -> dict:
    m = row._mapping
    return {
        "id": int(m["id"]),
        "dashboard_id": int(m["dashboard_id"]),
        "name": m["name"],
        "view_key": m["view_key"],
        "frequency": m["frequency"],
        "send_time": m["send_time"],
        "week_day": int(m["week_day"] or 1),
        "channel": m["channel"],
        "webhook_url": m["webhook_url"],
        "email_to": m.get("email_to") or "",
        "enabled": bool(m["enabled"]),
        "created_by": m["created_by"],
        "last_run_at": time_text(m["last_run_at"] or ""),
        "last_status": m["last_status"],
        "last_error": m["last_error"],
        "next_run_at": time_text(m["next_run_at"] or ""),
        "created_at": time_text(m["created_at"] or ""),
        "updated_at": time_text(m["updated_at"] or ""),
    }


def _run_dict(row) -> dict:
    m = row._mapping
    return {
        "id": int(m["id"]),
        "subscription_id": int(m["subscription_id"]) if m["subscription_id"] is not None else None,
        "subscription_name": m.get("subscription_name") or "",
        "dashboard_id": int(m["dashboard_id"]) if m["dashboard_id"] is not None else None,
        "status": m["status"],
        "summary": _json(m["summary"]),
        "error": m["error"],
        "delivered": m["delivered"],
        "triggered_by": m["triggered_by"],
        "created_at": time_text(m["created_at"] or ""),
        "has_html": bool(m["html_path"]),
        "has_xlsx": bool(m["xlsx_path"]),
        "has_pdf": bool(m.get("pdf_path")),
    }


def list_subscriptions(db: Session, dashboard_id: int | None = None, limit: int = 200) -> list[dict]:
    sql = "SELECT * FROM bi_report_subscription"
    params: dict = {"limit": max(1, min(limit, 500))}
    if dashboard_id is not None:
        sql += " WHERE dashboard_id = :dashboard_id"
        params["dashboard_id"] = dashboard_id
    sql += " ORDER BY id DESC LIMIT :limit"
    return [_sub_dict(r) for r in db.execute(text(sql), params).fetchall()]


def get_subscription(db: Session, sub_id: int) -> dict | None:
    row = db.execute(
        text("SELECT * FROM bi_report_subscription WHERE id = :id"), {"id": sub_id}
    ).fetchone()
    return _sub_dict(row) if row else None


def create_subscription(db: Session, payload: dict) -> dict:
    row = db.execute(
        text(
            "INSERT INTO bi_report_subscription "
            "(dashboard_id, name, view_key, frequency, send_time, week_day, channel, "
            " webhook_url, email_to, enabled, created_by, next_run_at) "
            "VALUES (:dashboard_id, :name, :view_key, :frequency, :send_time, :week_day, :channel, "
            "        :webhook_url, :email_to, :enabled, :created_by, :next_run_at) RETURNING *"
        ),
        payload,
    ).fetchone()
    db.commit()
    return _sub_dict(row)


def update_subscription(db: Session, sub_id: int, payload: dict) -> dict | None:
    sets = [f"{key} = :{key}" for key in payload if key in _SUB_EDITABLE]
    if not sets:
        return get_subscription(db, sub_id)
    db.execute(
        text(f"UPDATE bi_report_subscription SET {', '.join(sets)}, updated_at = now() WHERE id = :id"),
        {**payload, "id": sub_id},
    )
    db.commit()
    return get_subscription(db, sub_id)


def delete_subscription(db: Session, sub_id: int) -> bool:
    result = db.execute(
        text("DELETE FROM bi_report_subscription WHERE id = :id"), {"id": sub_id}
    )
    db.commit()
    return bool(result.rowcount)


def due_subscriptions(db: Session, now) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT * FROM bi_report_subscription "
            "WHERE enabled IS TRUE AND next_run_at IS NOT NULL AND next_run_at <= :now "
            "ORDER BY next_run_at LIMIT 20"
        ),
        {"now": now},
    ).fetchall()
    return [_sub_dict(r) for r in rows]


def finish_run(db: Session, sub_id: int, *, status: str, error: str, next_run_at) -> None:
    db.execute(
        text(
            "UPDATE bi_report_subscription SET last_run_at = now(), last_status = :status, "
            "last_error = :error, next_run_at = :next_run_at, updated_at = now() WHERE id = :id"
        ),
        {"status": status, "error": error[:500], "next_run_at": next_run_at, "id": sub_id},
    )
    db.commit()


def insert_run(db: Session, payload: dict) -> dict:
    row = db.execute(
        text(
            "INSERT INTO bi_report_run "
            "(subscription_id, dashboard_id, status, html_path, xlsx_path, pdf_path, summary, error, "
            " delivered, triggered_by) "
            "VALUES (:subscription_id, :dashboard_id, :status, :html_path, :xlsx_path, :pdf_path, "
            "        CAST(:summary AS jsonb), :error, :delivered, :triggered_by) RETURNING *"
        ),
        payload,
    ).fetchone()
    db.commit()
    return _run_dict(row)


def set_run_delivered(db: Session, run_id: int, delivered: str) -> None:
    db.execute(
        text("UPDATE bi_report_run SET delivered = :delivered WHERE id = :id"),
        {"delivered": delivered, "id": run_id},
    )
    db.commit()


def list_runs(db: Session, *, subscription_id: int | None = None,
              dashboard_id: int | None = None, limit: int = 30) -> list[dict]:
    sql = (
        "SELECT r.*, s.name AS subscription_name FROM bi_report_run r "
        "LEFT JOIN bi_report_subscription s ON s.id = r.subscription_id WHERE 1 = 1"
    )
    params: dict = {"limit": max(1, min(limit, 200))}
    if subscription_id is not None:
        sql += " AND r.subscription_id = :subscription_id"
        params["subscription_id"] = subscription_id
    if dashboard_id is not None:
        sql += " AND r.dashboard_id = :dashboard_id"
        params["dashboard_id"] = dashboard_id
    sql += " ORDER BY r.created_at DESC, r.id DESC LIMIT :limit"
    return [_run_dict(r) for r in db.execute(text(sql), params).fetchall()]


def get_run(db: Session, run_id: int) -> dict | None:
    row = db.execute(
        text("SELECT * FROM bi_report_run WHERE id = :id"), {"id": run_id}
    ).fetchone()
    return _run_dict(row) if row else None


def get_run_files(db: Session, run_id: int) -> dict | None:
    row = db.execute(
        text("SELECT id, dashboard_id, html_path, xlsx_path, pdf_path, created_at "
             "FROM bi_report_run WHERE id = :id"),
        {"id": run_id},
    ).fetchone()
    if row is None:
        return None
    m = row._mapping
    return {
        "id": int(m["id"]),
        "dashboard_id": int(m["dashboard_id"]) if m["dashboard_id"] is not None else None,
        "html_path": m["html_path"],
        "xlsx_path": m["xlsx_path"],
        "pdf_path": m.get("pdf_path") or "",
        "created_at": time_text(m["created_at"] or ""),
    }


__all__ = [
    "list_subscriptions", "get_subscription", "create_subscription", "update_subscription",
    "delete_subscription", "due_subscriptions", "finish_run", "insert_run",
    "set_run_delivered", "list_runs", "get_run", "get_run_files",
]
