"""告警评估 —— 定时读取规则监控的指标卡当前值，命中条件写事件并推送 webhook.

约定：
    * 只支持指标卡（kpi）—— 数值口径与看板完全一致（走 render_dashboard，含筛选默认值 / 平台默认值）；
    * 规则以「创建者身份」取数，行级权限（RLS）与该用户看看板时一致；
    * 同一规则在冷却期内不重复写事件；
    * 多进程部署时用 PG advisory lock 保证只有一个实例在跑（拿到锁才评估）。
"""

from __future__ import annotations

import os
import threading
import time
from datetime import datetime, timedelta
from app.timezone import as_china, china_now
from types import SimpleNamespace
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.alerts import repository as repo
from app.dashboards import render as renderer
from app.dashboards import repository as dash_repo
from app.dashboards.models import validate_doc
from app.database import SessionLocal, engine
from app.models.user import User

LOCK_KEY = 872301  # pg_try_advisory_lock 的固定 key：多 worker 只有一个在评估

OPS = (">", ">=", "<", "<=", "=")


def interval_seconds() -> int:
    try:
        return max(0, int(os.getenv("BI_ALERT_INTERVAL_SECONDS", "60") or "60"))
    except ValueError:
        return 60


def webhook_timeout() -> float:
    try:
        return max(1.0, float(os.getenv("BI_ALERT_WEBHOOK_TIMEOUT", "5") or "5"))
    except ValueError:
        return 5.0


