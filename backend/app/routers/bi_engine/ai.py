"""BI 引擎 · AI 能力（自然语言转 SQL、诊断、生成看板、知识库、管线）。"""

from __future__ import annotations

from app.timezone import china_now, time_text

from fastapi import Depends, HTTPException, Query, Body, File, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional
import json
import re
import io
import pandas as pd
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
import re as _re
import time as _time
from app.query.table_catalog import BUILTIN_TABLES, is_queryable
from app.services.bi_ai_engine import collect_metadata, search_knowledge, run_ai_pipeline, validate_sql
from app.services.bi_ai_phase2 import create_task, get_task, update_task, auto_build_model, analyze_data_quality, compute_layout, kb_list_metrics, kb_upsert_metric, kb_delete_metric, kb_list_templates, kb_upsert_template, chat_iterate
from app.services.bi_ai_phase3 import ai_root_cause_analysis, ai_large_screen_layout, batch_generate_dashboards, ai_generate_alert_rules
from app.services.bi_ai_agent import run_agent_pipeline

from fastapi import APIRouter

router = APIRouter()

from .common import ACCEL_MAP, _AI_SQL, _AI_USE, _call_llm

@router.post("/ai/nl_to_sql", dependencies=_AI_SQL)
def nl_to_sql(payload: dict = Body(...), db: Session = Depends(get_db)):
    """自然语言 → SQL。输入 {question, table}，返回 {sql, explanation, chart_type}。
    基于关键词匹配 + 表结构感知，后续可替换为 LLM 调用。"""
    question = payload.get("question", "").strip()
    table = payload.get("table", "").strip()
    if not question or not table:
        raise HTTPException(400, "question 和 table 不能为空")
    if not is_queryable(table):
        raise HTTPException(404, f"表 {table} 不是可访问的业务表")

    # 获取表结构
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    col_names = [c[0] for c in cols]
    numeric_cols = [c[0] for c in cols if c[1] in ("integer","bigint","numeric","double precision","real")]
    text_cols = [c[0] for c in cols if c[1] in ("text","character varying","date")]

    q = question.lower()
    sql = ""; explanation = ""; chart_type = "bar"

    # 关键词提取
    metric = None
    for kw in ["收入","营收","revenue","gmv","销售额","利润","profit","成本","cost","订单","orders","销量","sales","播放"]:
        if kw in q:
            matching = [c for c in numeric_cols if kw in c.lower() or any(w in c.lower() for w in kw.split(","))]
            if matching: metric = matching[0]; break
    if not metric:
        # 排除 id 列，优先选有意义的数值列
        meaningful = [c for c in numeric_cols if c != "id"]
        metric = meaningful[0] if meaningful else numeric_cols[0] if numeric_cols else col_names[0]

    dim = text_cols[0] if text_cols else col_names[0]
    for kw in ["月","month","日期","date","时间","time","渠道","channel","产品","product","店铺","store"]:
        matching = [c for c in text_cols if kw in c.lower()]
        if matching: dim = matching[0]; break

    agg = "SUM"
    if "平均" in q or "avg" in q: agg = "AVG"
    if "数量" in q or "行数" in q or "多少个" in q: agg = "COUNT"

    order = ""
    if "最高" in q or "最大" in q or "top" in q or "排名" in q:
        order = f" ORDER BY {agg}(\"{metric}\") DESC"
    if "最低" in q or "最小" in q or "bottom" in q:
        order = f" ORDER BY {agg}(\"{metric}\") ASC"

    limit = 500
    m = _re.search(r'(前|top\s*|limit\s*)(\d+)', q, _re.IGNORECASE)
    if m: limit = int(m.group(2))

    sql = f'SELECT "{dim}", {agg}("{metric}") AS "{agg.lower()}_{metric}" FROM {table} GROUP BY "{dim}"{order} LIMIT {limit}'
    explanation = f"按 {dim} 统计 {agg}({metric}){'，降序排列' if order else ''}"

    # 图表类型推荐
    try:
        rows = db.execute(text(sql)).fetchall()
    except Exception:
        rows = []
    if len(rows) <= 5 and agg in ("SUM","COUNT"): chart_type = "pie"
    elif agg == "COUNT": chart_type = "bar"
    elif "趋势" in q or "走势" in q or "变化" in q: chart_type = "line"
    else: chart_type = "bar"

    # 执行查询并返回结果
    if not rows:
        return {"sql": sql, "explanation": explanation, "chart_type": chart_type, "columns": [], "rows": [], "count": 0}
    columns = list(rows[0]._mapping.keys())
    return {"sql": sql, "explanation": explanation, "chart_type": chart_type,
            "columns": columns, "rows": [dict(r._mapping) for r in rows], "count": len(rows)}


