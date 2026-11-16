"""把「市场部BI看板模板」榜单端 CSV 导入 bi_rank_board.

用法：
    cd backend && ./.venv/bin/python -m scripts.import_rank_board
    RANK_TEMPLATE_DIR=/path/to/template ./.venv/bin/python -m scripts.import_rank_board --dry-run

设计：
    * 幂等：按 link_id upsert，重复跑不会产生脏数据
    * 只读模板文件，不修改模板
    * 平台归属由文件决定（拼多多真实 / 拼多多模拟 / 天猫模拟）
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402

from app.database import SessionLocal  # noqa: E402

DEFAULT_TEMPLATE = os.environ.get(
    "RANK_TEMPLATE_DIR",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "市场部BI看板模板",
    ),
)

SOURCES = [
    ("模拟数据/榜单端-拼多多/榜单端-拼多多-2026.11.06.csv", "拼多多", True),
    ("模拟数据/榜单端-拼多多_模拟/榜单端-拼多多-模拟-2026.11.06.csv", "拼多多", False),
    ("模拟数据/榜单端-天猫_模拟/榜单端-天猫-模拟-2026.11.06.csv", "天猫", False),
]


def _int(value, default: int = 0) -> int:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return int(digits) if digits else default


def _num(value):
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _date(value):
    raw = str(value or "").strip()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def read_rows(template_dir: str) -> list[dict]:
    """读取三份 CSV，返回待入库行."""
    rows: list[dict] = []
    for rel_path, platform, is_real in SOURCES:
        path = os.path.join(template_dir, rel_path)
        if not os.path.exists(path):
            print(f"[skip] 找不到 {rel_path}")
            continue
        with io.open(path, encoding="utf-8-sig") as fh:
            for raw in csv.DictReader(fh):
                link_id = str(raw.get("链接id") or "").strip()
                if not link_id:
                    continue
                rows.append({
                    "link_id": link_id,
                    "title": (raw.get("产品标题") or "").strip(),
                    "platform": platform,
                    "brand": (raw.get("品牌") or "").strip(),
                    "category": (raw.get("种类") or "").strip(),
                    "board": (raw.get("榜单") or "").strip(),
                    "listed_date": _date(raw.get("上架时间")),
                    "band": (raw.get("价格带") or "").strip(),
                    "price": _num(raw.get("均价")),
                    "sales": _int(raw.get("日销量")),
                    "sales_raw": (raw.get("日销量") or "").strip(),
                    "rank": _int(raw.get("榜单排名")),
                    "heat": _int(raw.get("热销指数")),
                    "days_on_board": _int(raw.get("霸榜天数")),
                    "days_listed": _int(raw.get("上架天数")),
                    "neg": _int(raw.get("差评数")),
                    "url": (raw.get("链接") or "").strip(),
                    "main_sell": (raw.get("主卖点") or "").strip(),
                    "sub_sell": (raw.get("副卖点") or "").strip(),
                    "pain": (raw.get("痛点") or "").strip(),
                    "is_real": is_real,
                    "source_file": rel_path,
                })
    return rows


UPSERT = """
INSERT INTO bi_rank_board
    (link_id, title, platform, brand, category, board, listed_date, band, price,
     sales, sales_raw, rank, heat, days_on_board, days_listed, neg, url,
     main_sell, sub_sell, pain, is_real, source_file, updated_at)
VALUES
    (:link_id, :title, :platform, :brand, :category, :board, :listed_date, :band, :price,
     :sales, :sales_raw, :rank, :heat, :days_on_board, :days_listed, :neg, :url,
     :main_sell, :sub_sell, :pain, :is_real, :source_file, now())
ON CONFLICT (link_id) DO UPDATE SET
    title = EXCLUDED.title,
    platform = EXCLUDED.platform,
    brand = EXCLUDED.brand,
    category = EXCLUDED.category,
    board = EXCLUDED.board,
    listed_date = EXCLUDED.listed_date,
    band = EXCLUDED.band,
    price = EXCLUDED.price,
    sales = EXCLUDED.sales,
    sales_raw = EXCLUDED.sales_raw,
    rank = EXCLUDED.rank,
    heat = EXCLUDED.heat,
    days_on_board = EXCLUDED.days_on_board,
    days_listed = EXCLUDED.days_listed,
    neg = EXCLUDED.neg,
    url = EXCLUDED.url,
    main_sell = EXCLUDED.main_sell,
    sub_sell = EXCLUDED.sub_sell,
    pain = EXCLUDED.pain,
    is_real = EXCLUDED.is_real,
    source_file = EXCLUDED.source_file,
    updated_at = now()
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", default=DEFAULT_TEMPLATE, help="模板根目录")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    rows = read_rows(args.dir)
    if not rows:
        print(f"[error] 未读到数据，检查目录：{args.dir}")
        return 1

    real = sum(1 for r in rows if r["is_real"])
    print(f"[read] {len(rows)} 条（真实 {real} / 模拟 {len(rows) - real}）")

    if args.dry_run:
        print("[dry-run] 不写库。样例：", rows[0]["link_id"], rows[0]["platform"], rows[0]["sales"])
        return 0

    db = SessionLocal()
    try:
        for row in rows:
            db.execute(text(UPSERT), row)
        db.commit()
        total = db.execute(text("SELECT count(*) FROM bi_rank_board")).scalar()
        by_platform = db.execute(text(
            "SELECT platform, count(*) FROM bi_rank_board GROUP BY platform ORDER BY 1"
        )).fetchall()
        print(f"[done] 库中合计 {total} 条：" + "，".join(f"{p} {n}" for p, n in by_platform))
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
