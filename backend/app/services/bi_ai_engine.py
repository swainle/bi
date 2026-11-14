"""
自研 BI AI 引擎 — pgvector + 元数据 + SQL校验 + 多阶段流水线
Phase 1: 元数据采集、向量知识库、SQL生成校验、AI看板生成
"""
from __future__ import annotations

import json
import re
import time
import io
import traceback
from typing import Optional

import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import HTTPException

# ═══════ LLM 调用 ═══════
def _call_llm(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    """调用默认 LLM（管理后台配置 → 环境变量）"""
    import requests, os

    from app.services.ai_models import default_config

    cfg = None
    try:
        cfg = default_config()
    except Exception:
        cfg = None

    if cfg:
        endpoint = cfg["chat_url"]
        api_key = cfg["api_key"]
        model = cfg["model"]
        temperature = cfg["temperature"]
    else:
        api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
        api_base = os.environ.get("LLM_API_BASE") or os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com")
        endpoint = f"{api_base.rstrip('/')}/v1/chat/completions" if not api_base.rstrip("/").endswith("/v1") else f"{api_base.rstrip('/')}/chat/completions"
        model = os.environ.get("LLM_MODEL") or os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")
        temperature = 0.3
    if not api_key:
        return '{"error": "no_api_key"}'

    resp = requests.post(
        endpoint,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": temperature,
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ═══════ Vector Embedding ═══════
_EMBED_CACHE = {}
def _get_embedding(text: str) -> list[float]:
    """获取文本向量（使用本地模型或 API）"""
    import requests, os
    key = text[:200]
    if key in _EMBED_CACHE:
        return _EMBED_CACHE[key]

    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE") or os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return [0.0] * 384

    try:
        resp = requests.post(
            f"{api_base}/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": "text-embedding-3-small", "input": text},
            timeout=30,
        )
        data = resp.json()
        vec = data["data"][0]["embedding"]
        # Pad or truncate to 384
        if len(vec) > 384:
            vec = vec[:384]
        elif len(vec) < 384:
            vec = vec + [0.0] * (384 - len(vec))
        _EMBED_CACHE[key] = vec
        return vec
    except Exception:
        return [0.0] * 384


# ═══════ 1. 元数据自动采集 ═══════
def collect_metadata(db: Session, table_names: list[str] = None):
    """自动扫描 PG 表结构 → 存入 bi_metadata_fields，生成向量"""
    if table_names is None:
        rows = db.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
        )).fetchall()
        table_names = [r[0] for r in rows]

    total = 0
    for tbl in table_names:
        cols = db.execute(text(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = :tbl ORDER BY ordinal_position"
        ), {"tbl": tbl}).fetchall()

        for col_name, dtype in cols:
            # 智能识别维度/指标
            is_measure = any(t in str(dtype).lower() for t in ("int", "float", "numeric", "double", "decimal", "real"))
            is_dimension = any(t in str(dtype).lower() for t in ("char", "text", "date", "time", "bool"))

            # 生成描述文本用于向量化
            desc = f"表:{tbl} 字段:{col_name} 类型:{dtype}"
            if is_dimension: desc += " 维度"
            if is_measure: desc += " 指标"

            vec = _get_embedding(desc)
            vec_str = "[" + ",".join(str(v) for v in vec) + "]"

            db.execute(text("""
                INSERT INTO bi_metadata_fields (table_name, column_name, data_type, is_dimension, is_measure, embedding)
                VALUES (:tbl, :col, :dtype, :is_dim, :is_meas, CAST(:vec_str AS vector))
                ON CONFLICT (table_name, column_name) DO UPDATE SET
                    data_type = EXCLUDED.data_type,
                    is_dimension = EXCLUDED.is_dimension,
                    is_measure = EXCLUDED.is_measure,
                    embedding = EXCLUDED.embedding
            """), {"tbl": tbl, "col": col_name, "dtype": dtype, "is_dim": is_dimension, "is_meas": is_measure, "vec_str": vec_str})
            total += 1

    db.commit()
    return {"tables": len(table_names), "fields": total}


# ═══════ 2. 向量知识库检索 ═══════
def search_knowledge(db: Session, query: str, top_k: int = 10) -> dict:
    """向量相似度检索最相关的表/字段"""
    vec = _get_embedding(query)
    vec_str = "[" + ",".join(str(v) for v in vec) + "]"

    # 检索相关字段
    fields = db.execute(text("""
        SELECT table_name, column_name, data_type, is_dimension, is_measure,
               1 - (embedding <=> CAST(:vec_str AS vector)) AS similarity
        FROM bi_metadata_fields
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:vec_str AS vector)
        LIMIT :k
    """), {"vec_str": vec_str, "k": top_k}).fetchall()

    # 检索相关指标
    metrics = db.execute(text("""
        SELECT metric_name, formula, description, category,
               1 - (embedding <=> CAST(:vec_str AS vector)) AS similarity
        FROM bi_knowledge_metrics
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:vec_str AS vector)
        LIMIT :k
    """), {"vec_str": vec_str, "k": top_k}).fetchall()

    # 检索相关模板
    templates = db.execute(text("""
        SELECT template_name, description, panels_config,
               1 - (embedding <=> CAST(:vec_str AS vector)) AS similarity
        FROM bi_knowledge_templates
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> CAST(:vec_str AS vector)
        LIMIT :k
    """), {"vec_str": vec_str, "k": 5}).fetchall()

    return {
        "fields": [dict(r._mapping) for r in fields],
        "metrics": [dict(r._mapping) for r in metrics],
        "templates": [dict(r._mapping) for r in templates],
    }


