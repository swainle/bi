"""把「市场部BI看板模板」需求端（天猫生意参谋）的 3 个 xlsx 导入.

用法：
    cd backend && ./.venv/bin/python -m scripts.import_demand
    DEMAND_TEMPLATE_DIR=/path/to/template ./.venv/bin/python -m scripts.import_demand --dry-run

设计：
    * 幂等：按 (word, period_start, period_end) upsert
    * 只读模板文件，不修改模板
    * 清洗口径集中在这里（区间取中值 / 百分数换算 / 分类拆层），
      语义层与组件只认清洗后的列 —— 口径只有一处实现
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_TEMPLATE = os.environ.get(
    "DEMAND_TEMPLATE_DIR", os.path.join(REPO_ROOT, "市场部BI看板模板")
)
DEMAND_DIR = os.path.join(DEFAULT_TEMPLATE, "模拟数据", "需求端", "天猫")

_HOT = "搜索排行_搜索词_搜索人气_2026-10-08~2026-10-14_宠物_宠物食品及用品_猫零食_猫冻干零食.xlsx"
_GROW = "搜索排行_搜索词_搜索增速_2026-10-08~2026-10-14_宠物_宠物食品及用品_猫零食_猫冻干零食.xlsx"
_REL = "搜索排行_搜索分析_相关分析_环比_猫冻干_2026-09-15~2026-10-14.xlsx"

_UNIT = {"万": 10000.0, "千": 1000.0, "w": 10000.0, "k": 1000.0}


def _side(raw: str) -> float | None:
    text_value = str(raw or "").strip().replace(",", "")
    if not text_value:
        return None
    pct = text_value.endswith("%")
    if pct:
        text_value = text_value[:-1].strip()
    mult = 1.0
    if text_value and text_value[-1] in _UNIT:
        mult = _UNIT[text_value[-1]]
        text_value = text_value[:-1]
    try:
        return float(text_value) * mult
    except ValueError:
        return None


def mid_of(raw) -> float | None:
    """区间文案 → 中值：'4万 ~ 8万' → 60000；'30% ~ 35%' → 32.5；单值原样返回."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    text_value = str(raw).strip()
    if not text_value:
        return None
    parts = re.split(r"\s*[~～]\s*", text_value)
    if len(parts) == 1:
        return _side(parts[0])
    lo, hi = _side(parts[0]), _side(parts[-1])
    if lo is None or hi is None:
        return lo if hi is None else hi
    return round((lo + hi) / 2, 4)


def period_of(raw) -> tuple[date | None, date | None]:
    text_value = str(raw or "").strip()
    found = re.findall(r"\d{4}-\d{2}-\d{2}", text_value)
    if len(found) >= 2:
        return date.fromisoformat(found[0]), date.fromisoformat(found[-1])
    if len(found) == 1:
        return date.fromisoformat(found[0]), date.fromisoformat(found[0])
    return None, None


def class_of(raw) -> tuple[str, str, str, str]:
    """' 宠物/宠物食品及用品 > 猫零食 > 猫冻干零食' → 路径 + 三层."""
    text_value = re.sub(r"\s*>\s*", " > ", str(raw or "").strip())
    segs = [s.strip() for s in text_value.split(">") if s.strip()]
    path = " > ".join(segs)
    l1 = segs[0] if len(segs) > 0 else ""
    l2 = segs[1] if len(segs) > 1 else ""
    l3 = segs[2] if len(segs) > 2 else ""
    return path, l1, l2, l3


def _rows(path: str, sheet: str = "") -> list[dict]:
    import openpyxl  # 延迟导入：只有导入时才需要

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb[sheet] if sheet else wb[wb.sheetnames[0]]
    it = ws.iter_rows(values_only=True)
    head = [str(c or "").strip() for c in next(it)]
    out = []
    for row in it:
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        out.append({head[i]: row[i] for i in range(min(len(head), len(row)))})
    wb.close()
    return out


def load_hot() -> list[dict]:
    out = []
    for raw in _rows(os.path.join(DEMAND_DIR, _HOT)):
        start, end = period_of(raw.get("日期"))
        path, l1, l2, l3 = class_of(raw.get("分类名称"))
        out.append({
            "word": str(raw.get("搜索词") or "").strip(),
            "rank_no": int(raw.get("排名") or 0),
            "class_path": path, "cls_l1": l1, "cls_l2": l2, "cls_l3": l3,
            "v": mid_of(raw.get("搜索人气")),
            "v_text": str(raw.get("搜索人气") or "").strip(),
            "ctr": float(raw.get("点击率") or 0),
            "cvr": mid_of(raw.get("支付转化率")),
            "cvr_text": str(raw.get("支付转化率") or "").strip(),
            "period_start": start, "period_end": end,
            "source_file": _HOT,
        })
    return out


def load_grow() -> list[dict]:
    out = []
    for raw in _rows(os.path.join(DEMAND_DIR, _GROW)):
        start, end = period_of(raw.get("日期"))
        path, l1, l2, l3 = class_of(raw.get("分类名称"))
        ratio = raw.get("搜索增速")
        out.append({
            "word": str(raw.get("搜索词") or "").strip(),
            "rank_no": int(raw.get("排名") or 0),
            "class_path": path, "cls_l1": l1, "cls_l2": l2, "cls_l3": l3,
            "g": round(float(ratio) * 100, 1) if ratio is not None else None,
            "v": mid_of(raw.get("搜索人气")),
            "v_text": str(raw.get("搜索人气") or "").strip(),
            "ctr": float(raw.get("点击率") or 0),
            "cvr": mid_of(raw.get("支付转化率")),
            "cvr_text": str(raw.get("支付转化率") or "").strip(),
            "period_start": start, "period_end": end,
            "source_file": _GROW,
        })
    return out


