"""MCP 配额、熔断（R10）—— 单客户端 / 单用户限速，失败率过高临时停用.

口径：
    * QPS：同一客户端 1 秒内最多 `BI_MCP_QPS` 次（默认 20）；
    * 每日：同一用户每天最多 `BI_MCP_DAILY_CALLS` 次（默认 2000，按 `bi_mcp_audit` 统计）；
    * 熔断：5 分钟内调用 >=20 次且失败率 >50%，该客户端熔断 `BI_MCP_BREAKER_SECONDS`（默认 300s），
      期间直接 429，并写安全事件；到期自动半开（放行下一次，成功即恢复）。
    * 错误码统一：denied(-32003) / permission(-32003) / scope(-32004) / param(-32004) /
      upstream(-32002) / quota(-32029) / loop(-32010)。
"""

from __future__ import annotations

import os
import time
from collections import deque

from sqlalchemy import text


class McpRateLimitError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class McpCircuitOpenError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


_QPS: dict[int, deque] = {}
_BREAKER: dict[int, dict] = {}


def _now() -> float:
    return time.monotonic()


def check_rate(client_id: int, user_id: int, db) -> None:
    limit = _env_int("BI_MCP_QPS", 20)
    window = _QPS.setdefault(int(client_id), deque())
    now = _now()
    while window and now - window[0] > 1.0:
        window.popleft()
    if len(window) >= limit:
        raise McpRateLimitError(f"客户端请求过快（>{limit} 次/秒），请稍后重试")
    window.append(now)

    daily = _env_int("BI_MCP_DAILY_CALLS", 2000)
    try:
        used = int(db.execute(
            text("SELECT count(*) FROM bi_mcp_audit WHERE user_id = :u "
                 "AND created_at > now() - interval '1 day'"), {"u": int(user_id)}
        ).scalar() or 0)
    except Exception:
        used = 0
    if used >= daily:
        raise McpRateLimitError(f"今日 MCP 调用已达上限（{daily} 次）")


def check_breaker(client_id: int) -> None:
    state = _BREAKER.get(int(client_id))
    if not state:
        return
    opened_until = float(state.get("opened_until") or 0)
    if opened_until and _now() < opened_until:
        raise McpCircuitOpenError("客户端失败率过高，已临时熔断，请稍后重试")
    if opened_until and _now() >= opened_until:
        # 半开：清空窗口，让下一次调用验证
        state["opened_until"] = 0
        state["calls"] = deque()
        state["failures"] = 0


def record_result(client_id: int, ok: bool) -> None:
    state = _BREAKER.setdefault(int(client_id), {"calls": deque(), "failures": 0,
                                                 "opened_until": 0})
    now = _now()
    calls = state["calls"]
    calls.append((now, bool(ok)))
    while calls and now - calls[0][0] > 300:
        calls.popleft()
    state["failures"] = sum(1 for _, success in calls if not success)
    total = len(calls)
    if total >= 20 and state["failures"] / total > 0.5:
        state["opened_until"] = now + _env_int("BI_MCP_BREAKER_SECONDS", 300)
        try:
            from app.security import security_events

            security_events.record(
                "mcp_circuit_open",
                detail={"client_id": int(client_id), "calls": total,
                        "failures": state["failures"]},
            )
        except Exception:
            pass


__all__ = ["McpRateLimitError", "McpCircuitOpenError", "check_rate", "check_breaker",
           "record_result"]