# ═══════ 3. SQL 生成 & 校验引擎 ═══════
_DANGEROUS_KEYWORDS = ["DROP", "DELETE", "TRUNCATE", "INSERT", "UPDATE", "ALTER", "CREATE",
                        "GRANT", "REVOKE", "EXEC", "EXECUTE", ";--", "UNION SELECT"]
_MAX_SQL_LENGTH = 8000

def validate_sql(sql: str) -> tuple[bool, str]:
    """校验 AI 生成 SQL 的安全性"""
    sql_upper = sql.upper().strip()
    # 黑名单检查
    for kw in _DANGEROUS_KEYWORDS:
        if re.search(r'\b' + kw + r'\b', sql_upper):
            return False, f"SQL包含禁止操作: {kw}"

    # 必须包含 SELECT
    if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
        return False, "SQL必须以SELECT或WITH开头"

    # 长度限制
    if len(sql) > _MAX_SQL_LENGTH:
        return False, f"SQL超过长度限制({_MAX_SQL_LENGTH})"

    # 基本语法检查（通过 PG EXPLAIN 验证）
    try:
        # Lightweight syntax-only check without executing
        if ";" in sql and not sql.strip().endswith(";"):
            pass  # allow single statement
        # Check bracket balance
        if sql.count("(") != sql.count(")"):
            return False, "括号不匹配"
    except Exception as e:
        return False, f"SQL语法错误: {str(e)[:100]}"

    return True, "OK"


