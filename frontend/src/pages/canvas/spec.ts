/** 画布编辑器 · 规格构造与文档转换（纯函数，不依赖 React） */

import type { CanvasItem } from "../../features/components/boardTypes";
import type { ComponentKind, ComponentSpec, DocItem } from "../../features/components/types";
import { findSplitField, isSplitField, splitKeysOf } from "../../features/components/split";

export interface DashboardBrief { id: number; name: string; updated_at?: string; published?: boolean; agent_generated?: boolean }

export const ACCENTS = ["indigo", "teal", "amber", "rose", "violet", "slate", "sky"] as const;

/** 多选对齐的 6 个方向（图标 + 提示语） */
export const ALIGN_ACTIONS = [
  { mode: "left", tip: "左对齐" },
  { mode: "hcenter", tip: "水平居中" },
  { mode: "right", tip: "右对齐" },
  { mode: "top", tip: "顶对齐" },
  { mode: "vcenter", tip: "垂直居中" },
  { mode: "bottom", tip: "底对齐" },
] as const;



export function newKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
}

export function baseKind(component?: string): ComponentKind {
  const kind = (component || "").replace("base.", "");
  return (kind || "kpi") as ComponentKind;
}

export function emptySpec(title = "组件"): ComponentSpec {
  return {
    title, subtitle: "", unit: "",
    ui: {
      accent: ACCENTS[0], radius: 14, min_height: 260, show_unit: true,
      animate: true, align: "left", columns: 1, edge: true, edge_px: 1, edge_alpha: 22, shadow_px: 16,
    },
    binding: {
      dataset_id: null, dimension: null, metric: null, metrics: [], agg: "SUM",
      top_n: 10, sort: "desc", series: null, split: null, limit: 500, filters: [],
    },
    compute: {
      headline: "first", hint: "none", format: "int", bucket_size: null,
      bucket_start: null, bucket_count: 0, transform: "raw", scale: 1, offset: 0,
      decimals: 0, prefix: "", suffix: "",
    },
    chart: {
      show_labels: true, show_legend: true, show_grid: true, x_title: "", y_title: "",
      label_rotate: 0, y_min: null, y_max: null, bar_width: 26, smooth: true,
      label_format: "auto", scatter_mode: "point", x_key: "", y_key: "", size_key: "",
      log_x: false, log_y: false, label_layout: "inside", single_slice: true,
      pie_inner: 46, pie_start: 90, pie_label: "name_pct", pie_gap: true, pie_rose: false,
      hbar_threshold_key: "", hbar_threshold_gte: null, hbar_highlight: "violet",
    },
    layout: { x: 12, y: 12, w: 420, h: 260 },
    filter: { fields: [], inline: true },
    content: { index: "", icon: "", items: [], text: "" },
    rank: {
      order: "value", show_rank: true, show_score: false, show_tags: false,
      max_items: 10, weights: {}, value_key: "", tags_key: "", x_key: "", y_key: "", cvr_key: "",
    },
    combo: { bar_name: "", line_name: "", right_axis: true, smooth: true },
    table_view: {
      columns: [], sortable: false, page_size: 10, more: true,
      more_label: "", index_column: true,
    },
    banner: {
      kicker: "", title: "页面标题", accent: "", subtitle: "",
      stats: [], tone: "sky",
    },
    nav: {
      brand: "市场", brand_accent: "BI", brand_tone: "sky",
      items: [], meta: "", badge: "", actions: [], global_nav: false, export_scope: "primary",
    },
  };
}

/** 导航菜单卡默认内容（拖进来就是一条能看的页头导航） */
export function emptyNavSpec(): ComponentSpec {
  const spec = emptySpec("导航菜单卡");
  spec.nav = {
    brand: "市场",
    brand_accent: "BI",
    brand_tone: "sky",
    global_nav: false,
    export_scope: "primary",
    items: [
      { label: "市场总览", tone: "slate", active: false },
      { label: "榜单端", tone: "indigo", active: true },
      { label: "需求端", tone: "amber", active: false },
      { label: "竞品端", tone: "amber", active: false },
    ],
    meta: "数据同步 · 2026-11-03 09:30",
    badge: "构建 v166 · 22:04",
    actions: [{ label: "导出 CSV", kind: "primary" }],
  };
  spec.ui = { ...spec.ui, min_height: 64, radius: 12, edge: true, edge_px: 1, edge_alpha: 18, shadow_px: 8 };
  return spec;
}

/** 头标卡默认内容（拖进来就是一张能看的头图，不用先填字段） */
export function emptyBannerSpec(): ComponentSpec {
  const spec = emptySpec("头标卡");
  spec.banner = {
    kicker: "2026 Q4 · 榜单采集 · 单期快照",
    title: "四平台榜单",
    accent: "市场分析看板",
    subtitle: "拼多多 · 天猫 · 京东 · 抖音 ｜ 示例数据（可直接替换为真实采集表）",
    stats: [
      { value: "36", unit: "", label: "在榜 SKU" },
      { value: "14", unit: "", label: "竞品品牌" },
      { value: "6", unit: "", label: "覆盖种类" },
    ],
    tone: "sky",
  };
  spec.ui = { ...spec.ui, min_height: 200, radius: 12 };
  return spec;
}

