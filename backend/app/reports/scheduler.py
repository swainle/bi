"""定时报表调度 —— 到点生成 HTML + Excel，写站内通知 / 推 Webhook.

约定：
    * 后台线程随应用启动，默认每分钟检查一次；多 worker 用 PG advisory lock 去重；
    * 时间按北京时间（UTC+8），频率支持每天 / 每周；
    * 生成失败只记录错误并把下次时间往后推，不会每分钟重试刷屏。
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.alerts import repository as alert_repo
from app.dashboards import repository as dash_repo
from app.database import SessionLocal, engine
from app.models.user import User
from app.reports import generate, tokens
from app.reports import repository as repo
from app.timezone import as_china, time_text, utc_now

LOCK_KEY = 872302
FREQUENCIES = ("daily", "weekly")
CHANNELS = ("inapp", "webhook", "dingtalk", "wecom", "email")


def interval_seconds() -> int:
    try:
        return max(0, int(os.getenv("BI_REPORT_INTERVAL_SECONDS", "60") or "60"))
    except ValueError:
        return 60


def webhook_timeout() -> float:
    try:
        return max(1.0, float(os.getenv("BI_REPORT_WEBHOOK_TIMEOUT", "5") or "5"))
    except ValueError:
        return 5.0


def public_base() -> str:
    return (os.getenv("BI_PUBLIC_BASE_URL", "http://127.0.0.1:8300") or "").rstrip("/")


def parse_time(value: str) -> tuple[int, int]:
    try:
        hour, minute = str(value or "").split(":")
        hour, minute = int(hour), int(minute)
        if 0 <= hour <= 23 and 0 <= minute <= 59:
            return hour, minute
    except ValueError:
        pass
    return 9, 0


def next_run_at(frequency: str, send_time: str, week_day: int = 1,
                after: datetime | None = None) -> datetime:
    """按北京时间排期，返回兼容数据库的 UTC 无时区时间。"""
    now = as_china(after or utc_now()).replace(second=0, microsecond=0)
    hour, minute = parse_time(send_time)
    if frequency == "weekly":
        target = min(max(int(week_day or 1), 1), 7)
        delta = (target - now.isoweekday()) % 7
        candidate = (now + timedelta(days=delta)).replace(hour=hour, minute=minute)
        if candidate <= now:
            candidate += timedelta(days=7)
        return candidate.astimezone(timezone.utc).replace(tzinfo=None)
    candidate = now.replace(hour=hour, minute=minute)
    if candidate <= now:
        candidate += timedelta(days=1)
    return candidate.astimezone(timezone.utc).replace(tzinfo=None)


def _load_user(db: Session, user_id: int | None) -> Any | None:
    if not user_id:
        return None
    user = db.get(User, int(user_id))
    if user is None or not getattr(user, "is_active", True):
        return None
    return SimpleNamespace(id=user.id, role=user.role or "", username=user.username or "")


def _notify_webhook(subscription: dict, board_name: str, run: dict, summary: dict) -> str:
    """按渠道推送（自定义 Webhook / 钉钉 / 企微 / 邮件），返回 delivered 状态."""
    from app import notifications

    channel = str(subscription.get("channel") or "webhook")
    url = str(subscription.get("email_to") if channel == "email"
              else subscription.get("webhook_url") or "").strip()
    if not url:
        return "inapp"
    html_url = f"{public_base()}{tokens.download_path(run['id'], 'html')}"
    xlsx_url = f"{public_base()}{tokens.download_path(run['id'], 'xlsx')}"
    pdf_url = f"{public_base()}{tokens.download_path(run['id'], 'pdf')}" if run.get("has_pdf") else ""
    title = f"定时报表 · {subscription.get('name') or '未命名'}"
    text = f"{board_name} 报表已生成（{summary.get('cards', 0)} 张卡片，{run.get('created_at') or ''}）"
    data = {
        "type": "report",
        "subscription": {"id": subscription.get("id"), "name": subscription.get("name"),
                         "frequency": subscription.get("frequency"),
                         "send_time": subscription.get("send_time")},
        "dashboard": {"id": subscription.get("dashboard_id"), "name": board_name},
        "run_id": run["id"],
        "generated_at": run["created_at"],
        "html_url": html_url,
        "xlsx_url": xlsx_url,
        "pdf_url": pdf_url,
        "summary": summary,
    }
    links = {"查看报表": html_url, "下载 Excel": xlsx_url}
    if pdf_url:
        links["下载 PDF"] = pdf_url
    notified, _error = notifications.send(
        channel if channel in notifications.CHANNELS else "webhook",
        url, title, text, data=data,
        links=links if channel in notifications.BOT_CHANNELS or channel == "email" else None,
        timeout=webhook_timeout(),
    )
    return notified


def run_subscription(db: Session, subscription: dict, *, triggered_by: str = "schedule",
                     user: Any | None = None) -> dict:
    """生成一次报表并交付；任何失败都落一条 failed 记录，不抛给调用方."""
    actor = user or _load_user(db, subscription.get("created_by"))
    board = dash_repo.get(db, subscription["dashboard_id"])
    board_name = board.name if board else f"看板 {subscription['dashboard_id']}"
    next_at = next_run_at(subscription.get("frequency") or "daily",
                          subscription.get("send_time") or "09:00",
                          subscription.get("week_day") or 1)

    if not board:
        run = repo.insert_run(db, {
            "subscription_id": subscription["id"], "dashboard_id": subscription["dashboard_id"],
            "status": "failed", "html_path": "", "xlsx_path": "", "pdf_path": "", "summary": "{}",
            "error": "看板不存在或已删除", "delivered": "inapp", "triggered_by": triggered_by,
        })
        repo.finish_run(db, subscription["id"], status="failed",
                        error="看板不存在或已删除", next_run_at=next_at)
        return run

    if actor is None:
        run = repo.insert_run(db, {
            "subscription_id": subscription["id"], "dashboard_id": subscription["dashboard_id"],
            "status": "failed", "html_path": "", "xlsx_path": "", "pdf_path": "", "summary": "{}",
            "error": "订阅创建者不存在或已停用，无法按行级权限取数", "delivered": "inapp",
            "triggered_by": triggered_by,
        })
        repo.finish_run(db, subscription["id"], status="failed",
                        error="订阅创建者不存在或已停用", next_run_at=next_at)
        return run

    try:
        files = generate.generate_files(db, subscription, actor)
    except Exception as exc:
        message = str(exc)[:300]
        run = repo.insert_run(db, {
            "subscription_id": subscription["id"], "dashboard_id": subscription["dashboard_id"],
            "status": "failed", "html_path": "", "xlsx_path": "", "pdf_path": "", "summary": "{}",
            "error": message, "delivered": "inapp", "triggered_by": triggered_by,
        })
        repo.finish_run(db, subscription["id"], status="failed", error=message, next_run_at=next_at)
        return run

    import json

    run = repo.insert_run(db, {
        "subscription_id": subscription["id"],
        "dashboard_id": subscription["dashboard_id"],
        "status": "success",
        "html_path": files["html_path"],
        "xlsx_path": files["xlsx_path"],
        "pdf_path": files.get("pdf_path") or "",
        "summary": json.dumps(files["summary"], ensure_ascii=False),
        "error": "",
        "delivered": "inapp",
        "triggered_by": triggered_by,
    })

    # 站内通知：复用告警事件表（rule_id 为空 = 报表事件），点开直接看 HTML
    alert_repo.insert_event(db, {
        "rule_id": None,
        "dashboard_id": subscription["dashboard_id"],
        "item_key": "",
        "rule_name": subscription.get("name") or "定时报表",
        "value": None,
        "threshold": None,
        "message": f"{subscription.get('name') or '定时报表'} · {board_name}：报表已生成（{files['summary'].get('cards', 0)} 张卡片）",
        "notified": "inapp",
        "link": tokens.download_path(run["id"], "html"),
    })

    channel = str(subscription.get("channel") or "inapp")
    target = subscription.get("email_to") if channel == "email" else subscription.get("webhook_url")
    if channel != "inapp" and target:
        delivered = _notify_webhook(subscription, board_name, run, files["summary"])
        if delivered != "inapp":
            repo.set_run_delivered(db, run["id"], delivered)
            run["delivered"] = delivered

    repo.finish_run(db, subscription["id"], status="success", error="", next_run_at=next_at)
    run["next_run_at"] = time_text(next_at)
    return run


def run_once_locked() -> dict:
    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}).scalar()
        if not got:
            return {"skipped": "locked", "checked": 0, "generated": 0}
        try:
            return run_due()
        finally:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})
                conn.commit()
            except Exception:
                pass


def run_due() -> dict:
    db = SessionLocal()
    results: list[dict] = []
    try:
        for subscription in repo.due_subscriptions(db, utc_now()):
            try:
                run = run_subscription(db, subscription)
                results.append({"subscription_id": subscription["id"], "run_id": run["id"],
                                "status": run["status"]})
            except Exception as exc:
                db.rollback()
                results.append({"subscription_id": subscription["id"], "status": "failed",
                                "error": str(exc)[:200]})
    finally:
        db.close()
    return {
        "checked": len(results),
        "generated": sum(1 for item in results if item.get("status") == "success"),
        "results": results,
    }


def loop_forever() -> None:
    while True:
        interval = interval_seconds()
        if interval <= 0:
            return
        try:
            run_once_locked()
        except Exception as exc:
            print(f"[reports] 调度失败：{str(exc)[:200]}")
        time.sleep(interval)


def start_background() -> threading.Thread | None:
    interval = interval_seconds()
    if interval <= 0:
        print("[reports] 定时报表调度已关闭（BI_REPORT_INTERVAL_SECONDS=0）")
        return None
    thread = threading.Thread(target=loop_forever, name="report-scheduler", daemon=True)
    thread.start()
    print(f"[reports] 定时报表调度已启动：每 {interval}s 检查一次")
    return thread


__all__ = ["FREQUENCIES", "CHANNELS", "interval_seconds", "webhook_timeout", "parse_time",
           "next_run_at", "run_subscription", "run_due", "run_once_locked",
           "loop_forever", "start_background"]
