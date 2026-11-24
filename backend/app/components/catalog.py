"""图表类型目录 —— 对标「创建新图表」的分类体系.

分类按**图表类型**划分（不是业务域）：
    指标 / 表格 / 分布 / 时间序列 / 占比 / 排名 / 词频 / 矩阵 / 关系

每个条目带 defaults：新建时据此自动生成 spec（即「案例字段」的默认填充）。
"""

from __future__ import annotations

# 分类 = 图表类型家族；名称与卡片上的类型标签保持一致（指标卡 / 明细表 / 词云 / 热力矩阵）
CATEGORIES: list[str] = [
    "指标卡", "明细表", "分布", "时间序列", "占比", "排名", "组合", "词云", "热力矩阵", "关系",
    "页面模块", "内容",
]


def _binding(**kwargs) -> dict:
    base = {
        "dataset_id": None, "dimension": None, "metric": None, "metrics": [],
        "agg": "SUM", "top_n": 10, "sort": "desc", "series": None,
        "split": None, "limit": 500,
    }
    base.update(kwargs)
    return base


def _compute(**kwargs) -> dict:
    base = {"headline": "first", "hint": "none", "format": "int",
            "bucket_size": None, "bucket_start": None, "bucket_count": 0}
    base.update(kwargs)
    return base


def _spec(title: str, *, dim=None, metric=None, agg="SUM", sort="desc", top_n=10,
          headline="first", hint="none", fmt="int", unit="", accent="indigo",
          height=260, series=None, split=None, bucket=None, bucket_count=0,
          bucket_start=None, metrics=None) -> dict:
    return {
        "title": title,
        "subtitle": "",
        "unit": unit,
        "ui": {"accent": accent, "radius": 14, "min_height": height,
               "show_unit": True, "animate": True, "align": "left", "columns": 1},
        "binding": _binding(dimension=dim, metric=metric, agg=agg, sort=sort,
                            top_n=top_n, series=series, split=split,
                            metrics=metrics or []),
        "compute": _compute(headline=headline, hint=hint, format=fmt,
                            bucket_size=bucket, bucket_start=bucket_start,
                            bucket_count=bucket_count),
    }