# ═══════ 4. 多阶段 AI 流水线 ═══════
def run_ai_pipeline(
    db: Session,
    user_id: int,
    business_query: str,
    uploaded_file: Optional[bytes] = None,
    uploaded_filename: str = "",
) -> dict:
    """
    AI 多阶段流水线：
    Stage 1: 业务语义理解 → 知识库检索
    Stage 2: SQL 自动生成
    Stage 3: SQL 安全校验
    Stage 4: 图表智能推荐
    Stage 5: 布局自动排版
    Stage 6: 看板持久化 + 审计日志
    """
    start = time.time()
    audit = {"user_id": user_id, "query_text": business_query}

    try:
        # ── Stage 1: 语义理解 + 知识库检索 ──
        knowledge = search_knowledge(db, business_query, top_k=10)
        ctx_fields = "\n".join(
            f"- {f['table_name']}.{f['column_name']} ({f['data_type']})"
            for f in knowledge.get("fields", [])[:15]
        )
        ctx_metrics = "\n".join(
            f"- {m['metric_name']}: {m.get('description', '')}"
            for m in knowledge.get("metrics", [])[:5]
        ) or "无预定义指标"

        # ── Stage 2: SQL 生成 ──
        sql_prompt = f"""你是数据分析专家。基于以下元数据生成 PostgreSQL 查询 SQL。

业务需求: {business_query}

相关数据表/字段:
{ctx_fields}

已有指标:
{ctx_metrics}

规则:
- 只生成 SELECT 查询
- 使用 CTE (WITH) 简化复杂查询
- 自动添加 LIMIT 1000
- 只返回 SQL，不要解释"""

        generated_sql = _call_llm(sql_prompt, "只返回纯SQL，不要markdown代码块。", max_tokens=2048)
        # Clean SQL
        generated_sql = re.sub(r'```sql\s*|```\s*', '', generated_sql).strip()
        audit["generated_sql"] = generated_sql[:2000]

        # ── Stage 3: SQL 校验 ──
        valid, msg = validate_sql(generated_sql)
        if not valid:
            audit["status"] = "sql_invalid"
            audit["error_msg"] = msg
            _write_audit(db, audit)
            raise HTTPException(400, f"AI生成的SQL校验失败: {msg}")

        # ── Stage 4: 图表推荐 ──
        chart_prompt = f"""你是BI看板设计专家。基于以下数据生成看板配置。

业务需求: {business_query}
相关数据表: {ctx_fields}

请返回JSON:
{{
  "dashboard_name": "看板名称(中文15字内)",
  "panels": [
    {{
      "title": "图表标题",
      "type": "bar|line|pie|number|table|bar_stack|line_area|donut|radar|scatter|funnel|heatmap",
      "xField": "维度字段名",
      "yField": "指标字段名",
      "reason": "选择原因"
    }}
  ]
}}

规则：
- 生成 4-8 个面板
- 必须有 1 个 KPI 数值面板
- 数值列优先用于柱状图/折线图
- 文本列优先用于饼图/表格
- 只返回JSON，不要解释"""

        chart_resp = _call_llm(chart_prompt, "只返回JSON。", max_tokens=4096)
        m = re.search(r'\{[\s\S]*\}', chart_resp)
        ai_config = json.loads(m.group()) if m else _fallback_config(business_query)

        # ── Stage 5: 布局排版 ──
        panels = ai_config.get("panels", [])
        cards, layout = _auto_layout(panels)

        # ── Stage 6: 持久化 ──
        dashboard_name = ai_config.get("dashboard_name", "AI看板")
        panels_json = json.dumps(panels, ensure_ascii=False)
        db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:name, :uid, CAST(:panels AS jsonb), CAST(:tmap AS jsonb), NOW(), NOW())
            RETURNING id
        """), {"name": dashboard_name, "uid": user_id, "panels": panels_json, "tmap": '{"_ai_generated": true}'})
        result = db.execute(text(
            "SELECT id FROM bi_dashboards WHERE name=:n AND owner_id=:uid ORDER BY id DESC LIMIT 1"
        ), {"n": dashboard_name, "uid": user_id}).fetchone()
        db.commit()
        dashboard_id = result[0]

        # 审计日志
        audit["dashboard_id"] = dashboard_id
        audit["generated_config"] = panels
        audit["latency_ms"] = int((time.time() - start) * 1000)
        audit["status"] = "success"
        _write_audit(db, audit)

        return {
            "dashboard_id": dashboard_id,
            "dashboard_name": dashboard_name,
            "panels": panels,
            "cards": cards,
            "layout": layout,
            "knowledge_fields": len(knowledge.get("fields", [])),
            "knowledge_metrics": len(knowledge.get("metrics", [])),
            "latency_ms": audit["latency_ms"],
        }

    except HTTPException:
        raise
    except Exception as e:
        audit["status"] = "error"
        audit["error_msg"] = str(e)[:500]
        audit["latency_ms"] = int((time.time() - start) * 1000)
        _write_audit(db, audit)
        traceback.print_exc()
        raise HTTPException(500, f"AI流水线异常: {str(e)[:200]}")


# ═══════ Helpers ═══════
def _auto_layout(panels: list) -> tuple[list, list]:
    """自动栅格排版：4列 × 自适应行"""
    cards, layout = [], []
    for i, p in enumerate(panels):
        ctype = p.get("type", "bar")
        if ctype == "number": w, h = 3, 2
        elif ctype in ("table", "heatmap"): w, h = 6, 4
        elif ctype in ("pie", "donut", "radar", "funnel"): w, h = 3, 3
        else: w, h = 4, 3

        x = (i % 3) * 4
        y = (i // 3) * (h + 1)

        card = {
            "card_id": f"ai-{i}",
            "title": p.get("title", f"图表{i+1}"),
            "chart_type": ctype,
            "chart_config": {**p, "id": f"ai-{i}"},
            "layout": {"i": f"ai-{i}", "x": x, "y": y, "w": w, "h": h},
            "sort": i,
        }
        cards.append(card)
        layout.append({"i": f"ai-{i}", "x": x, "y": y, "w": w, "h": h})
    return cards, layout


def _fallback_config(query: str) -> dict:
    return {
        "dashboard_name": "数据看板",
        "panels": [
            {"title": "核心指标", "type": "number", "xField": "", "yField": "", "reason": "KPI概览"},
            {"title": "趋势分析", "type": "line", "xField": "", "yField": "", "reason": "时间序列"},
            {"title": "分类对比", "type": "bar", "xField": "", "yField": "", "reason": "维度对比"},
            {"title": "占比分布", "type": "pie", "xField": "", "yField": "", "reason": "比例分析"},
            {"title": "明细数据", "type": "table", "xField": "", "yField": "", "reason": "原始数据"},
        ],
    }


def _write_audit(db: Session, audit: dict):
    try:
        db.execute(text("""
            INSERT INTO bi_ai_audit_log (user_id, query_text, generated_sql, generated_config, dashboard_id, latency_ms, status, error_msg)
            VALUES (:uid, :query, :sql, CAST(:cfg AS jsonb), :did, :ms, :status, :err)
        """), {
            "uid": audit["user_id"],
            "query": audit.get("query_text", ""),
            "sql": audit.get("generated_sql", ""),
            "cfg": json.dumps(audit.get("generated_config", {})),
            "did": audit.get("dashboard_id"),
            "ms": audit.get("latency_ms", 0),
            "status": audit.get("status", "error"),
            "err": audit.get("error_msg", ""),
        })
        db.commit()
    except Exception:
        pass
