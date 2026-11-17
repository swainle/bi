"""AI 成本配额（R14）—— 每用户每日调用次数 / token 预算.

    BI_AI_DAILY_CALLS=300         每日调用次数（0 = 不限）
    BI_AI_DAILY_TOKENS=1000000    每日 token 预算（0 = 不限）

每次 `_call_llm` 前先占一次调用额度，超限抛 429（写审计 + 告警事件）；
调用成功后按「字符数 / 4」估算 token（供应商不统一返回 usage，估算足够做预算）。
"""

from __future__ import annotations

import os

from sqlalchemy import text


def _limit(name: str, default: int) -> int:
    try:
        return max(0, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def daily_calls_limit() -> int:
    return _limit("BI_AI_DAILY_CALLS", 300)


def daily_tokens_limit() -> int:
    return _limit("BI_AI_DAILY_TOKENS", 1_000_000)


def _db():
    from app.database import SessionLocal

    return SessionLocal()


def reserve(user_id: int | None) -> None:
    """占用一次调用额度；超限抛 HTTPException(429)."""
    if not user_id:
        return
    limit = daily_calls_limit()
    token_limit = daily_tokens_limit()
    if limit == 0 and token_limit == 0:
        return
    db = _db()
    try:
        row = db.execute(
            text("""
                INSERT INTO bi_ai_usage (user_id, day, calls, tokens, updated_at)
                VALUES (:u, CURRENT_DATE, 1, 0, now())
                ON CONFLICT (user_id, day) DO UPDATE
                  SET calls = bi_ai_usage.calls + 1, updated_at = now()
                RETURNING calls, tokens
            """),
            {"u": int(user_id)},
        ).fetchone()
        db.commit()
    except Exception:
        db.rollback()
        return
    finally:
        db.close()
    calls, tokens = int(row[0] or 0), int(row[1] or 0)
    over_calls = limit and calls > limit
    over_tokens = token_limit and tokens >= token_limit
    if over_calls or over_tokens:
        _record_blocked(user_id, calls, tokens, limit, token_limit)
        from fastapi import HTTPException

        raise HTTPException(
            429,
            f"今日 AI 用量已达上限（调用 {calls}/{limit or '不限'}，"
            f"token {tokens}/{token_limit or '不限'}），请明天再试或联系管理员",
        )


def add_tokens(user_id: int | None, tokens: int) -> None:
    if not user_id or tokens <= 0:
        return
    db = _db()
    try:
        db.execute(
            text("""
                INSERT INTO bi_ai_usage (user_id, day, calls, tokens, updated_at)
                VALUES (:u, CURRENT_DATE, 0, :t, now())
                ON CONFLICT (user_id, day) DO UPDATE
                  SET tokens = bi_ai_usage.tokens + :t, updated_at = now()
            """),
            {"u": int(user_id), "t": int(tokens)},
        )
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _record_blocked(user_id: int, calls: int, tokens: int, call_limit: int,
                    token_limit: int) -> None:
    try:
        from app.middleware.audit import log_audit
        from app.security import security_events

        detail = {"calls": calls, "call_limit": call_limit, "tokens": tokens,
                  "token_limit": token_limit}
        log_audit(user_id, "ai.quota.blocked", "ai_model", 0, detail)
        security_events.record("ai_quota_exceeded", user_id=user_id, detail=detail)
    except Exception:
        pass


__all__ = ["reserve", "add_tokens", "daily_calls_limit", "daily_tokens_limit"]
