"""
自研 BI AI 引擎 — Phase 3: 超越 FineBI 的差异化高阶能力
根因分析 + 大屏分层 + 批量生成 + 智能预警
"""
from __future__ import annotations

import json, re, time, hashlib
from typing import Optional
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sqlalchemy import text
from sqlalchemy.orm import Session


# ═══════ 1. AI 异常根因下钻分析 ═══════
@dataclass
class AnomalyResult:
    metric: str
    current_value: float
    expected_value: float
    deviation_pct: float
    severity: str  # critical|warning|info
    root_causes: list[dict]
    drill_path: list[dict]
    recommendation: str


def _detect_anomalies(series: pd.Series, name: str, threshold: float = 2.0) -> list[dict]:
    """基于 Z-Score 的异常检测"""
    clean = series.dropna()
    if len(clean) < 5:
        return []
    mean, std = clean.mean(), clean.std()
    if std == 0:
        return []
    anomalies = []
    z_scores = np.abs((clean - mean) / std)
    for idx, val in clean.items():
        z = z_scores[idx]
        if z > threshold:
            anomalies.append({
                "index": str(idx), "value": float(val),
                "z_score": round(float(z), 2),
                "deviation": round(float((val - mean) / mean * 100), 1) if mean != 0 else 0,
            })
    return sorted(anomalies, key=lambda x: abs(x["z_score"]), reverse=True)[:10]


def _find_root_cause(df: pd.DataFrame, target_col: str, anomaly_val: float) -> list[dict]:
    """通过相关性分析追溯根因"""
    causes = []
    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c]) and c != target_col]
    for col in numeric_cols[:15]:
        clean = df[[target_col, col]].dropna()
        if len(clean) > 3:
            corr = clean[target_col].corr(clean[col])
            if abs(corr) > 0.3:
                causes.append({
                    "factor": col,
                    "correlation": round(float(corr), 3),
                    "direction": "正相关" if corr > 0 else "负相关",
                    "current_avg": round(float(clean[col].mean()), 2),
                })
    return sorted(causes, key=lambda x: abs(x["correlation"]), reverse=True)[:5]


def ai_root_cause_analysis(db: Session, table_name: str, metric_col: str, dim_cols: list[str] = None) -> dict:
    """
    AI 异常根因分析 — 检测指标异常 → 追溯关联因子 → 生成下钻路径
    返回: 异常列表 + 根因 + 推荐 actions
    """
    try:
        df = pd.read_sql(f"SELECT * FROM {table_name} LIMIT 5000", db.get_bind())

        if metric_col not in df.columns:
            return {"error": f"列 {metric_col} 不存在", "available": list(df.columns)}

        anomalies = _detect_anomalies(df[metric_col], metric_col)
        if not anomalies:
            return {"metric": metric_col, "anomalies": [], "summary": "未检测到显著异常", "row_count": len(df)}

        results = []
        for a in anomalies[:5]:
            root = _find_root_cause(df, metric_col, a["value"])
            severity = "critical" if abs(a["z_score"]) > 3 else "warning" if abs(a["z_score"]) > 2 else "info"
            results.append(AnomalyResult(
                metric=metric_col,
                current_value=a["value"],
                expected_value=round(df[metric_col].mean(), 2),
                deviation_pct=a["deviation"],
                severity=severity,
                root_causes=root,
                drill_path=_build_drill_path(df, metric_col, a, root),
                recommendation=_generate_recommendation(a, root),
            ))

        return {
            "metric": metric_col,
            "anomalies": [{
                "value": r.current_value, "expected": r.expected_value,
                "deviation_pct": r.deviation_pct, "severity": r.severity,
                "root_causes": r.root_causes, "drill_path": r.drill_path,
                "recommendation": r.recommendation,
            } for r in results],
            "summary": f"检测到 {len(results)} 个异常，严重程度: {sum(1 for r in results if r.severity == 'critical')} 严重",
            "row_count": len(df),
        }
    except Exception as e:
        return {"error": str(e)}


def _build_drill_path(df: pd.DataFrame, metric: str, anomaly: dict, root: list[dict]) -> list[dict]:
    """构建逐层下钻分析路径"""
    path = [{"level": 1, "name": metric, "value": anomaly["value"], "type": "指标"}]
    for i, r in enumerate(root[:3]):
        path.append({"level": i + 2, "name": r["factor"], "correlation": r["correlation"], "type": "因子"})
    return path


