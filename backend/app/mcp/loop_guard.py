"""Agent 死循环防护（R6）—— 会话步数 / 重复调用 / 无进展中断.

MCP 网关每收到一次 `tools/call` 就过一遍这里：
    * 单会话工具调用上限（默认 60）→ 超限中断，防空跑刷配额；
    * 同工具同参数短时间重复（默认 120 秒内 5 次）→ 中断，防 LLM 原地打转；
    * 连续无进展（相邻结果完全一致，默认 6 次）→ 中断；
    * 带 `task_id` 的批量任务不参与重复/无进展判定（用户已明确确认），但仍计入会话步数。

会话键：客户端自带 `Mcp-Session-Id` 头优先；没有就用「客户端 + 用户 + 令牌 jti」，
保证同一令牌下的连续调用算同一会话。状态只存进程内存（10 分钟无调用自动回收），
与现有内存限流同口径；多 worker 下各算各的，够挡住单实例内的死循环。

旋钮：
    BI_MCP_LOOP_GUARD=0          关闭
    BI_MCP_SESSION_MAX_CALLS=60  单会话调用上限
    BI_MCP_REPEAT_LIMIT=5        同一指纹重复次数
    BI_MCP_REPEAT_WINDOW=120     重复统计窗口（秒）
    BI_MCP_NO_PROGRESS_LIMIT=6   连续相同结果次数
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from typing import Any

_LOCK = threading.Lock()
_SESSIONS: dict[str, dict] = {}
_IDLE_SECONDS = 600.0


class LoopGuardError(Exception):
    """命中死循环防护（网关转成 JSON-RPC 错误）."""

    def __init__(self, message: str, reason: str) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


def enabled() -> bool:
    return (os.getenv("BI_MCP_LOOP_GUARD", "1") or "1").strip() != "0"


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default)) or default))
    except ValueError:
        return default


def session_key(client_id: int, user_id: int, jti: str, header: str = "") -> str:
    given = (header or "").strip()[:80]
    if given:
        return f"h:{given}"
    return f"t:{client_id}:{user_id}:{(jti or '')[:12]}"


def _state(key: str) -> dict:
    now = time.monotonic()
    # 顺手回收闲置会话，避免内存无限增长
    if len(_SESSIONS) > 2000:
        for old in [k for k, v in _SESSIONS.items() if now - v.get("seen", 0) > _IDLE_SECONDS]:
            _SESSIONS.pop(old, None)
    state = _SESSIONS.get(key)
    if state is None:
        state = {"calls": 0, "calls_ts": [], "repeats": {},
                 "last_hash": "", "same_count": 0, "seen": now}
        _SESSIONS[key] = state
    state["seen"] = now
    return state


def fingerprint(tool: str, args: dict | None) -> str:
    raw = tool + "|" + json.dumps(args or {}, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def before_call(key: str, tool: str, args: dict | None) -> None:
    """调用前检查；命中则抛 LoopGuardError."""
    if not enabled():
        return
    now = time.monotonic()
    with _LOCK:
        state = _state(key)
        state["calls"] += 1
        state["calls_ts"].append(now)

        max_calls = _env_int("BI_MCP_SESSION_MAX_CALLS", 60)
        if state["calls"] > max_calls:
            raise LoopGuardError(
                f"本会话工具调用已达上限（{max_calls} 次），已中断，请新建会话或确认任务范围",
                "max_calls",
            )

        # 用户确认过的批量任务：只计入步数，不做重复 / 无进展判定
        if (args or {}).get("task_id"):
            return

        window = _env_int("BI_MCP_REPEAT_WINDOW", 120)
        limit = _env_int("BI_MCP_REPEAT_LIMIT", 5)
        fp = fingerprint(tool, args)
        hits = [ts for ts in state["repeats"].get(fp, []) if now - ts <= window]
        hits.append(now)
        state["repeats"][fp] = hits
        if len(hits) >= limit:
            raise LoopGuardError(
                f"同一工具与参数在 {window} 秒内重复 {len(hits)} 次，疑似死循环，已中断",
                "repeat",
            )

        no_progress = _env_int("BI_MCP_NO_PROGRESS_LIMIT", 6)
        if state["same_count"] >= no_progress:
            raise LoopGuardError(
                f"连续 {state['same_count']} 次结果没有变化，已中断，请调整问题或检查数据",
                "no_progress",
            )


def after_call(key: str, result: Any) -> None:
    """调用成功后记录结果指纹，用于识别「连续无进展」."""
    if not enabled():
        return
    try:
        digest = hashlib.sha256(
            json.dumps(result, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
        ).hexdigest()[:16]
    except Exception:
        return
    with _LOCK:
        state = _state(key)
        if digest == state["last_hash"]:
            state["same_count"] += 1
        else:
            state["last_hash"] = digest
            state["same_count"] = 0


def reset(key: str = "") -> None:
    """清空会话状态（回归脚本 / 排障用）."""
    with _LOCK:
        if key:
            _SESSIONS.pop(key, None)
        else:
            _SESSIONS.clear()


__all__ = ["LoopGuardError", "enabled", "session_key", "before_call", "after_call",
           "fingerprint", "reset"]
