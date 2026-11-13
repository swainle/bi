"""内置组件 + 榜单端语义数据集（幂等种子）.

为什么种子要写代码而不是 SQL：
    组件 spec 是 JSON，语义字段还要经过校验；代码化才能保证「改一次、全环境一致」。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.components.repository import upsert_builtin
from app.semantic import repository as semantic_repo

DATASET_NAME = "榜单端·SKU"
DATASET_TABLE = "bi_rank_board"

FIELDS = [
    # (语义名, 物理列, 角色, 类型, 默认粒度)
    ("商品标题", "title", "dimension", "text", None),
    ("平台", "platform", "dimension", "text", None),
    ("品牌", "brand", "dimension", "text", None),
    ("品类", "category", "dimension", "text", None),
    ("榜单", "board", "dimension", "text", None),
    ("价格带", "band", "dimension", "text", None),
    ("卖点", "main_sell", "dimension", "text", None),
    ("主卖点", "main_sell", "dimension", "text", None),
    ("副卖点", "sub_sell", "dimension", "text", None),
    ("搜索文本", "search_text", "dimension", "text", None),
    ("链接ID", "link_id", "dimension", "text", None),
    ("痛点", "pain", "dimension", "text", None),
    ("上架时间", "listed_date", "time", "date", None),
    ("均价", "price", "measure", "numeric", None),
    ("日销量", "sales", "measure", "integer", None),
    ("榜单排名", "rank", "measure", "integer", None),
    ("热销指数", "heat", "measure", "integer", None),
    ("霸榜天数", "days_on_board", "measure", "integer", None),
    ("上架天数", "days_listed", "measure", "integer", None),
    ("差评数", "neg", "measure", "integer", None),
]

RANK_FILTERS = [
    {"column": "平台", "op": "=", "valueFrom": "param:platform"},
    {"column": "品类", "op": "=", "valueFrom": "param:category"},
    {"column": "榜单", "op": "=", "valueFrom": "param:board"},
    {"column": "价格带", "op": "=", "valueFrom": "param:band"},
    {"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:q"},
]

METRICS = [
    ("SKU数", "COUNT(*)", "number"),
    ("总销量", "SUM(sales)", "number"),
    ("平均销量", "AVG(sales)", "number"),
]


def ensure_dataset(db: Session) -> int:
    """确保榜单端语义数据集存在，返回 dataset_id."""
    existing = next((d for d in semantic_repo.list_datasets(db) if d.name == DATASET_NAME), None)
    if existing is None:
        existing = semantic_repo.create_dataset(
            db, name=DATASET_NAME, physical_table=DATASET_TABLE,
            owner_id=None, description="榜单端：拼多多 / 天猫 SKU 榜单快照",
        )

    have_fields = {f.name for f in semantic_repo.list_fields(db, existing.id)}
    for name, column, role, dtype, grain in FIELDS:
        if name in have_fields:
            continue
        try:
            semantic_repo.add_field(
                db, existing, name=name, source_column=column,
                role=role, data_type=dtype, default_grain=grain,
            )
        except Exception as exc:  # 字段已存在 / 列缺失都不该阻断其它字段
            print(f"[seed] 字段 {name} 跳过：{exc}")

    have_metrics = {m.name for m in semantic_repo.list_metrics(db, existing.id)}
    for name, expression, fmt in METRICS:
        if name in have_metrics:
            continue
        try:
            semantic_repo.add_metric(db, existing, name=name, expression=expression, fmt=fmt)
        except Exception as exc:
            print(f"[seed] 指标 {name} 跳过：{exc}")
    return existing.id


def _spec(title, *, dim=None, metric=None, agg="SUM", sort="desc", top_n=10,
          headline="first", hint="none", fmt="int", unit="", subtitle="",
          accent="indigo", bucket=None, bucket_start=None, bucket_count=0,
          series=None, split=None, metrics=None, min_height=96):
    binding = {
        "dimension": dim, "metric": metric, "agg": agg, "sort": sort,
        "top_n": top_n, "series": series, "split": split,
        "metrics": metrics or [],
    }
    compute = {
        "headline": headline, "hint": hint, "format": fmt,
        "bucket_size": bucket, "bucket_start": bucket_start, "bucket_count": bucket_count,
    }
    ui = {"accent": accent, "min_height": min_height, "radius": 14}
    return {"title": title, "subtitle": subtitle, "unit": unit,
            "ui": ui, "binding": binding, "compute": compute}


BUILTINS = [
    # ── 榜单端 6 张维度卡（KPI）──
    ("rank.sales", "日销量", "kpi", "指标卡", "榜单端·SKU", "榜首日销 + 前十合计",
     {"title": "日销量", "subtitle": "", "unit": "单",
      "ui": {"accent": "indigo", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "商品标题", "metric": "日销量", "agg": "SUM", "top_n": 10},
      "compute": {"headline": "first", "hint": "sum_topn", "format": "int"}}),

    ("rank.heat", "热销指数", "kpi", "指标卡", "榜单端·SKU", "最高指数 + 前十平均",
     {"title": "热销指数", "subtitle": "", "unit": "",
      "ui": {"accent": "amber", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "商品标题", "metric": "热销指数", "agg": "MAX", "top_n": 10},
      "compute": {"headline": "max", "hint": "avg_topn", "format": "int"}}),

    ("rank.rank", "榜单排名", "kpi", "指标卡", "榜单端·SKU", "最好名次 + 前十 SKU 数",
     {"title": "榜单排名", "subtitle": "", "unit": "名",
      "ui": {"accent": "teal", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "商品标题", "metric": "榜单排名", "agg": "MIN", "sort": "asc", "top_n": 10},
      "compute": {"headline": "min", "hint": "count_topn", "format": "int"}}),

    ("rank.days", "霸榜天数", "kpi", "指标卡", "榜单端·SKU", "最长天数 + 前十平均",
     {"title": "霸榜天数", "subtitle": "", "unit": "天",
      "ui": {"accent": "violet", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "商品标题", "metric": "霸榜天数", "agg": "MAX", "top_n": 10},
      "compute": {"headline": "max", "hint": "avg_topn", "format": "int"}}),

    ("rank.band", "价格带", "kpi", "指标卡", "榜单端·SKU", "销量最高的价格带",
     {"title": "价格带", "subtitle": "", "unit": "",
      "ui": {"accent": "rose", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "价格带", "metric": "日销量", "agg": "SUM", "top_n": 6},
      "compute": {"headline": "mode", "hint": "none", "format": "text"}}),

    ("rank.listed", "上架时间", "kpi", "指标卡", "榜单端·SKU", "最新上架日期",
     {"title": "上架时间", "subtitle": "", "unit": "",
      "ui": {"accent": "sky", "min_height": 104, "badge": "TOP10"},
      "binding": {"dimension": "上架时间", "top_n": 1},
      "compute": {"headline": "latest", "hint": "none", "format": "date"}}),

    # ── 图表卡（bar / heatmap / wordcloud / table）──
    ("rank.rank-bucket", "榜单排名分段", "bar", "分布", "榜单端·SKU", "SKU 数量按名次分段",
     {"title": "榜单排名分段", "subtitle": "SKU 数量分布",
      "ui": {"accent": "indigo", "min_height": 260},
      "binding": {"dimension": "商品标题", "metric": "榜单排名", "agg": "MIN", "top_n": 40},
      "compute": {"headline": "first", "format": "int",
                  "bucket_size": 10, "bucket_start": 1, "bucket_count": 6}}),

    ("rank.days-bucket", "霸榜时长分布", "bar", "分布", "榜单端·SKU", "SKU 数量按在榜天数分档",
     {"title": "霸榜时长分布", "subtitle": "SKU 数量",
      "ui": {"accent": "violet", "min_height": 260},
      "binding": {"dimension": "商品标题", "metric": "霸榜天数", "agg": "MAX", "top_n": 60},
      "compute": {"headline": "first", "format": "int",
                  "bucket_size": 30, "bucket_start": 0, "bucket_count": 10}}),

    ("rank.band-sales", "价格带销量分布", "bar", "分布", "榜单端·SKU", "各价格带销量合计",
     {"title": "价格带销量", "subtitle": "单位：单",
      "ui": {"accent": "teal", "min_height": 260},
      "binding": {"dimension": "价格带", "metric": "日销量", "agg": "SUM", "top_n": 8},
      "compute": {"headline": "first", "format": "int"}}),

    ("rank.platform-band", "平台 × 价格带", "heatmap", "热力矩阵", "榜单端·SKU", "销量矩阵",
     {"title": "平台 × 价格带", "subtitle": "颜色越深销量越集中",
      "ui": {"accent": "amber", "min_height": 280},
      "binding": {"dimension": "平台", "series": "价格带", "metric": "日销量", "agg": "SUM", "top_n": 40},
      "compute": {"headline": "first", "format": "int"}}),

    ("rank.sell-cloud", "卖点云", "wordcloud", "词云", "榜单端·SKU", "主卖点词频",
     {"title": "卖点云", "subtitle": "按 SKU 数加权",
      "ui": {"accent": "sky", "min_height": 280},
      "binding": {"dimension": "主卖点", "metric": "SKU数", "agg": "COUNT", "split": "/", "top_n": 30},
      "compute": {"headline": "first", "format": "int"}}),

    ("rank.pain-cloud", "痛点云", "wordcloud", "词云", "榜单端·SKU", "差评痛点词频",
     {"title": "痛点云", "subtitle": "按 SKU 数加权",
      "ui": {"accent": "rose", "min_height": 280},
      "binding": {"dimension": "痛点", "metric": "SKU数", "agg": "COUNT", "split": "/", "top_n": 30},
      "compute": {"headline": "first", "format": "int"}}),

    ("rank.brand-top", "品牌 TOP10", "bar", "排名", "榜单端·SKU", "品牌销量合计",
     {"title": "品牌 TOP10", "subtitle": "按销量",
      "ui": {"accent": "indigo", "min_height": 260},
      "binding": {"dimension": "品牌", "metric": "日销量", "agg": "SUM", "top_n": 10},
      "compute": {"headline": "first", "format": "int"}}),

    ("rank.detail", "榜单明细", "table", "明细表", "榜单端·SKU", "TOP10 明细",
     {"title": "榜单明细", "subtitle": "前 10 条",
      "ui": {"accent": "slate", "min_height": 320},
      "binding": {"dimension": "商品标题", "metric": "日销量", "agg": "SUM",
                  "metrics": [{"name": "热销指数", "agg": "MAX"},
                              {"name": "霸榜天数", "agg": "MAX"},
                              {"name": "榜单排名", "agg": "MIN"}], "top_n": 10},
      "compute": {"headline": "first", "format": "int"}}),
]


def ensure_builtins(db: Session, dataset_id: int) -> int:
    """写入内置组件（幂等），返回写入数量."""
    count = 0
    for code, name, kind, category, _ds, description, spec in BUILTINS:
        spec = dict(spec)
        spec["binding"] = dict(spec["binding"], dataset_id=dataset_id, filters=RANK_FILTERS)
        if kind == "kpi":
            spec["ui"] = {**(spec.get("ui") or {}), "animate": False}
        spec.setdefault("layout", {"x": 40, "y": 40, "w": 420, "h": 260})
        upsert_builtin(db, code=code, name=name, kind=kind, spec=spec,
                       category=category, description=description)
        count += 1
    return count


def ensure_all(db: Session | None = None) -> dict:
    """启动时调用：建数据集 + 写内置组件 + 需求端数据集."""
    from app.components import seed_demand
    from app.database import SessionLocal

    owns = db is None
    db = db or SessionLocal()
    try:
        dataset_id = ensure_dataset(db)
        count = ensure_builtins(db, dataset_id)
        demand: dict[str, int] = {}
        if seed_demand.table_ready(db):
            demand = seed_demand.ensure_datasets(db)
        return {"dataset_id": dataset_id, "components": count, "demand_datasets": demand}
    finally:
        if owns:
            db.close()


def table_ready(db: Session) -> bool:
    row = db.execute(text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name='bi_component'"
    )).fetchone()
    return row is not None


__all__ = ["ensure_all", "ensure_dataset", "ensure_builtins", "DATASET_NAME", "BUILTINS"]
