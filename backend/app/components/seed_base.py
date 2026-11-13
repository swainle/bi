"""基础组件（类型级）—— 一类一个，差异进实例配置.

组件库只放这些：15 个「类型」。
页面上的每张卡都是它们的实例，自带 spec，不往库里复制同类组件。
"""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.components.repository import get_by_code, upsert_builtin


def _spec(title: str, *, dim=None, metric=None, agg="SUM", metrics=None, extra=None) -> dict:
    spec = {
        "title": title,
        "subtitle": "",
        "unit": "",
        "ui": {"accent": "indigo", "min_height": 260},
        "binding": {
            "dataset_id": None, "dimension": dim, "metric": metric, "agg": agg,
            "top_n": 10, "sort": "desc", "metrics": metrics or [], "limit": 500,
        },
        "compute": {"headline": "first", "hint": "none", "format": "int"},
    }
    for key, value in (extra or {}).items():
        spec[key] = value
    return spec


BASE = [
    ("base.kpi", "指标卡", "kpi", "指标卡", "单个聚合值 + 徽标；数字格式/取数规则可配",
     {**_spec("指标卡", dim=None, metric="日销量"),
      "ui": {"accent": "indigo", "min_height": 112, "badge": "TOP10"}}),
    ("base.table", "明细表", "table", "明细表", "字段模式 · 缩略图 · 排序 · 分页 · 查看更多（点图看大图）",
     {**_spec("明细表", dim=None, metric=None),
      "binding": {"dataset_id": None, "dimension": None, "metric": None, "agg": "SUM",
                  "dimensions": ["商品标题", "日销量"],
                  "top_n": 10, "sort": "desc", "metrics": [], "limit": 500},
      "table_view": {"index_column": True, "page_size": 10, "more": True,
                     "more_label": "查看更多", "thumb": False, "thumb_key": ""}}),
    ("base.bar", "柱状图", "bar", "分布", "按维度聚合，圆角柱 + 顶部数值",
     {**_spec("柱状图", dim="价格带", metric="日销量"),
      "subtitle": "按价格带", "chart": {"bar_width": 26}}),
    ("base.hbar", "排行条形", "hbar", "排名", "TOP N 横向排行，支持阈值染色",
     _spec("排行", dim="品牌", metric="日销量")),
    ("base.line", "折线图", "line", "时间序列", "按时间粒度串联",
     _spec("趋势", dim="上架时间", metric="日销量")),
    ("base.area", "面积图", "area", "时间序列", "累积规模",
     _spec("面积", dim="上架时间", metric="日销量")),
    ("base.pie", "饼图", "pie", "占比", "构成占比，可外置标签",
     {**_spec("占比", dim="品类", metric="日销量"), "chart": {"label_layout": "outside"}}),
    ("base.donut", "环形图", "donut", "占比", "带总量中心的环形",
     _spec("构成", dim="平台", metric="日销量")),
    ("base.funnel", "漏斗图", "funnel", "转化", "按阶段逐层收窄，看每一层的量级与流失",
     {**_spec("转化漏斗", dim="平台", metric="日销量"), "subtitle": "按平台"}),
    ("base.gauge", "仪表盘", "gauge", "进度", "单值 + 目标刻度（最大值留空自动取整）",
     {**_spec("目标完成", dim=None, metric="日销量", agg="SUM"),
      "ui": {"accent": "teal", "min_height": 220}}),
    ("base.radar", "雷达图", "radar", "关系", "多个维度上的单指标轮廓（每个轴一个维度值）",
     {**_spec("能力雷达", dim="价格带", metric="日销量"), "subtitle": "按价格带"}),
    ("base.waterfall", "瀑布图", "waterfall", "贡献", "逐项累计，看每一项对总量的贡献",
     {**_spec("贡献瀑布", dim="价格带", metric="日销量"), "subtitle": "按价格带"}),
    ("base.map", "中国地图", "map", "分布", "按省份铺满地图，颜色深浅看指标大小（维度值需是省份名）",
     {**_spec("省份分布", dim="省份", metric="日销量"), "subtitle": "颜色越深，指标越高",
      # 省份名标签在东部会互相压住（京津 / 江浙沪），默认只上色 + tooltip，需要时面板可开
      "chart": {"show_labels": False}}),
    ("base.scatter", "散点图", "scatter", "关系", "点 / 气泡 / 四象限三种模式",
     _spec("关联", dim="商品标题", metric="日销量", metrics=[{"name": "均价", "agg": "AVG"}])),
    ("base.heatmap", "热力矩阵", "heatmap", "矩阵", "二维交叉分布",
     {**_spec("矩阵", dim="平台", metric="日销量"), "binding": {
         "dataset_id": None, "dimension": "平台", "series": "价格带", "metric": "日销量",
         "agg": "SUM", "top_n": 40, "sort": "desc", "metrics": [], "limit": 500}}),
    ("base.wordcloud", "词云", "wordcloud", "词频", "标签按权重，支持分隔符拆词",
     {**_spec("词云", dim=None, metric="热销指数", agg="SUM"),
      # 词云只有一个槽：默认按指标当权重（词由后端自动挑一列），拖「列」过来可当词
      "binding": {"dataset_id": None, "dimension": None, "metric": "热销指数", "agg": "SUM",
                  "split": "", "top_n": 30, "sort": "desc", "metrics": [], "limit": 500}}),
    ("base.combo", "柱线组合", "combo", "组合", "柱看体量 + 线看质量（双轴）",
     {**_spec("组合", dim="价格带", metric="日销量", agg="AVG",
              metrics=[{"name": "热销指数", "agg": "AVG"}]),
      "subtitle": "柱=平均日销量 · 线=平均热销指数",
      "combo": {"bar_name": "平均日销量", "line_name": "平均热销指数",
                "right_axis": True, "smooth": True},
      "chart": {"bar_width": 26}}),
    ("base.rank_list", "排行列表", "rank_list", "排名", "TOP N + 分值 + 标签；可按原值/评分/机会象限排序",
     {**_spec("排行", dim="商品标题", metric="日销量"),
      "rank": {"order": "value", "max_items": 10}}),
    ("base.insight", "结论卡", "insight", "内容", "键值结论，支持 {指标} 占位符",
     {**_spec("结论", dim=None, metric=None), "content": {
         "items": [{"k": "结论", "v": "这条结论可以引用 {指标} 占位符"}]}}),
    ("base.section", "分节标题", "section", "页面模块", "编号 + 图标 + 标题 + 说明；把一个页面分成几节",
     {**_spec("分节标题", dim=None, metric=None),
      "ui": {"accent": "indigo", "min_height": 56},
      "content": {"index": "一", "icon": "grid", "items": [], "text": ""}}),
    ("base.banner", "头标卡", "banner", "页面模块", "页头大图：kicker + 大标题（尾段渐变）+ 副标题 + 右侧统计",
     {**_spec("头标卡", dim=None, metric=None),
      "ui": {"accent": "sky", "radius": 12, "min_height": 200, "edge": True, "shadow_px": 16},
      "banner": {
          "kicker": "2026 Q4 · 榜单采集 · 单期快照",
          "title": "四平台榜单",
          "accent": "市场分析看板",
          "subtitle": "拼多多 · 天猫 · 京东 · 抖音 ｜ 示例数据（可直接替换为真实采集表）",
          "stats": [
              {"value": "36", "unit": "", "label": "在榜 SKU"},
              {"value": "14", "unit": "", "label": "竞品品牌"},
              {"value": "6", "unit": "", "label": "覆盖种类"},
          ],
          "tone": "sky",
      }}),
    ("base.nav", "导航菜单卡", "nav", "页面模块", "品牌 + 菜单（圆点/高亮/首视页）+ 右侧状态徽标与按钮，做页头导航",
     {**_spec("导航菜单卡", dim=None, metric=None),
      "ui": {"accent": "indigo", "radius": 12, "min_height": 64, "edge": True, "edge_px": 1, "edge_alpha": 18},
      "nav": {
          "brand": "市场",
          "brand_accent": "BI",
          "brand_tone": "sky",
          # active = 首视页（打开看板先落到哪一页），模板里不预置，由用户在面板里勾
          "items": [
              {"label": "市场总览", "tone": "slate", "active": False, "page": ""},
              {"label": "榜单端", "tone": "indigo", "active": False, "page": ""},
              {"label": "需求端", "tone": "amber", "active": False, "page": ""},
              {"label": "竞品端", "tone": "amber", "active": False, "page": ""},
          ],
          "meta": "数据同步 · 2026-11-03 09:30",
          "badge": "构建 v166 · 22:04",
          "actions": [{"label": "导出 CSV", "kind": "primary"}],
      }}),
    ("base.filter", "筛选栏", "filter", "页面模块", "下拉 / 日期 / 分段 / 多选 / 搜索，产出页面参数",
     {**_spec("筛选栏", dim=None, metric=None),
      "ui": {"accent": "indigo", "min_height": 56},
      "filter": {"fields": [
            # 平台 = 分套依据（split）：切天猫 / 拼多多就各看那一套内容
            {"id": "platform", "label": "平台", "type": "select", "default": "拼多多",
             "options": [{"v": "天猫", "t": "天猫"}, {"v": "拼多多", "t": "拼多多"}],
             "multiple": False, "placeholder": "", "width": 0, "note": "", "split": True},
            # 日期 = 区间日历（快捷档位 + 双月历）；绑列后按「开始 00:00 ~ 结束 23:59:59」过滤
            {"id": "date", "label": "日期", "type": "date",
             "default": "", "placeholder": "", "width": 160},
            {"id": "keyword", "label": "搜索", "type": "search",
             "default": "", "placeholder": "搜索", "width": 200},
        ],
                 # 底部背景（白底圆角卡片）：默认关，面板里可开
                 "inline": True, "background": False}}),
]

BASE_CODES = {code for code, *_ in BASE}


def ensure_base(db: Session, dataset_id: int | None = None,
                demo_dataset_id: int | None = None) -> int:
    """写入基础组件。

    数据类组件默认挂**演示数据集**（组件库预览 / 新建卡片才有数），业务数据集只在没给演示库时兜底；
    画布上新建卡片时前端会用当前看板的数据集覆盖它 —— 最终以用户的自定义绑定为准。
    """
    count = 0
    for code, name, kind, category, description, spec in BASE:
        spec = {k: (dict(v) if isinstance(v, dict) else v) for k, v in spec.items()}
        default_dataset = demo_dataset_id or dataset_id
        if default_dataset and kind not in ("insight", "filter", "banner", "section", "nav") and not spec["binding"].get("dataset_id"):
            spec["binding"] = {**spec["binding"], "dataset_id": default_dataset}
        spec.setdefault("layout", {"x": 40, "y": 40, "w": 420, "h": 260})
        upsert_builtin(db, code=code, name=name, kind=kind, spec=spec,
                       category=category, description=description)
        count += 1
    return count


__all__ = ["BASE", "BASE_CODES", "ensure_base"]
