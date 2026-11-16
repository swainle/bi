"""Prompt 注入防护（R5）—— AI 输入 / MCP 参数 / 工具返回三层检测.

分级：
    * attack：明确的越权 / 套密钥 / 全量导出 / 覆盖系统规则 → 拒绝（AI 返回 400，MCP 返回 400）；
    * suspicious：角色扮演 / 开发者模式 / 越狱等苗头 → 只告警，不打断业务；
    * clean：放行。

所有命中写 `bi_security_event`（可用安全卫士的封禁列表一起看），
正常业务提问不受影响；开关 `BI_PROMPT_GUARD_ENABLED=0` 可整体关闭（排障用）。
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

# 明确攻击：命中即拒绝
_ATTACK_RULES: tuple[tuple[str, re.Pattern], ...] = (
    ("override_rules", re.compile(
        r"(忽略|无视|忘记|抛弃|覆盖).{0,12}(以上|之前|前面|所有|全部|系统).{0,8}"
        r"(指令|规则|提示|要求|约束)", re.I)),
    ("override_rules", re.compile(
        r"(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above|system)\s+"
        r"(instructions?|prompts?|rules?)", re.I)),
    ("system_prompt", re.compile(
        r"(system|developer)\s*prompt|系统提示词|系统指令|隐藏指令", re.I)),
    ("bypass_permission", re.compile(
        r"(绕过|跳过|解除|关闭|禁用).{0,10}(权限|鉴权|认证|校验|限制|安全|风控|脱敏|审计)", re.I)),
    ("bulk_export", re.compile(
        r"(导出|下载|返回|给我|列出).{0,12}(全部|所有|全量|整库).{0,10}"
        r"(数据|明细|用户|订单|客户|表|库)", re.I)),
    ("secret_probe", re.compile(
        r"(密码|口令|密钥|私钥|token|secret|api[\s_-]?key).{0,12}"
        r"(是什么|告诉我|给我|显示|打印|发我|输出)", re.I)),
    ("impersonate_admin", re.compile(
        r"(以|用|按).{0,8}(管理员|超级管理员|root|sa|超级用户).{0,8}(身份|权限|账号)|"
        r"act\s+as\s+(an?\s+)?(admin|root|superuser)", re.I)),
    ("jailbreak", re.compile(
        r"(now\s+you\s+are|from\s+now\s+on).{0,20}(unrestricted|no\s+rules|admin)|DAN\s+mode|"
        r"越狱模式|开发者模式.{0,8}(开启|启用)", re.I)),
)

# 疑似：只告警
_SUSPICIOUS_RULES: tuple[tuple[str, re.Pattern], ...] = (
    ("roleplay", re.compile(r"(假装|扮演|roleplay|pretend\s+to\s+be).{0,20}(管理员|root|系统|admin)", re.I)),
    ("sql_probe", re.compile(r"(union\s+select|information_schema|pg_catalog|drop\s+table|;--)", re.I)),
    ("prompt_leak", re.compile(r"(重复|输出|告诉我).{0,8}(上面的|之前的|你的).{0,6}(提示|指令|规则)", re.I)),
    ("encoding", re.compile(r"(base64|rot13|十六进制).{0,10}(解码|执行|运行)", re.I)),
)

REDACTED = "[疑似注入内容已移除]"


def enabled() -> bool:
    return (os.getenv("BI_PROMPT_GUARD_ENABLED", "1") or "1").strip() != "0"


def inspect(text: str) -> dict:
    """检测文本，返回 {level, categories, matches}（不写事件、不改文本）."""
    value = str(text or "")
    if not enabled() or not value:
        return {"level": "clean", "categories": [], "matches": 0}

    attacks: list[str] = []
    for name, pattern in _ATTACK_RULES:
        if pattern.search(value):
            attacks.append(name)
    if attacks:
        return {"level": "attack", "categories": sorted(set(attacks)), "matches": len(attacks)}

    suspected: list[str] = []
    for name, pattern in _SUSPICIOUS_RULES:
        if pattern.search(value):
            suspected.append(name)
    if suspected:
        return {"level": "suspicious", "categories": sorted(set(suspected)),
                "matches": len(suspected)}
    return {"level": "clean", "categories": [], "matches": 0}


def _record(verdict: dict, *, source: str, user_id: int | None = None,
            path: str = "", status_code: int = 400, extra: dict | None = None) -> None:
    try:
        from app.middleware.audit_context import get_request_meta
        from app.security import security_events

        meta = get_request_meta()
        security_events.record(
            f"prompt_injection_{'blocked' if verdict['level'] == 'attack' else 'suspected'}",
            ip=meta.get("ip", ""),
            user_agent=meta.get("user_agent", ""),
            fp=meta.get("fingerprint", ""),
            method="",
            path=path or source,
            status_code=status_code,
            user_id=user_id,
            request_id="",
            detail={"source": source, "categories": verdict.get("categories"),
                    **(extra or {})},
        )
    except Exception:
        pass


def check_prompt(prompt: str, *, source: str = "ai", user_id: int | None = None,
                 path: str = "") -> dict:
    """检测 LLM 提示词：attack 抛 400；suspicious 记事件后放行."""
    verdict = inspect(prompt)
    if verdict["level"] == "clean":
        return verdict
    _record(verdict, source=source, user_id=user_id, path=path)
    if verdict["level"] == "attack":
        from fastapi import HTTPException

        raise HTTPException(
            400,
            f"输入命中安全规则（{', '.join(verdict['categories'])}），已拒绝执行并记录安全事件",
        )
    return verdict


def check_tool_args(args: dict, *, tool: str, user_id: int | None = None,
                    path: str = "mcp") -> dict:
    """检测 MCP 工具参数：attack 返回 verdict 供网关拒绝，suspicious 只记录."""
    payload = json.dumps(args or {}, ensure_ascii=False, default=str)
    verdict = inspect(payload)
    if verdict["level"] != "clean":
        _record(verdict, source=f"mcp:{tool}", user_id=user_id, path=path,
                extra={"tool": tool})
    return verdict


def sanitize_tool_output(value: Any) -> tuple[Any, int]:
    """清除工具返回里夹带的指令（防数据回流诱导模型），返回 (清理后对象, 清理条数)."""
    removed = 0

    def clean(text: str) -> tuple[str, int]:
        nonlocal removed
        out = text
        for _, pattern in _ATTACK_RULES + _SUSPICIOUS_RULES:
            out, count = pattern.subn(REDACTED, out)
            removed += count
        return out, count

    def walk(node: Any) -> Any:
        if isinstance(node, str):
            return clean(node)[0]
        if isinstance(node, list):
            return [walk(item) for item in node]
        if isinstance(node, tuple):
            return tuple(walk(item) for item in node)
        if isinstance(node, dict):
            return {key: walk(item) for key, item in node.items()}
        return node

    return walk(value), removed


__all__ = ["enabled", "inspect", "check_prompt", "check_tool_args", "sanitize_tool_output"]
