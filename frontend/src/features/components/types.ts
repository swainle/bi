/** 组件库类型 —— 与后端 app/components/spec.py 保持一致 */

import type { RecoSpec, RecoItem, RecoMeta } from "./reco/types";

export type ComponentKind =
  | "kpi" | "table"
  | "bar" | "hbar"
  | "line" | "area"
  | "pie" | "donut"
  | "scatter"
  | "heatmap" | "wordcloud"
  | "funnel" | "gauge"
  | "radar" | "waterfall"
  | "map"
  // v2：业务页形态
  | "combo" | "rank_list" | "reco_list" | "insight" | "section" | "filter"
  // 页面头标卡（渐变头图 + 大标题 + 右侧统计）
  | "banner"
  // 导航菜单卡（品牌 + 菜单 + 右侧状态/按钮）
  | "nav";

export type ComponentRole = "data" | "content" | "structure" | "param";

export type Accent = "indigo" | "teal" | "amber" | "rose" | "violet" | "slate" | "sky";

export interface UiSpec {
  accent: Accent;
  radius: number;
  min_height: number;
  show_unit: boolean;
  animate: boolean;
  align: "left" | "center";
  columns: number;
  badge?: string;
  /** 同色系描边（头标卡用） */
  edge?: boolean;
  /** 描边线宽 px（1~4） */
  edge_px?: number;
  /** 描边深浅：占色板 alpha 的百分比（0~100） */
  edge_alpha?: number;
  /** 卡片投影强度，0 = 关（头标卡用） */
  shadow_px?: number;
}

export interface FilterFieldSpec {
  id: string;
  label: string;
  /** date = 日期区间（值 [开始, 结束] 或单日 "YYYY-MM-DD"；空 / all = 不过滤） */
  type: "select" | "segment" | "chips" | "search" | "date";
  default?: unknown;
  options: { v: string; t: string; group?: string }[];
  multiple: boolean;
  placeholder: string;
  width: number;
  note: string;
  column?: string;
  /** 只影响这些组件（空 = 全部组件） */
  targets?: string[];
  ranges?: Record<string, string>;
  /** 数据集切换器：选项值 → 数据集 id（如 {拼多多: 15, 天猫: 21}）。
   *  非空时这个字段不再是「过滤一行」，而是「换一张表」，选项由映射生成。 */
  dataset_map?: Record<string, number>;
  /** 按平台分别给选项：{拼多多: {options, ranges}}；没配的平台回落到通用 options / ranges */
  options_map?: Record<string, { options: { v: string; t: string; group?: string }[]; ranges?: Record<string, string> }>;
  /** 「分套」开关：勾上后这个字段就是分套依据（取值 = 选项值 / dataset_map 的键），
   *  这一页其余内容按它分套存放。分类名不要求是「平台」。 */
  split?: boolean;
}

export interface FilterSpec {
  fields: FilterFieldSpec[];
  inline: boolean;
  /** 底部背景：白底圆角卡片（和页面其它卡片一层表面），默认关 */
  background?: boolean;
  /** 按平台各配一套字段（不含平台入口本身）：{拼多多: [字段…]}；没配的平台用通用那份 */
  fields_map?: Record<string, FilterFieldSpec[]>;
}

export interface ContentSpec {
  index: string;
  icon: string;
  items: { k: string; v: string }[];
  text: string;
}

/** 头标卡：kicker + 大标题（可带渐变色尾段）+ 副标题 + 右侧统计 */
export interface BannerStat {
  /** 静态值（没绑指标时显示） */
  value: string;
  unit: string;
  label: string;
  /** 绑定的数据集指标：绑了就按数据集实时聚合（受页面筛选影响） */
  metric?: string;
  agg?: string;
  format?: "number" | "integer" | "percent" | "currency";
  /** 运算（结果集换算，不动 SQL）：与指标卡同一口径 */
  scale?: number;
  offset?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
}

export interface BannerSpec {
  kicker: string;
  title: string;
  /** 标题尾段（用渐变色强调） */
  accent: string;
  subtitle: string;
  stats: BannerStat[];
  /** 底色：sky / indigo / teal / warm */
  tone: string;
}

