"""演示数据 —— 专门给「组件库 / 卡片」看效果用的一张独立小表.

为什么单独建：
    · 组件库缩略图、新建卡片的默认预览都需要「有数」才好看；
    · 但不能拿真实业务数据（榜单端 / 需求端）去当演示，也不能让演示卡默认绑定业务数据集。

数据来源（2026-11-13 起）：
    · 源文件是用户整理的「测试数据2026.11.13.csv」（已脱敏：平台A/B/C、品牌A~N、省份铺满 31 省），
      抄了一份进仓库 `data/demo_sku.csv`，一条一条照搬，不再靠生成器随机造数；
    · 180 行，上架时间铺满最近 3 个月（2026-08-04 ~ 2026-11-03）；
    · 字段名与「榜单端」真实数据集对齐（平台 / 品牌 / 种类 / 榜单 / 均价 / 日销量 / 日销量档位…），
      演示卡换绑真实数据时不用改绑定。

约束：
    · 表名固定 `bi_demo_sku`，幂等（表结构对不上就重建、行数/产品 id 指纹对不上就重刷），可反复跑；
    · 改数据只要换 `data/demo_sku.csv`，字段顺序与 role 都在 COLUMNS 里声明；
    · 只做 SELECT 演示，不参与任何业务口径。
"""

from __future__ import annotations

import csv
import hashlib
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.semantic import repository as semantic_repo

DATASET_NAME = "测试-01"          # 2026-11-13 用户要求：内置这份演示数据叫「测试-01」
LEGACY_NAMES = ("测试数据集",)      # 老名字：换名后靠 TABLE 认，不靠 name
TABLE = "bi_demo_sku"
DATA_FILE = Path(__file__).with_name("data") / "demo_sku.csv"

# (字段名, 物理列名, role, data_type, CSV 表头, 取值方式)
#   role: dimension / time / measure / id（id = 标识类，可筛选、不进分组聚合）
#   取值方式：text = 原样；int = 去掉「+」按整数存；raw = 原样（档位文本）
COLUMNS: list[tuple[str, str, str, str, str, str]] = [
    ("产品id", "product_id", "id", "text", "产品id", "text"),
    ("产品标题", "title", "dimension", "text", "产品标题", "text"),
    ("平台", "platform", "dimension", "text", "平台", "text"),
    ("品牌", "brand", "dimension", "text", "品牌", "text"),
    ("种类", "category", "dimension", "text", "种类", "text"),
    ("榜单", "board", "dimension", "text", "榜单", "text"),
    ("上架时间", "listed_at", "time", "date", "上架时间", "text"),
    ("价格带", "price_band", "dimension", "text", "价格带", "text"),
    ("均价", "price_avg", "measure", "numeric", "均价", "text"),
    ("日销量", "sales_lower", "measure", "integer", "日销量", "int"),
    ("日销量档位", "sales_tier", "dimension", "text", "日销量", "raw"),
    ("榜单排名", "board_rank", "dimension", "integer", "榜单排名", "text"),
    ("热销指数", "heat_score", "measure", "integer", "热销指数", "text"),
    ("霸榜天数", "top_days", "measure", "integer", "霸榜天数", "text"),
    ("上架天数", "listed_days", "measure", "integer", "上架天数", "text"),
    ("差评数", "bad_review_cnt", "measure", "integer", "差评数", "text"),
    ("链接", "url", "id", "text", "链接", "text"),
    ("主卖点", "main_selling_point", "dimension", "text", "主卖点", "text"),
    ("副卖点", "sub_selling_point", "dimension", "text", "副卖点", "text"),
    ("痛点", "pain_point", "dimension", "text", "痛点", "text"),
    ("sku name_id", "sku_name_id", "id", "text", "sku name_id", "text"),
    ("差评_id", "review_id", "id", "text", "差评_id", "text"),
    ("主图_id", "main_image_id", "id", "text", "主图_id", "text"),
    ("sku_id", "sku_id", "id", "text", "sku_id", "text"),
    ("详情图_id", "detail_image_id", "id", "text", "详情图_id", "text"),
    ("省份", "province", "dimension", "text", "省份", "text"),
]

SQL_TYPE = {"text": "text", "integer": "integer", "numeric": "numeric(10,2)", "date": "date"}


def _load_rows() -> list[dict]:
    """读仓库里的 CSV → 行字典（key = CSV 表头）."""
    with DATA_FILE.open(encoding="utf-8-sig", newline="") as fh:
        return [r for r in csv.DictReader(fh) if (r.get("产品id") or "").strip()]


def _csv_digest() -> str:
    """整份 CSV 的内容指纹：任何一格改了（比如上架时间重排）都要能触发重刷."""
    return hashlib.sha1(DATA_FILE.read_bytes()).hexdigest()


def _table_columns(db: Session) -> set[str]:
    rows = db.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :t AND table_schema = current_schema()"
        ),
        {"t": TABLE},
    ).fetchall()
    return {r[0] for r in rows}