/** 组件库模板拖进画布时按目标数据集自检：引用了不存在的字段就清掉，绝不让卡片带着死字段上线
 *  （2026-11-13 用户要求「字段不能固定写死」：模板里的维度 / 指标 / 图表轴 / 表格列一律以数据集为准） */
export function pruneSpecFields(spec: ComponentSpec, allowed: Set<string>, roleOf?: Map<string, string>): ComponentSpec {
  if (!allowed.size) return spec;
  /* 目标数据集里这一列是文本/维度，但模板给的是 SUM/AVG 这类数值聚合 → 改成 COUNT。
     否则拖进来就红字「字段是文本列，SUM 用不了」（2026-11-15 用「榜单端-天猫」实测：16 张卡全报这个）。
     COUNT 对文本/标识都成立，是唯一能安全退化的聚合。 */
  const NUMERIC_AGGS = new Set(["SUM", "AVG", "MIN", "MAX"]);
  const numericlyIllegal = (name: unknown, agg: unknown) => {
    if (typeof name !== "string" || !name) return false;
    const role = roleOf?.get(name);
    if (!role || role === "measure" || role === "metric") return false;   // 数值列 / 数据集指标：照旧
    return NUMERIC_AGGS.has(String(agg || "SUM").toUpperCase());
  };
  const keep = (v: unknown) => (typeof v === "string" && v && !allowed.has(v) ? "" : v);
  const binding: Record<string, unknown> = { ...(spec.binding as unknown as Record<string, unknown>) };
  for (const key of ["dimension", "series", "metric"]) {
    if (typeof binding[key] === "string" && binding[key] && !allowed.has(binding[key] as string)) binding[key] = null;
  }
  if (Array.isArray(binding.dimensions)) {
    binding.dimensions = (binding.dimensions as unknown[])
      .map((x) => (typeof x === "string" ? x : (x as { name?: string })?.name))
      .filter((x): x is string => !!x && allowed.has(x));
  }
  if (numericlyIllegal(binding.metric, binding.agg)) binding.agg = "COUNT";
  if (Array.isArray(binding.metrics)) {
    binding.metrics = (binding.metrics as { name?: string; agg?: string }[])
      .filter((m) => !!m?.name && allowed.has(m.name))
      .map((m) => (numericlyIllegal(m.name, m.agg) ? { ...m, agg: "COUNT" } : m));
  }
  const chart: Record<string, unknown> = { ...(spec.chart as unknown as Record<string, unknown>) };
  for (const key of ["x_key", "y_key", "size_key", "hbar_threshold_key"]) {
    if (key in chart) chart[key] = keep(chart[key]);
  }
  const rank: Record<string, unknown> = { ...(spec.rank as unknown as Record<string, unknown>) };
  for (const key of ["value_key", "x_key", "y_key", "cvr_key", "tags_key"]) {
    if (key in rank) rank[key] = keep(rank[key]);
  }
  const table = spec.table_view ? { ...spec.table_view } : null;
  if (table) {
    if (Array.isArray(table.columns)) {
      table.columns = (table.columns as unknown[]).filter((c) => {
        const key = typeof c === "string" ? c : (c as { key?: string })?.key;
        return !!key && allowed.has(key);
      }) as unknown as typeof table.columns;
    }
    if (table.thumb_key && !allowed.has(table.thumb_key)) table.thumb_key = "";
  }
  const filter = spec.filter ? { ...spec.filter } : null;
  if (filter && Array.isArray(filter.fields)) {
    filter.fields = filter.fields.map((f) => {
      const col = (f.column || "").trim();
      if (col && !allowed.has(col)) return { ...f, column: "", options: [], default: "" };
      return f;
    });
  }
  return {
    ...spec,
    binding: binding as unknown as ComponentSpec["binding"],
    chart: chart as unknown as ComponentSpec["chart"],
    rank: rank as unknown as ComponentSpec["rank"],
    ...(table ? { table_view: table as ComponentSpec["table_view"] } : {}),
    ...(filter ? { filter: filter as ComponentSpec["filter"] } : {}),
  };
}

/** 文档里的 spec 可能是残缺的（导入 / 手工写入），按默认值补齐再进画布 */
export function normalizeSpec(raw: Partial<ComponentSpec> | undefined, title: string): ComponentSpec {
  const base = emptySpec(title);
  const src = raw ?? {};
  return {
    ...base,
    ...src,
    ui: { ...base.ui, ...(src.ui || {}) },
    binding: { ...base.binding, ...(src.binding || {}) },
    compute: { ...base.compute, ...(src.compute || {}) },
    chart: { ...base.chart, ...(src.chart || {}) },
    filter: { ...base.filter, ...(src.filter || {}) },
    content: { ...base.content, ...(src.content || {}) },
    rank: { ...base.rank, ...(src.rank || {}) },
    combo: { ...base.combo, ...(src.combo || {}) },
    table_view: { ...base.table_view, ...(src.table_view || {}) },
    banner: { ...base.banner, ...(src.banner || {}) },
    nav: { ...base.nav, ...(src.nav || {}) },
    layout: { ...base.layout, ...(src.layout || {}) },
  } as ComponentSpec;
}