/** 导航菜单卡：品牌 + 菜单项 + 右侧状态与按钮 */
export interface NavItem {
  label: string;
  tone: string;
  active: boolean;
  /** 挂载的目标页面 key（看板内的某一页）；空 = 不跳转 */
  page?: string;
}

export interface NavAction {
  label: string;
  kind: "primary" | "secondary";
  /** 后端拼进来的「导出」按钮（点它才触发导出，不受文案影响） */
  export?: boolean;
}

export interface NavSpec {
  brand: string;
  /** 品牌名里用渐变强调的尾段 */
  brand_accent: string;
  brand_tone: string;
  items: NavItem[];
  meta: string;
  badge: string;
  actions: NavAction[];
  /** 跳转页全展示：开启后每个页面都显示这张导航 */
  global_nav?: boolean;
  /** 导出范围：primary=主数据集 / all=当前页全部数据集 / dataset=指定数据集 */
  export_scope?: "primary" | "all" | "dataset";
  /** export_scope=dataset 时导哪个数据集 */
  export_dataset_id?: number | null;
  /** 导出按钮：显示 / 文字 / 样式 */
  export_visible?: boolean;
  export_label?: string;
  export_kind?: "primary" | "secondary";
  /** 状态区功能：time = 当前时间（每 10 秒刷）；空 = 不显示 */
  status?: "" | "time";
}

export interface RankSpec {
  order: "value" | "score" | "opportunity";
  show_rank: boolean;
  show_score: boolean;
  show_tags: boolean;
  max_items: number;
  weights: Record<string, number>;
  value_key: string;
  tags_key: string;
  x_key: string;
  y_key: string;
  cvr_key: string;
}

export interface ComboSpec {
  bar_name: string;
  line_name: string;
  note?: string;
  right_axis: boolean;
  smooth: boolean;
}

export type { RecoSpec, RecoItem, RecoMeta };

export interface TableColumn {
  key: string;
  label: string;
  type: "text" | "number" | "percent" | "money" | "image" | "badge" | "rank" | "dual" | "tag" | "date" | "link";
  align: "left" | "center" | "right";
  width: number;
  format?: string;
  /** 列级文字颜色（#RRGGBB）；空 = 表格默认灰 */
  color?: string;
  /** 文本最多显示几行（1~4，超出省略）；空/1 = 单行省略 */
  rows?: number;
  tag_split?: string;
  image?: string;
  sub_key?: string;
  badge_tone?: string;
}

export interface RelatedThumbnailSpec {
  enabled: boolean;
  local_key: string;
  dataset_id: number | null;
  match_key: string;
  url_key: string;
  operation: "none" | "prefix" | "replace" | "regex";
  pattern: string;
  replacement: string;
}

export interface TableViewSpec {
  columns: TableColumn[];
  /** 每页条数（默认 10，面板可调 3–200；页脚也能临时切换） */
  page_size: number;
  /** @deprecated 2026-11-21 起明细表改为卡内分页，不再有「查看更多」；字段只为兼容旧文档保留 */
  more: boolean;
  /** @deprecated 同上 */
  more_label: string;
  index_column: boolean;
  /** 行首缩略图（图来自 thumb_key 那一列的图片地址） */
  thumb?: boolean;
  thumb_key?: string;
  related_thumb?: RelatedThumbnailSpec;
  /** 标题右侧搜索框：启用后按所有列模糊过滤 */
  search?: boolean;
  /** 行详情面板：点明细表一行，右侧滑出，内容由组件卡片纵向排列组成 */
  detail?: DetailConfig;
}

export interface DetailCard {
  key: string;
  component: string;
  kind: string;
  h: number;
  spec: ComponentSpec;
  /** 在详情画布里的位置与宽度（可自由拖动 / 拉伸） */
  x?: number;
  y?: number;
  w?: number;
}

