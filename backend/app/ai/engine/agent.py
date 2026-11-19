"""
自研 BI AI Agent 管线 — 三阶段流水线
上传数据 → 清洗 Agent → 校验 Agent → 生成 Agent
（阶段间可降级为本地规则引擎，不依赖外部 Agent 服务）
"""
from __future__ import annotations

from app.timezone import china_now

import json, io, re, time, traceback
import pandas as pd
import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing import Optional


# ═══════ LLM 调用（无外部 Agent 依赖）═══════
def _call_llm_fallback(prompt: str, system: str = "", max_tokens: int = 4096) -> str:
    """直接调用 LLM API（OpenClaw 不可用时的降级方案）"""
    import requests, os
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY", "")
    api_base = os.environ.get("LLM_API_BASE") or os.environ.get("DEEPSEEK_API_BASE", "https://api.deepseek.com")
    if not api_key:
        return '{"error": "no_api_key"}'
    resp = requests.post(
        f"{api_base}/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": os.environ.get("LLM_MODEL") or os.environ.get("DEEPSEEK_MODEL", "deepseek-chat"),
              "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
              "max_tokens": max_tokens, "temperature": 0.3},
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


# ═══════ Agent 1: 数据清洗 & 校验 ═══════
def agent_clean_data(df: pd.DataFrame) -> dict:
    """
    OpenClaw Agent: BI数据清洗专家
    输入: 原始 DataFrame
    输出: 清洗后的 DataFrame + 清洗报告
    """
    report = {"original_rows": len(df), "original_columns": len(df.columns), "actions": []}

    # 列名清洗
    new_columns = [str(c).strip().replace("\n", "").replace("\r", "") for c in df.columns]
    if new_columns != list(df.columns):
        report["actions"].append(f"列名清洗: {len([c for c in df.columns if str(c) != new_columns[list(df.columns).index(c)]])} 列")
    df.columns = new_columns

    # 空值处理
    null_report = {}
    for col in df.columns:
        null_count = int(df[col].isna().sum())
        if null_count > 0:
            null_pct = round(null_count / len(df) * 100, 1)
            if pd.api.types.is_numeric_dtype(df[col]):
                df[col] = df[col].fillna(0)
                null_report[col] = f"{null_count}空值({null_pct}%)→填充0"
            else:
                df[col] = df[col].fillna("")
                null_report[col] = f"{null_count}空值({null_pct}%)→填充为空"
    if null_report:
        report["actions"].append(f"空值处理: {len(null_report)} 列")

    # 异常值处理 (IQR)
    outlier_count = 0
    for col in df.select_dtypes(include=[np.number]).columns:
        clean = df[col].dropna()
        if len(clean) > 4:
            q1, q3 = clean.quantile(0.25), clean.quantile(0.75)
            iqr = q3 - q1
            if iqr > 0:
                lower, upper = q1 - 3 * iqr, q3 + 3 * iqr
                outliers = (df[col] < lower) | (df[col] > upper)
                count = int(outliers.sum())
                if count > 0:
                    df.loc[outliers, col] = df[col].median()
                    outlier_count += count
    if outlier_count > 0:
        report["actions"].append(f"异常值修正: {outlier_count} 个（替换为中位数）")

    # 去重
    dupes = int(df.duplicated().sum())
    if dupes > 0:
        df = df.drop_duplicates()
        report["actions"].append(f"去重: {dupes} 行")

    report["final_rows"] = len(df)
    report["final_columns"] = len(df.columns)
    report["total_actions"] = len(report["actions"])

    return {"df": df, "report": report}


# ═══════ Agent 2: 交叉校验 ═══════
def agent_validate_data(df: pd.DataFrame) -> dict:
    """
    OpenClaw Agent: BI交叉校验专家
    检查数据一致性、完整性、业务逻辑
    """
    validations = []
    warnings = []

    # 完整性检查
    for col in df.columns:
        if df[col].isna().sum() > 0:
            warnings.append(f"列 {col} 仍有 {int(df[col].isna().sum())} 个空值")
        if pd.api.types.is_numeric_dtype(df[col]):
            validations.append({
                "column": col, "type": "numeric_check",
                "min": round(float(df[col].min()), 2),
                "max": round(float(df[col].max()), 2),
                "mean": round(float(df[col].mean()), 2),
                "status": "ok",
            })

    # 唯一性检查
    for col in df.columns:
        if pd.api.types.is_string_dtype(df[col]):
            unique_pct = round(df[col].nunique() / len(df) * 100, 1)
            if unique_pct > 90:
                validations.append({"column": col, "type": "uniqueness", "unique_pct": unique_pct, "note": "高唯一性，适合做维度"})

    # 关联性检查
    num_cols = df.select_dtypes(include=[np.number]).columns[:5]
    if len(num_cols) >= 2:
        corr = df[num_cols].corr()
        for i in range(len(num_cols)):
            for j in range(i + 1, len(num_cols)):
                v = corr.iloc[i, j]
                if abs(v) > 0.8:
                    validations.append({
                        "type": "correlation",
                        "columns": [num_cols[i], num_cols[j]],
                        "correlation": round(float(v), 3),
                        "note": "高相关性，可能冗余",
                    })

    return {
        "validations": validations,
        "warnings": warnings,
        "passed": len(warnings) == 0,
        "checks": len(validations),
    }