export function toCanvasItem(item: DocItem): CanvasItem {
  const layout = item.layout;
  const kind = baseKind(item.component);
  const spec = normalizeSpec(item.spec, item.title || "组件");
  /* 指标卡/结论卡/分节标题没有维度概念：旧卡残留的维度直接清掉（面板上也没入口） */
  if (["kpi", "insight", "section"].includes(kind) && spec.binding.dimension) {
    spec.binding = { ...spec.binding, dimension: null };
  }
  return {
    key: item.key,
    kind,
    spec,
    x: layout?.x ?? 12,
    y: layout?.y ?? 12,
    w: layout?.w ?? 400,
    h: layout?.h ?? item.h ?? 260,
    type: item.type || "chart",
    text: item.text,
    note: item.note,
    index: item.index,
    icon: item.icon,
    size: item.size,
    weight: item.weight,
    align: item.align,
    action: item.action,
    row_action: item.row_action,
    component: item.component || undefined,
    raw: item as unknown as Record<string, unknown>,
  };
}

/**
 * 筛选栏判定 —— 页面级共用，永远不随平台切换。
 * 只看 type 不够：历史文档里有的筛选栏 type 存成了 chart，用 kind/component 兜底。
 */
export function isFilterBarItem(item: { type?: string; kind?: string; component?: string }): boolean {
  return item.type === "filter" || item.kind === "filter" || /filter/i.test(item.component || "");
}

/** 页面级共用元素：筛选栏 + 标题 / 文字 / 形状 —— 不随平台切换（否则切页会把这些元素带走或藏掉） */
/** 只有筛选栏是「整页共用」；标题 / 文字 / 形状 / 卡片都归当前平台那一套
 *  （在拼多多页删掉天猫的标题，天猫那边不能跟着没了 —— 2026-11-12 用户实测） */
export function isViewLevelItem(item: { type?: string; kind?: string; component?: string }): boolean {
  return isFilterBarItem(item);
}

/** 筛选栏一个字段都没有（含各平台那套）= 一个空框，没有任何作用：读文档时就清掉 */
export function isEmptyFilterItem(item: DocItem): boolean {
  if (!isFilterBarItem(item)) return false;
  const filter = item.spec?.filter as { fields?: unknown[]; fields_map?: Record<string, unknown[]> } | undefined;
  if (!filter) return false;
  /* 只看通用那份：它空了就没有平台入口，专套里剩的也永远渲染不出来 */
  return (filter.fields ?? []).length === 0;
}

/** 这一页有没有「分套依据」（筛选字段勾了分套，或旧版带 dataset_map）—— 有才需要分套存 items_map */
export function hasPlatformSwitcher(items: DocItem[]): boolean {
  return items.some((item) => Boolean(findSplitField(item.spec?.filter?.fields)));
}

export function dedupeByKey<T extends { key: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

/** 元素绑定的分套清单：分套字段的取值（数据集映射的键 / 选项值）+ 按套配置的字段集合 */
export function boundPlatforms(list: CanvasItem[]): string[] {
  const keys = new Set<string>();
  for (const item of list) {
    if (!isFilterBarItem(item)) continue;
    for (const field of item.spec?.filter?.fields ?? []) {
      if (!isSplitField(field)) continue;
      for (const key of splitKeysOf(field)) keys.add(key);
    }
    for (const key of Object.keys(item.spec?.filter?.fields_map || {})) keys.add(key);
  }
  return [...keys];
}

export function toDocItem(item: CanvasItem): DocItem {
  const raw = (item.raw || {}) as unknown as DocItem;
  const next: DocItem = {
    ...raw,
    key: item.key,
    span: raw.span ?? 4,
    h: item.h,
    layout: { x: item.x, y: item.y, w: item.w, h: item.h },
  };
  if (item.type) next.type = item.type;
  if (item.type === "chart" || item.type === "filter") {
    next.spec = item.spec;
    next.component = item.component || `base.${item.kind}`;
  } else {
    next.text = item.text;
    next.note = item.note;
    next.index = item.index;
    next.icon = item.icon;
    next.size = item.size;
    next.weight = item.weight;
    next.align = item.align;
    /* 页面元素也会带 spec：分割线的形状、画板绑定的数据集 */
    if (item.type === "divider" || item.type === "board") next.spec = item.spec;
  }
  return next;
}

/** 拖拽中的全局标记：期间暂停画布宽度重算，松手后一次性补上，拖动才顺滑 */