export interface DetailConfig {
  enabled: boolean;
  /** 弹哪个画板（画板元素 key），弹窗内容 = 画板区域内的组件 */
  board_key?: string;
  /** 弹出方式：右侧 / 中间 / 左侧 */
  popup?: "right" | "center" | "left";
  /** 用哪一列识别当前行（弹窗里的组件按它过滤） */
  key_field: string;
  /** 旧的「面板内嵌卡片」（保留兼容） */
  items: DetailCard[];
  /** 抽屉内容字段映射：{title: 列名, platform: 列名, ...}（空 = 按字段名自动匹配） */
  fields?: Record<string, string>;
  /** 抽屉词云配置：{pain: {dataset_id, key_field, word_field, weight_field, split, palette}, ...} */
  wordclouds?: Record<string, {
    /** 关联表（数据集 id）；空 = 用当前明细表数据集 */
    dataset_id?: number;
    /** 关联字段（关联表里对应明细表行的字段） */
    key_field?: string;
    /** 词字段（关联表里的词列） */
    word_field?: string;
    /** 权重字段（关联表里的权重/次数列，可选） */
    weight_field?: string;
    /** 拆词符 */
    split?: string;
    /** 主题色 */
    palette?: string;
  }>;
  /** 抽屉附加区块：{trend, reviews, skus}，各区块可单独指定关联表与字段 */
  blocks?: Record<string, {
    dataset_id?: number;
    key_field?: string;
    date_field?: string;
    value_field?: string;
    score_field?: string;
    tag_field?: string;
    text_field?: string;
    spec_field?: string;
    price_field?: string;
    split?: string;
    /** 近30天差评数：X轴（维度） / Y轴字段 / Y轴函数 */
    dim_field?: string;
    val_field?: string;
    agg?: string;
    /** 图表参数 */
    bar_width?: number;
    show_grid?: boolean;
    accent?: string;
  }>;
  /** 抽屉图片区块：{main, sku, detail}，各可指定关联表 / 关联字段 / 图片字段 / 地址转换 */
  images?: Record<string, {
    dataset_id?: number;
    key_field?: string;
    field?: string;
    operation?: "none" | "prefix" | "replace" | "regex";
    pattern?: string;
    replacement?: string;
    /** 筛选字段（按它过滤图片行） */
    filter_field?: string;
    /** 筛选字段的匹配内容（去重值） */
    filter_value?: string;
  }>;
}

export interface BindingSpec {
  dataset_id: number | null;
  dimension: string | null;
  dimensions?: string[];
  metric: string | null;
  metrics: (string | { name: string; agg?: string; fmt?: string })[];
  agg: string;
  agg_expression?: string;
  top_n: number;
  sort: "desc" | "asc";
  order_by_dimension?: boolean;
  /** 不受页面筛选器影响（undefined = 按类型默认：环形图 / 组合图 true） */
  ignore_filters?: boolean | null;
  sort_field?: string;
  series: string | null;
  split: string | null;
  grain?: string | null;
  filters?: { column: string; op: string; value?: unknown; valueFrom?: string; ranges?: Record<string, unknown> }[];
  limit: number;
}

export interface ComputeSpec {
  headline: "first" | "max" | "min" | "mode" | "latest" | "total";
  hint: "sum_topn" | "avg_topn" | "count_topn" | "total" | "top_label" | "none";
  format: "int" | "w" | "pct" | "money" | "date" | "text";
  bucket_size?: number | null;
  bucket_start?: number | null;
  bucket_count: number;
  /** 运算自定义（结果集换算，不动 SQL） */
  transform: "raw" | "share" | "index" | "delta" | "cumsum";
  scale: number;
  offset: number;
  decimals: number;
  prefix: string;
  suffix: string;
}

export interface ChartSpec {
  show_labels: boolean;
  show_legend: boolean;
  show_title?: boolean;
  show_meta?: boolean;
  show_grid: boolean;
  x_title: string;
  y_title: string;
  label_rotate: number;
  y_min: number | null;
  y_max: number | null;
  /** 组合图右轴（线）单独一套刻度 / 格式 */
  y2_min?: number | null;
  y2_max?: number | null;
  y2_format?: "auto" | "int" | "w" | "k" | "pct" | "";
  bar_width: number;
  smooth: boolean;
  label_format: "auto" | "int" | "w" | "k" | "pct";
  /** 散点：点 / 气泡 / 四象限 */
  scatter_mode: "point" | "bubble" | "quadrant";
  trend_line?: boolean;
  dot_size?: number;
  x_key: string;
  y_key: string;
  size_key: string;
  log_x: boolean;
  log_y: boolean;
  /** 饼图 */
  /** 饼/环文字位置：图形上（inside）/ 图形旁（beside，无引导线）/ 图形外（outside，带引导线） */
  label_layout: "inside" | "beside" | "outside";
  single_slice: boolean;
  pie_inner: number;
  pie_start: number;
  pie_label: "name_pct" | "pct" | "name" | "value" | "none";
  pie_gap: boolean;
  pie_rose: boolean;
  /** 词云主题色（CLOUD_PALETTES 里的 name，缺省「潮彩」） */
  cloud_palette?: string;
  /** 排行条阈值染色 */
  hbar_threshold_key: string;
  hbar_threshold_gte: number | null;
  hbar_highlight: string;
}

