"""安全内核的统一异常族（SQL 校验 + 行级权限共用）.

设计原则：
    所有拒绝都必须抛同一族异常，调用方只需捕获 `SecurityError`，
    因此新增规则不会影响上层（路由 / 中间件）的错误处理逻辑。
"""

from __future__ import annotations


class SecurityError(Exception):
    """安全校验失败的基类."""

    code = "security_rejected"
    http_status = 400

    def __init__(self, message: str, *, detail: str = "") -> None:
        super().__init__(message)
        self.message = message
        self.detail = detail

    def to_dict(self) -> dict:
        payload = {"error": self.code, "message": self.message}
        if self.detail:
            payload["detail"] = self.detail
        return payload


# ── SQL 只读校验 ──────────────────────────────────────────────
class SqlSyntaxError(SecurityError):
    """SQL 无法解析."""

    code = "sql_syntax_error"


class NotReadOnlyError(SecurityError):
    """包含写操作 / DDL / 多语句."""

    code = "sql_not_readonly"


class TableNotAllowedError(SecurityError):
    """引用了系统内部表或非法表名。"""

    code = "sql_table_not_allowed"

    def __init__(self, tables: list[str], *, detail: str = "") -> None:
        super().__init__(f"不是可访问的业务表：{', '.join(sorted(tables))}", detail=detail)
        self.tables = tables


class UnsafeFunctionError(SecurityError):
    """调用了危险函数（读文件 / 睡眠 / 外部连接等）."""

    code = "sql_unsafe_function"


# ── 行级权限 ──────────────────────────────────────────────────
class RuleCompileError(SecurityError):
    """行级权限规则无法编译（管理员填写错误）."""

    code = "rls_rule_invalid"


class RlsBlockedError(SecurityError):
    """行级权限运行期失败 —— fail-closed：宁可 403，也不放数据."""

    code = "rls_blocked"
    http_status = 403


__all__ = [
    "SecurityError",
    "SqlSyntaxError",
    "NotReadOnlyError",
    "TableNotAllowedError",
    "UnsafeFunctionError",
    "RuleCompileError",
    "RlsBlockedError",
]