@router.get("/ai/diagnose/{table}", dependencies=_AI_USE)
def ai_diagnose(table: str, db: Session = Depends(get_db)):
    """AI 数据诊断：检测空值/异常/重复"""
    if not is_queryable(table): raise HTTPException(404)
    issues = []
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    total = db.execute(text(f"SELECT count(*) FROM {table}")).scalar() or 0

    for col, dtype in cols:
        if dtype in ("integer","bigint","numeric","double precision","real"):
            nulls = db.execute(text(f"SELECT count(*) FROM {table} WHERE \"{col}\" IS NULL")).scalar() or 0
            if nulls > 0: issues.append({"column": col, "issue": f"{nulls}/{total} 空值 ({round(nulls/total*100,1)}%)", "fix_sql": f"UPDATE {table} SET \"{col}\"=0 WHERE \"{col}\" IS NULL", "severity": "high" if nulls/total > 0.1 else "medium"})
            avg = db.execute(text(f"SELECT AVG(\"{col}\") FROM {table}")).scalar()
            if avg:
                anomalies = db.execute(text(f"SELECT count(*) FROM {table} WHERE \"{col}\" > {avg*10} OR \"{col}\" < 0")).scalar() or 0
                if anomalies > 0: issues.append({"column": col, "issue": f"{anomalies} 个异常值 (远大于平均值 {round(avg)} 或为负数)", "fix_sql": f"-- 检查 {col} 的数据源", "severity": "high"})

    # 重复行检测
    col_join = ", ".join(f'"{c[0]}"' for c in cols[:3])
    dups = db.execute(text(f"SELECT count(*) FROM (SELECT 1 FROM {table} GROUP BY {col_join} HAVING count(*) > 1) t")).scalar() or 0
    if dups > 0:
        fix_sql = f"DELETE FROM {table} WHERE ctid NOT IN (SELECT min(ctid) FROM {table} GROUP BY {col_join})"
        issues.append({"column": "all", "issue": f"检测到 {dups} 组重复行", "fix_sql": fix_sql, "severity": "medium"})

    return {"table": table, "total_rows": total, "issues": issues, "health": "good" if len(issues) == 0 else "warning" if len([i for i in issues if i["severity"]=="high"]) == 0 else "critical"}


@router.get("/ai/recommend/{table}", dependencies=_AI_USE)
def ai_recommend(table: str, db: Session = Depends(get_db)):
    """智能推荐：根据表结构推荐维度×指标组合 + 图表类型"""
    if not is_queryable(table): raise HTTPException(404)
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' ORDER BY ordinal_position")).fetchall()
    dims = [c[0] for c in cols if c[1] in ("text","character varying","date")]
    metrics = [c[0] for c in cols if c[1] in ("integer","bigint","numeric","double precision","real")]
    recommendations = []
    for d in dims[:3]:
        for m in metrics[:3]:
            chart = "bar"
            if d.lower().find("month") >= 0 or d.lower().find("date") >= 0: chart = "line"
            recommendations.append({"dimension": d, "metric": m, "aggregation": "SUM", "chart_type": chart,
                "title": f"{d} × {m}"})
    return {"table": table, "recommendations": recommendations[:9], "suggested_title": f"{table} 分析看板"}


@router.post("/ai/optimize_sql", dependencies=_AI_SQL)
def optimize_sql(payload: dict = Body(...), db: Session = Depends(get_db)):
    """SQL 智能优化器：改写低效 SQL + 索引建议"""
    sql = payload.get("sql", "").strip()
    table = payload.get("table", "")
    if not sql: raise HTTPException(400, "SQL 不能为空")

    suggestions = []
    optimized = sql

    # 规则1: SELECT * → 指定列
    if "SELECT *" in sql.upper() and table:
        cols = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public' LIMIT 10")).fetchall()
        col_list = ", ".join(f'"{c[0]}"' for c in cols)
        optimized = optimized.replace("SELECT *", f"SELECT {col_list}")

    # 规则2: LIKE '%xxx%' → 全表扫描，建议加索引
    if "LIKE '%" in sql.upper() or "like '%" in sql.lower():
        suggestions.append("⚠️ LIKE '%xxx%' 无法使用索引，建议改为 LIKE 'xxx%' 或使用全文检索")

    # 规则3: 函数包裹列 → 建议函数索引
    for func in ["LOWER(", "UPPER(", "DATE("]:
        if func in sql.upper():
            suggestions.append(f"💡 检测到 {func}...)，建议创建表达式索引: CREATE INDEX ON {table or 'table'} ({func.lower()}column)")

    # 规则4: 物化视图命中提示
    mv = ACCEL_MAP.get(table, "")
    if mv:
        suggestions.append(f"🚀 检测到物化视图 {mv}，建议使用 precomputed=true 查询或直接查物化视图")

    # 保存优化记录
    db.execute(text("INSERT INTO bi_ai_sql_cache (original_sql, optimized_sql, table_name) VALUES (:o,:n,:t)"),
               {"o": sql, "n": optimized, "t": table})
    db.commit()

    return {"original": sql, "optimized": optimized, "suggestions": suggestions}