export interface LayoutSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentSpec {
  title: string;
  subtitle: string;
  unit: string;
  ui: UiSpec;
  binding: BindingSpec;
  compute: ComputeSpec;
  chart: ChartSpec;
  layout: LayoutSpec;
  filter: FilterSpec;
  content: ContentSpec;
  rank: RankSpec;
  combo: ComboSpec;
  reco: RecoSpec;
  table_view: TableViewSpec;
  banner: BannerSpec;
  nav: NavSpec;
  /** 指标卡右上角徽标的弹窗（独立的 TOP N 榜单） */
  top?: TopListSpec;
  /** 形状元素（type=divider）的外观参数 */
  shape?: ShapeSpec;
}

/** 指标卡右上角徽标 → 弹窗（独立的 TOP N 榜单，不改页面状态） */
/** 排序方向："" = 不指定（保持原顺序） */
export type SortDir = "" | "desc" | "asc";

export interface TopListSpec {
  enabled: boolean;
  /** 指定弹出哪张明细表（元素 key） */
  table_key?: string;
  /** 弹窗打开时的默认排序：排序列（空 = 用明细表自己的顺序） */
  sort_field?: string;
  /** 排序方向：空 = 不指定（用明细表自己的顺序） */
  sort?: SortDir;
  title: string;
  dim: string;
  metric: string;
  agg: string;
  top_n: number;
  columns: string[];
  page_size: number;
  /** 并列处理：strict = 严格前 N 条（同分按名称排序）；all = 并列全部展示 */
  ties?: "strict" | "all";
}

export interface ComponentItem {
  id: number;
  code: string;
  name: string;
  category: string;
  kind: ComponentKind;
  description: string;
  spec: ComponentSpec;
  is_builtin: boolean;
}

export interface SeriesPoint {
  name: string | null;
  value: number;
  [key: string]: unknown;
}

export interface MatrixPayload {
  xLabels: string[];
  yLabels: string[];
  cells: [number, number, number][];
  max: number;
}

export interface RankItem {
  name: string;
  value: number;
  score?: number;
  quad?: "blue" | "pot" | "red" | "drop";
  tags?: string[];
}

export interface ScatterPoint {
  name?: string | null;
  x: number;
  y: number;
  size?: number;
  value?: number;
  quad?: string;
  score?: number;
}

export interface RenderPayload {
  /** 该 payload 所属的明细表元素 key（行详情面板写回用，后端不下发） */
  detailBoardKey?: string;
  kind?: ComponentKind;
  component?: { code: string; name: string; kind: ComponentKind; category?: string };
  value?: string;
  unit?: string;
  hint?: string;
  /** 仪表盘：原始数值（value 是格式化后的展示文本） */
  gauge_value?: number;
  /** 仪表盘：目标刻度上限（后端按数量级取整，chart.y_max 可覆盖） */
  max?: number;
  series?: SeriesPoint[];
  rows?: Record<string, unknown>[];
  total?: number;
  top_share?: number;
  count?: number;
  matrix?: MatrixPayload;
  sql?: string;
  elapsed_ms?: number;
  rls?: boolean;
  title?: string;
  subtitle?: string;
  dimension_label?: string | null;
  chart?: ChartSpec;
  combo?: ComboSpec;
  compute?: ComputeSpec;
  ui?: UiSpec;
  metric_label?: string | null;
  /** 词云的「颜色（分类）」字段名（未设置时为空） */
  series_label?: string | null;
  /** 指标卡：右上角徽标的弹窗配置（enabled 才可点） */
  top?: TopListSpec | null;
  params_used?: Record<string, unknown>;
  error?: string;