# ═══════ Agent 3: 看板生成 ═══════
def agent_generate_dashboard(df: pd.DataFrame, validation: dict, query: str = "综合分析") -> dict:
    """
    OpenClaw Agent: BI看板设计专家
    优先使用 LLM 生成，失败降级到本地规则引擎
    """
    import pandas as _pd

    # 尝试 OpenClaw Agent
    try:
        numeric = [c for c in df.columns if _pd.api.types.is_numeric_dtype(df[c])][:6]
        textual = [c for c in df.columns if _pd.api.types.is_string_dtype(df[c])][:4]
        cols_info = "\n".join(
            f"- {c} ({df[c].dtype}, 样例: {str(df[c].dropna().head(3).tolist())})"
            for c in df.columns[:15]
        )
        prompt = f"""请基于以下数据生成看板配置JSON。只返回JSON，不要任何解释。

业务需求: {query}
数据列:
{cols_info}
校验报告: {json.dumps(validation, ensure_ascii=False)[:500]}

要求:
- dashboard_name: 有业务含义的中文名
- panels: 数组，每个面板有 title/type/xField/yField
- type 必须是: number/bar/line/pie/donut/bar_stack/table
- 生成 4-8 个面板，必须包含 1 个 KPI 数值卡和 1 个表格"""

        resp = _call_llm_fallback(prompt, system="你是资深 BI 看板设计专家，只输出 JSON。")
        if resp and "error" not in resp.lower():
            # 提取 JSON
            m = re.search(r'\{[\s\S]*\}', resp)
            if m:
                cfg = json.loads(m.group())
                # 兼容不同 JSON 格式
                panels = (cfg.get("panels") or cfg.get("dashboard", {}).get("panels") or [])
                if panels and len(panels) > 2:
                    name = cfg.get("dashboard_name") or cfg.get("dashboard", {}).get("title") or f"{query[:10]}分析"
                    return {"dashboard_name": name, "panels": panels[:8], "source": "llm"}
    except Exception:
        pass

    # Fallback: 本地规则引擎
    numeric = [c for c in df.columns if _pd.api.types.is_numeric_dtype(df[c])][:6]
    textual = [c for c in df.columns if _pd.api.types.is_string_dtype(df[c])][:4]
    date_cols = [c for c in df.columns if _pd.api.types.is_datetime64_any_dtype(df[c]) or ('date' in c.lower()) or ('time' in c.lower())][:2]

    panels = []
    name = f"{query[:12]}分析看板" if query else "数据看板"

    # KPI 数值卡
    for nc in numeric[:4]:
        panels.append({"title": nc, "type": "number", "xField": "", "yField": nc, "size": "sm", "reason": "核心KPI"})

    # 柱状图
    if textual and numeric:
        panels.append({"title": f"{textual[0]}-{numeric[0]}", "type": "bar", "xField": textual[0], "yField": numeric[0], "size": "md", "reason": "分类对比"})

    # 折线图
    if date_cols and numeric:
        panels.append({"title": f"{numeric[0]}趋势", "type": "line", "xField": date_cols[0], "yField": numeric[0], "size": "md", "reason": "趋势分析"})

    # 饼图
    if len(textual) >= 2 and len(numeric) >= 2:
        panels.append({"title": f"{textual[1]}占比", "type": "pie", "xField": textual[1], "yField": numeric[1], "size": "sm", "reason": "占比分布"})

    # 堆叠柱状图
    if len(textual) >= 2 and len(numeric) >= 3:
        panels.append({"title": f"{textual[0]}×{numeric[2]}", "type": "bar_stack", "xField": textual[0], "yField": numeric[2], "size": "md", "reason": "堆叠对比"})

    # 表格/明细
    panels.append({"title": "数据明细", "type": "table", "xField": "", "yField": "", "size": "lg", "reason": "明细查询"})

    # 校验警告驱动的额外面板
    if validation.get("warnings"):
        panels.append({"title": "数据质量", "type": "table", "xField": "", "yField": "", "size": "sm", "reason": "质量监控"})

    # 兜底：始终至少 5 个面板
    if len(panels) < 5:
        extras = [
            {"title": "数据概览", "type": "donut", "xField": textual[0] if textual else "", "yField": numeric[0] if numeric else "", "size": "sm", "reason": "环形比例"},
            {"title": "汇总统计", "type": "table", "xField": "", "yField": "", "size": "lg", "reason": "数据汇总"},
            {"title": "记录数", "type": "number", "xField": "", "yField": "", "size": "sm", "reason": "总量指标"},
        ]
        for e in extras:
            if len(panels) < 7:
                panels.append(e)

    return {"dashboard_name": name, "panels": panels[:8]}