def load_rel() -> list[dict]:
    out = []
    for raw in _rows(os.path.join(DEMAND_DIR, _REL)):
        start, end = period_of(raw.get("日期"))
        out.append({
            "word": str(raw.get("相关搜索词") or "").strip(),
            "v": mid_of(raw.get("搜索人气")),
            "v_text": str(raw.get("搜索人气") or "").strip(),
            "ctr": float(raw.get("点击率") or 0),
            "cvr": mid_of(raw.get("支付转化率")),
            "cvr_text": str(raw.get("支付转化率") or "").strip(),
            "buy": mid_of(raw.get("支付买家数")),
            "buy_text": str(raw.get("支付买家数") or "").strip(),
            "ds": float(raw.get("需求供给比") or 0),
            "tm": float(raw.get("天猫商品点击占比") or 0),
            "period_start": start, "period_end": end,
            "source_file": _REL,
        })
    return out


UPSERT = {
    "bi_demand_hot": """
        INSERT INTO bi_demand_hot
            (word, rank_no, class_path, cls_l1, cls_l2, cls_l3, v, v_text, ctr, cvr, cvr_text,
             period_start, period_end, source_file, updated_at)
        VALUES
            (:word, :rank_no, :class_path, :cls_l1, :cls_l2, :cls_l3, :v, :v_text, :ctr, :cvr, :cvr_text,
             :period_start, :period_end, :source_file, now())
        ON CONFLICT (word, period_start, period_end) DO UPDATE SET
            rank_no = EXCLUDED.rank_no, class_path = EXCLUDED.class_path,
            cls_l1 = EXCLUDED.cls_l1, cls_l2 = EXCLUDED.cls_l2, cls_l3 = EXCLUDED.cls_l3,
            v = EXCLUDED.v, v_text = EXCLUDED.v_text, ctr = EXCLUDED.ctr,
            cvr = EXCLUDED.cvr, cvr_text = EXCLUDED.cvr_text,
            source_file = EXCLUDED.source_file, updated_at = now()
    """,
    "bi_demand_grow": """
        INSERT INTO bi_demand_grow
            (word, rank_no, class_path, cls_l1, cls_l2, cls_l3, g, v, v_text, ctr, cvr, cvr_text,
             period_start, period_end, source_file, updated_at)
        VALUES
            (:word, :rank_no, :class_path, :cls_l1, :cls_l2, :cls_l3, :g, :v, :v_text, :ctr, :cvr, :cvr_text,
             :period_start, :period_end, :source_file, now())
        ON CONFLICT (word, period_start, period_end) DO UPDATE SET
            rank_no = EXCLUDED.rank_no, class_path = EXCLUDED.class_path,
            cls_l1 = EXCLUDED.cls_l1, cls_l2 = EXCLUDED.cls_l2, cls_l3 = EXCLUDED.cls_l3,
            g = EXCLUDED.g, v = EXCLUDED.v, v_text = EXCLUDED.v_text, ctr = EXCLUDED.ctr,
            cvr = EXCLUDED.cvr, cvr_text = EXCLUDED.cvr_text,
            source_file = EXCLUDED.source_file, updated_at = now()
    """,
    "bi_demand_rel": """
        INSERT INTO bi_demand_rel
            (word, v, v_text, ctr, cvr, cvr_text, buy, buy_text, ds, tm,
             period_start, period_end, source_file, updated_at)
        VALUES
            (:word, :v, :v_text, :ctr, :cvr, :cvr_text, :buy, :buy_text, :ds, :tm,
             :period_start, :period_end, :source_file, now())
        ON CONFLICT (word, period_start, period_end) DO UPDATE SET
            v = EXCLUDED.v, v_text = EXCLUDED.v_text, ctr = EXCLUDED.ctr,
            cvr = EXCLUDED.cvr, cvr_text = EXCLUDED.cvr_text,
            buy = EXCLUDED.buy, buy_text = EXCLUDED.buy_text, ds = EXCLUDED.ds, tm = EXCLUDED.tm,
            source_file = EXCLUDED.source_file, updated_at = now()
    """,
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    batches = {
        "bi_demand_hot": load_hot(),
        "bi_demand_grow": load_grow(),
        "bi_demand_rel": load_rel(),
    }
    for table, rows in batches.items():
        print(f"[read] {table}: {len(rows)} 行")
        if rows:
            print("       首行:", {k: rows[0][k] for k in list(rows[0])[:6]})

    if args.dry_run:
        return 0

    db = SessionLocal()
    try:
        for table, rows in batches.items():
            for row in rows:
                db.execute(text(UPSERT[table]), row)
            db.commit()
            total = db.execute(text(f"SELECT count(*) FROM {table}")).scalar()
            print(f"[write] {table}: {len(rows)} 行 upsert，表内 {total} 行")

        merged = db.execute(text("SELECT count(*) FROM bi_demand_merged")).scalar()
        print(f"[view]  bi_demand_merged: {merged} 个去重词")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
