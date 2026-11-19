"""组件规格（spec）—— 一个组件能配置什么，全在这里定.

设计原则：
    组件 = 图表类型(kind) + 数据绑定(binding) + 计算规则(compute) + 界面样式(ui)
    前端只按 kind 选渲染器，按 ui 应用样式，按 compute 显示文案，
    因此「同类只搭一个，换字段就能复用」。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.security.errors import SecurityError

KINDS = (
    "kpi", "table", "bar", "hbar", "line", "area", "pie", "donut", "scatter", "heatmap", "wordcloud",
    "funnel", "gauge", "radar", "waterfall", "map",
    # v2：业务页需要的形态
    "combo",      # 柱 + 线双轴
    "rank_list",  # 榜卡 / 机会词列表（带分数与标签）
    "insight",    # 结论 / 洞察列表
    "section",    # 分节标题（页面结构）
    "banner",     # 头标卡（页头大图：kicker + 大标题 + 统计）
    "nav",        # 导航菜单卡（品牌 + 菜单 + 右侧状态/按钮）
    "filter",     # 筛选栏（页面参数，产出全局参数）
)

# 组件角色：决定它走哪条渲染链路、编辑器给什么面板
ROLES = {
    "kpi": "data", "table": "data", "bar": "data", "hbar": "data", "line": "data",
    "area": "data", "pie": "data", "donut": "data", "scatter": "data", "heatmap": "data",
    "wordcloud": "data", "combo": "data", "rank_list": "data",
    "funnel": "data", "gauge": "data", "radar": "data", "waterfall": "data", "map": "data",
    "insight": "content", "section": "structure", "filter": "param", "banner": "content",
    "nav": "content",
}
HEADLINES = ("first", "max", "min", "mode", "latest", "total")
HINTS = ("sum_topn", "avg_topn", "count_topn", "total", "top_label", "none")
FORMATS = ("int", "w", "pct", "money", "date", "text")
ACCENTS = ("indigo", "teal", "amber", "rose", "violet", "slate", "sky")
AGGREGATES = ("SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT")


class ComponentSpecError(SecurityError):
    code = "component_spec_invalid"


class UiSpec(BaseModel):
    """界面：只暴露设计令牌级别的开关，不允许写任意 CSS."""

    accent: str = "indigo"
    radius: int = 14
    min_height: int = 96
    show_unit: bool = True
    animate: bool = True
    align: Literal["left", "center"] = "left"
    columns: int = 1                  # 表格类：显示列数
    badge: str = ""                   # 卡片右上角徽标（如 TOP10）
    edge: bool = True                 # 同色系描边（头标卡用）
    edge_px: float = 1.0              # 描边线宽（0.5~4px，支持半像素细线）
    edge_alpha: int = 22              # 描边颜色深浅（0~100，占色板 alpha 的百分比）
    shadow_px: int = 16               # 卡片投影强度（0 = 关；头标卡用）

    @field_validator("accent")
    @classmethod
    def _accent(cls, v: str) -> str:
        return v if v in ACCENTS else "indigo"

    @field_validator("radius")
    @classmethod
    def _radius(cls, v: int) -> int:
        return max(0, min(int(v), 28))

    @field_validator("shadow_px")
    @classmethod
    def _shadow(cls, v: int) -> int:
        return max(0, min(int(v), 40))

    @field_validator("edge_px")
    @classmethod
    def _edge_px(cls, v: float) -> float:
        return max(0.0, min(round(float(v) * 2) / 2, 4.0))

    @field_validator("edge_alpha")
    @classmethod
    def _edge_alpha(cls, v: int) -> int:
        return max(0, min(int(v), 100))

    @field_validator("min_height")
    @classmethod
    def _height(cls, v: int) -> int:
        return max(60, min(int(v), 620))

    @field_validator("badge")
    @classmethod
    def _badge(cls, v: str) -> str:
        return (v or "")[:10]

    @field_validator("columns")
    @classmethod
    def _columns(cls, v: int) -> int:
        return max(1, min(int(v), 6))


class BindingSpec(BaseModel):
    """数据绑定：语义层字段名，不写物理列名."""

    dataset_id: int | None = None
    dimension: str | None = None      # 语义字段（分类轴 / 词云词列）
    metric: str | None = None         # 语义字段或指标名
    metrics: list = []                # 多指标：["热销指数"] 或 [{"name":"榜单排名","agg":"MIN"}]
    agg: str = "SUM"
    agg_expression: str = Field(default="", max_length=4000)
    top_n: int = 10
    sort: Literal["desc", "asc"] = "desc"
    order_by_dimension: bool = False   # 按维度名排序（价格带这类有序类目用）
    dimensions: list = []             # 明细表：额外维度（多列分组）
    series: str | None = None         # 热力图第二维
    split: str | None = None          # 词云：按分隔符拆标签
    grain: str | None = None          # 时间粒度（需维度为时间字段）
    filters: list = []                # 过滤条件 [{column,op,value}]
    limit: int = 500

    @field_validator("agg")
    @classmethod
    def _agg(cls, v: str) -> str:
        up = (v or "SUM").strip().upper()
        if up not in (*AGGREGATES, "CUSTOM"):
            raise ComponentSpecError(f"不支持的聚合：{v}")
        return up

    @field_validator("top_n", "limit")
    @classmethod
    def _positive(cls, v: int) -> int:
        return max(1, min(int(v), 5000))


class ComputeSpec(BaseModel):
    """计算规则：大数字取哪条、副标题怎么算、怎么格式化."""

    headline: Literal["first", "max", "min", "mode", "latest", "total"] = "first"
    hint: Literal["sum_topn", "avg_topn", "count_topn", "total", "top_label", "none"] = "none"
    format: Literal["int", "w", "pct", "money", "date", "text"] = "int"
    bucket_size: float | None = None      # 分档：按数值区间聚合
    bucket_start: float | None = None
    bucket_count: int = 0                 # >0 时按等宽分档出 series

    # ── 运算自定义（在结果集上换算，不动 SQL，零注入风险）──
    transform: Literal["raw", "share", "index", "delta", "cumsum"] = "raw"
    scale: float = 1.0                    # 乘数
    offset: float = 0.0                   # 加数
    decimals: int = 0                     # 小数位
    prefix: str = ""                      # 数值前缀（如 ¥）
    suffix: str = ""                      # 数值后缀（如 %）

    @field_validator("decimals")
    @classmethod
    def _dec(cls, v: int) -> int:
        return max(0, min(int(v or 0), 4))

    @field_validator("scale", "offset")
    @classmethod
    def _finite(cls, v: float) -> float:
        v = float(v or 0)
        if v != v or v in (float("inf"), float("-inf")):
            return 0.0 if v != v else (1e9 if v > 0 else -1e9)
        return max(-1e9, min(v, 1e9))

    @field_validator("prefix", "suffix")
    @classmethod
    def _text(cls, v: str) -> str:
        v = (v or "")[:8]
        return "".join(c for c in v if c not in "\'\";--/*")

    @field_validator("bucket_count")
    @classmethod
    def _buckets(cls, v: int) -> int:
        return max(0, min(int(v or 0), 40))


class FilterFieldSpec(BaseModel):
    """筛选栏里的一个字段（一个字段 = 一个看板参数）."""

    id: str
    label: str
    # date = 日期区间：值 [开始, 结束] 或单日 "YYYY-MM-DD"，按「开始 00:00 ~ 结束 23:59:59」过滤绑定列
    type: Literal["select", "segment", "chips", "search", "date"] = "select"
    default: Any = None
    options: list[dict] = []          # [{v, t, group?}]
    multiple: bool = False
    placeholder: str = ""
    width: int = 0                    # 0 = 自适应
    note: str = ""
    column: str = ""                  # 绑定的数据集字段（同名字段自动按参数过滤）
    ranges: dict[str, str] = {}       # 档位值 → 区间表达式（">=80000" / "5000..10000"）
    # 数据集切换器：选项值 → 数据集 id（如 {"拼多多": 15, "天猫": 21}）。
    # 非空时这个字段不再是「过滤一行」，而是「换一张表」：选项由映射生成，
    # 下面绑了这些表的卡片自动跟着切（字段同名自动匹配，不同名报错）。
    dataset_map: dict = {}
    # 「分套」开关：勾上后这个字段就是分套依据（取值 = 选项值 / dataset_map 的键），
    # 这一页其余内容按它分套存放；分类名不要求是「平台」。
    split: bool = False
    # 按平台分别给一份选项：{"拼多多": {"options": [{v,t}], "ranges": {档位: 区间}}, "天猫": {...}}。
    # 平台这一栏选了拼多多，就用拼多多那份；没单独配的平台回落到上面的通用 options / ranges。
    options_map: dict = {}

    @field_validator("id")
    @classmethod
    def _id(cls, v: str) -> str:
        text = (v or "").strip()
        if not text or not all(c.isalnum() or c in "_-" for c in text):
            raise ComponentSpecError(f"筛选字段 id 不合法：{v}")
        return text

    @field_validator("label")
    @classmethod
    def _label(cls, v: str) -> str:
        return (v or "")[:16]

    @field_validator("width")
    @classmethod
    def _width(cls, v: int) -> int:
        return max(0, min(int(v or 0), 480))

    @field_validator("options_map")
    @classmethod
    def _options_map(cls, v: dict) -> dict:
        """按平台分组的选项；脏数据丢掉，别让坏配置进库."""
        out: dict[str, dict] = {}
        for key, value in (v or {}).items():
            name = str(key or "").strip()[:16]
            if not name:
                continue
            if isinstance(value, dict):
                raw_options = value.get("options") or []
                raw_ranges = value.get("ranges") or {}
            elif isinstance(value, list):
                raw_options, raw_ranges = value, {}
            else:
                continue
            options: list[dict] = []
            for item in list(raw_options)[:200]:
                if isinstance(item, dict):
                    val = str(item.get("v") or "").strip()
                    if not val:
                        continue
                    options.append({"v": val[:60], "t": str(item.get("t") or val)[:60]})
                elif isinstance(item, str) and item.strip():
                    options.append({"v": item.strip()[:60], "t": item.strip()[:60]})
            ranges = {
                str(k)[:60]: str(x)[:40]
                for k, x in (raw_ranges.items() if isinstance(raw_ranges, dict) else [])
            }
            if options or ranges:
                out[name] = {"options": options, "ranges": ranges}
        return out

    @field_validator("dataset_map")
    @classmethod
    def _dataset_map(cls, v: dict) -> dict:
        """平台名 → 数据集 id；非法项直接丢掉，不让脏配置进库."""
        out: dict[str, int] = {}
        for key, value in (v or {}).items():
            name = str(key or "").strip()[:16]
            try:
                dataset_id = int(value)
            except (TypeError, ValueError):
                continue
            if name and dataset_id > 0:
                out[name] = dataset_id
        return out


class FilterSpec(BaseModel):
    """筛选栏：字段集合；字段产出的值作为看板参数注入所有数据组件."""

    fields: list[FilterFieldSpec] = []
    inline: bool = True               # 是否自带白底条（嵌在页面里）
    background: bool = False          # 筛选栏底部背景（白底圆角卡片，和页面其他卡片同一层表面）
    # 按平台各配一套字段：{"拼多多": [字段…], "天猫": [字段…]}。
    # 平台入口那一栏永远取 fields 里的切换器（一处定义），这里只放「平台之后的那些字段」，
    # 于是两个平台的筛选栏可以各设计各的（品类/榜单/价格带的选项、默认值互不影响）。
    fields_map: dict[str, list[FilterFieldSpec]] = {}

    @field_validator("fields_map")
    @classmethod
    def _fields_map(cls, v: dict) -> dict:
        out: dict[str, list[FilterFieldSpec]] = {}
        for key, value in (v or {}).items():
            name = str(key or "").strip()[:16]
            if not name:
                continue
            fields = [f for f in (value or []) if isinstance(f, FilterFieldSpec)]
            if fields:
                out[name] = fields
        return out


class ContentSpec(BaseModel):
    """文案类组件的正文：insight 的键值结论、section 的编号图标."""

    index: str = ""                   # "一" / "二"
    icon: str = ""                    # "grid" / "pie" / "table" / "cloud" / "bulb"
    items: list[dict] = []            # [{k: "需求盘子", v: "..."}]
    text: str = ""

    @field_validator("index")
    @classmethod
    def _index(cls, v: str) -> str:
        return (v or "")[:4]

    @field_validator("items")
    @classmethod
    def _items(cls, v: list) -> list:
        out = []
        for item in (v or [])[:12]:
            if isinstance(item, dict) and item.get("k"):
                out.append({"k": str(item["k"])[:12], "v": str(item.get("v") or "")[:240]})
        return out


class BannerStat(BaseModel):
    """头标卡右侧的一个统计：数值 + 单位 + 说明。

    绑了 metric 就按数据集实时聚合（受页面筛选影响），value 只当兜底/静态文案。
    """

    value: str = ""                   # 静态值（没绑 metric 时显示）
    unit: str = ""
    label: str = ""
    metric: str = ""                  # 绑定的数据集指标名
    agg: str = "SUM"                  # 与指标卡同一套聚合：SUM/AVG/MIN/MAX/COUNT/COUNT_DISTINCT
    format: str = "number"            # number / integer / percent / currency

    # ── 运算（在结果集上换算，不动 SQL）：与指标卡的「运算」同一口径 ──
    scale: float = 1.0                # 乘数
    offset: float = 0.0               # 加数
    decimals: int = 0                 # 小数位
    prefix: str = ""                  # 数值前缀，如 ¥
    suffix: str = ""                  # 数值后缀，如 个

    @field_validator("agg")
    @classmethod
    def _agg(cls, v: str) -> str:
        up = (v or "SUM").strip().upper()
        return up if up in AGGREGATES else "SUM"

    @field_validator("decimals")
    @classmethod
    def _decimals(cls, v: int) -> int:
        return max(0, min(int(v or 0), 4))


class BannerSpec(BaseModel):
    """头标卡内容：页头大图（渐变底 + 大标题 + 右侧统计）."""

    kicker: str = ""                  # 顶部小字：2026 Q4 · 冻干零食赛道
    title: str = ""                   # 大标题前半段（深色）
    accent: str = ""                  # 大标题尾段（渐变强调）
    subtitle: str = ""                # 副标题一行
    stats: list[BannerStat] = []      # 右侧统计，建议 3 个以内
    tone: str = "sky"                 # 底色：sky / indigo / teal / warm / rose / violet / slate

    @field_validator("tone")
    @classmethod
    def _tone(cls, v: str) -> str:
        return v if v in ("sky", "indigo", "teal", "warm", "rose", "violet", "slate") else "sky"

    @field_validator("kicker", "title", "accent", "subtitle")
    @classmethod
    def _clip(cls, v: str) -> str:
        return (v or "")[:120]

    @field_validator("stats")
    @classmethod
    def _stats(cls, v: list[BannerStat]) -> list[BannerStat]:
        return (v or [])[:4]


class NavItem(BaseModel):
    """导航菜单的一项：标签 + 圆点色 + 是否当前页 + 挂载的目标页面."""

    label: str = ""
    tone: str = "slate"               # indigo / teal / amber / rose / violet / sky / slate
    active: bool = False
    page: str = ""                    # 挂载的页面 key（看板内某一页），空 = 不跳转

    @field_validator("page")
    @classmethod
    def _page(cls, v: str) -> str:
        return (v or "")[:40]


class NavAction(BaseModel):
    """导航条右侧的按钮."""

    label: str = ""
    kind: str = "secondary"           # primary / secondary


class NavSpec(BaseModel):
    """导航菜单卡：左侧品牌 + 中间菜单 + 右侧状态与操作."""

    brand: str = "市场BI"              # 品牌名（尾段可用强调色）
    brand_accent: str = "BI"          # 品牌名里用渐变强调的尾段
    brand_tone: str = "sky"           # 品牌标记底色：sky / indigo / teal / warm
    items: list[NavItem] = []         # 菜单项，建议 6 个以内
    meta: str = ""                    # 右侧灰字：数据同步 · 2026-11-03 09:30
    badge: str = ""                   # 右侧徽标：构建 v166 · 22:04（绿色小胶囊）
    global_nav: bool = False          # 跳转页全展示：开启后每个页面都显示这张导航
    export_scope: str = "primary"     # 导出范围：primary=主数据集 / all=当前页全部数据集 / dataset=指定的某个数据集
    export_dataset_id: int | None = None   # export_scope=dataset 时导哪个数据集
    actions: list[NavAction] = []     # 右侧按钮，建议 2 个以内

    @field_validator("brand", "brand_accent", "meta", "badge")
    @classmethod
    def _clip(cls, v: str) -> str:
        return (v or "")[:40]

    @field_validator("brand_tone")
    @classmethod
    def _brand_tone(cls, v: str) -> str:
        return v if v in ("sky", "indigo", "teal", "warm") else "sky"

    @field_validator("export_scope")
    @classmethod
    def _scope(cls, v: str) -> str:
        return v if v in ("primary", "all", "dataset") else "primary"

    @field_validator("items")
    @classmethod
    def _items(cls, v: list[NavItem]) -> list[NavItem]:
        return (v or [])[:6]

    @field_validator("actions")
    @classmethod
    def _actions(cls, v: list[NavAction]) -> list[NavAction]:
        out = (v or [])[:2]
        for a in out:
            if a.kind not in ("primary", "secondary"):
                a.kind = "secondary"
        return out


class RankSpec(BaseModel):
    """榜卡 / 列表：按原值、评分或「机会象限」排序."""

    order: Literal["value", "score", "opportunity"] = "value"
    show_rank: bool = True
    show_score: bool = True
    show_tags: bool = True
    max_items: int = 10
    weights: dict = {}                # 评分权重：{"v":0.45,"cvr":0.3,"ds":0.25}
    value_key: str = ""               # 评分用的语义字段（默认 binding.metric）
    tags_key: str = ""                # 标签列（如「来源」）
    x_key: str = ""                   # opportunity 模式：人气字段
    y_key: str = ""                   # opportunity 模式：供需比字段
    cvr_key: str = ""                 # opportunity 模式：转化率字段

    @field_validator("max_items")
    @classmethod
    def _max(cls, v: int) -> int:
        return max(1, min(int(v or 10), 60))


class ComboSpec(BaseModel):
    """柱 + 线组合图：柱看体量，线看质量（双轴）."""

    bar_name: str = ""
    line_name: str = ""
    note: str = ""                    # 标题右侧说明（留空 = 自动「柱 X · 线 Y」）
    right_axis: bool = True
    smooth: bool = True

    @field_validator("bar_name", "line_name", "note")
    @classmethod
    def _name(cls, v: str) -> str:
        return (v or "")[:16]


class TableDetailSpec(BaseModel):
    """行详情弹窗：点明细表一行，按配置的画板弹出（弹窗内容 = 画板区域内的组件）."""

    enabled: bool = False
    # 弹哪个画板（画板元素的 key）
    board_key: str = ""
    # 弹出方式：右侧 / 中间 / 左侧
    popup: Literal["right", "center", "left"] = "right"
    # 用哪一列识别当前行（弹窗里的组件按它过滤取数）
    key_field: str = ""
    # 旧的「面板内嵌卡片」数据（保留兼容，不再使用）
    items: list[dict] = []

    @field_validator("items")
    @classmethod
    def _items(cls, v: list) -> list:
        out = []
        for item in (v or [])[:30]:
            if not isinstance(item, dict):
                continue
            key = str(item.get("key") or "")[:48]
            component = str(item.get("component") or "")[:64]
            kind = str(item.get("kind") or "")[:24]
            if not key or not component:
                continue
            out.append({
                "key": key,
                "component": component,
                "kind": kind,
                # 卡片在详情画布里的位置与尺寸（可自由拖动）
                "x": max(0, min(int(item.get("x") or 8), 2000)),
                "y": max(0, min(int(item.get("y") or 8), 6000)),
                "w": max(160, min(int(item.get("w") or 440), 2000)),
                "h": max(60, min(int(item.get("h") or 220), 900)),
                "spec": item.get("spec") if isinstance(item.get("spec"), dict) else {},
            })
        return out


class TableViewSpec(BaseModel):
    """明细表的列与交互（富单元格 / 排序 / 分页 / 查看更多）."""

    columns: list[dict] = []          # [{key,label,type,align,width,format,tag_split,image}]
    sortable: bool = False
    page_size: int = 10
    more: bool = True
    more_label: str = ""
    index_column: bool = True
    # 缩略图：true 时在行首放一个图框，图来自 thumb_key 这一列的图片地址
    thumb: bool = False
    thumb_key: str = ""
    # 行详情面板（点一行右侧滑出，内容由组件卡片组成）
    detail: TableDetailSpec = Field(default_factory=TableDetailSpec)

    @field_validator("columns")
    @classmethod
    def _columns(cls, v: list) -> list:
        out = []
        for col in (v or [])[:20]:
            if not isinstance(col, dict) or not col.get("key"):
                continue
            item = {
                "key": str(col["key"])[:40],
                "label": str(col.get("label") or col["key"])[:20],
                "type": col.get("type") if col.get("type") in
                        ("text", "number", "percent", "money", "image", "badge", "rank", "dual", "tag", "date")
                        else "text",
                "align": col.get("align") if col.get("align") in ("left", "center", "right") else "left",
                "width": max(0, min(int(col.get("width") or 0), 420)),
            }
            for extra in ("format", "tag_split", "image", "sub_key", "badge_tone"):
                if col.get(extra):
                    item[extra] = str(col[extra])[:60]
            out.append(item)
        return out

    @field_validator("page_size")
    @classmethod
    def _page(cls, v: int) -> int:
        return max(3, min(int(v or 10), 200))


class ChartSpec(BaseModel):
    """图形与坐标轴自定义."""

    show_labels: bool = True          # 显示数值标签
    show_legend: bool = True          # 显示图例
    show_grid: bool = True            # 显示横向网格
    show_title: bool = True           # 显示卡片标题
    show_meta: bool = True            # 显示标题右侧的说明（如「柱 X · 线 Y」）
    x_title: str = ""
    y_title: str = ""
    label_rotate: int = 0             # 0=自动，可 0/30/45/90
    y_min: float | None = None
    y_max: float | None = None
    bar_width: int = 26               # 柱宽 px
    hbar_threshold_key: str = ""      # 排行条：按哪个字段染色（如「需求供给比」）
    hbar_threshold_gte: float | None = None
    hbar_highlight: str = "violet"    # 达标项配色
    smooth: bool = True               # 折线平滑
    label_format: Literal["auto", "int", "w", "k", "pct"] = "auto"
    cloud_palette: str = "潮彩"        # 词云主题色（前端 CLOUD_PALETTES 的 name）

    # ── 散点：点 / 气泡 / 四象限 ──
    scatter_mode: Literal["point", "bubble", "quadrant"] = "point"
    trend_line: bool = False          # 散点趋势线（最小二乘）
    dot_size: int = 8                 # 散点基础点大小（气泡/四象限按比例放大）
    x_key: str = ""                   # 四象限横轴字段（默认第二个指标）
    y_key: str = ""                   # 四象限纵轴字段（默认主指标）
    size_key: str = ""                # 气泡大小字段
    log_x: bool = False
    log_y: bool = False

    # ── 饼图 / 环形图专属 ──
    # 饼/环文字位置：图形上 / 图形旁（无引导线）/ 图形外（带引导线）
    label_layout: Literal["inside", "beside", "outside"] = "inside"
    single_slice: bool = True         # 只有一个类目时退化为 100% 环形
    pie_inner: int = 46                                   # 内径 %（0=实心饼）
    pie_start: int = 90                                   # 起始角
    pie_label: Literal["name_pct", "pct", "name", "value", "none"] = "name_pct"
    pie_gap: bool = True                                  # 块间白色分隔
    pie_rose: bool = False                                # 玫瑰图

    @field_validator("label_rotate")
    @classmethod
    def _rot(cls, v: int) -> int:
        v = int(v or 0)
        return v if v in (0, 30, 45, 90) else 0

    @field_validator("bar_width")
    @classmethod
    def _bw(cls, v: int) -> int:
        return max(8, min(int(v or 26), 80))

    @field_validator("x_title", "y_title")
    @classmethod
    def _axis_title(cls, v: str) -> str:
        return (v or "")[:24]

    @field_validator("cloud_palette")
    @classmethod
    def _cloud_palette(cls, v: str) -> str:
        return (v or "潮彩")[:12]

    @field_validator("pie_inner")
    @classmethod
    def _pie_inner(cls, v: int) -> int:
        return max(0, min(int(v or 0), 78))

    @field_validator("pie_start")
    @classmethod
    def _pie_start(cls, v: int) -> int:
        return max(0, min(int(v or 0), 360))


class LayoutSpec(BaseModel):
    """画布位置与尺寸（编辑页中间画布用）."""

    x: int = 40
    y: int = 56
    w: int = 520
    h: int = 320

    @field_validator("x", "y")
    @classmethod
    def _pos(cls, v: int) -> int:
        return max(0, min(int(v), 8000))

    @field_validator("w", "h")
    @classmethod
    def _size(cls, v: int) -> int:
        return max(120, min(int(v), 4000))


class ComponentSpec(BaseModel):
    title: str
    subtitle: str = ""
    unit: str = ""
    ui: UiSpec = Field(default_factory=UiSpec)
    binding: BindingSpec = Field(default_factory=BindingSpec)
    compute: ComputeSpec = Field(default_factory=ComputeSpec)
    chart: ChartSpec = Field(default_factory=ChartSpec)
    layout: LayoutSpec = Field(default_factory=LayoutSpec)
    # v2 新增（按 kind 选用，未用到的保持默认）
    filter: FilterSpec = Field(default_factory=FilterSpec)
    content: ContentSpec = Field(default_factory=ContentSpec)
    rank: RankSpec = Field(default_factory=RankSpec)
    combo: ComboSpec = Field(default_factory=ComboSpec)
    table_view: TableViewSpec = Field(default_factory=TableViewSpec)
    banner: BannerSpec = Field(default_factory=BannerSpec)
    nav: NavSpec = Field(default_factory=NavSpec)

    @field_validator("title")
    @classmethod
    def _title(cls, v: str) -> str:
        text = (v or "").strip()
        if not text:
            raise ComponentSpecError("组件标题不能为空")
        if len(text) > 40:
            raise ComponentSpecError("组件标题不能超过 40 字")
        return text


def validate_kind(kind: str) -> str:
    value = (kind or "").strip().lower()
    if value not in KINDS:
        raise ComponentSpecError(f"不支持的组件类型：{kind}（可选 {', '.join(KINDS)}）")
    return value


_KIND_CN = {
    "bar": "柱状图", "hbar": "条形图", "line": "折线图", "area": "面积图",
    "pie": "饼图", "donut": "环形图", "wordcloud": "词云", "table": "明细表",
    "scatter": "散点图", "rank_list": "排行列表", "combo": "组合图",
    "heatmap": "热力图", "kpi": "指标卡", "insight": "结论卡", "section": "分节标题",
    "banner": "头标卡",
    "nav": "导航菜单卡",
    "funnel": "漏斗图",
    "gauge": "仪表盘",
    "radar": "雷达图",
    "waterfall": "瀑布图",
    "map": "地图",
}


def validate_spec(kind: str, raw: dict) -> ComponentSpec:
    """按 kind 校验 spec（不同图表类型允许的字段不同）."""
    try:
        spec = ComponentSpec(**(raw or {}))
    except ComponentSpecError:
        raise
    except Exception as exc:  # pydantic 的 ValidationError
        raise ComponentSpecError(f"组件配置不合法：{_first_error(exc)}") from exc

    if kind in ("section", "banner", "nav"):
        return spec
    if kind == "insight":
        return spec
    if kind == "filter":
        if not spec.filter.fields:
            raise ComponentSpecError("筛选栏至少需要配置一个字段")
        return spec
    if kind == "kpi":
        if not spec.binding.metric and spec.compute.headline != "latest":
            raise ComponentSpecError("KPI 组件必须绑定指标字段")
    if kind == "combo":
        if not spec.binding.dimension:
            raise ComponentSpecError("组合图必须绑定维度字段")
        if not spec.binding.metric or not spec.binding.metrics:
            raise ComponentSpecError("组合图需要柱指标（metric）与线指标（metrics）各一个")
    if kind == "table":
        # 明细表就是「列清单」：字段都放在 binding.dimensions 里，原样出表，不聚合
        if not spec.binding.dimension and not spec.binding.dimensions:
            raise ComponentSpecError("明细表至少需要一个字段（点「+ 添加字段」）")
    if kind in ("bar", "hbar", "line", "area", "pie", "donut", "scatter", "rank_list", "funnel", "radar", "waterfall", "map") and not spec.binding.dimension:
        raise ComponentSpecError(f"{_KIND_CN.get(kind, kind)}需要先绑定维度字段（从左侧「列」拖一列进来）")
    if kind == "gauge" and not spec.binding.metric:
        raise ComponentSpecError("仪表盘必须绑定指标字段")
    if kind in ("radar", "waterfall", "map") and not spec.binding.metric:
        raise ComponentSpecError(f"{_KIND_CN.get(kind, kind)}必须绑定指标字段")
    if kind == "wordcloud" and not (spec.binding.dimension or spec.binding.metric):
        raise ComponentSpecError("词云至少要绑一个字段（拖一列当词，或拖一个指标当权重）")
    if kind == "heatmap" and not (spec.binding.dimension and spec.binding.series):
        raise ComponentSpecError("热力图组件必须绑定两个维度（dimension / series）")
    return spec


def _first_error(exc: Exception) -> str:
    errors = getattr(exc, "errors", None)
    if callable(errors):
        try:
            first = errors()[0]
            return str(first.get("msg") or first)[:120]
        except Exception:
            pass
    return str(exc)[:120]


__all__ = [
    "KINDS", "ROLES", "ACCENTS", "AGGREGATES", "HEADLINES", "HINTS", "FORMATS",
    "ComponentSpec", "UiSpec", "BindingSpec", "ComputeSpec", "ChartSpec", "LayoutSpec",
    "FilterSpec", "FilterFieldSpec", "ContentSpec", "RankSpec", "ComboSpec", "TableViewSpec",
    "ComponentSpecError", "validate_kind", "validate_spec",
]
