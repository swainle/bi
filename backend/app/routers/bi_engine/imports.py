"""BI 引擎 · 拼多多利润表导入与 AI 预处理入口（/import/*）。"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, File, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session
import json
import io
import openpyxl
from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User

from fastapi import APIRouter

router = APIRouter()

from .common import _cache, _call_llm
from .import_clean import _EXCEL_COL_MAP_PDD_PROFIT, _PIVOT_METRIC_MAP, _ai_deep_clean, _ai_generate_insights, _ai_profile, _ai_smart_repair, _clean_person_name, _clean_store_name, _detect_outliers, _fix_percentage, _is_number, _normalize_numeric, _normalize_sheet, _parse_excel_rows, _parse_pivot_table, _read_pivot_as_rows, _validate_row

@router.post("/import/pdd-profit/ai-process")
async def ai_process_data(file: UploadFile = File(...)):
    """🤖 AI数据处理 — 清洗整理表格，返回结构化预览。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 清洗店铺名
        clean_logs = []
        for r in rows:
            name = r.get("store", "")
            cleaned, logs = _clean_store_name(name)
            if logs:
                r["store"] = cleaned
                clean_logs.extend(logs)

        # 数值规整
        for r in rows:
            for col in ["revenue", "refund", "cost", "promo", "logistics", "platform_fee", "labor", "net_profit"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, msg = _normalize_numeric(v, col)
                    if msg:
                        r[col] = corrected
                        clean_logs.append(msg)

        # 百分比修正
        for r in rows:
            for col in ["gross_rate", "net_rate"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, msg = _fix_percentage(v, col)
                    if msg:
                        r[col] = corrected

        # LLM 分析结构
        sample_text = "\n".join(str(r.get("store","")[:20]) for r in rows[:5])
        prompt = f"""电商数据清洗专家。已解析{len(rows)}行数据，前5行店铺: {sample_text}。清洗了{len(clean_logs)}处。返回JSON分析: {{"table_type":"standard/pivot","data_quality":"good/fair/poor","issues":["问题1"],"summary":"总结20字"}}"""
        resp = _call_llm(prompt, system="只返回JSON。", max_tokens=1024)
        ai = {}
        try:
            import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
        except Exception:
            ai = {"summary": f"解析{len(rows)}行数据"}

        return {
            "row_count": len(rows),
            "cleaned_count": len(clean_logs),
            "clean_logs": clean_logs[:10],
            "columns": list(rows[0].keys())[:12] if rows else [],
            "ai_analysis": ai,
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"AI处理失败: {str(e)}")


@router.post("/import/pdd-profit/cross-validate")
async def cross_validate_data(file: UploadFile = File(...)):
    """✔️ 交叉校验 — 对清洗后的表格进行毛利/净利/离群值校验。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 先清洗
        for r in rows:
            cleaned, _ = _clean_store_name(r.get("store", ""))
            r["store"] = cleaned

        # 校验
        all_warnings = []
        for i, r in enumerate(rows):
            w = _validate_row(r, i + 1)
            if w:
                all_warnings.extend(w)

        outlier_alerts = _detect_outliers(rows)

        # 按类型分类
        gross_warnings = [w for w in all_warnings if "毛利" in w]
        net_warnings = [w for w in all_warnings if "净利" in w]
        other_warnings = [w for w in all_warnings if "毛利" not in w and "净利" not in w]

        return {
            "row_count": len(rows),
            "total_warnings": len(all_warnings),
            "gross_issues": len(gross_warnings),
            "net_issues": len(net_warnings),
            "outliers": len(outlier_alerts),
            "warnings": all_warnings[:15],
            "outlier_details": outlier_alerts[:10],
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"交叉校验失败: {str(e)}")


@router.post("/import/pdd-profit/ai-infer")
async def ai_deep_infer(file: UploadFile = File(...)):
    """🔬 AI深度推断 — 对校验出的异常进行深度分析和调整建议。"""
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式")
    try:
        content = await file.read()
        rows, diag = _parse_excel_rows(content)

        # 清洗 + 校验
        for r in rows:
            cleaned, _ = _clean_store_name(r.get("store", ""))
            r["store"] = cleaned
        for r in rows:
            for col in ["revenue", "refund", "cost", "promo"]:
                v = r.get(col)
                if v is not None and isinstance(v, (int, float)):
                    corrected, _ = _normalize_numeric(v, col)
                    r[col] = corrected

        all_warnings = []
        for i, r in enumerate(rows):
            w = _validate_row(r, i + 1)
            if w:
                all_warnings.extend(w)

        # 构建异常摘要发给 LLM
        anomaly_summary = f"共{len(rows)}行，{len(all_warnings)}个校验异常。"
        loss_stores = [r.get("store","") for r in rows if (r.get("net_profit") or 0) < 0]
        anomaly_summary += f" 亏损{len(loss_stores)}家。"

        sample_warnings = all_warnings[:5]
        warning_text = "; ".join(sample_warnings)[:500] if sample_warnings else "无严重异常"

        prompt = f"""电商数据分析专家。数据校验结果: {anomaly_summary} 异常样例: {warning_text}。
请深度分析并给出调整建议，返回JSON:
{{"analysis":"根因分析(80字)","adjustments":["调整建议1","调整建议2"],"risk_level":"low/medium/high","actions":["行动1","行动2"]}}"""

        resp = _call_llm(prompt, system="只返回JSON。", max_tokens=2048)
        ai = {}
        try:
            import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
        except Exception:
            ai = {"analysis": f"共{len(all_warnings)}个异常，{len(loss_stores)}家亏损"}

        return {
            "row_count": len(rows),
            "anomaly_count": len(all_warnings),
            "loss_count": len(loss_stores),
            "ai_inference": ai,
            "sample_anomalies": sample_warnings[:3],
            "ready": True,
        }
    except HTTPException: raise
    except Exception as e: raise HTTPException(400, f"AI推断失败: {str(e)}")


@router.post("/import/pdd-profit/ai-analyze")
def ai_analyze_current_data(
    data_month: str = Query(default="2026-05"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI分析 — 对已导入数据库的表格数据进行深度分析。"""
    rows = db.execute(text(
        "SELECT store, person, revenue, cost, gross, gross_rate, promo, logistics, "
        "platform_fee, labor, net_profit, net_rate, is_loss "
        "FROM bi_pdd_profit WHERE data_month=:mth ORDER BY revenue DESC"
    ), {"mth": data_month}).fetchall()

    if not rows:
        return {"analysis": "暂无数据", "recommendations": []}

    # 构建数据摘要
    total_rev = sum(r[2] or 0 for r in rows)
    total_net = sum(r[10] or 0 for r in rows)
    loss_count = sum(1 for r in rows if r[12])
    store_count = len(rows)

    # Top 5 和 Bottom 5
    top5 = rows[:5]
    bottom5 = rows[-5:] if len(rows) > 5 else rows[:5]

    summary = (
        f"共{store_count}家店铺，总营收{total_rev:,.0f}，净利润{total_net:,.0f}，"
        f"亏损{loss_count}家。"
        f"TOP5: {', '.join(f'{r[0][:8]}({r[2]:,.0f})' for r in top5)}. "
        f"尾5: {', '.join(f'{r[0][:8]}({r[10]:,.0f})' for r in bottom5)}."
    )

    prompt = f"""电商数据分析专家。数据摘要：{summary}

请进行专业分析，返回JSON：
{{"summary":"整体分析(100字)", "highlights":["亮点1","亮点2"],
 "risks":["风险1","风险2"], "cost_analysis":"成本结构分析(60字)",
 "profit_trend":"利润趋势判断(60字)", "actions":["行动建议1","行动建议2","行动建议3"]}}"""

    resp = _call_llm(prompt, system="你是电商数据分析专家，只返回JSON。", max_tokens=2048)
    try:
        import re as _jr; m = _jr.search(r"\{[\s\S]*\}", resp); ai = json.loads(m.group()) if m else {}
    except Exception:
        ai = {"summary": summary}

    return {
        "data_summary": summary,
        "store_count": store_count,
        "total_revenue": round(total_rev, 2),
        "total_net_profit": round(total_net, 2),
        "loss_count": loss_count,
        "ai_analysis": ai,
    }


@router.post("/import/pdd-profit/preview")
async def preview_pdd_profit(
    file: UploadFile = File(...),
):
    """🔍 表序整理预览 — 先分析 Excel 结构，返回列映射和样例数据。

    不写入数据库，仅做结构解析和预览，供用户确认后再执行导入。
    返回: sheet名、header行号、列映射表、前5行样例数据。
    """
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式的 Excel 文件")

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

        # 选 sheet
        target_sheet = None
        for sn in wb.sheetnames:
            if sn in ("店铺明细", "Sheet1", "数据", "明细", "利润", "报表"):
                target_sheet = sn
                break
        if not target_sheet:
            target_sheet = max(wb.sheetnames, key=lambda sn: wb[sn].max_row)

        ws = wb[target_sheet]

        # 运行表序整理
        headers, col_map, data_start, diag = _normalize_sheet(ws)

        # 检查是否透视表格式
        pivot_meta = getattr(_parse_pivot_table, "_meta", None) if hasattr(_parse_pivot_table, "_meta") else None
        is_pivot = pivot_meta and pivot_meta.get("is_pivot")

        if is_pivot:
            # 透视表格式：展示人员列表和分区标题
            sample_rows: list[dict] = []
            for person in pivot_meta.get("persons", [])[:5]:
                sample_rows.append({"人员": person})
            return {
                "sheet": target_sheet,
                "sheet_rows": ws.max_row,
                "header_row": pivot_meta.get("header_row", 0),
                "diagnostic": diag,
                "is_pivot": True,
                "persons": pivot_meta.get("persons", []),
                "sections": pivot_meta.get("section_labels", []),
                "column_mapping": _PIVOT_METRIC_MAP,
                "mapped_columns": [f"核算项目名称"] + pivot_meta.get("persons", [])[:10],
                "mapped_count": 1 + len(pivot_meta.get("persons", [])),
                "total_columns": 1 + len(pivot_meta.get("persons", [])),
                "sample_rows": sample_rows,
                "ready": True,
            }

        # 标准格式：读取前 5 行样例数据
        col_keys = list(col_map.keys())
        sample_rows: list[dict] = []
        row_count = 0
        for row_idx in range(data_start, min(data_start + 10, ws.max_row + 1)):
            row = [c.value for c in ws[row_idx]]
            store = str(row[col_map["店铺名称"]]) if "店铺名称" in col_map and col_map["店铺名称"] < len(row) else ""
            if not store or store in ("None", "nan", "-"):
                continue
            if "合计" in store or "总计" in store:
                continue
            vals = {}
            for key, idx in col_map.items():
                if idx < len(row):
                    v = row[idx]
                    try:
                        vals[key] = round(float(v), 2) if v is not None and _is_number(v) else str(v)[:30]
                    except Exception:
                        vals[key] = str(v)[:30] if v else ""
            sample_rows.append(vals)
            row_count += 1
            if row_count >= 5:
                break

        return {
            "sheet": target_sheet,
            "sheet_rows": ws.max_row,
            "header_row": data_start - 1,  # header 行号（1-based）
            "diagnostic": diag,
            "column_mapping": {k: _EXCEL_COL_MAP_PDD_PROFIT[k] for k in col_keys},
            "mapped_columns": col_keys,
            "mapped_count": len(col_map),
            "total_columns": len(col_keys),
            "sample_rows": sample_rows,
            "ready": len(col_map) >= 2,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"表序整理预览失败: {str(e)}")


@router.post("/import/pdd-profit")
async def import_pdd_profit(
    file: UploadFile = File(...),
    data_month: str = Query(default="2026-05"),
    replace_mode: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """🤖 AI智能导入 — 全自动流水线：表序整理→AI清洗→交叉校验→入库→洞察。

    流水线 8 阶段：
      0️⃣ AI表序整理：合并单元格填充、列名模糊匹配、自动定位header
      ① 读取解析：按映射列读取数值
      ② AI列统计画像 + 智能修补（IQR异常裁剪/负值规整）
      ③ 规则清洗（店铺名标准化/百分比校正）
      ④ AI深度推断（列间关系智能修正）
      ⑤ 交叉校验（毛利/净利/离群值检测）
      ⑥ 写入 PostgreSQL bi_pdd_profit
      ⑦ AI洞察 + 前端自动刷新

    列名别名支持：店铺≈店铺名称/店名, 营收≈销售收入, 推广≈运营推广, 物流≈仓库物流, 人工≈人工成本
    所有阶段日志和AI洞察在导入弹窗中可视化展示。
    """
    import re as _re

    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in (".xlsx", ".xls", ".xlsm")):
        raise HTTPException(400, "只支持 .xlsx / .xls 格式的 Excel 文件")

    # 聚合日志
    clean_logs: list[str] = []
    warnings: list[str] = []

    try:
        content = await file.read()
        wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True)

        # ─── 0️⃣ AI 表序整理 — 自动识别表格结构 ───
        target_sheet = None
        # 优先精确匹配 sheet 名
        for sn in wb.sheetnames:
            if sn in ("店铺明细", "Sheet1", "数据", "明细", "利润", "报表"):
                target_sheet = sn
                break
        if not target_sheet:
            # 启发式：选行数最多的 sheet
            best = max(wb.sheetnames, key=lambda sn: wb[sn].max_row)
            target_sheet = best

        ws = wb[target_sheet]
        clean_logs.append(f"📋 使用 Sheet「{target_sheet}」(共{ws.max_row}行)")

        headers, col_map, data_start, diag = _normalize_sheet(ws)
        clean_logs.append(f"🔍 表序整理: {diag}")

        # 检测透视表格式
        pivot_meta = getattr(_parse_pivot_table, "_meta", {}) if hasattr(_parse_pivot_table, "_meta") else {}
        is_pivot = pivot_meta.get("is_pivot")

        if is_pivot:
            clean_logs.append(f"📊 透视表格式: {len(pivot_meta.get('persons',[]))}人, {len(pivot_meta.get('metric_rows',[]))}个分区")
            pivot_rows, metric_cols = _read_pivot_as_rows(
                ws, pivot_meta["header_row"], pivot_meta["persons"],
                pivot_meta["metric_rows"], pivot_meta["max_row"]
            )
            # 转换为标准格式（补齐必填字段）
            raw_rows = []
            for pr in pivot_rows:
                row = {
                    "person": pr.get("person", ""),
                    "store": pr.get("store", ""),
                    "data_month": data_month,
                }
                for col in ["revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate"]:
                    row[col] = pr.get(col, 0) or 0
                for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                           "product_cost", "gift_cost", "special_cost", "damage",
                           "express", "other_logistics", "product_promo", "wujie_promo",
                           "platform_commission", "op_labor", "alloc_labor",
                           "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
                    row.setdefault(fld, 0)
                raw_rows.append(row)
            clean_logs.append(f"📄 透视表解析: {len(raw_rows)} 行 → {len(metric_cols)} 个指标")
        else:
            # ─── 第一阶段：读取行 ───
            raw_rows: list[dict] = []
            for row_idx in range(data_start, ws.max_row + 1):
                row = [c.value for c in ws[row_idx]]

                store_name = str(row[col_map.get("店铺名称", -1)]).strip() if "店铺名称" in col_map and col_map["店铺名称"] < len(row) else ""
                if not store_name or store_name in ("None", "nan", "-"):
                    continue
                if "合计" in store_name or "总计" in store_name:
                    continue

                def _get_val(col: str):
                    if col not in col_map:
                        return None
                    idx = col_map[col]
                    if idx >= len(row):
                        return None
                    v = row[idx]
                    if v is None:
                        return None
                    try:
                        return float(v)
                    except (ValueError, TypeError):
                        return None

                person = str(row[col_map["负责人"]]).strip() if "负责人" in col_map and col_map["负责人"] < len(row) and row[col_map["负责人"]] else ""

                vals = {"person": person, "store": store_name, "data_month": data_month}
                for col in ["revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate"]:
                    vals[col] = _get_val(col) or 0

                for fld in ["positive_rev", "special_rev", "reverse_orders", "postage_income",
                           "product_cost", "gift_cost", "special_cost", "damage",
                           "express", "other_logistics", "product_promo", "wujie_promo",
                           "platform_commission", "op_labor", "alloc_labor",
                           "other_expense", "rent", "utility", "admin_alloc", "other_income"]:
                    vals.setdefault(fld, 0)

                raw_rows.append(vals)

            clean_logs.append(f"📄 读取 {len(raw_rows)} 行原始数据")

        # ─── ①-② AI 列统计画像 + 智能修补 ───
        numeric_cols = ["revenue", "cost", "gross", "gross_rate", "promo", "logistics",
                        "platform_fee", "labor", "net_profit", "net_rate", "positive_orders",
                        "refund", "positive_rev", "reverse_orders"]
        ai_profile = _ai_profile(raw_rows, numeric_cols)
        ai_logs = _ai_smart_repair(raw_rows, ai_profile)
        if ai_logs:
            clean_logs.append(f"🤖 AI智能修补: {len(ai_logs)} 处异常")
            clean_logs.extend(ai_logs[:10])  # 只展示前 10 条

        # ─── ② 规则数据清洗 ───
        for row in raw_rows:
            # 店铺名清洗
            cleaned_store, logs = _clean_store_name(row["store"])
            if logs:
                row["store"] = cleaned_store
                clean_logs.extend(logs)

            # 负责人名清洗
            cleaned_person, logs = _clean_person_name(row["person"])
            if logs:
                row["person"] = cleaned_person
                clean_logs.extend(logs)

            # 百分比修正
            for col in ["gross_rate", "net_rate"]:
                v = row.get(col)
                if v is not None:
                    corrected, msg = _fix_percentage(v, col)
                    if msg:
                        row[col] = corrected
                        clean_logs.append(msg)

            # 数值规整
            for col in ["revenue", "refund", "cost", "promo", "logistics", "platform_fee", "labor", "net_profit"]:
                v = row.get(col)
                if v is not None:
                    corrected, msg = _normalize_numeric(v, col)
                    if msg:
                        row[col] = corrected
                        clean_logs.append(msg)

        clean_logs.append(f"🧹 规则清洗完成")

        # ─── ②-③ AI 深度清洗（列间关系推断修正）───
        ai_deep_logs = _ai_deep_clean(raw_rows)
        if ai_deep_logs:
            clean_logs.append(f"🔬 AI深度清洗: {len(ai_deep_logs)} 处修正")
            clean_logs.extend(ai_deep_logs[:10])

        # ─── ③ 数据校验 ───
        for i, row in enumerate(raw_rows):
            w = _validate_row(row, i + 1)
            if w:
                warnings.extend(w)

        # 离群值检测
        outlier_alerts = _detect_outliers(raw_rows)
        if outlier_alerts:
            warnings.append("⚠️ 离群值检测:")
            warnings.extend(outlier_alerts)

        # ─── 第四阶段：写入数据库 ───
        if replace_mode:
            deleted = db.execute(text(
                "DELETE FROM bi_pdd_profit WHERE data_month=:mth"
            ), {"mth": data_month}).rowcount
            clean_logs.append(f"🔄 全量替换模式: 已清除 {deleted} 条旧数据")
        inserted = 0
        updated = 0
        for row in raw_rows:
            existing = db.execute(text(
                "SELECT id FROM bi_pdd_profit WHERE store=:store AND data_month=:mth"
            ), {"store": row["store"], "mth": data_month}).fetchone()

            if existing:
                row["is_loss"] = row.get("net_profit", 0) < 0
                update_fields = []
                update_params = {"id": existing[0]}
                for col in ["person", "revenue", "positive_orders", "refund", "cost", "gross", "gross_rate",
                            "promo", "logistics", "platform_fee", "labor", "net_profit", "net_rate", "is_loss"]:
                    if col in row:
                        update_fields.append(f"{col}=:{col}")
                        update_params[col] = row[col]
                update_fields.append("updated_at=NOW()")
                db.execute(text(f"UPDATE bi_pdd_profit SET {', '.join(update_fields)} WHERE id=:id"), update_params)
                updated += 1
            else:
                row["is_loss"] = (row.get("net_profit", 0) or 0) < 0
                cols = ", ".join(row.keys())
                placeholders = ", ".join(f":{k}" for k in row)
                db.execute(text(f"INSERT INTO bi_pdd_profit ({cols}) VALUES ({placeholders})"), row)
                inserted += 1

        db.commit()
        total = db.execute(text(
            "SELECT count(*) FROM bi_pdd_profit WHERE data_month=:mth"
        ), {"mth": data_month}).scalar()
        loss_count = db.execute(text(
            "SELECT count(*) FROM bi_pdd_profit WHERE data_month=:mth AND is_loss=true"
        ), {"mth": data_month}).scalar()

        # ─── ④ AI 数据洞察 ───
        ai_insights = _ai_generate_insights(raw_rows, ai_profile)

        # 清除数据缓存，确保下次查询获取最新数据
        _cache.invalidate_table("bi_pdd_profit")

        return {
            "inserted": inserted,
            "updated": updated,
            "total": total,
            "loss_count": loss_count,
            "data_month": data_month,
            "file": file.filename,
            "cleaned": len([l for l in clean_logs if l and not l.startswith("📋") and not l.startswith("📄") and not l.startswith("🧹") and not l.startswith("🤖") and not l.startswith("🔬")]),
            "ai_fixes": len(ai_logs) + len(ai_deep_logs),
            "warnings_count": len(warnings),
            "clean_logs": clean_logs[-15:],  # 返回最后 15 条日志
            "warnings": warnings[:15],  # 前 15 条警告
            "ai_insights": ai_insights,  # AI 洞察摘要
        }

    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(500, f"导入失败: {str(e)}")
