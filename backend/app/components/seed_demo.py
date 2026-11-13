"""演示数据 —— 专门给「组件库 / 卡片」看效果用的一张独立小表.

为什么单独建：
    · 组件库缩略图、新建卡片的默认预览都需要「有数」才好看；
    · 但不能拿真实业务数据（榜单端 / 需求端）去当演示，也不能让演示卡默认绑定业务数据集。

约束：
    · 表名固定 `bi_demo_sku`，幂等（表不在才建、行数不对才补），可反复跑；
    · 数据是确定性生成的（不靠随机数种子漂移），每次环境一致；
    · 只做 SELECT 演示，不参与任何业务口径。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.semantic import repository as semantic_repo

DATASET_NAME = "测试数据集"
TABLE = "bi_demo_sku"

PLATFORMS = ["拼多多", "天猫"]
CATEGORIES = ["猫咪零食", "狗狗零食", "猫粮", "狗粮", "猫砂", "宠物玩具"]
BRANDS = ["麦斯蒂", "麦富迪", "网易严选", "疯狂小狗", "迪格宠物", "萌维兔", "贪吃猫", "顽皮"]
BOARDS = ["品牌猫零食畅销榜", "猫零食畅销榜", "狗零食畅销榜", "兔粮热销榜", "猫条人气榜", "冻干零食好评榜", "宠物玩具热销榜"]
BANDS = ["<20元", "20-40元", "40-60元", "60-80元", "≥80元"]
# 省份：与地图 GeoJSON 的名称一致（广东省…），循环取用；广东 / 浙江 / 江苏权重更高，地图上更像真实生意
PROVINCES = [
    "广东省", "广东省", "广东省", "广东省",
    "浙江省", "浙江省", "浙江省",
    "江苏省", "江苏省", "江苏省",
    "上海市", "上海市", "北京市", "北京市",
    "福建省", "山东省", "四川省", "河南省", "湖北省", "安徽省",
]
TITLES = [
    "猫条零食鱼油益生元调理肠胃罐头猫粮成幼猫营养增肥补水湿粮包",
    "高汤鲜肉猫罐头猫零食猫主食罐营养增肥补水不掉毛猫咪成幼猫湿粮",
    "2罐麦富迪每日洁齿猫零食幼猫通用夹心饼干冻干磨牙棒三文鱼鸡肉",
    "网易严选宠物零食大礼包猫条猫薄荷饼干罐头冻干",
    "猫零食狗狗猫咪零食冻干鸡肉粒宠物鸡胸肉桶装混合全家桶营养增肥",
    "冻干鸡胸肉粒独立小包装发腮无谷高蛋白宠物零食营养增肥",
    "猫条零食发腮锁鲜成幼猫通用猫粮补水独立小包装湿粮包调理肠胃",
    "磨牙棒耐咀嚼宠物零食成幼犬洁齿独立小包装狗狗零食清新口气",
    "兔肉干宠物零食营养独立小包装成幼犬通用低敏耐咀嚼易消化",
    "冻干猫咪零食鸡肉粒整粒鸡胸肉拌粮猫粮伴侣增肥发腮",
    "猫砂豆腐砂除臭结团低尘膨润土混合猫砂大包装",
    "宠物玩具耐咬磨牙发声球狗玩具互动漏食球泰迪金毛",
]
FIELDS = [
    ("商品标题", "title", "dimension", "text"),
    ("平台", "platform", "dimension", "text"),
    ("品牌", "brand", "dimension", "text"),
    ("品类", "category", "dimension", "text"),
    ("省份", "province", "dimension", "text"),
    ("榜单", "board", "dimension", "text"),
    ("价格带", "band", "dimension", "text"),
    ("上架时间", "listed_at", "time", "date"),
    ("搜索文本", "search_text", "dimension", "text"),
    ("日销量", "sales", "measure", "integer"),
    ("热销指数", "heat_index", "measure", "integer"),
    ("均价", "avg_price", "measure", "numeric"),
    ("差评数", "bad_reviews", "measure", "integer"),
    ("霸榜天数", "top_days", "measure", "integer"),
    ("销量增速", "growth", "measure", "numeric"),
    ("链接ID", "link_id", "id", "text"),
]

ROW_COUNT = 240


def _rows() -> list[dict]:
    """生成带真实相关性的演示数据（固定种子，环境间一致）.

    刻意做出三组关系，方便散点图验证「科学不科学」：
        · 均价 ↑ → 日销量 ↓        （负相关）
        · 热销指数 ↑ → 日销量 ↑    （强正相关）
        · 差评数 ↔ 日销量          （弱相关，噪声为主）
        · 霸榜天数 / 销量增速      （基本无关，用来对照「无相关」）
    """
    import random

    rng = random.Random(20261111)
    rows: list[dict] = []
    for i in range(ROW_COUNT):
        price = round(12 + rng.random() * 88, 1)          # 均价 12~100 元
        # 价格越高，期望销量越低（线性 + 噪声）
        expect = 1500 * (1 - (price - 12) / 88 * 0.78)
        sales = max(20, int(expect * (0.72 + rng.random() * 0.56)))
        heat = int(sales * (1.5 + rng.random() * 0.6))     # 与销量强相关
        bad = int(sales * (0.015 + rng.random() * 0.05))   # 弱相关
        days = int(rng.random() * 400)                     # 与销量无关
        growth = round(rng.random() * 2.6, 2)              # 与销量无关
        month = 1 + i % 12
        year = 2025 + (1 if month <= 6 else 0)
        # 商品标题补序号 → 每个 SKU 唯一，散点才是一行一个点（不是按标题聚合）
        rows.append({
            "title": f"{TITLES[i % len(TITLES)]}·{i + 1:03d}",
            "platform": PLATFORMS[i % len(PLATFORMS)],
            "brand": BRANDS[i % len(BRANDS)],
            "category": CATEGORIES[i % len(CATEGORIES)],
            "province": PROVINCES[i % len(PROVINCES)],
            "board": BOARDS[i % len(BOARDS)],
            "band": BANDS[min(4, int((price - 12) // 17.6))],
            "listed_at": f"{year}-{month:02d}-{(i % 27) + 1:02d}",
            "search_text": f"{TITLES[i % len(TITLES)]} {BRANDS[i % len(BRANDS)]} {BOARDS[i % len(BOARDS)]}",
            "sales": sales,
            "heat_index": heat,
            "avg_price": price,
            "bad_reviews": bad,
            "top_days": days,
            "growth": growth,
            "link_id": f"DEMO{i:06d}",
        })
    return rows


def ensure_demo_dataset(db: Session, force: bool = False) -> int:
    """确保演示表 + 语义数据集存在，返回 dataset_id（幂等；force=True 时整表重刷）."""
    db.execute(text(f"""
        CREATE TABLE IF NOT EXISTS {TABLE} (
            title        text,
            platform     text,
            brand        text,
            category     text,
            province     text,
            board        text,
            band         text,
            listed_at    date,
            search_text  text,
            sales        integer,
            heat_index   integer,
            avg_price    numeric(10,1),
            bad_reviews  integer,
            top_days     integer,
            growth       numeric(6,2),
            link_id      text
        )
    """))
    # 老环境：表已存在时 CREATE IF NOT EXISTS 不会加列，这里补「省份」
    db.execute(text(f"ALTER TABLE {TABLE} ADD COLUMN IF NOT EXISTS province text"))
    db.commit()

    missing = db.execute(text(f"SELECT count(*) FROM {TABLE} WHERE province IS NULL")).scalar() or 0
    if missing:
        links = [row[0] for row in db.execute(
            text(f"SELECT link_id FROM {TABLE} ORDER BY link_id")
        ).fetchall()]
        for index, link_id in enumerate(links):
            db.execute(
                text(f"UPDATE {TABLE} SET province = :province WHERE link_id = :link_id"),
                {"province": PROVINCES[index % len(PROVINCES)], "link_id": link_id},
            )
        db.commit()

    count = db.execute(text(f"SELECT count(*) FROM {TABLE}")).scalar() or 0
    if force or count < ROW_COUNT:
        db.execute(text(f"TRUNCATE {TABLE}"))
        rows = _rows()
        db.execute(text(f"""
            INSERT INTO {TABLE} (title, platform, brand, category, province, board, band, listed_at,
                                 search_text, sales, heat_index, avg_price, bad_reviews,
                                 top_days, growth, link_id)
            VALUES (:title, :platform, :brand, :category, :province, :board, :band, CAST(:listed_at AS date),
                    :search_text, :sales, :heat_index, :avg_price, :bad_reviews,
                    :top_days, :growth, :link_id)
        """), rows)
        db.commit()

    existing = next((d for d in semantic_repo.list_datasets(db) if d.name == DATASET_NAME), None)
    if existing is None:
        existing = semantic_repo.create_dataset(
            db, name=DATASET_NAME, physical_table=TABLE, owner_id=None,
            description="组件库 / 卡片预览专用的模拟数据（跟随项目，公共数据，仅管理员可删）",
        )
    have = {f.name for f in semantic_repo.list_fields(db, existing.id)}
    for name, column, role, dtype in FIELDS:
        if name in have:
            continue
        try:
            semantic_repo.add_field(db, existing, name=name, source_column=column,
                                    role=role, data_type=dtype)
        except Exception as exc:  # 列缺失 / 重复都不该阻断
            print(f"[demo] 字段 {name} 跳过：{exc}")
    return existing.id


__all__ = ["ensure_demo_dataset", "DATASET_NAME", "TABLE"]