META_TABLE = "bi_demo_meta"
META_KEY = f"{TABLE}_csv_sha1"


def _stored_digest(db: Session) -> str | None:
    try:
        return db.execute(
            text(f"SELECT value FROM {META_TABLE} WHERE key = :k"), {"k": META_KEY}
        ).scalar()
    except Exception:          # 迁移还没跑 / 表不存在：当成没记录，走一次重刷
        db.rollback()
        return None


def _remember_digest(db: Session, digest: str) -> None:
    db.execute(text(
        f"INSERT INTO {META_TABLE} (key, value) VALUES (:k, :v) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
    ), {"k": META_KEY, "v": digest})
    db.commit()


def _value(raw: dict, header: str, mode: str):
    value = (raw.get(header) or "").strip()
    if mode == "int":
        try:
            return int(value.replace("+", "") or 0)
        except ValueError:
            return 0
    return value or None


def ensure_demo_dataset(db: Session, force: bool = False) -> int:
    """确保演示表 + 语义数据集存在，返回 dataset_id（幂等；force=True 时整表重刷）."""
    rows = _load_rows()
    wanted_cols = {col for _n, col, _r, _t, _h, _m in COLUMNS}

    # ① 表结构对不上（老版是 16 列另一套列名）→ 拆了重建；演示表只读、不承载业务，重建无风险
    existing_cols = _table_columns(db)
    if existing_cols and existing_cols != wanted_cols:
        db.execute(text(f"DROP TABLE IF EXISTS {TABLE}"))
        db.commit()
        existing_cols = set()

    if not existing_cols:
        ddl = ", ".join(f"{col} {SQL_TYPE[dtype]}" for _n, col, _r, dtype, _h, _m in COLUMNS)
        db.execute(text(f"CREATE TABLE IF NOT EXISTS {TABLE} ({ddl})"))
        db.commit()

    # ② 行数 / 产品 id 指纹对不上 → 整表重刷
    count = db.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar() or 0
    digest = _csv_digest()
    if force or count != len(rows) or _stored_digest(db) != digest:
        payload = [
            {col: _value(raw, header, mode) for _n, col, _r, _t, header, mode in COLUMNS}
            for raw in rows
        ]
        db.execute(text(f"TRUNCATE {TABLE}"))
        db.execute(text(
            f"INSERT INTO {TABLE} ({', '.join(c for _n, c, _r, _t, _h, _m in COLUMNS)}) VALUES ("
            + ", ".join(f"CAST(:{c} AS {SQL_TYPE[t]})" for _n, c, _r, t, _h, _m in COLUMNS) + ")"
        ), payload)
        db.commit()
        _remember_digest(db, digest)

    # ③ 语义数据集 + 字段（字段名 = CSV 表头，顺序与 COLUMNS 一致）
    # 认这行数据集一律按物理表（`bi_demo_sku`）：名字是用户可以变的，按名字认会在改名后凭空多建一份
    dataset = next((d for d in semantic_repo.list_datasets(db) if d.physical_table == TABLE), None)
    if dataset is None:
        dataset = next((d for d in semantic_repo.list_datasets(db) if d.name == DATASET_NAME), None)
    if dataset is None:
        dataset = semantic_repo.create_dataset(
            db, name=DATASET_NAME, physical_table=TABLE, owner_id=None,
            description="组件库 / 卡片预览专用的模拟数据（跟随项目，公共数据，仅管理员可删）",
        )
    elif dataset.name in LEGACY_NAMES:
        # 老环境里还叫「测试数据集」：就地换成新名字（rename_dataset 在 SQL 层面只写 name 一列）
        try:
            dataset = semantic_repo.rename_dataset(db, dataset.id, DATASET_NAME)
        except Exception as exc:
            print(f"[demo] 改名跳过：{exc}")

    # 字段集合和 COLUMNS 对不上（换了一版 CSV / 老版字段名）→ 整组按 CSV 顺序重建；
    # 对得上就一个字都不动（用户在「测试数据集」里改过的字段名 / 角色要保住）。
    existing_fields = semantic_repo.list_fields(db, dataset.id)
    if {f.source_column for f in existing_fields} != wanted_cols:
        for field in existing_fields:
            semantic_repo.delete_field(db, dataset.id, field.id)
        for name, col, role, dtype, _header, _mode in COLUMNS:
            try:
                field = semantic_repo.add_field(db, dataset, name=name, source_column=col,
                                                role=role, data_type=dtype, validate=False)
            except Exception as exc:  # 列缺失 / 重名都不该阻断启动
                print(f"[demo] 字段 {name} 跳过：{exc}")
                continue
            # add_field 会把「名字=源列名」的字段自动翻成中文别名（sku_id → SKU_ID）；
            # 演示数据集要求字段名与 CSV 表头一致，这里按表头纠回来。
            if field is not None and field.name != name:
                semantic_repo.update_field(db, dataset, field.id, {"name": name})
    return dataset.id


__all__ = ["ensure_demo_dataset", "DATASET_NAME", "TABLE"]
