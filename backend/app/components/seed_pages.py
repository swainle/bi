"""业务页种子 —— 榜单端 / 需求端-天猫 的全部组件 + 两个看板文档.

为什么单独一个模块：
    seed.py 负责「数据集 + 基础图表」，这里负责「业务卡片」与「页面组装」。
    页面上的每一块都必须是组件库里的一个组件（component code），
    看板文档只存引用 + 布局 + 动作 —— 不允许内联一次性块。
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.components.repository import upsert_builtin
from app.dashboards.models import validate_doc
from app.dashboards.repository import ensure_seed

PLAT_LABEL = {"pdd": "拼多多", "tmall": "天猫", "jd": "京东", "douyin": "抖音"}


# ────────────────────────── 小工具 ──────────────────────────

def _distinct(db: Session, table: str, column: str, limit: int = 30) -> list[str]:
    try:
        rows = db.execute(text(
            f'SELECT DISTINCT "{column}" FROM "{table}" '
            f'WHERE "{column}" IS NOT NULL AND "{column}" <> \'\' '
            f'ORDER BY 1 LIMIT :n'
        ), {"n": limit}).fetchall()
        return [str(r[0]) for r in rows]
    except Exception:
        return []


def _spec(title: str, *, subtitle: str = "", unit: str = "", accent: str = "indigo",
          height: int = 260, badge: str = "", binding: dict | None = None,
          compute: dict | None = None, chart: dict | None = None, **extra) -> dict:
    spec = {
        "title": title,
        "subtitle": subtitle,
        "unit": unit,
        "ui": {"accent": accent, "min_height": height, "badge": badge},
        "binding": binding or {},
        "compute": compute or {},
        "chart": chart or {},
    }
    for key in ("filter", "content", "rank", "combo", "table_view"):
        if extra.get(key):
            spec[key] = extra[key]
    return spec


def _binding(ds: int, *, dim: str | None = None, metric: str | None = None, agg: str = "SUM",
             sort: str = "desc", top_n: int = 10, metrics: list | None = None,
             filters: list | None = None, split: str | None = None,
             dimensions: list | None = None, limit: int = 500) -> dict:
    return {
        "dataset_id": ds, "dimension": dim, "metric": metric, "agg": agg,
        "sort": sort, "top_n": top_n, "metrics": metrics or [], "split": split,
        "dimensions": dimensions or [], "filters": filters or [], "limit": limit,
    }


def _compute(headline: str = "first", hint: str = "none", fmt: str = "int",
             decimals: int = 0, prefix: str = "", suffix: str = "") -> dict:
    return {"headline": headline, "hint": hint, "format": fmt,
            "decimals": decimals, "prefix": prefix, "suffix": suffix}


def _put(db: Session, code: str, name: str, kind: str, category: str,
         description: str, spec: dict) -> None:
    if kind == "kpi":  # KPI 不做滚动动画：模板是静态数字，截图也不抖
        spec["ui"] = {**(spec.get("ui") or {}), "animate": False}
    upsert_builtin(db, code=code, name=name, kind=kind, spec=spec,
                   category=category, description=description)


def _section(db: Session, code: str, title: str, note: str, index: str,
             icon: str, category: str) -> None:
    _put(db, code, f"{index}、{title}", "section", category, note,
         _spec(f"{index}、{title}", subtitle=note, height=56,
               content={"index": index, "icon": icon}))


# ────────────────────────── 榜单端 ──────────────────────────

def seed_rank(db: Session, ds: int) -> None:
    cat = "榜单端"
    filters = [
        {"column": "平台", "op": "=", "valueFrom": "param:platform"},
        {"column": "品类", "op": "=", "valueFrom": "param:category"},
        {"column": "榜单", "op": "=", "valueFrom": "param:board"},
        {"column": "价格带", "op": "=", "valueFrom": "param:band"},
        {"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:q"},
    ]

    # 筛选栏：字段 = 看板参数
    platforms = _distinct(db, "bi_rank_board", "platform")
    default_platform = "拼多多" if "拼多多" in platforms else (platforms[0] if platforms else "拼多多")
    _put(db, "rank.filter", "筛选栏", "filter", cat, "平台 / 品类 / 榜单 / 价格带 / 搜索",
         _spec("筛选栏", height=76, filter={"fields": [
             {"id": "platform", "label": "平台", "type": "select", "default": default_platform,
              "options": [{"v": p, "t": PLAT_LABEL.get(p, p)} for p in platforms] or
                         [{"v": "pdd", "t": "拼多多"}]},
             {"id": "category", "label": "品类", "type": "select", "default": "all",
              "options": [{"v": "all", "t": "全部品类"}] +
                         [{"v": v, "t": v} for v in _distinct(db, "bi_rank_board", "category", 12)]},
             {"id": "board", "label": "榜单", "type": "select", "default": "all",
              "options": [{"v": "all", "t": "全部榜单"}] +
                         [{"v": v, "t": v} for v in _distinct(db, "bi_rank_board", "board", 12)]},
             {"id": "band", "label": "价格带", "type": "select", "default": "all",
              "options": [{"v": "all", "t": "全部价格带"}] +
                         [{"v": v, "t": v} for v in _distinct(db, "bi_rank_board", "band", 12)]},
             {"id": "q", "label": "搜索", "type": "search", "default": "",
              "placeholder": "标题 / 品牌 / 榜单", "width": 210},
         ]}))

    # Hero 统计（页面头的三个数字）
    _put(db, "rank.stat.count", "在榜 SKU 数", "kpi", "榜单端·统计", "筛选后的 SKU 数",
         _spec("在榜", height=104, accent="indigo",
               binding=_binding(ds, metric="SKU数", top_n=1, filters=filters),
               compute=_compute("first", "none", "int")))
    _put(db, "rank.stat.brands", "竞品品牌数", "kpi", "榜单端·统计", "去重品牌数",
         _spec("品牌", height=104, accent="teal",
               binding=_binding(ds, metric="品牌", agg="COUNT_DISTINCT", top_n=1, filters=filters),
               compute=_compute("first", "none", "int")))
    _put(db, "rank.stat.cats", "覆盖品类数", "kpi", "榜单端·统计", "去重品类数",
         _spec("品类", height=104, accent="violet",
               binding=_binding(ds, metric="品类", agg="COUNT_DISTINCT", top_n=1, filters=filters),
               compute=_compute("first", "none", "int")))

    # 分节
    _section(db, "rank.sec.overview", "榜单概况", "当前平台 · 六维指标", "一", "grid", cat)
    _section(db, "rank.sec.structure", "榜单结构", "品类 / 品牌 / 价格带", "二", "pie", cat)
    _section(db, "rank.sec.detail", "榜单明细", "按日销量排序 · 可搜可看全部", "三", "table", cat)
    _section(db, "rank.sec.pain", "差评云", "痛点词频 · 按 SKU 数加权", "四", "cloud", cat)
    _section(db, "rank.sec.sell", "卖点云", "主卖点 / 副卖点", "五", "tag", cat)

    # 结构三图
    _put(db, "rank.cat-share", "品类销量占比", "pie", cat, "热卖品类构成",
         _spec("热卖品类", subtitle="按日销量", height=300, accent="amber",
               chart={"label_layout": "outside", "pie_label": "name_pct" if False else "name_pct"},
               binding=_binding(ds, dim="品类", metric="日销量", top_n=6, filters=filters),
               compute=_compute("first", "none", "int")))
    _put(db, "rank.brand-top", "品牌 TOP10", "bar", cat, "品牌销量合计",
         _spec("品牌 TOP10", subtitle="按日销量", height=300, accent="indigo",
               binding=_binding(ds, dim="品牌", metric="日销量", sort="desc", top_n=10, filters=filters),
               compute=_compute("first", "none", "int")))
    _put(db, "rank.band-combo", "价格带 × 日销量", "combo", cat, "柱=平均日销量 · 线=平均热销指数",
         _spec("价格带 × 日销量", subtitle="柱=平均日销量 · 线=平均热销指数", height=300, accent="sky",
               binding={**_binding(ds, dim="价格带", metric="日销量", agg="AVG",
                                   metrics=[{"name": "热销指数", "agg": "AVG"}], top_n=8, filters=filters),
                        "order_by_dimension": True},
               combo={"bar_name": "平均日销量", "line_name": "平均热销指数"}))

    # 明细表（含行内链接ID 供抽屉使用）
    detail_binding = {
        "dataset_id": ds, "dimension": "商品标题", "metric": "日销量", "agg": "SUM",
        "sort": "desc", "top_n": 10, "limit": 500,
        "metrics": [
            {"name": "均价", "agg": "AVG"},
            {"name": "榜单排名", "agg": "MIN"},
            {"name": "热销指数", "agg": "MAX"},
            {"name": "霸榜天数", "agg": "MAX"},
            {"name": "差评数", "agg": "MAX"},
        ],
        "dimensions": ["平台", "品牌", "价格带", "链接ID"],
        "filters": filters,
        # 额外维度：平台 / 品牌 / 价格带 / 链接ID（表格列与行动作都要用）
        "series": None,
    }
    _put(db, "rank.detail", "榜单明细", "table", cat, "13 列明细 · 点击行看详情",
         _spec("榜单明细", subtitle="前 10 条", height=460, accent="slate",
               binding=detail_binding,
               table_view={"page_size": 10, "more": False,
                           "columns": [
                               {"key": "商品标题", "type": "text", "width": 260},
                               {"key": "平台", "type": "badge", "align": "center", "width": 90},
                               {"key": "品牌", "type": "text", "width": 100},
                               {"key": "价格带", "type": "text", "align": "center", "width": 100},
                               {"key": "均价", "type": "money", "align": "right", "width": 90},
                               {"key": "日销量", "type": "number", "align": "right", "width": 100},
                               {"key": "榜单排名", "type": "rank", "align": "center", "width": 100},
                               {"key": "热销指数", "type": "number", "align": "right", "width": 100},
                               {"key": "霸榜天数", "type": "number", "align": "right", "width": 100},
                               {"key": "差评数", "type": "number", "align": "right", "width": 90},
                           ]}))

    # 商品详情（抽屉）：按链接ID 过滤，动作参数注入
    _put(db, "rank.sku.detail", "商品详情", "table", "榜单端·详情", "抽屉里的单商品详情",
         _spec("商品详情", height=420, accent="slate",
               binding={
                   "dataset_id": ds, "dimension": "商品标题", "metric": "日销量", "agg": "SUM",
                   "top_n": 1, "limit": 10,
                   "metrics": [
                       {"name": "均价", "agg": "AVG"},
                       {"name": "榜单排名", "agg": "MIN"},
                       {"name": "热销指数", "agg": "MAX"},
                       {"name": "霸榜天数", "agg": "MAX"},
                       {"name": "差评数", "agg": "MAX"},
                       {"name": "上架天数", "agg": "MAX"},
                   ],
                   "dimensions": ["平台", "链接ID"],
                   "filters": filters + [{"column": "链接ID", "op": "=", "valueFrom": "action:link_id"}],
               },
               table_view={"page_size": 5, "more": False, "columns": [
                   {"key": "商品标题", "type": "text"},
                   {"key": "日销量", "type": "number", "align": "right"},
                   {"key": "均价", "type": "money", "align": "right"},
                   {"key": "榜单排名", "type": "rank", "align": "center"},
                   {"key": "热销指数", "type": "number", "align": "right"},
                   {"key": "霸榜天数", "type": "number", "align": "right"},
                   {"key": "差评数", "type": "number", "align": "right"},
                   {"key": "上架天数", "type": "number", "align": "right"},
               ]}))

    # TOP10（KPI 点击弹窗：同一组件 + 覆盖指标）
    _put(db, "rank.top10", "TOP10 排行", "rank_list", "榜单端·浮层", "按指标看 TOP10（弹窗用）",
         _spec("TOP10", height=520, accent="indigo",
               binding=_binding(ds, dim="商品标题", metric="日销量", top_n=10, limit=200, filters=filters),
               rank={"max_items": 10, "order": "value"}))

    # 词云
    _put(db, "rank.subsell-cloud", "副卖点云", "wordcloud", cat, "副卖点词频",
         _spec("副卖点云", subtitle="按 SKU 数", height=320, accent="teal",
               binding=_binding(ds, dim="副卖点", metric="SKU数", agg="COUNT", split="/",
                                top_n=30, filters=filters),
               compute=_compute("first", "none", "int")))


# ────────────────────────── 需求端 ──────────────────────────

def _demand_filters(ids: dict, *, with_growth: bool = False) -> list[dict]:
    base = [
        {"column": "搜索人气", "op": "BETWEEN", "valueFrom": "param:dv", "ranges": {
            "all": None, "gt8": [80000, 1e12], "4to8": [40000, 80000],
            "1to4": [10000, 40000], "5k1w": [5000, 10000], "lt5k": [0, 5000]}},
        {"column": "点击率", "op": "BETWEEN", "valueFrom": "param:dctr", "ranges": {
            "all": None, "g100": [1.0, 99], "m80": [0.8, 1.0],
            "m50": [0.5, 0.8], "lt50": [0, 0.5]}},
        {"column": "支付转化率", "op": "BETWEEN", "valueFrom": "param:dcv", "ranges": {
            "all": None, "g35": [35, 1000], "m25": [25, 35],
            "m15": [15, 25], "lt15": [0, 15]}},
        {"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:dq"},
    ]
    if with_growth:
        base.append({"column": "搜索增速", "op": "BETWEEN", "valueFrom": "param:dg", "ranges": {
            "all": None, "fast": [100, 1e9], "mid": [50, 100], "slow": [0, 50]}})
    return base


def seed_demand(db: Session, ids: dict) -> None:
    cat = "需求端"

    _put(db, "demand.filter", "筛选栏", "filter", cat, "人气档 / 点击率 / 转化率 / 搜索",
         _spec("筛选栏", height=76, filter={"fields": [
             {"id": "dv", "label": "人气档", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "gt8", "t": ">8万"}, {"v": "4to8", "t": "4万~8万"},
                          {"v": "1to4", "t": "1万~4万"}, {"v": "5k1w", "t": "5千~1万"}, {"v": "lt5k", "t": "<5千"}]},
             {"id": "dctr", "label": "点击率", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "g100", "t": "≥100%"}, {"v": "m80", "t": "80%~100%"},
                          {"v": "m50", "t": "50%~80%"}, {"v": "lt50", "t": "<50%"}]},
             {"id": "dcv", "label": "转化率", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "g35", "t": "≥35%"}, {"v": "m25", "t": "25%~35%"},
                          {"v": "m15", "t": "15%~25%"}, {"v": "lt15", "t": "<15%"}]},
             {"id": "dq", "label": "搜索", "type": "search", "default": "",
              "placeholder": "搜索词", "width": 200},
         ]}))
    _put(db, "demand.filter.grow", "筛选栏（增速）", "filter", cat, "增速档 + 基础筛选",
         _spec("筛选栏", height=76, filter={"fields": [
             {"id": "dv", "label": "人气档", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "4to8", "t": "4万~8万"}, {"v": "1to4", "t": "1万~4万"},
                          {"v": "5k1w", "t": "5千~1万"}, {"v": "lt5k", "t": "<5千"}]},
             {"id": "dg", "label": "增速档", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "fast", "t": "≥100%"}, {"v": "mid", "t": "50%~100%"},
                          {"v": "slow", "t": "<50%"}]},
             {"id": "dcv", "label": "转化率", "type": "segment", "default": "all",
              "options": [{"v": "all", "t": "全部"}, {"v": "g35", "t": "≥35%"}, {"v": "m25", "t": "25%~35%"},
                          {"v": "m15", "t": "15%~25%"}, {"v": "lt15", "t": "<15%"}]},
             {"id": "dq", "label": "搜索", "type": "search", "default": "",
              "placeholder": "搜索词", "width": 200},
         ]}))

    # 汇总页统计
    _put(db, "demand.stat.words", "去重词数", "kpi", "需求端·统计", "三表去重词数",
         _spec("去重词", height=104, accent="indigo",
               binding=_binding(ids["merged"], metric="词数", top_n=1,
                                filters=[{"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:dq"}]),
               compute=_compute("first", "none", "int")))
    _put(db, "demand.stat.scar", "高缺口词数", "kpi", "需求端·统计", "需求供给比 ≥3 的词数",
         _spec("高缺口", height=104, accent="violet",
               binding=_binding(ids["rel"], metric="高缺口词数", top_n=1,
                                filters=[{"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:dq"}]),
               compute=_compute("first", "none", "int")))

    # 分节
    _section(db, "demand.sec.summary.1", "需求总览", "三张表汇总 · 天猫生意参谋", "一", "chart", "需求端·汇总")
    _section(db, "demand.sec.summary.2", "机会分布", "需求 × 供给 · 一张图看蓝海", "二", "grid", "需求端·汇总")
    _section(db, "demand.sec.summary.3", "三张表的构成", "各表规模 · 去重后不重复计算", "三", "table", "需求端·汇总")
    _section(db, "demand.sec.summary.4", "机会词明细", "按机会分排序 · 蓝海优先", "四", "bulb", "需求端·汇总")

    # 汇总 6 卡
    merged = ids["merged"]
    kpi_filters = [{"column": "搜索文本", "op": "ILIKE", "valueFrom": "param:dq"}]
    summary_filters = _demand_filters(ids)   # 人气档 / 点击率 / 转化率 / 搜索，汇总页全生效
    _put(db, "demand.kpi.v", "搜索人气", "kpi", "需求端·汇总", "三表去重人气合计",
         _spec("搜索人气", height=112, accent="indigo",
               binding=_binding(merged, metric="人气合计", top_n=1, filters=summary_filters),
               compute=_compute("first", "none", "w")))
    _put(db, "demand.kpi.g", "搜索增速", "kpi", "需求端·汇总", "最高搜索增速",
         _spec("搜索增速", height=112, accent="teal",
               binding=_binding(merged, dim="搜索词", metric="搜索增速", agg="MAX", top_n=1,
                                filters=summary_filters),
               compute=_compute("max", "top_label", "pct", prefix="+")))
    _put(db, "demand.kpi.ctr", "点击率", "kpi", "需求端·汇总", "三表去重均值",
         _spec("点击率", height=112, accent="violet",
               binding=_binding(merged, metric="平均点击率", top_n=1, filters=summary_filters),
               compute=_compute("first", "none", "pct")))
    _put(db, "demand.kpi.cvr", "支付转化率", "kpi", "需求端·汇总", "三表去重均值",
         _spec("支付转化率", height=112, accent="green",
               binding=_binding(merged, metric="平均转化率", top_n=1, filters=summary_filters),
               compute=_compute("first", "none", "pct")))
    _put(db, "demand.kpi.ds", "需求供给比", "kpi", "需求端·汇总", "最高供需比",
         _spec("需求供给比", height=112, accent="amber",
               binding=_binding(merged, dim="搜索词", metric="需求供给比", agg="MAX", top_n=1,
                                filters=summary_filters),
               compute=_compute("max", "top_label", "int", decimals=1, suffix="×")))
    _put(db, "demand.kpi.buy", "支付买家数", "kpi", "需求端·汇总", "相关词表合计",
         _spec("支付买家数", height=112, accent="rose",
               binding=_binding(merged, metric="买家合计", top_n=1, filters=summary_filters),
               compute=_compute("first", "none", "w")))

    # 机会矩阵
    _put(db, "demand.quadrant", "需求 × 供给矩阵", "scatter", "需求端·汇总", "四象限 · 气泡=转化率",
         _spec("需求 × 供给", subtitle="中位数分割四象限 · 气泡=转化率", height=380, accent="violet",
               binding=_binding(merged, dim="搜索词", metric="搜索人气",
                                metrics=[{"name": "需求供给比", "agg": "MAX"}],
                                top_n=60, limit=2000, filters=summary_filters + [
                                    {"column": "需求供给比", "op": "IS NOT NULL"}]),
               chart={"scatter_mode": "quadrant", "x_key": "搜索人气", "y_key": "需求供给比",
                      "size_key": "支付转化率", "log_x": True, "log_y": True}))
    _put(db, "demand.blue", "蓝海机会 TOP6", "rank_list", "需求端·汇总", "需求≥中位 · 缺口≥中位",
         _spec("蓝海机会 TOP6", subtitle="需求 ≥ 中位 · 缺口 ≥ 中位", height=380, accent="teal",
               binding=_binding(merged, dim="搜索词", metric="搜索人气",
                                metrics=[{"name": "需求供给比", "agg": "MAX"},
                                         {"name": "支付转化率", "agg": "MAX"}],
                                top_n=60, limit=2000,
                                filters=summary_filters + [{"column": "需求供给比", "op": "IS NOT NULL"}]),
               rank={"order": "opportunity", "show_score": True, "show_tags": True,
                     "tags_key": "来源", "x_key": "搜索人气", "y_key": "需求供给比",
                     "cvr_key": "支付转化率", "max_items": 6}))

    # 构成表
    _put(db, "demand.overview", "三张表的构成", "table", "需求端·汇总", "各表规模 + 去重合计",
         _spec("三张表的构成", height=280, accent="slate",
               binding=_binding(ids["overview"], dim="数据源", metric="词数",
                                metrics=[{"name": "覆盖人气", "agg": "SUM"},
                                         {"name": "万词数", "agg": "SUM"}], top_n=10),
               table_view={"page_size": 10, "more": False, "columns": [
                   {"key": "数据源", "type": "text"},
                   {"key": "词数", "type": "number", "align": "right"},
                   {"key": "覆盖人气", "type": "number", "align": "right"},
                   {"key": "万词数", "type": "number", "align": "right"},
               ]}))

    # 汇总结论
    _put(db, "demand.insight.summary", "汇总结论", "insight", "需求端·汇总", "按当前筛选范围计算",
         _spec("汇总结论", height=280, accent="amber",
               binding=_binding(merged, metrics=[{"name": "词数", "agg": "SUM", "fmt": "int"},
                                                 {"name": "人气合计", "agg": "SUM", "fmt": "w"},
                                                 {"name": "最高增速", "agg": "MAX", "fmt": "pct"},
                                                 {"name": "最高需求供给比", "agg": "MAX", "fmt": "x"}],
                                filters=summary_filters),
               content={"items": [
                   {"k": "需求盘子", "v": "三表去重共 {词数} 个搜索词，合计人气 {人气合计}。"},
                   {"k": "增长最快", "v": "最高搜索增速 {最高增速}，是当前最陡的上升词。"},
                   {"k": "首推机会", "v": "最高需求供给比 {最高需求供给比}，供给不足的方向优先做。"},
               ]}))

    # 机会词明细
    _put(db, "demand.opps", "机会词明细", "rank_list", "需求端·汇总", "按机会分排序 · 蓝海优先",
         _spec("机会词明细", subtitle="按机会分排序", height=440, accent="indigo",
               binding=_binding(merged, dim="搜索词", metric="搜索人气",
                                metrics=[{"name": "需求供给比", "agg": "MAX"},
                                         {"name": "支付转化率", "agg": "MAX"}],
                                top_n=60, limit=2000,
                                filters=kpi_filters + [{"column": "需求供给比", "op": "IS NOT NULL"}]),
               rank={"order": "opportunity", "show_rank": True, "show_score": True,
                     "show_tags": True, "tags_key": "来源", "x_key": "搜索人气",
                     "y_key": "需求供给比", "cvr_key": "支付转化率", "max_items": 12}))

    # ── 三个类别视图 ──
    CATEGORY = [
        ("hot", "搜索词（人气）", "hot", "chart", _demand_filters(ids)),
        ("grow", "搜索词（增速）", "grow", "bulb",
         [f for f in _demand_filters(ids, with_growth=True) if f.get("valueFrom") != "param:dctr"]),
        ("rel", "相关搜索词", "rel", "table", _demand_filters(ids)),
    ]

    for key, title, ds_key, icon, filters in CATEGORY:
        ds = ids[ds_key]
        prefix = f"demand.{key}"
        view_cat = f"需求端·{'人气' if key == 'hot' else '增速' if key == 'grow' else '相关'}"
        _section(db, f"{prefix}.sec.1", title, "天猫生意参谋 · 2026-10", "一", icon, view_cat)
        _section(db, f"{prefix}.sec.2", "搜索词明细", "前 10 条 · 可看全部", "二", "table", view_cat)
        _section(db, f"{prefix}.sec.3", "结论", "当前筛选范围", "三", "bulb", view_cat)

        if key == "grow":
            kpis = [
                (f"{prefix}.kpi.1", "平均增速", "平均增速", _compute("first", "none", "pct", prefix="+"),
                 "blue", dict(metric="平均增速", top_n=1)),
                (f"{prefix}.kpi.2", "最高增速", "搜索增速", _compute("max", "top_label", "pct", prefix="+"),
                 "teal", dict(dim="搜索词", metric="搜索增速", agg="MAX", top_n=1)),
                (f"{prefix}.kpi.3", "翻倍词", "增速 ≥100%", _compute("first", "none", "int"),
                 "violet", dict(metric="翻倍词数", top_n=1)),
                (f"{prefix}.kpi.4", "人气", "按区间中值累加", _compute("first", "none", "w"),
                 "green", dict(metric="人气合计", top_n=1)),
            ]
        elif key == "rel":
            kpis = [
                (f"{prefix}.kpi.1", "人气", "按区间中值累加", _compute("first", "none", "w"),
                 "blue", dict(metric="人气合计", top_n=1)),
                (f"{prefix}.kpi.2", "点击率", "命中词均值", _compute("first", "none", "pct"),
                 "violet", dict(metric="平均点击率", top_n=1)),
                (f"{prefix}.kpi.3", "需求供给比", "最高供需比", _compute("max", "top_label", "int", 1, "", "×"),
                 "amber", dict(dim="搜索词", metric="需求供给比", agg="MAX", top_n=1)),
                (f"{prefix}.kpi.4", "转化率", "命中词均值", _compute("first", "none", "pct"),
                 "green", dict(metric="平均转化率", top_n=1)),
            ]
        else:
            kpis = [
                (f"{prefix}.kpi.1", "人气", "按区间中值累加", _compute("first", "none", "w"),
                 "blue", dict(metric="人气合计", top_n=1)),
                (f"{prefix}.kpi.2", "头部词", "人气最高的搜索词", _compute("mode", "none", "text"),
                 "teal", dict(dim="搜索词", metric="搜索人气", agg="MAX", top_n=1)),
                (f"{prefix}.kpi.3", "点击率", "命中词均值", _compute("first", "none", "pct"),
                 "violet", dict(metric="平均点击率", top_n=1)),
                (f"{prefix}.kpi.4", "转化率", "命中词均值", _compute("first", "none", "pct"),
                 "green", dict(metric="平均转化率", top_n=1)),
            ]
        for code, label, desc, compute, accent, binding in kpis:
            _put(db, code, label, "kpi", view_cat, desc,
                 _spec(label, height=112, accent=accent,
                       binding=_binding(ds, filters=filters, **binding), compute=compute))

        # 趋势组合图 / 排行条
        line_metric = {"hot": {"name": "支付转化率", "agg": "AVG"},
                       "grow": {"name": "搜索增速", "agg": "AVG"},
                       "rel": {"name": "需求供给比", "agg": "MAX"}}[key]
        line_name = {"hot": "支付转化率", "grow": "搜索增速", "rel": "需求供给比"}[key]
        _put(db, f"{prefix}.trend", "搜索趋势", "combo", view_cat, "柱=搜索人气 · 线=次要指标",
             _spec("搜索趋势", subtitle=f"柱=搜索人气 · 线={line_name}", height=340, accent="sky",
                   binding=_binding(ds, dim="搜索词", metric="搜索人气", top_n=10, filters=filters,
                                    metrics=[line_metric]),
                   combo={"bar_name": "搜索人气", "line_name": line_name}))

        bar_metric = {"hot": ("搜索人气", "SUM"), "grow": ("搜索增速", "MAX"),
                      "rel": ("需求供给比", "MAX")}[key]
        bar_chart = {}
        if key == "rel":
            bar_chart = {"hbar_threshold_key": "需求供给比", "hbar_threshold_gte": 3,
                         "hbar_highlight": "violet"}
        _put(db, f"{prefix}.bar", f"{bar_metric[0]} TOP10", "hbar", view_cat, "横向排行",
             _spec(f"{bar_metric[0]} TOP10", height=340, accent="indigo",
                   binding=_binding(ds, dim="搜索词", metric=bar_metric[0], agg=bar_metric[1],
                                    top_n=10, filters=filters),
                   chart=bar_chart))

        # 明细表
        columns = {
            "hot": [
                {"key": "搜索词", "type": "text", "width": 220},
                {"key": "分类三级", "type": "text", "width": 130},
                {"key": "排名", "type": "rank", "align": "center", "width": 92},
                {"key": "搜索人气", "type": "number", "align": "right", "width": 110},
                {"key": "点击率", "type": "percent", "align": "right", "width": 96},
                {"key": "支付转化率", "type": "percent", "align": "right", "width": 110},
            ],
            "grow": [
                {"key": "搜索词", "type": "text", "width": 240},
                {"key": "分类三级", "type": "text", "width": 130},
                {"key": "排名", "type": "rank", "align": "center", "width": 92},
                {"key": "搜索增速", "type": "percent", "align": "right", "width": 110},
                {"key": "搜索人气", "type": "number", "align": "right", "width": 110},
                {"key": "点击率", "type": "percent", "align": "right", "width": 96},
            ],
            "rel": [
                {"key": "搜索词", "type": "text", "width": 220},
                {"key": "搜索人气", "type": "number", "align": "right"},
                {"key": "点击率", "type": "percent", "align": "right"},
                {"key": "支付转化率", "type": "percent", "align": "right"},
                {"key": "需求供给比", "type": "number", "align": "right"},
                {"key": "支付买家数", "type": "number", "align": "right"},
                {"key": "天猫点击占比", "type": "percent", "align": "right"},
            ],
        }[key]
        metrics = [{"name": "点击率", "agg": "AVG"}, {"name": "支付转化率", "agg": "MAX"}]
        dimensions = []
        if key in ("hot", "grow"):
            metrics = [{"name": "排名", "agg": "MIN"}] + metrics
            dimensions = ["分类三级"]
        if key == "grow":
            metrics = [{"name": "搜索增速", "agg": "MAX"}, {"name": "排名", "agg": "MIN"}] + metrics[1:]
        if key == "rel":
            metrics = [{"name": "点击率", "agg": "AVG"}, {"name": "支付转化率", "agg": "MAX"},
                       {"name": "支付买家数", "agg": "MAX"}, {"name": "天猫点击占比", "agg": "MAX"}]
        _put(db, f"{prefix}.table", f"{title}明细", "table", view_cat, "前 10 条 · 卡内分页",
             _spec(f"{title}明细", height=460, accent="slate",
                   binding=_binding(ds, dim="搜索词", metric="搜索人气",
                                    metrics=metrics, dimensions=dimensions,
                                    top_n=10, filters=filters),
                   table_view={"page_size": 10, "more": False,
                               "columns": columns}))

        # 结论
        insight_metrics = {
            "hot": [{"name": "词数", "agg": "SUM", "fmt": "int"},
                    {"name": "人气合计", "agg": "SUM", "fmt": "w"},
                    {"name": "平均转化率", "agg": "AVG", "fmt": "pct"}],
            "grow": [{"name": "翻倍词数", "agg": "SUM", "fmt": "int"},
                     {"name": "平均增速", "agg": "AVG", "fmt": "pct"},
                     {"name": "词数", "agg": "SUM", "fmt": "int"}],
            "rel": [{"name": "高缺口词数", "agg": "SUM", "fmt": "int"},
                    {"name": "平均转化率", "agg": "AVG", "fmt": "pct"},
                    {"name": "词数", "agg": "SUM", "fmt": "int"}],
        }[key]
        items = {
            "hot": [{"k": "主词根", "v": "命中 {词数} 个词，合计人气 {人气合计}，标题与卖点要覆盖头部词。"},
                    {"k": "转化基线", "v": "命中词平均转化率 {平均转化率}，低于它的词只适合拉流量。"}],
            "grow": [{"k": "起量词", "v": "有 {翻倍词数} 个词同比翻倍，类目需求在扩张。"},
                     {"k": "平均增速", "v": "命中词平均增速 {平均增速}，可优先给这些词配预算。"}],
            "rel": [{"k": "供给缺口", "v": "命中 {词数} 个词，其中 {高缺口词数} 个供需比 ≥3。"},
                    {"k": "转化侧", "v": "相关词平均转化率 {平均转化率}，适合放进主推 SKU 标题。"}],
        }[key]
        _put(db, f"{prefix}.insight", f"{title}结论", "insight", view_cat, "按当前筛选计算",
             _spec(f"{title}结论", height=200, accent="amber",
                   binding=_binding(ds, metrics=insight_metrics, filters=filters),
                   content={"items": items}))

    # 需求端 TOP10（KPI 点击弹窗共用）
    _put(db, "demand.top10", "TOP10 排行", "rank_list", "需求端·浮层", "按指标看 TOP10（弹窗用）",
         _spec("TOP10", height=520, accent="indigo",
               binding=_binding(merged, dim="搜索词", metric="搜索人气", top_n=10, limit=200,
                                filters=kpi_filters),
               rank={"max_items": 10, "order": "value"}))


# ────────────────────────── 看板文档 ──────────────────────────

def _item(key: str, component: str, span: int, h: int, **extra) -> dict:
    return {"key": key, "component": component, "span": span, "h": h, **extra}


def _modal(code: str, title: str, overrides: dict | None = None) -> dict:
    return {"type": "modal", "component": code, "title": title, "overrides": overrides or {}}


def build_rank_doc() -> dict:
    def kpi_action(metric: str | None = None, dim: str | None = None,
                   sort: str = "desc", title: str = "") -> dict:
        binding = {}
        if metric:
            binding["metric"] = metric
        if dim:
            binding["dimension"] = dim
        if sort != "desc":
            binding["sort"] = sort
        return _modal("rank.top10", title, {"binding": binding, "title": title})

    items = [
        _item("filter", "rank.filter", 12, 76),
        _item("sec_overview", "rank.sec.overview", 12, 56),
        _item("kpi_sales", "rank.sales", 2, 112, action=kpi_action("日销量", title="日销量 TOP10")),
        _item("kpi_heat", "rank.heat", 2, 112, action=kpi_action("热销指数", title="热销指数 TOP10")),
        _item("kpi_rank", "rank.rank", 2, 112, action=kpi_action("榜单排名", sort="asc", title="榜单排名 TOP10")),
        _item("kpi_days", "rank.days", 2, 112, action=kpi_action("霸榜天数", title="霸榜天数 TOP10")),
        _item("kpi_band", "rank.band", 2, 112, action=kpi_action(dim="价格带", metric="日销量", title="价格带分布")),
        _item("kpi_listed", "rank.listed", 2, 112,
              action=kpi_action(dim="商品标题", metric="上架天数", sort="asc", title="最新上架")),
        _item("sec_structure", "rank.sec.structure", 12, 56),
        _item("chart_cat", "rank.cat-share", 4, 300),
        _item("chart_brand", "rank.brand-top", 4, 300),
        _item("chart_band", "rank.band-combo", 4, 300),
        _item("sec_detail", "rank.sec.detail", 12, 56),
        _item("table_detail", "rank.detail", 12, 460,
              action=_modal("rank.detail", "全部在榜商品",
                            {"binding": {"top_n": 999, "limit": 999},
                             "table_view": {"page_size": 50}, "title": "全部在榜商品"}),
              row_action={"type": "drawer", "component": "rank.sku.detail", "title": "商品详情",
                          "params": {"link_id": "$row.链接ID"}}),
        _item("sec_pain", "rank.sec.pain", 12, 56),
        _item("cloud_pain", "rank.pain-cloud", 12, 320),
        _item("sec_sell", "rank.sec.sell", 12, 56),
        _item("cloud_sell", "rank.sell-cloud", 6, 320),
        _item("cloud_subsell", "rank.subsell-cloud", 6, 320),
    ]
    return {
        "version": 2, "mode": "flow",
        "header": {
            "kicker": "2026 Q4 · 冻干零食赛道 · 单期快照",
            "title": "榜单端 市场分析",
            "subtitle": "拼多多 · 天猫 · 京东 · 抖音 | 按平台切换",
            "stats": [
                {"label": "在榜 SKU", "component": "rank.stat.count"},
                {"label": "竞品品牌", "component": "rank.stat.brands"},
                {"label": "覆盖品类", "component": "rank.stat.cats"},
            ],
        },
        "views": [{"key": "main", "title": "榜单端", "items": items}],
    }


def build_demand_doc() -> dict:
    def top10(metric: str, title: str) -> dict:
        return _modal("demand.top10", title, {"binding": {"metric": metric}, "title": title})

    summary = [
        _item("filter", "demand.filter", 12, 76),
        _item("sec1", "demand.sec.summary.1", 12, 56),
        _item("kpi_v", "demand.kpi.v", 2, 112, action=top10("人气合计", "搜索人气 TOP10")),
        _item("kpi_g", "demand.kpi.g", 2, 112, action=top10("搜索增速", "搜索增速 TOP10")),
        _item("kpi_ctr", "demand.kpi.ctr", 2, 112, action=top10("点击率", "点击率 TOP10")),
        _item("kpi_cvr", "demand.kpi.cvr", 2, 112, action=top10("支付转化率", "支付转化率 TOP10")),
        _item("kpi_ds", "demand.kpi.ds", 2, 112, action=top10("需求供给比", "需求供给比 TOP10")),
        _item("kpi_buy", "demand.kpi.buy", 2, 112, action=top10("支付买家数", "支付买家数 TOP10")),
        _item("sec2", "demand.sec.summary.2", 12, 56),
        _item("quadrant", "demand.quadrant", 7, 380),
        _item("blue", "demand.blue", 5, 380),
        _item("sec3", "demand.sec.summary.3", 12, 56),
        _item("overview", "demand.overview", 5, 280),
        _item("insight", "demand.insight.summary", 7, 280),
        _item("sec4", "demand.sec.summary.4", 12, 56),
        _item("opps", "demand.opps", 12, 440),
    ]

    def category_view(key: str, title: str, filter_code: str) -> dict:
        prefix = f"demand.{key}"
        return {
            "key": key, "title": title,
            "items": [
                _item("filter", filter_code, 12, 76),
                _item("sec1", f"{prefix}.sec.1", 12, 56),
                _item("kpi1", f"{prefix}.kpi.1", 3, 112),
                _item("kpi2", f"{prefix}.kpi.2", 3, 112),
                _item("kpi3", f"{prefix}.kpi.3", 3, 112),
                _item("kpi4", f"{prefix}.kpi.4", 3, 112),
                _item("trend", f"{prefix}.trend", 7, 360,
                      action=_modal(f"{prefix}.trend", f"{title} · 搜索趋势",
                                    {"title": f"{title} · 搜索趋势"})),
                _item("bar", f"{prefix}.bar", 5, 360),
                _item("sec2", f"{prefix}.sec.2", 12, 56),
                _item("table", f"{prefix}.table", 12, 460,
                      action=_modal(f"{prefix}.table", f"{title} · 全部搜索词",
                                    {"binding": {"top_n": 999, "limit": 999},
                                     "table_view": {"page_size": 50},
                                     "title": f"{title} · 全部搜索词"})),
                _item("sec3", f"{prefix}.sec.3", 12, 56),
                _item("insight", f"{prefix}.insight", 12, 200),
            ],
        }

    return {
        "version": 2, "mode": "flow",
        "header": {
            "kicker": "天猫生意参谋 · 搜索词 / 相关分析",
            "title": "需求端 搜索词分析",
            "subtitle": "2026-10-08 ~ 10-14 · 三张导出表按词去重",
            "stats": [
                {"label": "去重词数", "component": "demand.stat.words"},
                {"label": "高缺口词", "component": "demand.stat.scar"},
            ],
        },
        "views": [
            {"key": "summary", "title": "汇总", "items": summary},
            category_view("hot", "搜索词（人气）", "demand.filter"),
            category_view("grow", "搜索词（增速）", "demand.filter.grow"),
            category_view("rel", "相关搜索词", "demand.filter"),
        ],
    }


# ────────────────────────── 入口 ──────────────────────────

def ensure_all(db: Session) -> dict:
    from app.components import seed as base_seed
    from app.components import seed_demand as demand_datasets

    rank_ds = base_seed.ensure_dataset(db)
    demand_ids = demand_datasets.ensure_datasets(db) if demand_datasets.table_ready(db) else {}
    if not demand_ids:
        return {"skipped": "需求端数据集未就绪"}

    # 基础图表 + 业务卡片
    base_seed.ensure_builtins(db, rank_ds)
    seed_rank(db, rank_ds)
    seed_demand(db, demand_ids)

    rank_doc = ensure_seed(db, "board.rank", "榜单端 · 市场分析", build_rank_doc())
    demand_doc = ensure_seed(db, "board.demand", "需求端 · 天猫搜索词", build_demand_doc())
    return {
        "rank_dataset": rank_ds,
        "demand_datasets": demand_ids,
        "dashboards": {"rank": rank_doc.id, "demand": demand_doc.id},
    }


__all__ = ["ensure_all", "seed_rank", "seed_demand", "build_rank_doc", "build_demand_doc"]