@router.post("/ai/auto_model", dependencies=_AI_SQL)
def auto_model(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 自动建模：多表关联自动识别"""
    tables = payload.get("tables", [])
    if not tables: raise HTTPException(400, "至少提供一张表")
    relations = []
    for t in tables[:5]:
        if not is_queryable(t): continue
        # 检测外键模式（列名包含 _id 或与另一表名匹配）
        cols = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{t}' AND table_schema='public'")).fetchall()
        for c in cols:
            cn = c[0]
            if cn.endswith("_id"):
                ref = cn[:-3]
                for t2 in tables:
                    if t2 != t and (ref in t2 or t2.endswith(ref)):
                        relations.append({"from_table": t, "from_col": cn, "to_table": t2, "to_col": "id", "type": "INNER"})
            elif cn == "id":
                for t2 in tables:
                    if t2 != t:
                        cols2 = db.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{t2}' AND table_schema='public'")).fetchall()
                        for c2 in cols2:
                            if c2[0].endswith(f"_{t}"):
                                relations.append({"from_table": t2, "from_col": c2[0], "to_table": t, "to_col": "id", "type": "INNER"})

    return {"tables": tables, "relations": relations, "suggested_joins": [f"{r['from_table']} {r['type']} JOIN {r['to_table']} ON {r['from_table']}.{r['from_col']}={r['to_table']}.{r['to_col']}" for r in relations]}


@router.post("/ai/gen_chart", dependencies=_AI_USE)
def gen_chart(payload: dict = Body(...)):
    """一句话生成 ECharts 复杂图表配置"""
    desc = payload.get("description", "")
    chart_type = payload.get("type", "bar")
    title = payload.get("title", "图表")

    option = {
        "title": {"text": title, "left": "center"},
        "tooltip": {"trigger": "item" if chart_type in ("pie","sunburst","funnel") else "axis"},
        "legend": {"bottom": 0},
    }

    if chart_type == "sunburst":
        option["series"] = [{"type": "sunburst", "radius": ["15%", "80%"], "data": [], "label": {"rotate": "radial"}}]
    elif chart_type == "sankey":
        option["series"] = [{"type": "sankey", "layout": "none", "emphasis": {"focus": "adjacency"}, "data": [], "links": []}]
    elif chart_type == "radar":
        option["radar"] = {"indicator": []}; option["series"] = [{"type": "radar", "data": []}]
    elif chart_type == "wordcloud":
        option["series"] = [{"type": "wordCloud", "shape": "circle", "sizeRange": [14, 60], "data": []}]
    elif chart_type == "funnel":
        option["series"] = [{"type": "funnel", "left": "10%", "right": "10%", "sort": "descending", "data": []}]
    elif chart_type == "heatmap":
        option["xAxis"] = {"type": "category"}; option["yAxis"] = {"type": "category"}
        option["visualMap"] = {"min": 0, "calculable": True, "orient": "horizontal", "left": "center"}
        option["series"] = [{"type": "heatmap", "data": []}]
    else:
        option["xAxis"] = {"type": "category"}; option["yAxis"] = {"type": "value"}
        option["series"] = [{"type": chart_type, "data": [], "smooth": chart_type == "line"}]

    return {"description": desc, "echarts_option": option, "note": "将此 JSON 传给 ECharts setOption() 即可渲染，data 需从 API 填充"}


@router.post("/ai/smart_alert", dependencies=_AI_USE)
def smart_alert(payload: dict = Body(...), db: Session = Depends(get_db)):
    """时序智能预警：移动平均检测环比异常"""
    table = payload.get("table", "")
    metric_col = payload.get("metric_col", "")
    if not is_queryable(table) or not metric_col: raise HTTPException(400)

    rows = db.execute(text(f"SELECT {metric_col} FROM {table} ORDER BY updated_at DESC LIMIT 30")).fetchall()
    if len(rows) < 7: return {"status": "insufficient_data", "message": "至少需要7期数据"}

    vals = [r[0] for r in rows]
    recent = vals[0]
    ma7 = sum(vals[:7]) / 7
    change_pct = round((recent - ma7) / ma7 * 100, 1) if ma7 else 0
    severity = "normal"
    if abs(change_pct) > 30: severity = "critical"
    elif abs(change_pct) > 15: severity = "warning"

    pct = abs(change_pct)
    msg = f"{metric_col} 最新值 {recent}，较7日移动平均 {round(ma7)} {'增长' if change_pct>0 else '下降'} {pct}" + "%"
    return {"table": table, "metric": metric_col, "recent_value": recent, "ma7": round(ma7, 1),
            "change_pct": change_pct, "severity": severity, "message": msg}


@router.post("/ai/knowledge", dependencies=_AI_USE)
def add_knowledge(payload: dict = Body(...), db: Session = Depends(get_db)):
    """添加知识条目到 pgvector 知识库"""
    query = payload.get("query", "")
    sql = payload.get("sql", "")
    db.execute(text("INSERT INTO bi_ai_knowledge (query, sql_template) VALUES (:q,:s)"), {"q": query, "s": sql})
    db.commit()
    return {"added": True}


@router.get("/ai/knowledge", dependencies=_AI_USE)
def search_knowledge(q: str = Query(default=""), db: Session = Depends(get_db)):
    """搜索知识库"""
    if not q: rows = db.execute(text("SELECT query, sql_template, usage_count FROM bi_ai_knowledge ORDER BY usage_count DESC LIMIT 20")).fetchall()
    else:
        rows = db.execute(text("SELECT query, sql_template, usage_count FROM bi_ai_knowledge WHERE query ILIKE :kw OR sql_template ILIKE :kw2 ORDER BY usage_count DESC LIMIT 10"),
                          {"kw": f"%{q}%", "kw2": f"%{q}%"}).fetchall()
    return {"results": [{"query": r[0], "sql": r[1], "usage": r[2]} for r in rows]}


@router.post("/ai/pre_aggregate", dependencies=_AI_USE)
def ai_pre_aggregate(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 预聚合调度：分析慢查询模式，自动创建物化视图"""
    table = payload.get("table", "")
    if table and not is_queryable(table): raise HTTPException(404)
    # 统计最近SQL缓存中的高频查询模式
    where = f"WHERE table_name='{table}'" if table else ""
    patterns = db.execute(text(
        f"SELECT table_name, original_sql FROM bi_ai_sql_cache {where} ORDER BY optimized_at DESC LIMIT 50"
    )).fetchall()
    suggestions = []
    seen = set()
    for t, sql in patterns:
        if not is_queryable(t): continue
        key = f"{t}_monthly"
        if key not in seen:
            seen.add(key)
            mv = f"{t}_auto_mv"
            suggestions.append({
                "table": t, "suggested_mv": mv,
                "sql": f"CREATE MATERIALIZED VIEW {mv} AS SELECT * FROM {t} WHERE updated_at > NOW() - INTERVAL '30 days'",
                "reason": f"基于慢查询分析，建议对 {t} 按月预聚合减少查询时间",
            })
    return {"suggestions": suggestions[:5], "analyzed_queries": len(patterns)}


@router.post("/ai/root_cause", dependencies=_AI_USE)
def ai_root_cause(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 根因下钻：逐层分析异常指标的来源"""
    table = payload.get("table", "")
    metric = payload.get("metric", "")
    dims = payload.get("dimensions", [])
    limit = payload.get("limit", 5)
    if not is_queryable(table): raise HTTPException(404)
    if not metric: raise HTTPException(400, "metric 不能为空")

    drill_results = []
    # Level 1: 按第一维度分组
    if dims:
        d1 = dims[0]
        rows = db.execute(text(
            f'SELECT "{d1}", SUM("{metric}") AS total FROM {table} GROUP BY "{d1}" ORDER BY total DESC LIMIT {limit}'
        )).fetchall()
        drill_results.append({"level": 1, "dimension": d1, "data": [dict(r._mapping) for r in rows]})
        # Level 2: 对最高值钻取第二维度
        if len(dims) > 1 and rows:
            top_val = rows[0][0]
            d2 = dims[1]
            rows2 = db.execute(text(
                f'SELECT "{d1}", "{d2}", SUM("{metric}") AS total FROM {table} WHERE "{d1}" = :tv GROUP BY "{d1}", "{d2}" ORDER BY total DESC LIMIT {limit}'
            ), {"tv": top_val}).fetchall()
            drill_results.append({"level": 2, "dimension": d2, "parent_value": top_val, "data": [dict(r._mapping) for r in rows2]})

    conclusion = "分析完成"
    if drill_results and drill_results[0]["data"]:
        top_item = drill_results[0]["data"][0]
        conclusion = f"{metric} 最高值为 {top_item[drill_results[0]['dimension']]}（{top_item['total']}），占比最大。"

    return {"table": table, "metric": metric, "drill_results": drill_results, "conclusion": conclusion}


@router.post("/ai/generate_screen", dependencies=_AI_USE)
def ai_generate_screen(payload: dict = Body(...)):
    """AI 大屏一键生成：输入场景描述→返回 BigScreen 配置"""
    scene = payload.get("scene", "经营大屏")
    panels = [
        {"id": "p1", "type": "number", "title": "总成交额", "xField": "month", "yField": "gmv"},
        {"id": "p2", "type": "number", "title": "总订单量", "xField": "month", "yField": "orders"},
        {"id": "p3", "type": "number", "title": "平均ROI", "xField": "month", "yField": "roi"},
        {"id": "p4", "type": "number", "title": "推广费用", "xField": "month", "yField": "ad_spend"},
        {"id": "p5", "type": "line", "title": "成交趋势", "xField": "month", "yField": "gmv", "size": "lg"},
        {"id": "p6", "type": "bar", "title": "月度对比", "xField": "month", "yField": "orders", "size": "lg"},
        {"id": "p7", "type": "pie", "title": "费用占比", "xField": "month", "yField": "ad_spend", "size": "md"},
        {"id": "p8", "type": "sunburst", "title": "业务分布", "xField": "month", "yField": "gmv", "size": "md"},
    ]
    color_scheme = "日落橙" if "门店" in scene else ("森林绿" if "产线" in scene else "默认蓝")
    return {
        "scene": scene, "panels": panels, "color_scheme": color_scheme,
        "carousel_interval": 8,
        "title": f"{{scene}} BI大屏",
        "note": "将 panels 传给 BigScreen 组件即可渲染，数据从 /api/bi/engine/data/{table} 拉取",
    }


@router.post("/ai/interpret", dependencies=_AI_USE)
def ai_interpret(payload: dict = Body(...), db: Session = Depends(get_db)):
    """AI 报表解读：输入看板数据→输出经营分析报告"""
    table = payload.get("table", "")
    if not is_queryable(table): raise HTTPException(404)
    cols = db.execute(text(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='{table}' AND table_schema='public'")).fetchall()
    numeric = [c[0] for c in cols if c[0] != "id" and c[1] in ("integer","bigint","numeric","double precision","real")]
    if not numeric: raise HTTPException(400, "无可用数值列")
    insights = []
    for col in numeric[:4]:
        try:
            total = db.execute(text(f"SELECT SUM({col}) FROM {table}")).scalar() or 0
            avg = db.execute(text(f"SELECT AVG({col}) FROM {table}")).scalar() or 0
            max_row = db.execute(text(f"SELECT * FROM {table} ORDER BY {col} DESC LIMIT 1")).fetchone()
            if max_row:
                insights.append({
                    "metric": col, "total": total, "average": round(avg, 2),
                    "peak": f"{dict(max_row._mapping).get(next(c2[0] for c2 in cols if c2[0]!=col), '?')} ({max_row._mapping[col]})",
                })
        except Exception: pass
    summary = f"共分析 {len(insights)} 个指标。"
    if insights:
        top = insights[0]
        summary += f"最高指标为 {top['metric']}，总计 {top['total']}，峰值出现在 {top['peak']}。"

    return {"table": table, "insights": insights, "summary": summary,
            "report": f"## {table} 分析报告\n\n{summary}\n\n| 指标 | 总计 | 均值 | 峰值 |\n|------|------|------|------|\n" +
            "\n".join(f"| {i['metric']} | {i['total']} | {i['average']} | {i['peak']} |" for i in insights)}


@router.post("/ai/security_scan", dependencies=_AI_USE)
def ai_security_scan(db: Session = Depends(get_db)):
    """AI 数据安全扫描：检测异常访问模式"""
    alerts = []
    large_exports = db.execute(text(
        "SELECT table_name, count(*) FROM bi_sync_logs WHERE sync_type='full' AND started_at > NOW() - INTERVAL '1 day' GROUP BY table_name HAVING count(*) > 5"
    )).fetchall()
    for t, c in large_exports:
        alerts.append({"type": "frequent_export", "table": t, "count": c, "severity": "warning",
                       "message": f"过去24小时 {t} 全量导出 {c} 次，超过阈值(5次)"})

    # 检测脱敏表是否有非管理员访问
    masked = db.execute(text("SELECT table_name, column_name FROM bi_column_masks")).fetchall()
    for t, c in masked:
        alerts.append({"type": "sensitive_access", "table": t, "column": c, "severity": "info",
                       "message": f"敏感列 {t}.{c} 已配置脱敏规则"})

    return {"scan_time": china_now().strftime("%Y-%m-%d %H:%M:%S"), "alerts": alerts, "total": len(alerts)}


@router.post("/ai/analyze", dependencies=_AI_USE)
def ai_generic_analyze(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """🤖 通用AI分析 — 发送任意 prompt 给默认 LLM。"""
    prompt = payload.get("prompt", "")
    if not prompt:
        raise HTTPException(400, "prompt 不能为空")
    resp = _call_llm(prompt, system="你是数据分析专家，只返回JSON。", max_tokens=2048)
    return {"response": resp}


def _fallback_generate(df, numeric_cols, text_cols):
    """LLM 失败时的兜底方案：基于列类型自动生成看板。"""
    panels = []
    # KPI card
    if numeric_cols:
        panels.append({"title": f"总{numeric_cols[0]}", "type": "number", "xField": "", "yField": numeric_cols[0], "size": "sm", "reason": "核心指标"})
    # Bar chart
    if text_cols and numeric_cols:
        panels.append({"title": f"{text_cols[0]}分布", "type": "bar", "xField": text_cols[0], "yField": numeric_cols[0], "size": "md", "reason": "分类对比"})
    # Line chart
    if len(numeric_cols) >= 2:
        panels.append({"title": f"{numeric_cols[1]}趋势", "type": "line", "xField": text_cols[0] if text_cols else "", "yField": numeric_cols[1], "size": "md", "reason": "趋势分析"})
    # Pie chart
    if text_cols and len(numeric_cols) >= 2:
        panels.append({"title": f"{text_cols[0]}占比", "type": "pie", "xField": text_cols[0], "yField": numeric_cols[1] if len(numeric_cols) > 1 else numeric_cols[0], "size": "sm", "reason": "占比分布"})
    # Table
    panels.append({"title": "数据明细", "type": "table", "xField": "", "yField": "", "size": "lg", "reason": "原始数据"})
    # Add more if enough columns
    if len(numeric_cols) >= 3:
        panels.insert(2, {"title": f"{numeric_cols[2]}概览", "type": "number", "xField": "", "yField": numeric_cols[2], "size": "sm", "reason": "次要指标"})
    if len(text_cols) >= 2 and len(numeric_cols) >= 3:
        panels.insert(3, {"title": f"{text_cols[1]}-{numeric_cols[2]}", "type": "bar_stack", "xField": text_cols[1], "yField": numeric_cols[2], "size": "md", "reason": "多维分析"})
    return {"dashboard_name": "数据看板", "panels": panels[:8]}


@router.post("/ai-generate", dependencies=_AI_USE)
async def ai_generate_dashboard(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI 生成看板 — 上传数据 → AI 分析 → 自动选图表 → 生成看板布局。

    流程：
      1. 解析上传文件（Excel/CSV）
      2. 提取数据摘要（前20行+统计信息）
      3. 调用 DeepSeek LLM 分析数据结构
      4. AI 推荐图表类型和布局
      5. 创建看板并保存到 bi_dashboards
      6. 返回看板 ID 供前端跳转编辑
    """
    if not file.filename:
        raise HTTPException(400, "需要上传数据文件")

    ext = file.filename.lower().split(".")[-1] if "." in file.filename else ""
    if ext not in ("xlsx", "xls", "xlsm", "csv"):
        raise HTTPException(400, "只支持 .xlsx / .xls / .csv 格式")

    try:
        import io, pandas as pd

        content = await file.read()

        # 解析数据
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content), nrows=1000)
        else:
            df = pd.read_excel(io.BytesIO(content), nrows=1000)

        if df.empty:
            raise HTTPException(400, "文件中没有数据")

        # 清理列名
        df.columns = [str(c).strip() for c in df.columns]

        # 构造数据摘要给 LLM
        cols_info = []
        numeric_cols = []
        text_cols = []
        date_cols = []
        for c in df.columns:
            dtype = str(df[c].dtype)
            sample = str(df[c].dropna().head(3).tolist())
            null_count = int(df[c].isna().sum())
            cols_info.append(f"- {c} ({dtype}): 示例={sample[:60]}, 空值={null_count}")

            if "float" in dtype or "int" in dtype:
                numeric_cols.append(c)
            elif "datetime" in dtype:
                date_cols.append(c)
            else:
                text_cols.append(c)

        rows = len(df)
        summary = "\n".join(cols_info[:20])

        # 构造 LLM prompt
        prompt = f"""你是数据分析专家。分析以下表格数据并生成最佳看板配置。

数据概览：共 {rows} 行, {len(df.columns)} 列。
数值列: {numeric_cols[:10]}
文本列: {text_cols[:10]}
日期列: {date_cols}

列详情：
{summary}

请返回 JSON 格式（只返回 JSON，不要解释）：
{{
  "dashboard_name": "看板名称(15字以内中文)",
  "panels": [
    {{
      "title": "图表标题",
      "type": "bar|line|pie|number|table|bar_stack|line_area|donut|radar|scatter|funnel|heatmap",
      "xField": "X轴列名",
      "yField": "Y轴列名",
      "size": "sm|md|lg",
      "reason": "选择原因(10字)"
    }}
  ]
}}

规则：
- 共生成 4-8 个面板
- 必须有 1 个 KPI 数值卡片 (type="number")
- 数值列优先用于柱状图/折线图
- 文本列优先用于饼图/表格的维度
- 看板名称要具体有业务含义"""

        # 调用 LLM
        resp = _call_llm(prompt, system="只返回JSON，不要解释。", max_tokens=4096)

        # 解析 LLM 响应
        try:
            import re as _re
            m = _re.search(r"\{[\s\S]*\}", resp)
            ai_result = json.loads(m.group()) if m else {}
        except Exception:
            ai_result = {}

        if not ai_result.get("panels"):
            # 兜底：自动生成基本看板
            ai_result = _fallback_generate(df, numeric_cols, text_cols)

        # 创建看板
        dashboard_name = ai_result.get("dashboard_name", "AI 生成看板")
        panels = ai_result.get("panels", [])

        # 构建 panel 配置
        panel_configs = []
        for i, p in enumerate(panels):
            cfg = {
                "id": f"ai-panel-{i}",
                "title": p.get("title", f"图表 {i+1}"),
                "type": p.get("type", "bar"),
                "xField": p.get("xField", text_cols[0] if text_cols else ""),
                "yField": p.get("yField", numeric_cols[0] if numeric_cols else ""),
                "metric": p.get("yField", ""),
            }
            panel_configs.append(cfg)

        # 构造卡片布局
        cards = []
        layout_grid = []
        for i, cfg in enumerate(panel_configs):
            ctype = cfg["type"]
            if ctype == "number":
                w, h = 3, 2
            elif ctype in ("table", "heatmap"):
                w, h = 6, 4
            elif ctype in ("pie", "donut", "radar"):
                w, h = 3, 3
            elif ctype in ("funnel",):
                w, h = 3, 3
            else:
                w, h = 4, 3

            x = (i % 3) * 4
            y = (i // 3) * (h + 1)
            cards.append({
                "card_id": cfg["id"],
                "title": cfg["title"],
                "chart_type": ctype,
                "chart_config": cfg,
                "layout": {"i": cfg["id"], "x": x, "y": y, "w": w, "h": h},
                "sort": i,
            })
            layout_grid.append({"i": cfg["id"], "x": x, "y": y, "w": w, "h": h})

        # 保存到 bi_dashboards — store layout/cards inside panels JSONB
        panels_json = json.dumps(panel_configs, ensure_ascii=False)
        db.execute(text(
            "INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at) "
            "VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:tmap AS jsonb), NOW(), NOW())"
            " RETURNING id"
        ), {
            "name": dashboard_name,
            "uid": current_user.id,
            "panels": panels_json,
            "tmap": json.dumps({"table_map": {"_generated": True}}),
        })
        result = db.execute(text("SELECT id FROM bi_dashboards WHERE name=:n AND owner_id=:uid ORDER BY id DESC LIMIT 1"), {"n": dashboard_name, "uid": current_user.id}).fetchone()

        # Also save data to a temp table for the dashboard
        table_name = f"bi_ai_{current_user.id}_{int(result[0])}"
        try:
            df.to_sql(table_name, db.get_bind(), if_exists="replace", index=False)
        except Exception:
            pass

        db.commit()
        dashboard_id = result[0]

        return {
            "dashboard_id": dashboard_id,
            "dashboard_name": dashboard_name,
            "panels": panel_configs,
            "cards": cards,
            "rows": rows,
            "columns": len(df.columns),
            "table_name": table_name,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"AI 生成失败: {str(e)}")


@router.post("/ai/metadata/collect", dependencies=_AI_USE)
def ai_collect_metadata(
    table_names: Optional[list[str]] = Body(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """自动采集数据源元数据 → 向量化入库"""
    return collect_metadata(db, table_names)


@router.post("/ai/knowledge/search", dependencies=_AI_USE)
def ai_search_knowledge(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """向量相似度检索知识库"""
    return search_knowledge(db, payload.get("query", ""), payload.get("top_k", 10))


@router.post("/ai/sql/validate", dependencies=_AI_USE)
def ai_validate_sql(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """校验 AI 生成 SQL 安全性"""
    sql = payload.get("sql", "")
    valid, msg = validate_sql(sql)
    return {"valid": valid, "message": msg, "sql": sql}


@router.post("/ai/pipeline", dependencies=_AI_USE)
async def ai_pipeline_generate(
    file: Optional[UploadFile] = File(None),
    query: str = Body("请基于数据生成一份综合分析看板"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    🤖 AI 多阶段流水线 — 一句话生成完整看板

    流程：语义理解 → 向量检索 → SQL生成 → SQL校验 → 图表推荐 → 自动布板 → 持久化

    支持两种模式：
      - 上传文件：parse Excel/CSV → 自动建表 → 元数据采集 → 流水线
      - 纯文本查询：基于已有数据源/知识库生成
    """
    file_bytes = None
    filename = ""
    if file:
        filename = file.filename or "data.xlsx"
        file_bytes = await file.read()

    return run_ai_pipeline(
        db=db,
        user_id=current_user.id,
        business_query=query,
        uploaded_file=file_bytes,
        uploaded_filename=filename,
    )


@router.get("/ai/audit", dependencies=_AI_USE)
def ai_audit_log(
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """查询 AI 操作审计日志"""
    rows = db.execute(text(
        "SELECT id, query_text, dashboard_id, latency_ms, status, error_msg, created_at "
        "FROM bi_ai_audit_log WHERE user_id = :uid ORDER BY id DESC LIMIT :limit"
    ), {"uid": current_user.id, "limit": limit}).fetchall()
    return {"logs": [dict(r._mapping) for r in rows]}


def _smart_generate(df, query: str, knowledge: dict) -> dict:
    """智能生成 — LLM 优先，失败/无API则自动分析列类型生成"""
    # Try LLM
    from app.services.bi_ai_engine import _call_llm, _fallback_config
    try:
        if df is not None and not df.empty:
            cols_info = "\n".join(f"- {c} ({df[c].dtype})" for c in df.columns[:30])
            kb_ctx = ""
            if knowledge.get("fields"):
                kb_ctx += "【知识库】\n" + "\n".join(
                    f"- {f['table_name']}.{f['column_name']}" for f in knowledge.get("fields", [])[:8]
                )
            resp = _call_llm(f"业务需求:{query}\n数据列:\n{cols_info}\n{kb_ctx}\n返回看板JSON。", "只返回JSON。", max_tokens=4096)
            m = re.search(r'\{[\s\S]*\}', resp)
            if m:
                cfg = json.loads(m.group())
                if cfg.get("panels") and len(cfg["panels"]) > 0:
                    return cfg
    except Exception:
        pass

    # Fallback: auto-generate from column data types
    if df is not None and not df.empty:
        return _auto_generate_from_columns(df)
    return _fallback_config(query)


def _auto_generate_from_columns(df) -> dict:
    """根据列类型自动生成看板面板（无需 LLM）"""
    import pandas as _pd, numpy as _np
    numeric = [c for c in df.columns if _pd.api.types.is_numeric_dtype(df[c])][:5]
    textual = [c for c in df.columns if _pd.api.types.is_string_dtype(df[c]) or (not _pd.api.types.is_numeric_dtype(df[c]) and not _pd.api.types.is_datetime64_any_dtype(df[c]))][:3]
    date_cols = [c for c in df.columns if _pd.api.types.is_datetime64_any_dtype(df[c]) or 'date' in c.lower() or 'time' in c.lower()][:2]
    name = "数据看板"
    panels = []

    # KPI cards
    for nc in numeric[:3]:
        mean_val = df[nc].dropna().mean()
        panels.append({"title": f"{nc}", "type": "number", "xField": "", "yField": nc, "reason": "核心指标"})

    # Bar chart
    if textual and numeric:
        panels.append({"title": f"{textual[0]}分布", "type": "bar", "xField": textual[0], "yField": numeric[0], "reason": "维度对比"})

    # Line chart (if date/time column exists)
    if date_cols and numeric:
        panels.append({"title": f"{numeric[0]}趋势", "type": "line", "xField": date_cols[0], "yField": numeric[0], "reason": "趋势分析"})

    # Pie/Donut
    if len(textual) >= 2 and len(numeric) >= 2:
        panels.append({"title": f"{textual[1]}占比", "type": "pie", "xField": textual[1], "yField": numeric[1], "reason": "比例分析"})

    # Stack bar
    if len(textual) >= 2 and len(numeric) >= 3:
        panels.append({"title": f"{textual[0]}×{numeric[2]}", "type": "bar_stack", "xField": textual[0], "yField": numeric[2], "reason": "堆叠对比"})

    # Table
    panels.append({"title": "数据明细", "type": "table", "xField": "", "yField": "", "reason": "明细查询"})

    # Ensure at least 4 panels
    if len(panels) < 4:
        extras = [
            {"title": "数据占比", "type": "donut", "xField": textual[0] if textual else "", "yField": numeric[0] if numeric else "", "reason": "环形分布"},
            {"title": "统计汇总", "type": "table", "xField": "", "yField": "", "reason": "汇总"},
        ]
        for e in extras:
            if len(panels) < 6:
                panels.append(e)

    return {"dashboard_name": name, "panels": panels[:8]}


@router.post("/ai/pipeline/async", dependencies=_AI_USE)
async def ai_pipeline_async(
    file: Optional[UploadFile] = File(None),
    query: str = Body("请基于数据生成综合分析看板"),
    layout_preset: str = Body("dashboard"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """异步 AI 流水线 — 创建任务后立即返回 task_id，通过 WebSocket 推送进度"""
    task = create_task(current_user.id)
    task.status = "running"
    task.message = "初始化..."

    try:
        # Stage 1: Parse data
        update_task(task.task_id, progress=10, message="解析数据...")
        df = None
        if file:
            content = await file.read()
            ext = (file.filename or "xlsx").split(".")[-1].lower()
            df = pd.read_excel(io.BytesIO(content)) if ext in ("xlsx", "xls", "xlsm") else pd.read_csv(io.BytesIO(content))
        update_task(task.task_id, progress=20)

        # Stage 1.5: 向量知识库检索 (Phase 1 — pgvector 增强)
        update_task(task.task_id, progress=22, message="检索知识库...")
        knowledge = {}
        try:
            knowledge = search_knowledge(db,
                query if query else " ".join(df.columns.tolist()[:20]) if df is not None and not df.empty else "数据分析"
            )
        except Exception:
            pass

        # Stage 2: Data quality analysis (Phase 2)
        update_task(task.task_id, progress=25, message="分析数据质量...")
        quality = {}
        if df is not None and not df.empty:
            quality = analyze_data_quality(df)
        update_task(task.task_id, progress=35)

        # Stage 3: AI chart recommendations (知识库增强 / 自动降级)
        update_task(task.task_id, progress=40, message="AI 分析中...")
        ai_config = _smart_generate(df, query, knowledge)  # always produces panels

        # Stage 4: Layout
        update_task(task.task_id, progress=70, message="自动排版中...")
        layout_result = compute_layout(ai_config.get("panels", []), layout_preset)
        update_task(task.task_id, progress=80)

        # Stage 5: Save
        update_task(task.task_id, progress=85, message="保存看板...")
        panels_json = json.dumps(ai_config.get("panels", []), ensure_ascii=False)
        db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:n, :uid, CAST(:p AS jsonb), CAST(:t AS jsonb), NOW(), NOW())
            RETURNING id
        """), {"n": ai_config.get("dashboard_name", "AI看板"), "uid": current_user.id, "p": panels_json, "t": '{"_ai_generated":true,"quality":{}}'})
        row = db.execute(text("SELECT id FROM bi_dashboards WHERE owner_id=:uid ORDER BY id DESC LIMIT 1"), {"uid": current_user.id}).fetchone()
        db.commit()
        dashboard_id = row[0] if row else 0

        update_task(task.task_id, status="completed", progress=100, message="完成！",
                    result={"dashboard_id": dashboard_id, "dashboard_name": ai_config.get("dashboard_name", "AI看板"),
                            "panels": ai_config.get("panels", []), "layout": layout_result["layout"],
                            "quality": quality.get("stats", {})})
    except Exception as e:
        update_task(task.task_id, status="failed", message=str(e)[:200],
                    result={"error": str(e)})

    return task.to_dict()


@router.get("/ai/pipeline/status/{task_id}", dependencies=_AI_USE)
def ai_pipeline_status(task_id: str):
    """查询异步任务进度"""
    task = get_task(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    return task.to_dict()


@router.post("/ai/model/build", dependencies=_AI_USE)
def ai_build_model(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """AI 自动多表关联建模"""
    table_names = payload.get("tables", [])
    if len(table_names) < 1:
        raise HTTPException(400, "至少需要 1 个表")
    return auto_build_model(db, table_names)


@router.post("/ai/quality/analyze", dependencies=_AI_USE)
def ai_analyze_quality(
    payload: dict = Body(...),
):
    """AI 智能数据质量分析 — Mock 数据"""
    data = payload.get("data", [])
    import pandas as pd
    df = pd.DataFrame(data) if data else pd.DataFrame()
    return analyze_data_quality(df)


@router.post("/ai/layout/compute", dependencies=_AI_USE)
def ai_compute_layout(
    payload: dict = Body(...),
):
    """AI 自由布局排版"""
    panels = payload.get("panels", [])
    preset = payload.get("preset", "dashboard")
    return compute_layout(panels, preset)


@router.post("/ai/chat/iterate", dependencies=_AI_USE)
def ai_chat_iterate(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
):
    """多轮对话迭代修改看板"""
    msg = payload.get("message", "")
    if not msg:
        raise HTTPException(400, "消息不能为空")
    return chat_iterate(current_user.id, msg)


# Knowledge Base
@router.get("/ai/kb/metrics", dependencies=_AI_USE)
def ai_kb_metrics(
    category: str = "",
    db: Session = Depends(get_db),
):
    return {"metrics": kb_list_metrics(db, category)}


@router.post("/ai/kb/metrics", dependencies=_AI_USE)
def ai_kb_add_metric(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    return kb_upsert_metric(db, payload.get("name", ""), payload.get("formula", ""), payload.get("description", ""), payload.get("category", ""))


@router.delete("/ai/kb/metrics/{name}")
def ai_kb_del_metric(name: str, db: Session = Depends(get_db)):
    return kb_delete_metric(db, name)


@router.get("/ai/kb/templates", dependencies=_AI_USE)
def ai_kb_templates(db: Session = Depends(get_db)):
    return {"templates": kb_list_templates(db)}


@router.post("/ai/kb/templates", dependencies=_AI_USE)
def ai_kb_add_template(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    return kb_upsert_template(db, payload.get("name", ""), payload.get("description", ""), payload.get("panels", []))


@router.post("/ai/anomaly/analyze", dependencies=_AI_USE)
def ai_anomaly_analyze(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    🔍 AI 异常根因下钻分析
    输入: 表名 + 指标列名 + 维度列名
    输出: 异常列表 + 根因因子 + 下钻路径 + 建议
    """
    return ai_root_cause_analysis(
        db, payload["table"], payload["metric"],
        payload.get("dimensions"),
    )


@router.post("/ai/screen/layout", dependencies=_AI_USE)
def ai_screen_layout(
    payload: dict = Body(...),
):
    """
    🖥️ AI 大屏分层排版
    支持 背景层 → 主图区 → 侧边KPI → 浮动卡片 四层叠加
    """
    return ai_large_screen_layout(
        payload.get("panels", []),
        payload.get("screen_w", 1920),
        payload.get("screen_h", 1080),
    )


@router.post("/ai/batch/generate", dependencies=_AI_USE)
def ai_batch_generate(
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    📦 AI 批量生成业务看板
    输入: 行业领域 (电商/财务/生产/通用)
    输出: 3-5 套完整看板
    """
    domain = payload.get("domain", "通用")
    results = batch_generate_dashboards(db, current_user.id, domain)
    return {"domain": domain, "dashboards": results, "count": len(results)}


@router.post("/ai/alert/generate", dependencies=_AI_USE)
def ai_alert_generate(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
):
    """
    🚨 AI 智能预警规则
    自动分析数据分布 → 多级阈值 → 告警规则
    """
    return {"rules": ai_generate_alert_rules(db, payload["table"])}


@router.post("/ai/agent-pipeline", dependencies=_AI_USE)
async def ai_agent_pipeline(
    file: UploadFile = File(...),
    query: str = Body(""),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    🤖 AI Agent 多阶段管线

    上传数据 → OpenClaw Agent1: 数据清洗 → Agent2: 交叉校验 → Agent3: 看板生成
    返回: 清洗报告 + 校验报告 + 看板配置 + 布局
    """
    content = await file.read()
    result = run_agent_pipeline(
        db=db, user_id=current_user.id,
        file_bytes=content, filename=file.filename or "data.xlsx",
        query=query,
    )
    return result
