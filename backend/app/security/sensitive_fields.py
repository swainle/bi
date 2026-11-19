"""敏感字段自动识别（R13）—— 新数据集命中标签时默认脱敏.

标签与默认脱敏：
    * 薪资 / 工资 / 薪酬 / salary / wage          → custom "***"
    * 成本 / 进价 / 毛利 / cost / margin          → custom "***"
    * 手机 / 电话 / phone / mobile                → phone
    * 身份证 / id_card / identity                 → id_card
    * 邮箱 / email / mail                         → email
    * 地址 / 住址 / address                       → custom "***"
    * 密码 / 密钥 / password / secret / token     → custom "***"

规则写入 `bi_dataset_column_mask`（与导出 / AI / MCP 共用同一套脱敏），
自动套用会写审计；负责人可在数据集安全页手工关闭（同样写审计）。
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import text

# (标签, 正则, 脱敏类型, 模板)
RULES: tuple[tuple[str, re.Pattern, str, str], ...] = (
    ("salary", re.compile(r"薪资|工资|薪酬|月薪|年薪|salary|wage|payroll", re.I), "custom", "***"),
    ("cost", re.compile(r"成本|进价|采购价|毛利|cost|margin", re.I), "custom", "***"),
    ("phone", re.compile(r"手机|电话|联系方式|phone|mobile|tel", re.I), "phone", ""),
    ("id_card", re.compile(r"身份证|证件号|id[_ ]?card|identity", re.I), "id_card", ""),
    ("email", re.compile(r"邮箱|email|e[_ ]?mail", re.I), "email", ""),
    ("address", re.compile(r"地址|住址|address", re.I), "custom", "***"),
    ("secret", re.compile(r"密码|密钥|口令|password|secret|api[_ ]?key|token", re.I),
     "custom", "***"),
)


def detect(name: str, description: str = "") -> tuple[str, str, str] | None:
    value = f"{name or ''} {description or ''}"
    for tag, pattern, mask_type, mask_pattern in RULES:
        if pattern.search(value):
            return tag, mask_type, mask_pattern
    return None


def auto_mask_dataset(db: Any, dataset_id: int, created_by: int | None = None) -> list[dict]:
    """给新数据集自动套脱敏；已存在的规则不覆盖（负责人手工配置优先）."""
    try:
        fields = db.execute(
            text("SELECT name, source_column, description FROM bi_dataset_field "
                 "WHERE dataset_id = :d ORDER BY id"), {"d": int(dataset_id)}
        ).fetchall()
    except Exception:
        return []

    applied: list[dict] = []
    for name, source_column, description in fields:
        hit = detect(str(name or ""), str(description or ""))
        if hit is None and source_column:
            hit = detect(str(source_column or ""))
        if hit is None:
            continue
        tag, mask_type, pattern = hit
        column = str(name or source_column or "")
        if not column:
            continue
        result = db.execute(
            text(
                "INSERT INTO bi_dataset_column_mask "
                "  (dataset_id, column_name, mask_type, mask_pattern, created_by) "
                "VALUES (:d, :c, :t, :p, :by) "
                "ON CONFLICT (dataset_id, column_name) DO NOTHING"
            ),
            {"d": int(dataset_id), "c": column, "t": mask_type,
             "p": pattern, "by": created_by},
        )
        if result.rowcount:
            applied.append({"column_name": column, "tag": tag, "mask_type": mask_type})
    if applied:
        db.commit()
        try:
            from app.middleware.audit import log_audit

            log_audit(created_by, "dataset.mask.auto", "dataset", int(dataset_id),
                      {"applied": applied})
        except Exception:
            pass
    return applied


__all__ = ["RULES", "detect", "auto_mask_dataset"]
