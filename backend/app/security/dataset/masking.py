"""列级脱敏 —— 查询结果的最后一道工序.

放在 security 包里的原因：
    语义查询、SQL 面板、导出三条链路都要用同一套规则，
    否则「这个入口脱敏了、那个入口没有」就是数据泄漏。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

MASK_FUNCS = {
    "phone": lambda v: str(v)[:3] + "****" + str(v)[-4:] if v and len(str(v)) >= 11 else "***",
    "id_card": lambda v: str(v)[:4] + "**********" + str(v)[-4:] if v and len(str(v)) >= 18 else "***",
    "email": lambda v: str(v).split("@")[0][:2] + "***@" + str(v).split("@")[-1] if v and "@" in str(v) else "***",
    "custom": lambda v, p: p.replace("{val}", str(v)) if p else "***",
}


def mask_rules(db: Session, table: str) -> list[tuple]:
    """读取某张表的脱敏规则（列名 / 类型 / 模板）."""
    try:
        return db.execute(
            text(
                "SELECT column_name, mask_type, mask_pattern "
                "FROM bi_column_masks WHERE table_name = :t"
            ),
            {"t": table},
        ).fetchall()
    except Exception:
        # 规则表缺失不应阻断查询
        return []


def apply_masks(table: str, rows: list[dict], db: Session) -> list[dict]:
    """对查询结果按 bi_column_masks 自动脱敏（原地修改并返回）."""
    rules = mask_rules(db, table)
    if not rules:
        return rows

    for col, mtype, pattern in rules:
        fn = MASK_FUNCS.get(mtype)
        if not fn:
            continue
        for row in rows:
            if col in row and row[col] is not None:
                row[col] = fn(row[col]) if mtype != "custom" else fn(row[col], pattern)
    return rows


__all__ = ["apply_masks", "mask_rules", "MASK_FUNCS"]