def _num(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _compare(value: float, op: str, threshold: float) -> bool:
    if op == ">":
        return value > threshold
    if op == ">=":
        return value >= threshold
    if op == "<":
        return value < threshold
    if op == "<=":
        return value <= threshold
    if op == "=":
        return abs(value - threshold) < 1e-9
    return False


def _change_pct(value: float, previous: float | None) -> float | None:
    if previous in (None, 0):
        return None
    try:
        return (value - float(previous)) / abs(float(previous)) * 100.0
    except (TypeError, ValueError):
        return None


def _fmt(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value:,.2f}".rstrip("0").rstrip(".")


def current_value(db: Session, dashboard_id: int, item_key: str, user: Any) -> tuple[float | None, str]:
    """用与看板一致的渲染链路取这张卡当前的数值（kpi 才有 raw_value）."""
    row = dash_repo.get(db, dashboard_id)
    if row is None:
        return None, "看板不存在或已删除"
    try:
        doc = validate_doc(row.doc)
    except Exception as exc:
        return None, f"看板文档解析失败：{str(exc)[:120]}"
    found = renderer.find_item(doc, item_key)
    if found is None:
        return None, f"卡片不存在：{item_key}"
    view, item = found
    try:
        kind, _spec = renderer._item_spec(db, item)
    except Exception as exc:
        return None, f"卡片配置无效：{str(exc)[:120]}"
    if kind != "kpi":
        return None, "只支持指标卡（kpi）告警"
    try:
        payload = renderer.render_dashboard(db, doc, user, view_key=view.key)
    except Exception as exc:
        return None, f"取数失败：{str(exc)[:160]}"
    card = (payload.get("cards") or {}).get(item_key) or {}
    if card.get("error"):
        return None, f"取数失败：{str(card.get('error'))[:160]}"
    raw = _num(card.get("raw_value"))
    if raw is None:
        return None, "这张指标卡当前不是数值（检查指标 / 计算方式）"
    return raw, ""


def _load_user(db: Session, user_id: int | None) -> Any | None:
    if not user_id:
        return None
    user = db.get(User, int(user_id))
    if user is None or not getattr(user, "is_active", True):
        return None
    return SimpleNamespace(id=user.id, role=user.role or "", username=user.username or "")


def check(db: Session, rule: dict, user: Any | None = None, *, previous: float | None = None) -> dict:
    """评估一条规则（不写事件）—— 给定时任务与「立即测试」共用."""
    actor = user or _load_user(db, rule.get("created_by"))
    if actor is None:
        return {"rule_id": rule.get("id"), "value": None, "triggered": False,
                "error": "规则创建者不存在或已停用，无法按行级权限取数"}
    value, error = current_value(db, rule["dashboard_id"], rule["item_key"], actor)
    if value is None:
        return {"rule_id": rule.get("id"), "value": None, "triggered": False, "error": error}

    op = str(rule.get("op") or ">")
    threshold = _num(rule.get("threshold")) or 0.0
    baseline = previous if previous is not None else rule.get("last_value")
    pct = _change_pct(value, _num(baseline))
    limit = _num(rule.get("change_pct"))
    hit_threshold = _compare(value, op, threshold)
    hit_change = limit is not None and limit > 0 and pct is not None and abs(pct) >= limit
    triggered = hit_threshold or hit_change

    if hit_threshold:
        reason = f"当前值 {_fmt(value)} {op} 阈值 {_fmt(threshold)}"
    elif hit_change:
        reason = f"较上次检查波动 {pct:+.2f}%（阈值 ±{_fmt(limit)}%）"
    else:
        reason = f"当前值 {_fmt(value)}，条件 {op} {_fmt(threshold)} 未满足"
    return {
        "rule_id": rule.get("id"),
        "value": round(value, 6),
        "threshold": threshold,
        "op": op,
        "change_pct": round(pct, 4) if pct is not None else None,
        "hit_threshold": hit_threshold,
        "hit_change": hit_change,
        "triggered": triggered,
        "reason": reason,
        "error": "",
    }


def _in_cooldown(rule: dict) -> bool:
    last = str(rule.get("last_triggered_at") or "").strip()
    minutes = int(rule.get("cooldown_minutes") or 0)
    if not last or minutes <= 0:
        return False
    try:
        moment = as_china(datetime.fromisoformat(last))
    except ValueError:
        return False
    return china_now() - moment < timedelta(minutes=minutes)


def notify_webhook(rule: dict, value: float | None, message: str) -> tuple[str, str]:
    """按渠道推送（自定义 Webhook / 钉钉 / 企微 / 邮件），失败不抛异常、不影响站内事件."""
    from app import notifications

    channel = str(rule.get("channel") or "webhook")
    if channel == "email":
        target = str(rule.get("email_to") or "").strip()
    else:
        target = str(rule.get("webhook_url") or "").strip()
    if not target:
        return "inapp", ""
    data = {
        "type": "alert",
        "rule": {"id": rule.get("id"), "name": rule.get("name"), "op": rule.get("op"),
                 "threshold": rule.get("threshold"), "change_pct": rule.get("change_pct")},
        "dashboard_id": rule.get("dashboard_id"),
        "item_key": rule.get("item_key"),
        "value": value,
        "message": message,
        "sent_at": china_now().isoformat(timespec="seconds"),
    }
    return notifications.send(
        channel if channel in notifications.CHANNELS else "webhook",
        target,
        f"指标告警 · {rule.get('name') or '未命名'}",
        message,
        data=data,
        timeout=webhook_timeout(),
    )


def evaluate_rule(db: Session, rule: dict) -> dict:
    """评估单条规则：命中且不在冷却期 → 写事件（+ webhook）."""
    result = check(db, rule)
    value = result.get("value")
    if value is None:
        return result
    if not result.get("triggered"):
        repo.touch_state(db, rule["id"], value, triggered=False)
        return result
    if _in_cooldown(rule):
        repo.touch_state(db, rule["id"], value, triggered=False)
        result["triggered"] = False
        result["skipped"] = "cooldown"
        return result

    board = dash_repo.get(db, rule["dashboard_id"])
    board_name = board.name if board else f"看板 {rule['dashboard_id']}"
    message = f"{rule.get('name') or '指标告警'} · {board_name}：{result.get('reason')}"
    event = repo.insert_event(db, {
        "rule_id": rule["id"],
        "dashboard_id": rule["dashboard_id"],
        "item_key": rule["item_key"],
        "rule_name": rule.get("name") or "",
        "value": value,
        "threshold": result.get("threshold"),
        "message": message,
        "notified": "inapp",
    })
    repo.touch_state(db, rule["id"], value, triggered=True)
    result["event_id"] = event["id"]
    result["message"] = message

    channel = str(rule.get("channel") or "inapp")
    target = rule.get("email_to") if channel == "email" else rule.get("webhook_url")
    if channel != "inapp" and target:
        notified, error = notify_webhook(rule, value, message)
        repo.set_event_notified(db, event["id"], notified, error)
        result["notified"] = notified
    return result


def run_once() -> dict:
    """评估所有启用的规则（调用方负责加锁）."""
    db = SessionLocal()
    results: list[dict] = []
    try:
        rules = repo.list_enabled_rules(db)
        for rule in rules:
            try:
                results.append(evaluate_rule(db, rule))
            except Exception as exc:
                db.rollback()
                results.append({"rule_id": rule.get("id"), "triggered": False,
                                "error": str(exc)[:200]})
    finally:
        db.close()
    return {
        "checked": len(results),
        "triggered": sum(1 for r in results if r.get("triggered")),
        "results": results,
    }


def run_once_locked() -> dict:
    """带 PG advisory lock 的评估 —— 多 worker 同时只会有一个真正执行."""
    with engine.connect() as conn:
        got = conn.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": LOCK_KEY}).scalar()
        if not got:
            return {"skipped": "locked", "checked": 0, "triggered": 0, "results": []}
        try:
            return run_once()
        finally:
            try:
                conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": LOCK_KEY})
                conn.commit()
            except Exception:
                pass


def loop_forever() -> None:
    """后台线程入口：BI_ALERT_INTERVAL_SECONDS=0 时不启动."""
    while True:
        interval = interval_seconds()
        if interval <= 0:
            return
        try:
            run_once_locked()
        except Exception as exc:  # 评估失败不能拖垮进程
            print(f"[alerts] 评估失败：{str(exc)[:200]}")
        time.sleep(interval)


def start_background() -> threading.Thread | None:
    interval = interval_seconds()
    if interval <= 0:
        print("[alerts] 告警评估已关闭（BI_ALERT_INTERVAL_SECONDS=0）")
        return None
    thread = threading.Thread(target=loop_forever, name="alert-evaluator", daemon=True)
    thread.start()
    print(f"[alerts] 告警评估已启动：每 {interval}s 一次")
    return thread


__all__ = ["OPS", "current_value", "check", "evaluate_rule", "notify_webhook",
           "run_once", "run_once_locked", "loop_forever", "start_background",
           "interval_seconds", "webhook_timeout"]