# id, kind, 名称, 分类, 说明, 默认 spec
CHART_CATALOG: list[dict] = [
    # ── 指标 ──
    {"id": "kpi.value", "kind": "kpi", "label": "数字", "category": "指标",
     "desc": "单个聚合值",
     "defaults": _spec("指标", metric="日销量", agg="SUM", headline="first", fmt="int", height=104)},
    {"id": "kpi.top", "kind": "kpi", "label": "榜首数字", "category": "指标",
     "desc": "最大值 + 前N合计",
     "defaults": _spec("榜首", dim="商品标题", metric="日销量", headline="first",
                       hint="sum_topn", fmt="int", height=104)},
    {"id": "kpi.rank", "kind": "kpi", "label": "最佳名次", "category": "指标",
     "desc": "最小值 + 前N计数",
     "defaults": _spec("名次", dim="商品标题", metric="榜单排名", agg="MIN", sort="asc",
                       headline="min", hint="count_topn", fmt="int", height=104, accent="teal")},
    {"id": "kpi.latest", "kind": "kpi", "label": "最新日期", "category": "指标",
     "desc": "时间维度取最新",
     "defaults": _spec("最新", dim="上架时间", headline="latest", fmt="date",
                       height=104, accent="sky")},

    # ── 表格 ──
    {"id": "table.detail", "kind": "table", "label": "明细表", "category": "表格",
     "desc": "维度 + 多指标",
     "defaults": _spec("明细", dim="商品标题", metric="日销量",
                       metrics=[{"name": "热销指数", "agg": "MAX"},
                                {"name": "霸榜天数", "agg": "MAX"},
                                {"name": "榜单排名", "agg": "MIN"}],
                       top_n=10, height=320, accent="slate")},

    # ── 分布 ──
    {"id": "bar.dim", "kind": "bar", "label": "柱状图", "category": "分布",
     "desc": "按维度聚合",
     "defaults": _spec("柱状", dim="价格带", metric="日销量", agg="SUM", height=260, accent="indigo")},
    {"id": "bar.bucket", "kind": "bar", "label": "分档直方图", "category": "分布",
     "desc": "数值按区间分档",
     "defaults": _spec("分布", dim="商品标题", metric="榜单排名", agg="MIN",
                       bucket=10, bucket_start=1, bucket_count=6, height=260, accent="teal")},

    # ── 时间序列 ──
    {"id": "line.time", "kind": "line", "label": "折线图", "category": "时间序列",
     "desc": "按时间粒度串联",
     "defaults": _spec("趋势", dim="上架时间", metric="日销量", agg="SUM", height=260, accent="sky")},
    {"id": "area.time", "kind": "area", "label": "面积图", "category": "时间序列",
     "desc": "累积规模",
     "defaults": _spec("面积", dim="上架时间", metric="日销量", agg="SUM", height=260, accent="violet")},

    # ── 占比 ──
    {"id": "pie.share", "kind": "pie", "label": "饼图", "category": "占比",
     "desc": "构成占比",
     "defaults": _spec("占比", dim="价格带", metric="日销量", agg="SUM", top_n=6, height=260, accent="amber")},
    {"id": "donut.share", "kind": "donut", "label": "环形图", "category": "占比",
     "desc": "带总量中心的环形",
     "defaults": _spec("构成", dim="平台", metric="日销量", agg="SUM", top_n=6, height=260, accent="rose")},

    # ── 排名 ──
    {"id": "hbar.top", "kind": "hbar", "label": "排行条形", "category": "排名",
     "desc": "TOP N 横向排行",
     "defaults": _spec("排行", dim="品牌", metric="日销量", agg="SUM", top_n=10, height=300, accent="indigo")},

    # ── 词频 ──
    {"id": "word.cloud", "kind": "wordcloud", "label": "词云", "category": "词频",
     "desc": "标签按权重",
     "defaults": _spec("词云", dim="卖点", metric="SKU数", agg="COUNT", split="/",
                       top_n=30, height=280, accent="sky")},

    # ── 矩阵 ──
    {"id": "heat.matrix", "kind": "heatmap", "label": "热力矩阵", "category": "矩阵",
     "desc": "二维交叉分布",
     "defaults": _spec("矩阵", dim="平台", series="价格带", metric="日销量", agg="SUM",
                       height=280, accent="amber")},

    # ── 关系 ──
    {"id": "scatter.rel", "kind": "scatter", "label": "散点图", "category": "关系",
     "desc": "两个指标的相关性",
     "defaults": _spec("关联", dim="商品标题", metric="日销量",
                       metrics=[{"name": "均价", "agg": "AVG"}], height=280, accent="violet")},

    # ── 组合 ──
    {"id": "combo.mix", "kind": "combo", "label": "柱线组合", "category": "组合",
     "desc": "柱看体量 + 线看质量",
     "defaults": {**_spec("组合", dim="价格带", metric="日销量", agg="AVG",
                          metrics=[{"name": "热销指数", "agg": "AVG"}], height=300, accent="sky"),
                  "combo": {"bar_name": "平均日销量", "line_name": "平均热销指数"}}},

    # ── 排名：榜卡 / 推荐列表 ──
    {"id": "rank.list", "kind": "rank_list", "label": "排行列表", "category": "排名",
     "desc": "TOP N + 分值 + 标签",
     "defaults": {**_spec("排行", dim="商品标题", metric="日销量", top_n=10, height=340, accent="indigo"),
                  "rank": {"order": "value", "max_items": 10}}},
    {"id": "reco.list", "kind": "reco_list", "label": "推荐列表", "category": "排名",
     "desc": "机会分排序 + 点开看详情",
     "defaults": {**_spec("推荐", dim="产品标题", metric="日销量", agg="AVG", top_n=10,
                          height=360, accent="indigo"),
                  "reco": {}}},

    # ── 页面模块：分节 / 筛选 ──
    {"id": "filter.bar", "kind": "filter", "label": "筛选栏", "category": "页面模块",
     "desc": "下拉 / 分段 / 多选 / 搜索",
     "defaults": {**_spec("筛选栏", height=76, accent="indigo"),
                  "filter": {"fields": [
                      # 平台 = 分套依据（split）：切平台各看一套内容
                      {"id": "platform", "label": "平台", "type": "select", "default": "拼多多",
                       "options": [{"v": "天猫", "t": "天猫"}, {"v": "拼多多", "t": "拼多多"}],
                       "multiple": False, "placeholder": "", "width": 0, "note": "", "split": True},
                      {"id": "keyword", "label": "搜索", "type": "search",
                       "default": "", "placeholder": "搜索", "width": 200},
                  ]}}},

    # ── 内容：结论 ──
    {"id": "insight.notes", "kind": "insight", "label": "结论卡", "category": "内容",
     "desc": "键值结论列表",
     "defaults": {**_spec("结论", height=220, accent="amber"),
                  "content": {"items": [{"k": "结论", "v": "在编辑器里写这条结论"}]}}},
]


def catalog() -> dict:
    """返回给前端的目录：分类 + 每类下的图表."""
    return {"categories": CATEGORIES, "charts": CHART_CATALOG}


def find(entry_id: str) -> dict | None:
    return next((c for c in CHART_CATALOG if c["id"] == entry_id), None)


__all__ = ["CATEGORIES", "CHART_CATALOG", "catalog", "find"]