def _generate_recommendation(anomaly: dict, root: list[dict]) -> str:
    if not root:
        return "建议人工排查数据来源和业务逻辑"
    top = root[0]
    direction = "增加" if top["correlation"] > 0 else "减少"
    return f"重点关注 {top['factor']}，该因子与指标呈{top['direction']}，建议{direction}该因子"


# ═══════ 2. AI 大屏分层叠加 ═══════
def ai_large_screen_layout(panels: list[dict], screen_w: int = 1920, screen_h: int = 1080) -> dict:
    """
    AI 大屏分层排版
    Layer 0: 背景 (地图/图片)
    Layer 1: 主图区 (折线/柱状)
    Layer 2: 侧边 KPI
    Layer 3: 浮动卡片 (饼图/雷达)
    """
    layers = []
    # Pillar layout: main center, KPIs top, details sides
    for i, p in enumerate(panels):
        ctype = p.get("type", "bar")
        if ctype == "number":
            layer = {"z": 2, "x": 150 + (i % 4) * 400, "y": 40, "w": 360, "h": 180}
        elif ctype in ("bar", "line"):
            layer = {"z": 1, "x": 200, "y": 260, "w": 1000, "h": 500}
        elif ctype in ("pie", "donut", "radar"):
            layer = {"z": 3, "x": 1300, "y": 260 + (i % 3) * 250, "w": 380, "h": 220}
        elif ctype == "table":
            layer = {"z": 3, "x": 200, "y": 780, "w": 1520, "h": 260}
        else:
            layer = {"z": 3, "x": 1300, "y": 260, "w": 380, "h": 220}
        layers.append({**layer, "id": f"s{i}", "title": p.get("title", ""), "type": ctype})

    return {
        "screen": {"w": screen_w, "h": screen_h},
        "background": {"type": "gradient", "colors": ["#0A0E27", "#1A1F3F"]},
        "layers": sorted(layers, key=lambda x: x["z"]),
    }


# ═══════ 3. 批量生成业务看板 ═══════
# Industry-specific dashboard templates
INDUSTRY_TEMPLATES = {
    "电商": [
        {"name": "销售总览", "panels": [
            {"title": "GMV", "type": "number"}, {"title": "订单量", "type": "number"},
            {"title": "客单价", "type": "number"}, {"title": "退款率", "type": "number"},
            {"title": "日销售额趋势", "type": "line"}, {"title": "品类占比", "type": "pie"},
            {"title": "渠道对比", "type": "bar_stack"},
        ]},
        {"name": "商品分析", "panels": [
            {"title": "SKU数", "type": "number"}, {"title": "动销率", "type": "number"},
            {"title": "TOP10商品", "type": "bar"}, {"title": "库存周转", "type": "line"},
            {"title": "退货原因", "type": "funnel"},
        ]},
        {"name": "用户分析", "panels": [
            {"title": "DAU", "type": "number"}, {"title": "转化率", "type": "number"},
            {"title": "新老客占比", "type": "donut"}, {"title": "用户画像", "type": "table"},
            {"title": "RFM模型", "type": "scatter"},
        ]},
    ],
    "财务": [
        {"name": "利润概览", "panels": [
            {"title": "净利润", "type": "number"}, {"title": "毛利率", "type": "number"},
            {"title": "费用率", "type": "number"}, {"title": "收入趋势", "type": "line"},
            {"title": "成本构成", "type": "pie"}, {"title": "部门费用对比", "type": "bar_stack"},
            {"title": "现金流量", "type": "waterfall"},
        ]},
        {"name": "预算执行", "panels": [
            {"title": "预算完成率", "type": "number"}, {"title": "预算偏差", "type": "number"},
            {"title": "部门超支TOP5", "type": "bar"}, {"title": "月度预算跟踪", "type": "line_area"},
        ]},
    ],
    "生产": [
        {"name": "生产总览", "panels": [
            {"title": "产量", "type": "number"}, {"title": "良品率", "type": "number"},
            {"title": "设备OEE", "type": "number"}, {"title": "产线效率趋势", "type": "line"},
            {"title": "不良品分布", "type": "pie"}, {"title": "产能利用率", "type": "bullet"},
        ]},
    ],
    "通用": [
        {"name": "综合概览", "panels": [
            {"title": "核心指标1", "type": "number"}, {"title": "核心指标2", "type": "number"},
            {"title": "趋势分析", "type": "line"}, {"title": "维度对比", "type": "bar"},
            {"title": "占比分布", "type": "pie"}, {"title": "明细数据", "type": "table"},
        ]},
    ],
}