# ═══════ 主流水线 ═══════
def run_agent_pipeline(db: Session, user_id: int, file_bytes: bytes, filename: str, query: str = "") -> dict:
    """完整 Agent 管线：清洗 → 校验 → 生成 → 持久化"""
    start = time.time()
    stages = []

    # Stage 1: Parse
    ext = filename.split(".")[-1].lower() if "." in filename else "xlsx"
    df = pd.read_excel(io.BytesIO(file_bytes)) if ext in ("xlsx", "xls", "xlsm") else pd.read_csv(io.BytesIO(file_bytes))
    stages.append({"stage": "解析", "rows": len(df), "columns": len(df.columns)})

    # Stage 2: Clean (Agent 1) — LLM / 本地规则
    try:
        clean_result = agent_clean_data(df)
        df = clean_result["df"]
        stages.append({"stage": "清洗", "mode": "python", "actions": clean_result["report"]["total_actions"]})
    except Exception as e:
        stages.append({"stage": "清洗", "error": str(e)[:100]})

    # Stage 3: Validate (Agent 2)
    try:
        validation = agent_validate_data(df)
        stages.append({"stage": "校验", "checks": validation["checks"], "warnings": len(validation["warnings"]), "passed": validation["passed"]})
    except Exception as e:
        validation = {"validations": [], "warnings": [], "passed": True, "checks": 0}
        stages.append({"stage": "校验", "error": str(e)[:100]})

    # Stage 4: Generate (Agent 3)
    try:
        ai_config = agent_generate_dashboard(df, validation, query or "数据分析")
        stages.append({"stage": "生成", "panels": len(ai_config["panels"]), "source": ai_config.get("source", "local")})
    except Exception as e:
        ai_config = {"dashboard_name": "数据看板", "panels": [{"title": "数据明细", "type": "table", "xField": "", "yField": ""}]}
        stages.append({"stage": "生成", "error": str(e)[:100]})

    # Stage 5: 数据落表 PostgreSQL（关键——卡片数据来源）
    table_name = f"bi_ai_{user_id}_{china_now().strftime('%H%M%S')}"
    try:
        # Sanitize column names: keep only safe chars, replace others
        col_map = {}  # original → safe
        for col in df.columns:
            orig = str(col)
            safe = "col_" + re.sub(r'[^a-zA-Z0-9]', '_', orig)[:40].strip('_')
            if safe in col_map.values():
                safe = f"{safe}_{len(col_map)}"
            col_map[orig] = safe

        cols_create = []
        for orig, safe in col_map.items():
            if pd.api.types.is_numeric_dtype(df[orig]):
                clean_vals = df[orig].dropna()
                if len(clean_vals) > 0 and clean_vals.apply(lambda x: float(x).is_integer()).all():
                    dtype = "INTEGER"
                else:
                    dtype = "DOUBLE PRECISION"
            else:
                dtype = "TEXT"
            cols_create.append(f'"{safe}" {dtype}')

        db.execute(text(f'DROP TABLE IF EXISTS {table_name}'))
        db.execute(text(f'CREATE TABLE {table_name} (id SERIAL PRIMARY KEY, {", ".join(cols_create)})'))

        for _, row in df.iterrows():
            vals, names = {}, []
            for orig, safe in col_map.items():
                v = row[orig]
                if pd.isna(v): vals[safe] = None
                elif isinstance(v, (int, float)): vals[safe] = v
                else: vals[safe] = str(v)
                names.append(f'"{safe}"')
            db.execute(text(f'INSERT INTO {table_name} ({", ".join(names)}) VALUES ({", ".join(f":{c}" for c in vals)})'), vals)
        db.commit()
        stages.append({"stage": "落表", "table": table_name, "rows": len(df)})
    except Exception as e:
        table_name = ""
        db.rollback()
        stages.append({"stage": "落表", "error": str(e)[:100]})

    # Stage 6: Layout
    from app.services.bi_ai_phase2 import compute_layout
    layout = compute_layout(ai_config.get("panels", []), "dashboard")

    # Stage 7: 保存看板元数据（含 table_map 指向数据表）
    panels_json = json.dumps(ai_config.get("panels", []), ensure_ascii=False)
    tmap_json = json.dumps({table_name: table_name} if table_name else {})
    db.execute(text("""
        INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
        VALUES (:n, :uid, CAST(:p AS jsonb), CAST(:t AS jsonb), NOW(), NOW())
        RETURNING id
    """), {"n": ai_config["dashboard_name"], "uid": user_id, "p": panels_json, "t": tmap_json})
    row = db.execute(text("SELECT id FROM bi_dashboards WHERE owner_id=:uid ORDER BY id DESC LIMIT 1"), {"uid": user_id}).fetchone()
    db.commit()
    dashboard_id = row[0] if row else 0

    latency = int((time.time() - start) * 1000)
    return {
        "dashboard_id": dashboard_id,
        "dashboard_name": ai_config["dashboard_name"],
        "panels": ai_config.get("panels", []),
        "panels_count": len(ai_config.get("panels", [])),
        "layout": layout["layout"],
        "table_name": table_name,
        "stages": stages,
        "latency_ms": latency,
    }
