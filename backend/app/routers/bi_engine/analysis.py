"""BI 引擎 · 分析函数库（/analyze、/functions）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Body
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.query.table_catalog import BUILTIN_TABLES, is_queryable

from fastapi import APIRouter

router = APIRouter()

from .common import _validate_col

def _parse_function(func_type: str, metric_col: str, time_col: str) -> str:
    """将分析函数类型翻译为 PostgreSQL SQL 表达式"""
    _validate_col(metric_col)
    _validate_col(time_col)

    if func_type == "yoy":
        # 同比：当前值 / 去年同期 - 1
        return f"""
            CASE WHEN LAG("{metric_col}", 12) OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}", 12) OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_yoy_pct"
        """
    elif func_type == "mom":
        # 环比：当前值 / 上期 - 1
        return f"""
            CASE WHEN LAG("{metric_col}") OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}") OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_mom_pct"
        """
    elif func_type == "cumulative":
        return f'SUM("{metric_col}") OVER (ORDER BY "{time_col}" ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS "{metric_col}_cumsum"'
    elif func_type == "moving_avg":
        return f'ROUND(AVG("{metric_col}") OVER (ORDER BY "{time_col}" ROWS BETWEEN 2 PRECEDING AND 2 FOLLOWING), 2) AS "{metric_col}_ma5"'
    elif func_type == "rank":
        return f'RANK() OVER (ORDER BY "{metric_col}" DESC) AS "{metric_col}_rank"'
    elif func_type == "pct_change":
        return f"""
            CASE WHEN LAG("{metric_col}") OVER (ORDER BY "{time_col}") > 0
            THEN ROUND(("{metric_col}" * 1.0 / NULLIF(LAG("{metric_col}") OVER (ORDER BY "{time_col}"), 0) - 1) * 100, 1)
            ELSE NULL END AS "{metric_col}_pct"
        """
    elif func_type == "share":
        return f'ROUND("{metric_col}" * 100.0 / NULLIF(SUM("{metric_col}") OVER (), 0), 1) AS "{metric_col}_share_pct"'
    else:
        raise HTTPException(400, f"未知分析函数: {func_type}，支持: yoy/mom/cumulative/moving_avg/rank/pct_change/share")


FUNC_META = {
    "yoy":        {"label": "同比 YoY", "desc": "与去年同期比较的变化率（需12期数据）"},
    "mom":        {"label": "环比 MoM", "desc": "与上一期比较的变化率"},
    "cumulative": {"label": "累计值", "desc": "截至当前的累计总和"},
    "moving_avg": {"label": "移动平均", "desc": "前后2期的5期移动平均"},
    "rank":       {"label": "排名", "desc": "按指标降序排名"},
    "pct_change": {"label": "变化率", "desc": "每期相对于上一期的变化百分比"},
    "share":      {"label": "占比", "desc": "当前值占总体的百分比"},
}


@router.post("/analyze")
def compute_analysis(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """对 BI 表执行分析函数计算。
    参数: {table, time_col, metric_col, func: "yoy"|"mom"|"cumulative"|"moving_avg"|"rank"|"pct_change"|"share"}
    """
    table = payload.get("table", "")
    time_col = payload.get("time_col", "")
    metric_col = payload.get("metric_col", "")
    func_type = payload.get("func", "")

    if not is_queryable(table):
        raise HTTPException(404, f"表 {table} 不是可访问的业务表")
    if not func_type or func_type not in FUNC_META:
        raise HTTPException(400, f"无效函数类型，支持: {list(FUNC_META)}")

    sql_expr = _parse_function(func_type, metric_col, time_col)

    try:
        rows = db.execute(text(f"""
            SELECT "{time_col}", "{metric_col}", {sql_expr}
            FROM {table}
            ORDER BY "{time_col}"
        """)).fetchall()

        columns = [c for c in rows[0]._mapping.keys()] if rows else []
        return {
            "table": table,
            "func": func_type,
            "func_label": FUNC_META[func_type]["label"],
            "metric_col": metric_col,
            "time_col": time_col,
            "columns": columns,
            "rows": [dict(r._mapping) for r in rows],
            "count": len(rows),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"分析计算错误: {str(e)}")


@router.get("/functions")
def list_analysis_functions():
    """返回所有可用分析函数列表"""
    return {"functions": [{"key": k, **v} for k, v in FUNC_META.items()]}
