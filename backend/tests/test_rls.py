"""行级权限（RLS）的回归用例.

覆盖：
    1. 规则编译：合法条件通过，子查询 / 分号 / 危险函数 / 无列号 拒绝
    2. SQL 注入：单层 SELECT 下推到 WHERE；聚合时过滤在 GROUP BY 之前；UNION 外包
    3. 缓存指纹：同规则同指纹，不同规则不同指纹，空规则固定 "-"
    4. 规则读取：按 user_id / role_name 命中，系统上下文不套规则
"""

from __future__ import annotations

import pytest

from app.security.errors import RuleCompileError
from app.security.rls import compile_rule_text
from app.security.rls.compiler import compile_condition
from app.security.rls.fingerprint import fingerprint
from app.security.rls.injector import inject_conditions, where_fragment
from app.security.rls.repository import load_rules


# ── 规则编译 ────────────────────────────────────────────────
@pytest.mark.parametrize(
    "rule",
    [
        "store_id = 3",
        "region IN ('华东', '华南')",
        "amount > 100 AND status = 'paid'",
        "created_at >= '2026-01-01'",
    ],
)
def test_compile_ok(rule: str) -> None:
    assert compile_condition(rule) is not None
    assert compile_rule_text(rule)


@pytest.mark.parametrize(
    "rule",
    [
        "1 = 1; DROP TABLE users",
        "(SELECT 1) = 1",
        "store_id = (SELECT id FROM users)",
        "pg_read_file('/etc/passwd') = 'a'",
        "",
        "TRUE",
    ],
)
def test_compile_rejects(rule: str) -> None:
    with pytest.raises(RuleCompileError):
        compile_condition(rule)


# ── 注入 ────────────────────────────────────────────────────
def test_inject_into_simple_select() -> None:
    sql = inject_conditions("SELECT * FROM bi_finance", ["store_id = 3"])
    assert "WHERE store_id = 3" in sql


def test_inject_before_group_by() -> None:
    sql = inject_conditions(
        "SELECT store_id, SUM(amount) AS s FROM bi_finance GROUP BY store_id",
        ["store_id = 3"],
    )
    assert sql.index("WHERE store_id = 3") < sql.index("GROUP BY")


def test_inject_into_union_wraps() -> None:
    sql = inject_conditions(
        "SELECT a FROM bi_finance UNION SELECT a FROM bi_finance",
        ["store_id = 3"],
    )
    assert "_rls_src" in sql
    assert "WHERE store_id = 3" in sql


def test_no_rule_keeps_sql_untouched() -> None:
    sql = "SELECT * FROM bi_finance"
    assert inject_conditions(sql, []) == sql


def test_where_fragment() -> None:
    assert where_fragment([]) == ""
    assert where_fragment(["a = 1", "b = 2"]) == "(a = 1) AND (b = 2)"


# ── 指纹 ────────────────────────────────────────────────────
def test_fingerprint_stable() -> None:
    assert fingerprint(["a = 1"]) == fingerprint(["a = 1"])
    assert fingerprint(["a = 1", "b = 2"]) == fingerprint(["b = 2", "a = 1"])
    assert fingerprint(["a = 1"]) != fingerprint(["a = 2"])
    assert fingerprint([]) == "-"


# ── 规则读取 ────────────────────────────────────────────────
class _Row(tuple):
    """模拟 SQLAlchemy Row（按索引取值即可）."""


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def fetchall(self):
        return self._rows


class _FakeDB:
    def __init__(self, rows):
        self._rows = rows
        self.last_params = None

    def execute(self, _stmt, params=None):
        self.last_params = params
        return _FakeResult(self._rows)


class _User:
    def __init__(self, uid=1, role="user"):
        self.id = uid
        self.role = role


def test_load_rules_matches_user_and_role() -> None:
    db = _FakeDB([("bi_finance", 1, None, "store_id = 3"), ("bi_finance", None, "user", "region = '华东'")])
    rules = load_rules(db, "bi_finance", _User())
    assert [r.filter_rule for r in rules] == ["store_id = 3", "region = '华东'"]
    assert db.last_params == {"t": "bi_finance", "uid": 1, "role": "user"}


def test_load_rules_skips_system_context() -> None:
    db = _FakeDB([("bi_finance", 1, None, "store_id = 3")])
    assert load_rules(db, "bi_finance", None) == []


def test_load_rules_ignores_blank_text() -> None:
    db = _FakeDB([("bi_finance", 1, None, "   ")])
    assert load_rules(db, "bi_finance", _User()) == []
