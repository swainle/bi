"""
自研 BI AI 引擎 — Phase 2
独立任务队列 + 多表建模 + 数据清洗 + 自由布局 + 知识库API
"""
from __future__ import annotations

from app.timezone import china_now

import json, re, time, uuid, io, traceback
from typing import Optional
from dataclasses import dataclass, field
from datetime import datetime

import pandas as pd
import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session
from fastapi import HTTPException, WebSocket


# ═══════ Task Queue (Redis-backed) ═══════
@dataclass
class AITask:
    task_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    user_id: int = 0
    status: str = "pending"  # pending|running|completed|failed
    progress: int = 0
    message: str = ""
    result: dict = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: china_now().isoformat())

    def to_dict(self):
        return {
            "task_id": self.task_id, "user_id": self.user_id,
            "status": self.status, "progress": self.progress,
            "message": self.message, "result": self.result,
            "created_at": self.created_at,
        }


# In-memory task store (can upgrade to Redis)
_task_store: dict[str, AITask] = {}


def create_task(user_id: int) -> AITask:
    task = AITask(user_id=user_id)
    _task_store[task.task_id] = task
    return task


def get_task(task_id: str) -> Optional[AITask]:
    return _task_store.get(task_id)


def update_task(task_id: str, **kwargs):
    t = _task_store.get(task_id)
    if t:
        for k, v in kwargs.items():
            setattr(t, k, v)


