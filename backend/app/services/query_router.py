# services/query_router.py — BI 查询智能路由
"""根据数据量级自动选择 PG 或 Doris 执行查询"""

import os
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

class Engine(Enum):
    PG = "postgresql"
    DORIS = "doris"
    DORIS_PRE = "doris_mv"  # 预聚合物化视图

@dataclass
class RouteResult:
    engine: Engine
    sql: str  # 可能被改写为 Doris 语法
    reason: str

class QueryRouter:
    """智能路由决策树"""

    # 阈值
    PG_THRESHOLD = 100_000      # < 10万行 → PG
    DORIS_THRESHOLD = 10_000_000 # 10万-1000万 → Doris

    # 表名→行数估算（可后续接入统计信息）
    _row_estimates = {
        "bi_pdd_profit": 500_000,
        "bi_ai_generated_data": 200_000,
        "bi_dashboard_panels": 10_000,
        "audit_logs": 5_000_000,
    }

    def __init__(self, doris_engine: Optional[Engine] = None):
        self.doris = doris_engine
        self._build_pg_engine()

    def _build_pg_engine(self):
        db_url = os.getenv("DATABASE_URL", "postgresql://mingzebi:mingzebi@127.0.0.1:5432/mingzebi")
        self.pg = create_engine(db_url, pool_size=5, pool_pre_ping=True)

    def estimate_rows(self, table: str) -> int:
        """估算表行数"""
        if table in self._row_estimates:
            return self._row_estimates[table]
        # 默认1万行（保守估计走PG）
        return 10_000

    def route(self, sql: str, table: str = "") -> RouteResult:
        """路由决策"""
        parsed_table = table or self._extract_table(sql)
        row_estimate = self.estimate_rows(parsed_table)

        if row_estimate < self.PG_THRESHOLD:
            return RouteResult(Engine.PG, sql, f"行数({row_estimate}) < 10万，走PG")

        if row_estimate < self.DORIS_THRESHOLD:
            if not self.doris:
                # Doris不可用，降级PG
                return RouteResult(Engine.PG, sql, "Doris不可用，降级PG")
            # 改写SQL为Doris兼容语法
            doris_sql = self._to_doris_sql(sql)
            return RouteResult(Engine.DORIS, doris_sql, f"行数({row_estimate}) 10万-1000万，走Doris")

        # > 1000万行
        if not self.doris:
            return RouteResult(Engine.PG, sql, "Doris不可用，降级PG")
        doris_sql = self._to_doris_sql(sql)
        return RouteResult(Engine.DORIS_PRE, doris_sql, f"行数({row_estimate}) > 1000万，走Doris物化视图")

    def execute(self, sql: str, params: dict = None, table: str = "") -> list:
        """执行路由后的查询"""
        result = self.route(sql, table)
        engine = self.doris if result.engine in (Engine.DORIS, Engine.DORIS_PRE) else self.pg
        with engine.connect() as conn:
            rows = conn.execute(text(result.sql), params or {}).fetchall()
            return [dict(row._mapping) for row in rows]

    def _extract_table(self, sql: str) -> str:
        """从SQL中提取主表名"""
        match = re.search(r'FROM\s+(\w+)', sql, re.IGNORECASE)
        return match.group(1) if match else ""

    def _to_doris_sql(self, pg_sql: str) -> str:
        """PG SQL → Doris SQL 语法转换"""
        # Doris 兼容大部分 PG 语法，主要处理差异：
        s = pg_sql
        s = s.replace("ILIKE", "LIKE")  # Doris 不支持 ILIKE
        s = s.replace("::jsonb", "")     # Doris 类型转换语法不同
        s = s.replace("NOW()", "CURRENT_TIMESTAMP()")
        return s


# 全局单例
_router: Optional[QueryRouter] = None

def get_router() -> QueryRouter:
    global _router
    if _router is None:
        _router = QueryRouter()
    return _router
