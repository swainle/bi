"""需求端（天猫生意参谋）语义数据集 —— 4 个数据集 + 字段 + 指标（幂等）.

为什么 4 个而不是 1 个：
    人气 / 增速 / 相关 三张导出表的字段不同、可用筛选也不同，
    分开登记才能让组件只看到「自己那张表」的合法字段；
    汇总页需要「按词去重合并」，所以第 4 个数据集指向合并视图。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.semantic import repository as semantic_repo

DATASETS = {
    "hot": ("需求端·天猫·人气", "bi_demand_hot", "天猫生意参谋 · 搜索词（搜索人气） · 2026-10-08~10-14"),
    "grow": ("需求端·天猫·增速", "bi_demand_grow", "天猫生意参谋 · 搜索词（搜索增速） · 2026-10-08~10-14"),
    "rel": ("需求端·天猫·相关", "bi_demand_rel", "天猫生意参谋 · 搜索分析（相关分析·环比） · 2026-09-15~10-14"),
    "merged": ("需求端·天猫·汇总", "bi_demand_merged", "三表按词去重合并 · 来源标记 人气/增速/相关"),
    "overview": ("需求端·天猫·构成", "bi_demand_overview", "三张表的规模统计 + 去重合计"),
}

# (语义名, 物理列, 角色, 类型)
_COMMON_WORD = [
    ("搜索词", "word", "dimension", "text"),
    ("搜索文本", "word", "dimension", "text"),
]

FIELDS = {
    "hot": _COMMON_WORD + [
        ("排名", "rank_no", "measure", "integer"),
        ("分类路径", "class_path", "dimension", "text"),
        ("分类一级", "cls_l1", "dimension", "text"),
        ("分类二级", "cls_l2", "dimension", "text"),
        ("分类三级", "cls_l3", "dimension", "text"),
        ("搜索人气", "v", "measure", "numeric"),
        ("人气区间", "v_text", "dimension", "text"),
        ("点击率", "ctr", "measure", "numeric"),
        ("支付转化率", "cvr", "measure", "numeric"),
        ("转化区间", "cvr_text", "dimension", "text"),
        ("统计周期", "period_start", "time", "date"),
    ],
    "grow": _COMMON_WORD + [
        ("排名", "rank_no", "measure", "integer"),
        ("分类路径", "class_path", "dimension", "text"),
        ("分类一级", "cls_l1", "dimension", "text"),
        ("分类二级", "cls_l2", "dimension", "text"),
        ("分类三级", "cls_l3", "dimension", "text"),
        ("搜索增速", "g", "measure", "numeric"),
        ("搜索人气", "v", "measure", "numeric"),
        ("人气区间", "v_text", "dimension", "text"),
        ("点击率", "ctr", "measure", "numeric"),
        ("支付转化率", "cvr", "measure", "numeric"),
        ("转化区间", "cvr_text", "dimension", "text"),
        ("统计周期", "period_start", "time", "date"),
    ],
    "rel": _COMMON_WORD + [
        ("搜索人气", "v", "measure", "numeric"),
        ("人气区间", "v_text", "dimension", "text"),
        ("点击率", "ctr", "measure", "numeric"),
        ("支付转化率", "cvr", "measure", "numeric"),
        ("转化区间", "cvr_text", "dimension", "text"),
        ("支付买家数", "buy", "measure", "numeric"),
        ("买家区间", "buy_text", "dimension", "text"),
        ("需求供给比", "ds", "measure", "numeric"),
        ("天猫点击占比", "tm", "measure", "numeric"),
        ("统计周期", "period_start", "time", "date"),
    ],
    "overview": [
        ("数据源", "source_name", "dimension", "text"),
        ("词数", "words", "measure", "integer"),
        ("覆盖人气", "v_sum", "measure", "numeric"),
        ("万词数", "big_words", "measure", "integer"),
    ],
    "merged": [
        ("搜索词", "word", "dimension", "text"),
        ("搜索文本", "search_text", "dimension", "text"),
        ("来源", "sources", "dimension", "text"),
        ("搜索人气", "v", "measure", "numeric"),
        ("点击率", "ctr", "measure", "numeric"),
        ("支付转化率", "cvr", "measure", "numeric"),
        ("搜索增速", "g", "measure", "numeric"),
        ("需求供给比", "ds", "measure", "numeric"),
        ("支付买家数", "buy", "measure", "numeric"),
        ("天猫点击占比", "tm", "measure", "numeric"),
    ],
}

METRICS = {
    "hot": [("词数", "COUNT(*)", "number"), ("人气合计", "SUM(v)", "number"),
            ("平均点击率", "AVG(ctr)", "number"), ("平均转化率", "AVG(cvr)", "number"),
            ("最高人气", "MAX(v)", "number")],
    "grow": [("词数", "COUNT(*)", "number"), ("人气合计", "SUM(v)", "number"),
             ("平均增速", "AVG(g)", "number"), ("最高增速", "MAX(g)", "number"),
             ("翻倍词数", "COUNT(*) FILTER (WHERE g >= 100)", "number")],
    "rel": [("词数", "COUNT(*)", "number"), ("人气合计", "SUM(v)", "number"),
            ("平均点击率", "AVG(ctr)", "number"),
            ("平均转化率", "AVG(cvr)", "number"), ("最高需求供给比", "MAX(ds)", "number"),
            ("买家合计", "SUM(buy)", "number"), ("高缺口词数", "COUNT(*) FILTER (WHERE ds >= 3)", "number")],
    "overview": [],
    "merged": [("词数", "COUNT(*)", "number"), ("人气合计", "SUM(v)", "number"),
               ("平均点击率", "AVG(ctr)", "number"), ("平均转化率", "AVG(cvr)", "number"),
               ("最高需求供给比", "MAX(ds)", "number"), ("买家合计", "SUM(buy)", "number"),
               ("最高增速", "MAX(g)", "number")],
}


def ensure_datasets(db: Session) -> dict[str, int]:
    existing = {d.name: d for d in semantic_repo.list_datasets(db)}
    out: dict[str, int] = {}
    for key, (name, table, desc) in DATASETS.items():
        dataset = existing.get(name)
        if dataset is None:
            dataset = semantic_repo.create_dataset(
                db, name=name, physical_table=table, owner_id=None, description=desc
            )

        have_fields = {f.name for f in semantic_repo.list_fields(db, dataset.id)}
        for fname, column, role, dtype in FIELDS[key]:
            if fname in have_fields:
                continue
            try:
                semantic_repo.add_field(
                    db, dataset, name=fname, source_column=column,
                    role=role, data_type=dtype,
                    is_filterable=True,
                    is_groupable=role in ("dimension", "time"),
                )
            except Exception as exc:  # 字段已存在 / 列缺失都不该阻断其它字段
                print(f"[seed-demand] 字段 {fname} 跳过：{exc}")

        have_metrics = {m.name for m in semantic_repo.list_metrics(db, dataset.id)}
        for mname, expression, fmt in METRICS[key]:
            if mname in have_metrics:
                continue
            try:
                semantic_repo.add_metric(db, dataset, name=mname, expression=expression, fmt=fmt)
            except Exception as exc:
                print(f"[seed-demand] 指标 {mname} 跳过：{exc}")
        out[key] = dataset.id
    return out


def table_ready(db: Session) -> bool:
    row = db.execute(text(
        "SELECT 1 FROM information_schema.views "
        "WHERE table_schema='public' AND table_name='bi_demand_merged'"
    )).fetchone()
    return row is not None


__all__ = ["DATASETS", "FIELDS", "METRICS", "ensure_datasets", "table_ready"]
