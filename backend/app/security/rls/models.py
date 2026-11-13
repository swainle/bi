"""行级权限规则的统一数据结构."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class RowRule:
    """一条行级过滤规则（来自 bi_row_permissions）."""

    table_name: str
    filter_rule: str
    user_id: Optional[int] = None
    role_name: Optional[str] = None

    @property
    def scope(self) -> str:
        if self.user_id is not None:
            return f"user:{self.user_id}"
        if self.role_name:
            return f"role:{self.role_name}"
        return "global"


@dataclass(frozen=True)
class RlsDecision:
    """一次查询的行级权限结论 —— 供路由使用."""

    conditions: tuple[str, ...]        # 已编译校验过的条件片段
    fingerprint: str                   # 缓存键用
    blocked: bool = False              # True 表示无权限，应直接 403
    reason: str = ""

    @property
    def active(self) -> bool:
        return bool(self.conditions)


__all__ = ["RowRule", "RlsDecision"]