# ═══════ Auto JOIN Modeling ═══════
def _detect_joins(db: Session, tables: list[str]) -> list[dict]:
    """自动检测表间关联关系（基于外键和字段命名模式）"""
    joins = []
    # 查询所有外键
    fks = db.execute(text("""
        SELECT conname, conrelid::regclass AS child_table,
               a.attname AS child_col,
               confrelid::regclass AS parent_table,
               af.attname AS parent_col
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
        JOIN pg_attribute af ON af.attnum = ANY(c.confkey) AND af.attrelid = c.confrelid
        WHERE c.contype = 'f'
          AND conrelid::regclass::text = ANY(:tables)
    """), {"tables": tables}).fetchall()

    for row in fks:
        joins.append({
            "type": "fk",
            "left_table": row[1], "left_col": row[2],
            "right_table": row[3], "right_col": row[4],
        })

    # 命名模式推断: xxx_id 字段
    for tbl in tables:
        cols = db.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name=:tbl AND column_name LIKE '%\\_id'
        """), {"tbl": tbl}).fetchall()
        for col in cols:
            col_name = col[0]
            parent = col_name.replace("_id", "s")  # e.g., user_id → users
            if parent in tables:
                existing = any(
                    j["left_table"] == tbl and j["left_col"] == col_name
                    for j in joins
                )
                if not existing:
                    joins.append({
                        "type": "naming",
                        "left_table": tbl, "left_col": col_name,
                        "right_table": parent, "right_col": "id",
                    })
    return joins


def auto_build_model(db: Session, table_names: list[str]) -> dict:
    """AI 自动多表关联建模 — 生成 JOIN SQL"""
    if len(table_names) < 2:
        return {"tables": table_names, "joins": [], "model_sql": f"SELECT * FROM {table_names[0] if table_names else 'unknown'} LIMIT 1000"}

    joins = _detect_joins(db, table_names)
    if not joins:
        # 无关联时，生成交叉维度构建
        return {"tables": table_names, "joins": [], "model_sql": f"SELECT * FROM {table_names[0] if table_names else 'unknown'} LIMIT 1000"}

    # 构建 JOIN SQL
    main_table = table_names[0]
    select_cols = [f"t0.*"]
    join_clauses = []
    aliases = {main_table: "t0"}
    used = {main_table}

    for i, j in enumerate(joins):
        left = j["left_table"]
        right = j["right_table"]
        if left not in used and right in used:
            alias = f"t{len(aliases)}"
            aliases[left] = alias
            join_clauses.append(f"LEFT JOIN {left} {alias} ON {alias}.{j['left_col']} = {aliases[right]}.{j['right_col']}")
            used.add(left)
        elif right not in used and left in used:
            alias = f"t{len(aliases)}"
            aliases[right] = alias
            join_clauses.append(f"LEFT JOIN {right} {alias} ON {aliases[left]}.{j['left_col']} = {alias}.{j['right_col']}")
            used.add(right)

    sql = f"SELECT * FROM {main_table} t0 {' '.join(join_clauses)} LIMIT 1000"
    return {"tables": table_names, "joins": joins, "model_sql": sql}


# ═══════ AI Data Cleaning ═══════
def analyze_data_quality(df: pd.DataFrame) -> dict:
    """AI 智能数据清洗 — 识别脏数据、异常值、格式问题"""
    result = {"issues": [], "stats": {}}

    for col in df.columns:
        col_data = df[col]
        null_count = int(col_data.isna().sum())
        null_pct = round(null_count / len(df) * 100, 1) if len(df) > 0 else 0

        if null_pct > 0:
            result["issues"].append({
                "column": col, "type": "nulls",
                "severity": "high" if null_pct > 30 else "medium" if null_pct > 10 else "low",
                "detail": f"{null_count} 个空值 ({null_pct}%)",
            })

        # 数值列离群值检测 (IQR)
        if pd.api.types.is_numeric_dtype(col_data) and col_data.notna().sum() > 3:
            q1 = col_data.quantile(0.25)
            q3 = col_data.quantile(0.75)
            iqr = q3 - q1
            if iqr > 0:
                lower = q1 - 1.5 * iqr
                upper = q3 + 1.5 * iqr
                outliers = col_data[(col_data < lower) | (col_data > upper)]
                if len(outliers) > 0:
                    result["issues"].append({
                        "column": col, "type": "outliers",
                        "severity": "high" if len(outliers) > len(df) * 0.1 else "medium",
                        "detail": f"{len(outliers)} 个离群值 (范围: {lower:.1f}~{upper:.1f})",
                        "samples": outliers.head(5).tolist(),
                    })

        # 文本列异常检测
        if pd.api.types.is_string_dtype(col_data):
            empty_str = col_data.apply(lambda x: isinstance(x, str) and x.strip() == "").sum()
            if empty_str > 0:
                result["issues"].append({
                    "column": col, "type": "empty_strings",
                    "severity": "low",
                    "detail": f"{empty_str} 个空白字符串",
                })

    result["stats"] = {
        "rows": len(df),
        "columns": len(df.columns),
        "total_issues": len(result["issues"]),
        "issues_by_severity": {
            "high": sum(1 for i in result["issues"] if i["severity"] == "high"),
            "medium": sum(1 for i in result["issues"] if i["severity"] == "medium"),
            "low": sum(1 for i in result["issues"] if i["severity"] == "low"),
        },
    }
    return result


# ═══════ Free Layout Engine ═══════
LAYOUT_PRESETS = {
    "dashboard": {"cols": 12, "gap": 8, "mode": "grid"},
    "kpi_top": {"cols": 12, "gap": 8, "mode": "mixed"},
    "split_screen": {"cols": 12, "gap": 8, "mode": "free"},
}


def compute_layout(panels: list[dict], preset: str = "dashboard") -> dict:
    """AI 自由布局引擎 — 支持网格/混合/自由三种模式"""
    config = LAYOUT_PRESETS.get(preset, LAYOUT_PRESETS["dashboard"])
    cols = config["cols"]
    cards = []
    layout = []

    if preset == "kpi_top":
        # 顶部一行 KPI，下方网格
        kpis = [p for p in panels if p.get("type") == "number"]
        charts = [p for p in panels if p.get("type") != "number"]
        row = 0
        for i, p in enumerate(kpis[:4]):
            x = i * 3
            cards.append({"id": f"p{i}", "title": p.get("title", "KPI"), "type": p.get("type", "number"), "layout": {"i": f"p{i}", "x": x, "y": 0, "w": 3, "h": 2}})
            layout.append({"i": f"p{i}", "x": x, "y": 0, "w": 3, "h": 2})
        row = 2
        for i, p in enumerate(charts):
            x = (i % 3) * 4
            y = row + (i // 3) * 4
            cards.append({"id": f"p{len(kpis)+i}", "title": p.get("title", "图表"), "type": p.get("type", "bar"), "layout": {"i": f"p{len(kpis)+i}", "x": x, "y": y, "w": 4, "h": 3}})
            layout.append({"i": f"p{len(kpis)+i}", "x": x, "y": y, "w": 4, "h": 3})

    elif preset == "split_screen":
        # 左侧大屏 + 右侧信息
        main = panels[0] if panels else {"title": "", "type": "bar"}
        side = panels[1:] if len(panels) > 1 else []
        cards.append({"id": "p0", "title": main.get("title", "主图"), "type": main.get("type", "bar"), "layout": {"i": "p0", "x": 0, "y": 0, "w": 8, "h": 6}})
        layout.append({"i": "p0", "x": 0, "y": 0, "w": 8, "h": 6})
        for i, p in enumerate(side[:4]):
            cards.append({"id": f"p{i+1}", "title": p.get("title"), "type": p.get("type", "number"), "layout": {"i": f"p{i+1}", "x": 8, "y": i * 3, "w": 4, "h": 3}})
            layout.append({"i": f"p{i+1}", "x": 8, "y": i * 3, "w": 4, "h": 3})

    else:  # dashboard grid
        for i, p in enumerate(panels):
            ctype = p.get("type", "bar")
            if ctype == "number": w, h = 3, 2
            elif ctype in ("table", "heatmap"): w, h = 6, 4
            elif ctype in ("pie", "donut", "radar", "funnel"): w, h = 3, 3
            else: w, h = 4, 3
            x = (i % 3) * 4
            y = (i // 3) * (h + 1)
            cards.append({"id": f"p{i}", "title": p.get("title", f"图表{i+1}"), "type": ctype, "layout": {"i": f"p{i}", "x": x, "y": y, "w": w, "h": h}})
            layout.append({"i": f"p{i}", "x": x, "y": y, "w": w, "h": h})

    return {"cards": cards, "layout": layout, "preset": preset}


# ═══════ Knowledge Base Crud ═══════
def kb_list_metrics(db: Session, category: str = "") -> list:
    q = "SELECT id, metric_name, formula, description, category FROM bi_knowledge_metrics"
    params = {}
    if category:
        q += " WHERE category = :cat"
        params["cat"] = category
    rows = db.execute(text(q + " ORDER BY id"), params).fetchall()
    return [dict(r._mapping) for r in rows]


def kb_upsert_metric(db: Session, name: str, formula: str = "", description: str = "", category: str = "") -> dict:
    vec = _get_embedding_block(f"{name} {description}")
    db.execute(text("""
        INSERT INTO bi_knowledge_metrics (metric_name, formula, description, category, embedding)
        VALUES (:n, :f, :d, :c, CAST(:v AS vector))
        ON CONFLICT (metric_name) DO UPDATE SET
            formula = EXCLUDED.formula, description = EXCLUDED.description,
            category = EXCLUDED.category, embedding = EXCLUDED.embedding
    """), {"n": name, "f": formula, "d": description, "c": category, "v": vec})
    db.commit()
    return {"metric_name": name, "updated": True}


def kb_delete_metric(db: Session, name: str):
    db.execute(text("DELETE FROM bi_knowledge_metrics WHERE metric_name = :n"), {"n": name})
    db.commit()
    return {"deleted": name}


def kb_list_templates(db: Session) -> list:
    rows = db.execute(text("SELECT id, template_name, description FROM bi_knowledge_templates ORDER BY id")).fetchall()
    return [dict(r._mapping) for r in rows]


def kb_upsert_template(db: Session, name: str, description: str = "", panels: list = None) -> dict:
    vec = _get_embedding_block(f"{name} {description}")
    panels_json = json.dumps(panels or [], ensure_ascii=False)
    db.execute(text("""
        INSERT INTO bi_knowledge_templates (template_name, description, panels_config, embedding)
        VALUES (:n, :d, CAST(:p AS jsonb), CAST(:v AS vector))
        ON CONFLICT (template_name) DO UPDATE SET
            description = EXCLUDED.description, panels_config = EXCLUDED.panels_config,
            embedding = EXCLUDED.embedding
    """), {"n": name, "d": description, "p": panels_json, "v": vec})
    db.commit()
    return {"template_name": name, "updated": True}


# ═══════ Advanced AI Pipeline (Phase 2) ═══════
def _call_llm_2(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    import requests, os
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE") or os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return '{"error": "no_api_key"}'
    resp = requests.post(
        f"{api_base}/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": os.environ.get("LLM_MODEL") or os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"), "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt},
        ], "max_tokens": max_tokens, "temperature": 0.3},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _get_embedding_block(text: str) -> str:
    """Safe embedding that returns a vector string (never zero)"""
    import requests, os
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE") or os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        # Generate pseudo-embedding from text hash
        import hashlib
        h = hashlib.sha256(text.encode()).digest()
        vals = [float(b) / 255.0 for b in h[:384]]
        return "[" + ",".join(str(v) for v in vals) + "]"

    try:
        resp = requests.post(
            f"{api_base}/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": "text-embedding-3-small", "input": text[:8000]},
            timeout=30,
        )
        data = resp.json()
        vec = data["data"][0]["embedding"][:384]
        if len(vec) < 384:
            vec = vec + [0.0] * (384 - len(vec))
        return "[" + ",".join(str(v) for v in vec) + "]"
    except Exception:
        import hashlib
        h = hashlib.sha256(text.encode()).digest()
        vals = [float(b) / 255.0 for b in h[:384]]
        return "[" + ",".join(str(v) for v in vals) + "]"


# ═══════ Multi-turn Conversation Context ═══════
_conversation_store: dict[int, list[dict]] = {}  # user_id → messages

def chat_iterate(user_id: int, message: str) -> dict:
    """多轮对话迭代修改看板"""
    ctx = _conversation_store.get(user_id, [])
    ctx.append({"role": "user", "content": message})

    system = "你是BI看板设计专家。根据用户指令修改看板配置。返回JSON格式的panels数组。"

    resp = _call_llm_2(
        json.dumps([{"role": "system", "content": system}] + ctx[-10:]),
        max_tokens=4096,
    )

    ctx.append({"role": "assistant", "content": resp})
    _conversation_store[user_id] = ctx[-20:]  # Keep last 20 messages

    try:
        m = re.search(r'\{[\s\S]*\}', resp)
        if m:
            data = json.loads(m.group())
            if isinstance(data, dict) and "panels" in data:
                cards, layout = _auto_layout_phase2(data["panels"])
                return {"reply": data.get("reply", "已更新"), "panels": data["panels"], "cards": cards, "layout": layout}
    except Exception:
        pass
    return {"reply": "无法解析AI回复，请换种方式描述", "panels": [], "cards": [], "layout": []}


def _auto_layout_phase2(panels: list) -> tuple[list, list]:
    cards, layout = [], []
    for i, p in enumerate(panels):
        ctype = p.get("type", "bar")
        if ctype == "number": w, h = 3, 2
        elif ctype in ("table", "heatmap"): w, h = 6, 4
        elif ctype in ("pie", "donut", "radar"): w, h = 3, 3
        else: w, h = 4, 3
        x = (i % 3) * 4
        y = (i // 3) * (h + 1)
        cards.append({"id": f"ci{i}", "title": p.get("title", ""), "type": ctype, "layout": {"i": f"ci{i}", "x": x, "y": y, "w": w, "h": h}})
        layout.append({"i": f"ci{i}", "x": x, "y": y, "w": w, "h": h})
    return cards, layout
