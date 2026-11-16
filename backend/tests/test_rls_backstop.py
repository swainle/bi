"""物理表 RLS 兜底（S6）—— 策略表达式与 fail-closed 行为单测."""

from __future__ import annotations

import pytest

from app.security import dept_scope, rls_backstop
from app.security.errors import RlsBlockedError


def test_department_expression_is_fail_closed():
    expr = rls_backstop.policy_expression("dept_id", "department")
    # 没设置 app.rls_enforced → 条件为 false（默认拒绝）
    assert "app.rls_enforced" in expr and "= '1'" in expr
    assert "app.dept_ids" in expr
    assert "string_to_array" in expr


def test_self_expression_uses_user_id():
    expr = rls_backstop.policy_expression("owner_id", "self")
    assert "app.user_id" in expr
    assert "app.dept_ids" not in expr


def test_expression_rejects_bad_identifier():
    with pytest.raises(ValueError):
        rls_backstop.policy_expression("dept_id; drop table x", "department")


def test_preflight_blocks_when_policy_cannot_be_created(monkeypatch):
    rls_backstop.invalidate()
    monkeypatch.setattr(rls_backstop, "_dataset", lambda db, i: ("qa_table", "extract"))
    monkeypatch.setattr(dept_scope, "get_rule",
                        lambda db, i: {"dataset_id": i, "column_name": "部门", "mode": "department"})
    monkeypatch.setattr(rls_backstop, "policy_status", lambda db, table: False)
    monkeypatch.setattr(rls_backstop, "sync_policy", lambda db, i: False)
    alerts: list[tuple] = []
    monkeypatch.setattr(rls_backstop, "_alert", lambda db, i, kind, msg: alerts.append((i, kind)))

    with pytest.raises(RlsBlockedError):
        rls_backstop.preflight(object(), 42)
    assert alerts == [(42, "policy_missing")]


def test_preflight_skips_without_rule(monkeypatch):
    rls_backstop.invalidate()
    monkeypatch.setattr(dept_scope, "get_rule", lambda db, i: None)
    rls_backstop.preflight(object(), 42)  # 不抛异常


def test_read_role_is_noop_without_env(monkeypatch):
    monkeypatch.delenv("BI_RLS_APP_ROLE", raising=False)
    with rls_backstop.read_role(object()):
        pass


def test_read_role_fails_closed_when_role_unavailable(monkeypatch):
    monkeypatch.setenv("BI_RLS_APP_ROLE", "missing_role")

    class FakeDB:
        def execute(self, *args, **kwargs):
            raise RuntimeError("permission denied to set role")

    with pytest.raises(RlsBlockedError):
        with rls_backstop.read_role(FakeDB()):
            pass