  // v2 载荷
  bar_label?: string;
  line_label?: string;
  items?: RankItem[];
  /** 推荐列表（reco_list）：后端算好的行 + 大盘基准 */
  reco_items?: RecoItem[];
  reco_meta?: RecoMeta;
  reco_stats?: { key: string; label: string; format: string; avg: number }[];
  score_label?: string;
  bar_key?: string;
  reco_detail?: boolean;
  reco_trend_days?: number;
  entries?: { k: string; v: string }[];
  index_column?: boolean;
  thumb?: boolean;
  thumb_key?: string;
  columns?: TableColumn[];
  page_size?: number;
  more?: boolean;
  more_label?: string;
  fields?: FilterFieldSpec[];
  inline?: boolean;
  medians?: { x: number; y: number };
  quads?: Record<string, number>;
  x_label?: string;
  y_label?: string;
  log_x?: boolean;
  log_y?: boolean;
  mode?: string;
  index?: string;
  note?: string;
  icon?: string;
  k?: string;
  v?: string;
  values?: Record<string, string>;
}

export interface DatasetBrief {
  id: number;
  name: string;
  physical_table: string;
  conn_mode?: string;
}

export interface FieldOption {
  name: string;
  role: string;
}

/** ── 看板文档（与后端 app/dashboards/models.py 对齐）── */

export interface DocAction {
  type: "modal" | "drawer";
  component?: string;
  spec?: ComponentSpec;
  title?: string;
  params?: Record<string, string>;
  overrides?: Record<string, unknown>;
}

export type ElementType = "chart" | "filter" | "heading" | "text" | "divider" | "board";

/** 形状元素（工具栏「矩形」）：type=divider 复用为通用形状，参数放在 spec.shape */
export type ShapeKind = "rect" | "ellipse" | "triangle" | "polygon" | "line" | "star";

export interface ShapeSpec {
  kind: ShapeKind;
  /** 填充色（直线 = 线色）；空字符串 = 无填充 */
  fill: string;
  /** 描边色；空字符串 = 无描边 */
  stroke: string;
  /** 描边宽度（设计坐标 px），直线时作为线粗 */
  stroke_w: number;
  /** 圆角（仅矩形） */
  radius: number;
  flip_x: boolean;
  flip_y: boolean;
}

export interface DocItem {
  key: string;
  type?: ElementType;
  component?: string;
  spec?: ComponentSpec;
  title?: string;
  span: number;
  h: number;
  layout?: { x: number; y: number; w: number; h: number };
  action?: DocAction;
  row_action?: DocAction;
  /** 文本类元素 */
  text?: string;
  note?: string;
  index?: string;
  icon?: string;
  size?: number;
  weight?: number;
  align?: "left" | "center" | "right";
}

/** 参考线（编辑辅助，不参与渲染） */
export interface Guide {
  id: string;
  axis: "x" | "y";
  pos: number;
}

export interface CanvasSize { width: number; height: number }

export interface DocView {
  key: string;
  title: string;
  /** 共用元素（筛选栏） */
  items: DocItem[];
  guides?: Guide[];
  canvas?: CanvasSize | null;
  /** 平台 → 该平台自己那一套卡片；没有这个 key 表示单套版面（旧看板） */
  items_map?: Record<string, DocItem[]>;
}

export interface DashboardHeader {
  kicker?: string;
  title?: string;
  subtitle?: string;
  stats?: { label: string; component: string }[];
}

export interface DashboardDoc {
  version: number;
  mode: "flow";
  header: DashboardHeader;
  params: Record<string, unknown>[];
  views: DocView[];
  /** 发布状态：保存不改它，发布置 true（后端同时写 published_at） */
  published?: boolean;
  published_at?: string;
}

export interface DashboardSummary {
  id: number;
  name: string;
  code?: string | null;
  owner_id?: number | null;
  /** 当前用户对这个看板的权限（协同看板用） */
  my_permission?: "owner" | "edit" | "view";
  doc: DashboardDoc;
}

export interface DashboardRender {
  view: string | null;
  /** 当前平台（筛选栏数据集切换器的值） */
  platform?: string;
  header: DashboardHeader;
  stats: { label: string; value?: string; unit?: string }[];
  cards: Record<string, RenderPayload>;
  param_defs: FilterFieldSpec[];
  params: Record<string, unknown>;
  views: { key: string; title: string; items: number }[];
}