def batch_generate_dashboards(db: Session, user_id: int, domain: str = "通用") -> list[dict]:
    """批量 AI 生成整套业务看板"""
    templates = INDUSTRY_TEMPLATES.get(domain, INDUSTRY_TEMPLATES["通用"])
    results = []
    for tpl in templates:
        panels_json = json.dumps(tpl["panels"], ensure_ascii=False)
        db.execute(text("""
            INSERT INTO bi_dashboards (name, owner_id, panels, table_map, created_at, updated_at)
            VALUES (:n, :uid, CAST(:p AS jsonb), CAST(:t AS jsonb), NOW(), NOW())
        """), {"n": tpl["name"], "uid": user_id, "p": panels_json, "t": json.dumps({"_batch": True, "_domain": domain})})
        row = db.execute(text("SELECT id FROM bi_dashboards WHERE owner_id=:uid AND name=:n ORDER BY id DESC LIMIT 1"), {"uid": user_id, "n": tpl["name"]}).fetchone()
        db.commit()
        if row:
            from app.services.bi_ai_phase2 import compute_layout
            _, layout = compute_layout(tpl["panels"])
            results.append({"dashboard_id": row[0], "name": tpl["name"], "panels": len(tpl["panels"]), "layout": layout[:3]})
    return results


# ═══════ 4. AI 智能预警规则 ═══════
ALERT_SEVERITY_COLORS = {"critical": "#EF4444", "warning": "#F59E0B", "info": "#3B82F6"}


def _compute_thresholds(series: pd.Series) -> dict:
    """自动计算预警阈值"""
    clean = series.dropna()
    if len(clean) < 5:
        return {}
    mean, std = clean.mean(), clean.std()
    return {
        "mean": round(float(mean), 2),
        "std": round(float(std), 2),
        "min": round(float(clean.min()), 2),
        "max": round(float(clean.max()), 2),
    }


def ai_generate_alert_rules(db: Session, table_name: str) -> list[dict]:
    """AI 自动配置预警规则"""
    try:
        df = pd.read_sql(f"SELECT * FROM {table_name} LIMIT 5000", db.get_bind())
        rules = []
        numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]

        for col in numeric_cols[:10]:
            thresholds = _compute_thresholds(df[col])
            if not thresholds or thresholds["std"] == 0:
                continue

            mean, std = thresholds["mean"], thresholds["std"]

            # 自动生成多级阈值规则
            rules.append({
                "metric": col,
                "table": table_name,
                "rules": [
                    {"level": "critical", "condition": f"{col} < {round(mean - 3*std, 2)}", "color": "#EF4444", "message": f"{col} 严重偏低"},
                    {"level": "warning", "condition": f"{col} < {round(mean - 2*std, 2)}", "color": "#F59E0B", "message": f"{col} 偏低预警"},
                    {"level": "warning", "condition": f"{col} > {round(mean + 2*std, 2)}", "color": "#F59E0B", "message": f"{col} 偏高预警"},
                    {"level": "critical", "condition": f"{col} > {round(mean + 3*std, 2)}", "color": "#EF4444", "message": f"{col} 严重偏高"},
                ],
                "stats": thresholds,
            })

        # Save alert config
        if rules:
            db.execute(text("""
                INSERT INTO bi_billing_alerts (user_id, alert_type, threshold_value, config, created_at)
                VALUES (:uid, :atype, :thresh, CAST(:cfg AS jsonb), NOW())
            """), {"uid": 1, "atype": "ai_auto", "thresh": 0, "cfg": json.dumps({"rules": rules, "table": table_name})})
            db.commit()

        return rules
    except Exception as e:
        return [{"error": str(e)}]


# ═══════ SQL Generation Helper ═══════
def _clean_sql_response(resp: str) -> str:
    """清理 LLM SQL 响应"""
    resp = re.sub(r'```sql\s*|```\s*', '', resp).strip()
    if not resp.upper().startswith("SELECT") and not resp.upper().startswith("WITH"):
        # Try to find SELECT in the response
        m = re.search(r'(SELECT|WITH)\s[\s\S]+', resp, re.IGNORECASE)
        if m:
            resp = m.group()
    return resp
