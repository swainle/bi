import { formatChinaTime } from "../utils/time";
/** 统一编辑画布 —— 在自由画布上编辑业务看板（组件实例 + 页面元素 + 页面参数） */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  Menu, MenuItem, Snackbar, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import {
  Add, AlignHorizontalCenter, AlignHorizontalLeft, AlignHorizontalRight, AlignVerticalBottom,
  AlignVerticalCenter, AlignVerticalTop,
  ChevronLeft, ChevronRight, Close, CloudUpload, ContentCopy, CropFree, CropSquare, DeleteOutline, ExpandMore,
  Redo, Save, TextFields, Title as TitleIcon, Tune, Undo, Visibility,
} from "@mui/icons-material";
import client from "../api/client";
import BoardSurface, { type BoardSurfaceHandle } from "../features/components/board/BoardSurface";
import FieldPanel from "../features/components/editor/FieldPanel";
import QueryPanel from "../features/components/editor/QueryPanel";
import SharedFilterFieldsEditor from "../features/components/editor/FilterFieldsEditor";
import ChartTypeRail from "../features/components/editor/ChartTypeRail";
import OverlayScrollbar from "../features/components/editor/OverlayScrollbar";
import BoardViewer from "../features/components/board/BoardViewer";
import { CanvasDetailContext, asCanvasItem, autoKeyFieldOf, boardOf, boardViewItems, type InlineDetailPayload } from "../features/components/board/canvasDetail";
import { COMPONENT_SIZE } from "../features/components/sizes";
import { filterWithFields, findSplitField, isSplitField, splitKeysOf } from "../features/components/split";
import CanvasRuler, { RULER_SIZE } from "../features/components/editor/CanvasRuler";
import { useDatasetFields } from "../features/components/board/useDatasetFields";
import { snapGuide, snapMove } from "../features/components/board/snapping";
import { navHomePage } from "../features/components/navHome";
import ShapeView, { SHAPE_DEFAULT, SHAPE_KINDS, SHAPE_LABEL, SHAPE_SIZE, ShapeIcon, shapeOf } from "../features/components/shapes";
import FilterBar from "../features/components/renderers/FilterBar";
import { KIND_LABEL } from "../features/components/registry";
import type { CanvasItem } from "../features/components/boardTypes";
import type {
  ComponentItem, ComponentKind, ComponentSpec, DashboardDoc, DashboardRender,
  DatasetBrief, DocItem, FilterFieldSpec, Guide, RenderPayload, ShapeKind, ShapeSpec,
} from "../features/components/types";

interface DashboardBrief { id: number; name: string; updated_at?: string }

const ACCENTS = ["indigo", "teal", "amber", "rose", "violet", "slate", "sky"] as const;

/** 多选对齐的 6 个方向（图标 + 提示语） */
const ALIGN_ACTIONS = [
  { mode: "left", tip: "左对齐" },
  { mode: "hcenter", tip: "水平居中" },
  { mode: "right", tip: "右对齐" },
  { mode: "top", tip: "顶对齐" },
  { mode: "vcenter", tip: "垂直居中" },
  { mode: "bottom", tip: "底对齐" },
] as const;

/** 等间距图标：MUI 没有现成的，按设计软件的「三块等距」手写一个 */
function DistributeIcon({ axis }: { axis: "x" | "y" }) {
  const stops = [2.5, 8, 13.5];
  return (
    <Box component="svg" viewBox="0 0 18 18" sx={{ width: 17, height: 17, display: "block" }}>
      {stops.map((p, i) => (axis === "x"
        ? <rect key={i} x={p} y={2.5} width={2} height={13} rx={1} fill="currentColor" />
        : <rect key={i} x={2.5} y={p} width={13} height={2} rx={1} fill="currentColor" />))}
    </Box>
  );
}

function newKey(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
}

function baseKind(component?: string): ComponentKind {
  const kind = (component || "").replace("base.", "");
  return (kind || "kpi") as ComponentKind;
}

function emptySpec(title = "组件"): ComponentSpec {
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
function emptyNavSpec(): ComponentSpec {
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
function emptyBannerSpec(): ComponentSpec {
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
function pruneSpecFields(spec: ComponentSpec, allowed: Set<string>): ComponentSpec {
  if (!allowed.size) return spec;
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
  if (Array.isArray(binding.metrics)) {
    binding.metrics = (binding.metrics as { name?: string }[]).filter((m) => !!m?.name && allowed.has(m.name));
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
function normalizeSpec(raw: Partial<ComponentSpec> | undefined, title: string): ComponentSpec {
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

function toCanvasItem(item: DocItem): CanvasItem {
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
function isFilterBarItem(item: { type?: string; kind?: string; component?: string }): boolean {
  return item.type === "filter" || item.kind === "filter" || /filter/i.test(item.component || "");
}

/** 页面级共用元素：筛选栏 + 标题 / 文字 / 形状 —— 不随平台切换（否则切页会把这些元素带走或藏掉） */
/** 只有筛选栏是「整页共用」；标题 / 文字 / 形状 / 卡片都归当前平台那一套
 *  （在拼多多页删掉天猫的标题，天猫那边不能跟着没了 —— 2026-11-12 用户实测） */
function isViewLevelItem(item: { type?: string; kind?: string; component?: string }): boolean {
  return isFilterBarItem(item);
}

/** 筛选栏一个字段都没有（含各平台那套）= 一个空框，没有任何作用：读文档时就清掉 */
function isEmptyFilterItem(item: DocItem): boolean {
  if (!isFilterBarItem(item)) return false;
  const filter = item.spec?.filter as { fields?: unknown[]; fields_map?: Record<string, unknown[]> } | undefined;
  if (!filter) return false;
  /* 只看通用那份：它空了就没有平台入口，专套里剩的也永远渲染不出来 */
  return (filter.fields ?? []).length === 0;
}

/** 这一页有没有「分套依据」（筛选字段勾了分套，或旧版带 dataset_map）—— 有才需要分套存 items_map */
function hasPlatformSwitcher(items: DocItem[]): boolean {
  return items.some((item) => Boolean(findSplitField(item.spec?.filter?.fields)));
}

function dedupeByKey<T extends { key: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => (seen.has(item.key) ? false : (seen.add(item.key), true)));
}

/** 元素绑定的分套清单：分套字段的取值（数据集映射的键 / 选项值）+ 按套配置的字段集合 */
function boundPlatforms(list: CanvasItem[]): string[] {
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

function toDocItem(item: CanvasItem): DocItem {
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
const paneDragging = { active: false };
/** 折叠/展开动画进行中：期间不重算画布，动画结束补一次，避免每帧重渲染 */
const paneAnimating = { active: false };

/** PS 式拖拽分栏：拖拽中直接改 CSS 变量（零 React 重渲染），松手才落 state / localStorage */
function useResizableWidth(
  key: string, initial: number, min: number, max: number,
  dir: 1 | -1 = 1, onResizeEnd?: () => void,
) {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
  });
  const paneRef = useRef<HTMLDivElement | null>(null);

  // 初值与拖拽结束都走这里写变量；sx 里只引用变量，重渲染不会覆盖拖拽结果
  useEffect(() => {
    const el = paneRef.current;
    if (el) el.style.setProperty("--pane-w", `${width}px`);
  }, [width]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = paneRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    let latest = startW;
    let raf = 0;
    paneDragging.active = true;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const apply = () => { raf = 0; el.style.setProperty("--pane-w", `${latest}px`); };
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(max, Math.max(min, startW + (ev.clientX - startX) * dir));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      el.style.setProperty("--pane-w", `${latest}px`);
      const rounded = Math.round(latest);
      localStorage.setItem(key, String(rounded));
      paneDragging.active = false;
      setWidth(rounded);
      onResizeEnd?.();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [key, min, max, dir, onResizeEnd]);

  return { width, onDragStart, paneRef };
}

/** 折叠后的窄条：竖排标题，点击展开（PS 式收起面板） */
function CollapseStrip({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      title={`展开${label}`}
      sx={{
        width: 24, flexShrink: 0, bgcolor: "#fff", cursor: "pointer",
        borderRight: side === "left" ? "1px solid #EEF3FB" : "none",
        borderLeft: side === "right" ? "1px solid #EEF3FB" : "none",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
        transition: "background-color .12s ease",
        animation: "mz-strip-in .18s ease both",
        "&:hover": { bgcolor: "rgba(79,70,229,0.05)" },
      }}
    >
      {side === "left"
        ? <ChevronRight sx={{ fontSize: 16, color: "#94A3B8" }} />
        : <ChevronLeft sx={{ fontSize: 16, color: "#94A3B8" }} />}
      <Typography sx={{ fontSize: 10.5, color: "#94A3B8", writingMode: "vertical-rl", letterSpacing: 1.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

/** 面板内的折叠按钮（hover 才明显，保持界面干净） */
function CollapseButton({ dir, title, onClick }: { dir: "left" | "right"; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <IconButton
      size="small" onClick={onClick} title={title}
      sx={{
        position: "absolute", top: 6, right: 4, zIndex: 7, width: 22, height: 22,
        color: "#94A3B8", opacity: 0.55, transition: "opacity .12s ease, color .12s ease",
        "&:hover": { opacity: 1, color: "#4F46E5", bgcolor: "rgba(79,70,229,0.08)" },
        "& .MuiSvgIcon-root": { fontSize: 16 },
      }}
    >
      {dir === "left" ? <ChevronLeft /> : <ChevronRight />}
    </IconButton>
  );
}

/** 分栏手柄：1px 分隔线，hover 变紫并加宽，光标 col-resize */
function Splitter({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <Box
      onMouseDown={onMouseDown}
      sx={{
        width: 5, flexShrink: 0, cursor: "col-resize", position: "relative", zIndex: 3,
        "&::after": {
          content: '""', position: "absolute", top: 0, bottom: 0, left: 2, width: 1,
          bgcolor: "#EEF3FB", transition: "background-color .12s ease",
        },
        "&:hover::after, &:active::after": { bgcolor: "#4F46E5", width: 2, left: 1.5 },
      }}
    />
  );
}

export default function CanvasBoardPage() {
  const nav = useNavigate();
  const [search, setSearch] = useSearchParams();
  const docParam = Number(search.get("doc") || 0);

  const [docs, setDocs] = useState<DashboardBrief[]>([]);
  /** 顶栏点当前看板的名字可以直接改（空名字或 Esc 放弃） */
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  /** 没带 ?doc 时落到「最近更新的看板」——从侧栏「编辑设计」进来直接就有内容 */
  const docId = docParam || docs[0]?.id || 0;
  const [datasets, setDatasets] = useState<DatasetBrief[]>([]);
  const [activeDatasetId, setActiveDatasetId] = useState<number | null>(null);
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  const [view, setView] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [items, setItems] = useState<CanvasItem[]>([]);
  /** 行详情「画布编辑」模式：画布临时切换成该明细表的详情面板 */
  const [detailEditKey, setDetailEditKey] = useState<string | null>(null);
  const detailReturnRef = useRef<CanvasItem[] | null>(null);
  const [cards, setCards] = useState<Record<string, RenderPayload>>({});
  const [paramDefs, setParamDefs] = useState<FilterFieldSpec[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  /** 删除筛选栏前的确认：keys = 待删元素，platforms = 它绑定的平台 */
  const [deleteConfirm, setDeleteConfirm] = useState<{ keys: string[]; platforms: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  /** 正在进行的动作：save=只保存草稿，publish=保存并发布到「我的看板」 */
  const [saving, setSaving] = useState<"save" | "publish" | null>(null);
  const [rendering, setRendering] = useState(false);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: "success" | "error" }>({
    open: false, msg: "", severity: "success",
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  /** 拖拽结束补测一次画布宽（拖拽期间 ResizeObserver 被暂停） */
  const syncStageWidth = useCallback(() => {
    const el = stageRef.current;
    if (el) setStageWidth(el.clientWidth);
  }, []);
  /** 画布内的行详情面板（点明细表行时在画布右侧弹出，不遮编辑器） */
  const [inlineDetail, setInlineDetail] = useState<InlineDetailPayload | null>(null);
  /** 三栏折叠状态（PS 式收起面板，给画布腾地方），记在本地 */
  const paneAnimTimer = useRef<number>(0);
  const [collapsed, setCollapsed] = useState<{ left?: boolean; mid?: boolean; right?: boolean }>(() => {
    try { return JSON.parse(localStorage.getItem("mzbi.editor.collapsed") || "{}"); } catch { return {}; }
  });
  const togglePane = useCallback((key: "left" | "mid" | "right") => {
    paneAnimating.active = true;
    window.clearTimeout(paneAnimTimer.current);
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("mzbi.editor.collapsed", JSON.stringify(next));
      return next;
    });
    // 动画 240ms + 余量：结束后解除冻结并补测画布宽
    paneAnimTimer.current = window.setTimeout(() => {
      paneAnimating.active = false;
      syncStageWidth();
    }, 300);
  }, [syncStageWidth]);
  /** 三栏宽度：可拖拽（PS 式），记在本地，刷新后保留 */
  const leftW = useResizableWidth("mzbi.editor.leftW", 232, 180, 420, 1, syncStageWidth);
  const midW = useResizableWidth("mzbi.editor.midW", 336, 280, 560, 1, syncStageWidth);
  const rightW = useResizableWidth("mzbi.editor.rightW", 168, 140, 340, -1, syncStageWidth);
  /** 画布的实时层句柄：标尺拉参考线时直接推给 DOM，不 setState */
  const surfaceRef = useRef<BoardSurfaceHandle>(null);
  const [stageWidth, setStageWidth] = useState(1000);
  const [stageViewportH, setStageViewportH] = useState(600);
  const [canvasScrollTop, setCanvasScrollTop] = useState(0);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [guideMenu, setGuideMenu] = useState<{ x: number; y: number; id?: string } | null>(null);
  /** 工具栏「矩形」下拉的锚点 */
  const [shapeAnchor, setShapeAnchor] = useState<HTMLElement | null>(null);
  /** 后端账本：本看板每个元素用了哪个数据集（页面 ID / 元素 ID / 数据集） */
  const [docSources, setDocSources] = useState<{ view_key: string; item_key: string; dataset_id: number; role: string }[]>([]);
  const [guidesVisible, setGuidesVisible] = useState(true);
  /** 画布外左右溢出区的浅灰提醒层（工具栏「溢出区」开关） */
  const [bleedMask, setBleedMask] = useState(true);

  /* ── 撤销 / 重做：版面快照栈（拖拽按一次交互记一步，面板输入按 500ms 静默合并） ── */
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const prevSnap = useRef("");
  const lastPushAt = useRef(0);
  const interactionSnap = useRef<string | null>(null);
  const itemsRef = useRef<CanvasItem[]>([]);
  const guidesRef = useRef<Guide[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /** 右侧类型栏 = 组件库（与 /bi/components 同一份数据） */
  const [components, setComponents] = useState<ComponentItem[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(true);
  const initialized = useRef(false);

  /** 改看板名字：空名 / 没变化就直接退出，失败提示一句 */
  const commitRename = useCallback(async () => {
    const name = renameDraft.trim();
    setRenaming(false);
    if (!name || !docId) return;
    const current = docs.find((d) => d.id === docId);
    if (current && current.name === name) return;
    try {
      await client.patch(`/bi/dashboards/${docId}`, { name });
      setDocs((prev) => prev.map((d) => (d.id === docId ? { ...d, name } : d)));
      setToast({ open: true, msg: "已重命名", severity: "success" });
    } catch {
      setToast({ open: true, msg: "重命名失败", severity: "error" });
    }
  }, [renameDraft, docId, docs]);

  /** 顶栏的看板 chip：最近编辑的 3 个（当前这个一定在里面，其余按更新时间倒序补） */
  const recentDocs = useMemo(() => {
    const current = docs.find((d) => d.id === docId);
    const others = docs.filter((d) => d.id !== docId);
    return [...(current ? [current] : []), ...others].slice(0, 3);
  }, [docs, docId]);

  /** 主选中 = 最后点的那个；多选时「属性面板」不绑定任何单个元素 */
  const selected = selectedKeys.length ? selectedKeys[selectedKeys.length - 1] : null;

  const selectOnly = (key: string | null) => {
    setSelectedKeys(key ? [key] : []);
    setDetailCardKey("");
  };



  /* ── 复制 / 粘贴 / ⌥拖复制 ── */
  /** 页内剪贴板：切页面、切平台都不丢；同时写进系统剪贴板，跨看板也能粘 */
  const clipboardRef = useRef<DocItem[] | null>(null);
  const pasteTimes = useRef(0);

  const keyPrefixFor = (item: DocItem) => {
    if (item.type === "filter") return "f";
    if (item.type === "heading") return "h";
    if (item.type === "text") return "t";
    if (item.type === "divider") return "s";
    return "c";
  };

  /** 深拷贝一份元素（新 ID），位置可偏移 */
  const cloneDocItem = (item: DocItem, dx = 0, dy = 0): DocItem => {
    const copy: DocItem = JSON.parse(JSON.stringify(item));
    copy.key = newKey(keyPrefixFor(item));
    const layout = copy.layout ?? { x: 0, y: 0, w: 400, h: 240 };
    copy.layout = {
      x: Math.max(0, Math.round((layout.x ?? 0) + dx)),
      y: Math.max(0, Math.round((layout.y ?? 0) + dy)),
      w: layout.w ?? 400,
      h: layout.h ?? 240,
    };
    return copy;
  };

  const insertCopies = (sources: DocItem[], dx: number, dy: number) => {
    if (!sources.length) return;
    const copies = sources.map((item) => cloneDocItem(item, dx, dy));
    setItems((prev) => [...prev, ...copies.map(toCanvasItem)]);
    setSelectedKeys(copies.map((c) => c.key));
    setDirty(true);
    setToast({ open: true, msg: `已粘贴 ${copies.length} 个元素`, severity: "success" });
  };

  /** ⌘C：把选中的元素放进剪贴板（同时写系统剪贴板，便于跨看板） */
  const copySelection = () => {
    const chosen = items.filter((i) => selectedKeys.includes(i.key));
    if (!chosen.length) return;
    const docs = chosen.map(toDocItem);
    clipboardRef.current = docs;
    pasteTimes.current = 0;
    try {
      void navigator.clipboard?.writeText(JSON.stringify({ mingzebi: 1, items: docs }));
    } catch { /* 剪贴板不可用就只留页内那份 */ }
    setToast({ open: true, msg: `已复制 ${docs.length} 个元素`, severity: "success" });
  };

  /** ⌘V：粘到当前页面（同一看板换页也能粘；反复粘贴会阶梯错开） */
  const pasteSelection = async () => {
    let docs = clipboardRef.current;
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const parsed = JSON.parse(text) as { mingzebi?: number; items?: DocItem[] };
        if (parsed?.mingzebi === 1 && Array.isArray(parsed.items) && parsed.items.length) docs = parsed.items;
      }
    } catch { /* 没权限就退回页内剪贴板 */ }
    if (!docs?.length) {
      setToast({ open: true, msg: "剪贴板里没有可粘贴的元素", severity: "error" });
      return;
    }
    pasteTimes.current += 1;
    const step = 24 * pasteTimes.current;
    insertCopies(docs, step, step);
  };

  /** ⌥ + 拖动：先在原位复制一份（原元素继续被拖走），像 PS 的「按住 Alt 拖动 = 复制」 */
  const duplicateForDrag = useCallback((key: string) => {
    const keys = selectedKeys.includes(key) ? selectedKeys : [key];
    const chosen = items.filter((i) => keys.includes(i.key));
    if (!chosen.length) return;
    const copies = chosen.map((item) => toCanvasItem(cloneDocItem(toDocItem(item))));
    setItems((prev) => [...prev, ...copies]);
    setDirty(true);
    // 选中的仍是「被拖走的那一份」，复制出来的留在原位
  }, [items, selectedKeys]);

  const toggleSelect = (key: string) => setSelectedKeys((prev) => (
    prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
  ));

  /** ⌘/Ctrl + A 全选、方向键微移、Delete 删除、Esc 取消选择 */
  useEffect(() => {
    const nudge = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return true;
      return false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (nudge(event)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && !event.altKey && key === "a") {
        event.preventDefault();
        setSelectedKeys(items.map((i) => i.key));
        return;
      }

      if (mod && !event.altKey && !event.shiftKey && key === "c" && selectedKeys.length) {
        event.preventDefault();
        copySelection();
        return;
      }

      if (mod && !event.altKey && !event.shiftKey && key === "v") {
        event.preventDefault();
        void pasteSelection();
        return;
      }

      if (key === "escape") { setSelectedKeys([]); return; }

      if ((key === "delete" || key === "backspace") && selectedKeys.length) {
        event.preventDefault();
        requestDelete(selectedKeys);
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      const delta: Record<string, [number, number]> = {
        arrowleft: [-step, 0], arrowright: [step, 0],
        arrowup: [0, -step], arrowdown: [0, step],
      };
      const move = delta[key];
      if (!move || !selectedKeys.length || mod) return;
      event.preventDefault();
      const [dx, dy] = move;
      setItems((prev) => prev.map((item) => (
        selectedKeys.includes(item.key)
          ? { ...item, x: Math.max(0, item.x + dx), y: Math.max(0, item.y + dy) }
          : item
      )));
      setDirty(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [items, selectedKeys]);

  /** ⌘/Ctrl + H（以及 PS 的 ⌘/Ctrl + ;）一键显示/隐藏全部参考线 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "h" && key !== ";") return;
      event.preventDefault();
      setGuidesVisible((visible) => !visible);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** 画布滚动 → 左侧标尺刻度跟着走 */
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const sync = () => setCanvasScrollTop(el.scrollTop);
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    return () => el.removeEventListener("scroll", sync);
  }, []);

  /** 左侧标尺条高度 = 画布可视高度 */
  useEffect(() => {
    const el = rulerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect?.height ?? 0;
      if (height > 0) setStageViewportH(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** 后端落了「组件 → 数据源」账本，这里取回来做本看板的引用提示 */
  useEffect(() => {
    if (!docId) return;
    client.get(`/bi/dashboards/${docId}/sources`)
      .then((res) => setDocSources(res.data?.sources || []))
      .catch(() => setDocSources([]));
  }, [docId, revision]);

  useEffect(() => {
    client.get("/bi/dashboards").then((res) => setDocs(res.data?.dashboards || [])).catch(() => {});
    client.get("/bi/semantic/datasets").then((res) => setDatasets(res.data?.datasets || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!docId) return;
    client.get(`/bi/dashboards/${docId}`).then((res) => {
      const loaded: DashboardDoc = res.data?.doc;
      if (!loaded) return;
      /* 旧结构（标题/形状挂在页面级）先在内存里分到各平台，避免切平台少一截内容 */
      const next = migratePlatformSplit(loaded).doc;
      setDoc(next);
      /* 导航菜单卡勾了「首视页」就落到那一页，否则退回第一页 */
      const firstView = navHomePage(next) || next.views?.[0]?.key || "";
      const firstViewDef = next.views?.find((v) => v.key === firstView) ?? next.views?.[0];
      const firstItems = (firstViewDef?.items || []).filter((item) => !isEmptyFilterItem(item)).map(toCanvasItem);
      setView(firstView);
      setItems(firstItems);
      setGuides(firstViewDef?.guides ?? []);
      resetHistory(firstItems, firstViewDef?.guides ?? []);
      initialized.current = false;
      /* 换了一份文档：平台游标要归零，否则同名平台不会重新装载那套卡片 */
      platformRef.current = "";
      setParams({});
      setDirty(false);
      // 进场就选中第一张图 —— 左栏字段 / 口径 / 维度 / 指标 / 外观直接可编辑
      selectOnly((firstItems.find((i) => i.type === "chart") || firstItems[0])?.key ?? null);
    }).catch(() => {});
  }, [docId]);

  const currentView = useMemo(
    () => doc?.views.find((v) => v.key === view) ?? doc?.views[0] ?? null,
    [doc, view],
  );

  /** 当前平台：取筛选栏里那个「数据集切换器」的值（没配就是单套版面） */
  const activePlatform = useMemo(() => {
    const def = findSplitField(paramDefs);
    if (!def) return "";
    const value = params[def.id] ?? def.default;
    if (value === undefined || value === null || value === "" || value === "all" || value === "全部") return "";
    return String(value);
  }, [paramDefs, params]);

  /** 真正执行删除（键盘 / 确认弹窗都走这里） */
  const removeItems = useCallback((keys: string[]) => {
    if (!keys.length) return;
    setItems((prev) => prev.filter((i) => !keys.includes(i.key)));
    setSelectedKeys((prev) => prev.filter((k) => !keys.includes(k)));
    setDirty(true);
  }, []);

  /** 删除前先判断：绑了平台的筛选栏 → 弹确认；其余直接删 */
  const requestDelete = useCallback((keys: string[]) => {
    const doomed = items.filter((i) => keys.includes(i.key));
    const platforms = boundPlatforms(doomed);
    if (platforms.length) {
      setDeleteConfirm({ keys: doomed.map((i) => i.key), platforms });
      return;
    }
    removeItems(doomed.map((i) => i.key));
  }, [items, removeItems]);

  /** 版面拆两半：筛选栏共用；其余卡片属于当前平台 */
  /** 旧结构自愈：doc 里有 items_map，但标题/形状还挂在页面级 items 上
   *  —— 复制进每个「还没有标题/形状」的平台那套，然后页面级只留筛选栏。
   *  和后端 heal_view_filters 同一套口径，保证编辑器里看到的就是保存后的样子。 */
  const migratePlatformSplit = useCallback((source: DashboardDoc): { doc: DashboardDoc; changed: boolean } => {
    const decor = new Set(["heading", "text", "divider"]);
    const filterOf = (item: DocItem) => (item.type || "") === "filter" || isFilterBarItem(item);
    let changed = false;
    const views = source.views.map((view) => {
      const mapping = view.items_map;
      if (!mapping || !Object.keys(mapping).length) return view;
      const shared = (view.items ?? []).filter(filterOf);
      const legacy = (view.items ?? []).filter((item) => !filterOf(item));
      if (shared.length === (view.items ?? []).length && !legacy.length) return view;
      const nextMap: Record<string, DocItem[]> = {};
      Object.entries(mapping).forEach(([key, list]) => {
        const items = [...(list ?? [])];
        if (legacy.length) {
          const keys = new Set(items.map((item) => item.key));
          const hasDecor = items.some((item) => decor.has(item.type || ""));
          legacy.forEach((item) => {
            if (keys.has(item.key)) return;
            if (decor.has(item.type || "") && hasDecor) return;
            items.push(item);
            keys.add(item.key);
          });
        }
        nextMap[key] = items;
      });
      changed = true;
      return { ...view, items: shared, items_map: nextMap };
    });
    return { doc: changed ? { ...source, views } : source, changed };
  }, []);

  const splitItems = useCallback((list: CanvasItem[]) => {
    const filters = list.filter(isViewLevelItem).map(toDocItem);
    const others = list.filter((i) => !isViewLevelItem(i)).map(toDocItem);
    return { filters, others };
  }, []);

  /** 把当前页的版面写回 doc（切页 / 切平台 / 保存之前调一次，来回切不丢未保存改动） */
  const stashView = useCallback((source: DashboardDoc, list: CanvasItem[] = items, guard = true): DashboardDoc => {
    /* 正在编辑「行详情面板」时，画布上的 items 不是页面内容：切页/切平台先不落盘，免得把详情卡片写进页面 */
    if (guard && detailEditKey) return source;
    return {
    ...source,
    views: source.views.map((v) => {
      if (v.key !== view) return v;
      const { filters, others } = splitItems(list);
      if (!activePlatform) {
        const next: typeof v = { ...v, items: list.map(toDocItem), guides };
        /* 这页没有平台切换器 → 旧的 items_map 是历史残留，清掉，免得同一张卡在 items / items_map 各存一份 */
        if (!hasPlatformSwitcher(next.items ?? [])) next.items_map = undefined;
        return next;
      }
      return {
        ...v,
        items: filters,
        items_map: { ...(v.items_map || {}), [activePlatform]: others },
        guides,
      };
    }),
    };
  }, [view, items, guides, activePlatform, splitItems, detailEditKey]);

  /** 页面上的所有画板（含其他页面与分套里的）：明细表弹窗要能选到 */
  const boardOptions = useMemo(() => {
    const found: { key: string; label: string }[] = [];
    const collect = (list?: unknown[]) => {
      (list ?? []).forEach((raw) => {
        const it = raw as { key?: string; type?: string; text?: string };
        if (it?.type === "board" && it.key) found.push({ key: it.key, label: it.text || "画板" });
      });
    };
    collect(items);
    (doc?.views ?? []).forEach((v) => {
      collect(v.items as unknown[]);
      Object.values(v.items_map ?? {}).forEach((list) => collect(list as unknown[]));
    });
    return [...new Map(found.map((b) => [b.key, b])).values()];
  }, [items, doc]);

  /** 按 key 找画板：当前画布优先，其次其它页面（跨页面弹窗） */
  const findBoard = useCallback((key: string | undefined) => {
    const local = boardOf(items, key);
    if (local) return local;
    for (const v of doc?.views ?? []) {
      const lists: unknown[][] = [
        (v.items ?? []) as unknown[],
        ...Object.values(v.items_map ?? {}).map((l) => (l ?? []) as unknown[]),
      ];
      for (const list of lists) {
        const area = boardOf(list.map((it) => asCanvasItem(it)), key);
        if (area) return area;
      }
    }
    return null;
  }, [items, doc]);

  /** 进入「详情画布」：画布切换成该明细表的行详情组件，像页面一样拖拽编辑 */
  const enterDetailEdit = useCallback((tableKey: string) => {
    const table = items.find((it) => it.key === tableKey);
    if (!table) return;
    const cards = table.spec?.table_view?.detail?.items ?? [];
    detailReturnRef.current = items;
    setDetailEditKey(tableKey);
    setSelectedKeys([]);
    setItems(cards.map((card, index) => ({
      key: card.key || `d_${index}`,
      kind: card.kind as ComponentKind,
      component: card.component,
      type: "chart",
      x: 8, y: 24 + index * 250, w: 440, h: Math.max(60, card.h || 220),
      spec: card.spec as ComponentSpec,
    })));
  }, [items]);

  /** 提交详情画布的改动，返回恢复后的主画布 items */
  const commitDetailEdit = useCallback((): CanvasItem[] => {
    const tableKey = detailEditKey;
    const main = detailReturnRef.current;
    if (!tableKey || !main) return items;
    const cards = items.map((it) => ({
      key: it.key,
      component: it.component || "",
      kind: String(it.kind),
      h: Math.max(60, Math.round(it.h)),
      spec: it.spec,
    }));
    const nextMain = main.map((it) => {
      if (it.key !== tableKey) return it;
      const tv = it.spec?.table_view ?? ({} as NonNullable<ComponentSpec["table_view"]>);
      const detail = tv.detail ?? { enabled: true, key_field: "", items: [] };
      return { ...it, spec: { ...it.spec, table_view: { ...tv, detail: { ...detail, items: cards } } } };
    });
    detailReturnRef.current = null;
    setDetailEditKey(null);
    setSelectedKeys([]);
    setDirty(true);
    return nextMain;
  }, [detailEditKey, items]);

  const cancelDetailEdit = useCallback(() => {
    const main = detailReturnRef.current;
    detailReturnRef.current = null;
    setDetailEditKey(null);
    setSelectedKeys([]);
    if (main) setItems(main);
  }, []);

  const switchView = (key: string) => {
    if (!doc) return;
    platformRef.current = "";
    const stashed = stashView(doc);
    const target = stashed.views.find((v) => v.key === key);
    if (!target) return;
    /* 只有当当前页确实改过才标脏，单纯切页不弹「未保存」 */
    const previous = doc.views.find((v) => v.key === view);
    const changed = JSON.stringify(previous?.items ?? []) !== JSON.stringify(target.items ?? [])
      || JSON.stringify(previous?.guides ?? []) !== JSON.stringify(target.guides ?? []);
    setDoc(stashed);
    setView(key);
    setGuides(target.guides ?? []);
    const nextItems = target.items.map(toCanvasItem);
    setItems(nextItems);
    resetHistory(nextItems, target.guides ?? []);
    selectOnly((nextItems.find((i) => i.type === "chart") || nextItems[0])?.key ?? null);
    setEditingPage(null);
    if (changed) setDirty(true);
  };

  /* 平台切换 = 换一套卡片：当前这套先落回 doc，再把目标平台那套装进画布 */
  const platformRef = useRef("");
  useEffect(() => {
    if (!doc || !view) return;
    if (!activePlatform || platformRef.current === activePlatform) return;
    const previous = platformRef.current;
    const current = doc.views.find((v) => v.key === view);
    if (!current) return;

    const { filters, others } = splitItems(items);
    const map = { ...(current.items_map || {}) };
    if (previous) map[previous] = others;          // 上一套（含首次进入时的「单套版面」）存好
    const seeded = !map[activePlatform];
    if (seeded) {
      // 新平台第一次进来：复制一套当起点（当前这套为空就拿别的平台那套）
      const fallback = Object.entries(map)
        .filter(([key, list]) => key !== activePlatform && list.length)
        .map(([, list]) => list)[0];
      map[activePlatform] = others.length ? others : (fallback ?? []);
    }

    const nextDoc: DashboardDoc = {
      ...doc,
      views: doc.views.map((v) => (v.key === view
        ? { ...v, items: filters, items_map: map }
        : v)),
    };
    const nextItems = [...filters, ...(map[activePlatform] || [])].map(toCanvasItem);
    platformRef.current = activePlatform;
    setDoc(nextDoc);
    setItems(nextItems);
    resetHistory(nextItems, guides);
    /* 切平台只换卡片，筛选栏（共用）在场就保留选中，省得再点一次 */
    const keep = selectedKeys.filter((k) => nextItems.some((i) => i.key === k));
    selectOnly(keep.length ? keep[keep.length - 1] : null);
    if (seeded) setDirty(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePlatform, view, doc]);

  /* 有分平台内容、但当前还没选平台（比如默认值空着）：先显示第一套，别给白板 */
  useEffect(() => {
    if (!doc || !view || activePlatform) return;
    const current = doc.views.find((v) => v.key === view);
    const map = current?.items_map;
    if (!map || !Object.keys(map).length) return;
    const first = Object.values(map).find((list) => list.length);
    if (!first) return;
    /* 共用部分只认「画布上现在真实存在的」—— 不能从 doc 里补，
       否则用户删掉的筛选栏会被这个兜底逻辑又装回来（踩过）。 */
    const shared = items.filter(isViewLevelItem).map(toDocItem);
    const perPlatform = first.filter((item) => !isViewLevelItem(item));
    setItems(dedupeByKey([...shared, ...perPlatform]).map(toCanvasItem));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, view, activePlatform]);

  /** 新建页面：同一看板下的一页，默认名「页面N」，建完直接进重命名 */
  const addPage = () => {
    if (!doc) return;
    const stashed = stashView(doc);
    const title = `页面${stashed.views.length + 1}`;
    const key = `page_${Date.now().toString(36)}`;
    setDoc({ ...stashed, views: [...stashed.views, { key, title, items: [], guides: [] }] });
    setView(key);
    setItems([]);
    setGuides([]);
    setSelectedKeys([]);
    setDirty(true);
    setEditingPage({ key, draft: title });
  };

  const renamePage = (key: string, title: string) => {
    if (!doc) return;
    const clean = (title || "").trim().slice(0, 16) || "页面";
    setDoc({ ...doc, views: doc.views.map((v) => (v.key === key ? { ...v, title: clean } : v)) });
    setEditingPage(null);
    setDirty(true);
  };

  const duplicatePage = (key: string) => {
    if (!doc) return;
    const stashed = stashView(doc);
    const source = stashed.views.find((v) => v.key === key);
    if (!source) return;
    const stamp = Date.now().toString(36);
    const copy = {
      key: `page_${stamp}`,
      title: `${source.title || "页面"} 副本`.slice(0, 16),
      items: source.items.map((item, index) => ({ ...item, key: `${item.key}_${stamp}${index}` })),
      guides: (source.guides ?? []).map((guide, index) => ({ ...guide, id: `g_${stamp}${index}` })),
    };
    setDoc({ ...stashed, views: [...stashed.views, copy] });
    setDirty(true);
  };

  const deletePage = (key: string) => {
    if (!doc || doc.views.length <= 1) return;
    const stashed = stashView(doc);
    const views = stashed.views.filter((v) => v.key !== key);
    setDoc({ ...stashed, views });
    if (key === view) {
      const target = views[0];
      setView(target.key);
      setGuides(target.guides ?? []);
      const nextItems = target.items.map(toCanvasItem);
      setItems(nextItems);
      selectOnly((nextItems.find((i) => i.type === "chart") || nextItems[0])?.key ?? null);
    }
    setDirty(true);
  };

  const commitPageRename = () => {
    if (!editingPage) return;
    renamePage(editingPage.key, editingPage.draft);
  };

  /* ── 撤销 / 重做 ── */
  const snapOf = useCallback((nextItems: CanvasItem[], nextGuides: Guide[]) => JSON.stringify({
    items: nextItems.map(toDocItem), guides: nextGuides,
  }), []);

  const pushHistory = useCallback((snap: string) => {
    const h = historyRef.current;
    if (!snap) return;
    h.past.push(snap);
    if (h.past.length > 80) h.past.shift();
    h.future = [];
    lastPushAt.current = Date.now();
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const applySnapshot = useCallback((snap: string) => {
    const parsed = JSON.parse(snap) as { items: DocItem[]; guides?: Guide[] };
    setItems((parsed.items ?? []).map(toCanvasItem));
    setGuides(parsed.guides ?? []);
    prevSnap.current = snap;
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const target = h.past.pop();
    if (!target) return;
    const current = snapOf(itemsRef.current, guidesRef.current);
    h.future.push(current);
    applySnapshot(target);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
  }, [applySnapshot, snapOf]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const target = h.future.pop();
    if (!target) return;
    const current = snapOf(itemsRef.current, guidesRef.current);
    h.past.push(current);
    applySnapshot(target);
    setCanUndo(true);
    setCanRedo(h.future.length > 0);
  }, [applySnapshot, snapOf]);

  const resetHistory = useCallback((nextItems: CanvasItem[], nextGuides: Guide[]) => {
    historyRef.current = { past: [], future: [] };
    prevSnap.current = snapOf(nextItems, nextGuides);
    lastPushAt.current = 0;
    interactionSnap.current = null;
    setCanUndo(false);
    setCanRedo(false);
  }, [snapOf]);

  /* 面板里改属性 / 点按钮添加删除 → 静默 500ms 合并成一步 */
  useEffect(() => {
    itemsRef.current = items;
    guidesRef.current = guides;
    const snap = snapOf(items, guides);
    if (!prevSnap.current) { prevSnap.current = snap; return; }
    if (snap === prevSnap.current) return;
    const previous = prevSnap.current;
    prevSnap.current = snap;
    if (interactionSnap.current !== null) return;   // 拖拽中不记，松手时记一步
    if (Date.now() - lastPushAt.current < 500) return;
    pushHistory(previous);
  }, [items, guides, snapOf, pushHistory]);

  /* 画布内一次按下-松开 = 一步（拖元素 / 拉尺寸 / 拖动即一次） */
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const el = canvasRef.current;
      if (!el || !el.contains(event.target as Node)) return;
      interactionSnap.current = prevSnap.current || snapOf(itemsRef.current, guidesRef.current);
    };
    const up = () => {
      if (interactionSnap.current === null) return;
      const before = interactionSnap.current;
      interactionSnap.current = null;
      const now = snapOf(itemsRef.current, guidesRef.current);
      if (before && before !== now) pushHistory(before);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
    };
  }, [pushHistory, snapOf]);

  /* ⌘Z / ⇧⌘Z（输入框里不拦） */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /** 只有「决定数据」的部分变了才重查：绑定 / 口径 / 筛选栏字段（挪坐标、改外观看样式不触发） */
  const dataSig = useMemo(
    () => JSON.stringify(items.map((item) => (
      item.type === "chart" ? [
        item.key, item.kind, item.spec?.binding, item.spec?.compute, item.spec?.table_view,
        /* 头标卡右侧统计绑了指标：换字段/汇总/格式都要重算 */
        item.spec?.banner?.stats?.map((st) => [st.metric, st.agg, st.format]),
        /* 散点的 X / Y / 气泡字段与模式会改变取哪些列，必须重查（否则改完不生效） */
        item.spec?.chart
          ? [item.spec.chart.x_key, item.spec.chart.y_key, item.spec.chart.size_key, item.spec.chart.scatter_mode]
          : null,
      ]
        : item.type === "filter" ? [item.key, item.spec?.filter]
        : null
    )).filter(Boolean)),
    [items],
  );

  /* 渲染当前视图（防抖）—— 把当前版面一起发过去，没保存也能边改边看 */
  useEffect(() => {
    if (!view || !docId) return;
    setRendering(true);
    const timer = window.setTimeout(() => {
      client.post(`/bi/dashboards/${docId}/render`, {
        view, params, items: items.map(toDocItem),
      })
        .then((res) => {
          const data: DashboardRender = res.data;
          setCards(data.cards || {});
          setParamDefs(data.param_defs || []);
          if (!initialized.current) {
            initialized.current = true;
            setParams((prev) => ({ ...data.params, ...prev }));
          }
        })
        .catch(() => setCards({}))
        .finally(() => setRendering(false));
    }, 200);
    return () => window.clearTimeout(timer);
    // items 只认 dataSig：拖拽引起的坐标变化不该重跑 SQL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, view, params, revision, dataSig]);

  /** 页面（同一看板下的多页）：右键菜单与就地重命名 */
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [editingPage, setEditingPage] = useState<{ key: string; draft: string } | null>(null);
  /** 组件库（类型栏的数据源；库里增删改，画布跟着变）—— 进页面拉一次，回到页面再拉一次 */
  useEffect(() => {
    let alive = true;
    const load = (first: boolean) => {
      client.get("/bi/components")
        .then((res) => { if (alive) setComponents(res.data?.components || []); })
        .catch(() => { if (alive && first) setComponents([]); })
        .finally(() => { if (alive && first) setComponentsLoading(false); });
    };
    load(true);
    /* 库在别处（组件库页 / 存为默认）被改过时，切回画布就能看到最新配置，不用手动刷新 */
    const onVisible = () => { if (document.visibilityState === "visible") load(false); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // 画布宽度变化（拖分栏 / 折叠动画）统一 rAF 合并到每帧一次，保持顺滑
    let raf = 0;
    let pendingW = 0;
    const observer = new ResizeObserver((entries) => {
      if (paneAnimating.active) return; // 折叠动画期间冻结，结束后 syncStageWidth 补齐
      const width = entries[0]?.contentRect?.width ?? 0;
      if (width <= 0) return;
      pendingW = width;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pendingW > 0) setStageWidth(pendingW); });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const DESIGN_W = 1440;
  /** 版面可用宽 = 画布区 - 左侧标尺 */
  const boardWidth = Math.max(120, stageWidth - RULER_SIZE);
  /** 网页出血：1920 设计稿左右各留 60~80px；窄屏按 5% 收缩，最少 16px */
  const stageBleed = Math.min(72, Math.max(12, Math.round(boardWidth * 0.05)));
  const stageScale = Math.min(1.25, (boardWidth - stageBleed * 2) / DESIGN_W);
  /** 版面在画布里居中 */
  const stageOffsetX = Math.max(0, Math.round((boardWidth - DESIGN_W * stageScale) / 2));
  const stageHeight = items.reduce((max, i) => Math.max(max, i.y + i.h), 300) + 40;

  /** 当前页用到的数据集（导航卡「导出范围」下拉用）：按引用卡片数排序 */
  const pageDatasets = useMemo(() => {
    const usage = new Map<number, number>();
    items.forEach((it) => {
      const id = it.spec?.binding?.dataset_id;
      if (typeof id === "number") usage.set(id, (usage.get(id) ?? 0) + 1);
    });
    return [...usage.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, count]) => ({ id, name: datasets.find((d) => d.id === id)?.name || `数据集 ${id}`, count }));
  }, [items, datasets]);

  /** 别的页面上开着「跳转页全展示」的导航：在本页以只读影格显示 */
  const ghostNav = useMemo(() => {
    if (!doc) return null;
    /* 只认 nav.global_nav 这一个开关（kind / component 在「换形态」后可能对不上）；
       另一个页面的卡片可能躺在 items_map[平台] 里，所以两处都要找 */
    const isGlobalNav = (spec?: ComponentSpec) => !!spec?.nav?.global_nav;
    if (items.some((i) => isGlobalNav(i.spec))) return null;
    for (const v of doc.views) {
      if (v.key === view) continue;
      const all = [
        ...(v.items ?? []),
        ...Object.values(v.items_map ?? {}).flatMap((list) => list ?? []),
      ];
      const hit = all.find((it) => isGlobalNav(it.spec));
      if (hit) return toCanvasItem(hit);
    }
    return null;
  }, [doc, view, items]);

  const primaryItem = items.find((i) => i.key === selected) ?? null;
  const selectedItem = selectedKeys.length === 1 ? primaryItem : null;
  const selectedBounds = selectedKeys.length
    ? items.filter((i) => selectedKeys.includes(i.key)).reduce(
        (acc, i) => ({
          x0: Math.min(acc.x0, i.x), y0: Math.min(acc.y0, i.y),
          x1: Math.max(acc.x1, i.x + i.w), y1: Math.max(acc.y1, i.y + i.h),
        }),
        { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
      )
    : null;
  /** 只有「数据类元素」（type=chart）才用自己绑定的数据集决定左栏 —— 筛选栏 / 标题 / 文字 / 形状 / 画板
   *  这些非数据元素如果也拿自己的 binding.dataset_id 说话，左栏会被钉死在旧数据集上、点下拉没反应
   *  （2026-11-13 用户实测：「数据集被固定在榜单端-天猫」）。*/
  const selectedChartDatasetId = selectedItem && (selectedItem.type || "chart") === "chart"
    ? (selectedItem.spec?.binding?.dataset_id ?? null)
    : null;

  /** 选中卡片在当前平台下真正读的那张表 —— 绑的表在切换映射里就按当前参数换过去，
   *  左侧数据集、指标/维度列表、口径提示都跟着它，避免「卡读拼多多、面板却列天猫字段」。*/
  const followedDatasetId = useMemo(() => {
    const base = selectedChartDatasetId;
    if (!base) return null;
    for (const def of paramDefs) {
      const map = def.dataset_map;
      if (!map || !Object.keys(map).length) continue;
      if (!Object.values(map).includes(base)) continue;
      const value = params[def.id] ?? def.default;
      const target = map[String(value ?? "")];
      if (target) return target;
    }
    return null;
  }, [selectedChartDatasetId, paramDefs, params]);

  useEffect(() => {
    const id = followedDatasetId ?? selectedChartDatasetId;
    if (id) setActiveDatasetId(id);
  }, [selected, selectedKeys.length, followedDatasetId, selectedChartDatasetId]);

  /** 数据集默认跟当前看板走（第一张图绑的数据集），而不是列表第一个 */
  useEffect(() => {
    if (activeDatasetId != null) return;
    const bound = items.find((i) => i.type === "chart" && i.spec?.binding?.dataset_id)
      ?.spec.binding.dataset_id;
    if (bound) { setActiveDatasetId(bound); return; }
    if (datasets.length) setActiveDatasetId(datasets[0].id);
  }, [datasets, activeDatasetId, items]);

  const fieldDatasetId = followedDatasetId
    ?? selectedChartDatasetId
    ?? activeDatasetId
    ?? datasets[0]?.id
    ?? null;
  /** 当前数据集在本看板被几个元素引用（来自后端账本） */
  const datasetUsage = fieldDatasetId
    ? docSources.filter((row) => row.dataset_id === fieldDatasetId).length
    : 0;
  const { groups, datasetName } = useDatasetFields(fieldDatasetId);
  /** 拖进来的组件会落到 activeDatasetId 上：按它的字段自检（groups 尚未加载完时不动，别拿错依据） */
  const insertFields = useDatasetFields(activeDatasetId);

  /** 拖/选字段就把卡片标题换成该字段名 —— 标题已有名字也照换（用户要的是「填字段即得名」，
   *  不满意再自己改）；只改标题，不动用户手写的副标题。
   *  分开处理：换指标 = 一定改名；只换维度时，仅在没有指标的情况下才改名
   *  （饼图/词云这类维度卡会跟，柱状图不会因为换维度把指标名冲掉）。*/
  const syncTitle = (prev: ComponentSpec | undefined, next: ComponentSpec): ComponentSpec => {
    if (!prev) return next;
    const metric = next.binding.metric ?? "";
    const dim = next.binding.dimension ?? "";
    const metricChanged = (prev.binding.metric ?? "") !== metric;
    const dimChanged = (prev.binding.dimension ?? "") !== dim;
    if (!metricChanged && !dimChanged) return next;
    const name = metricChanged ? metric : (metric ? "" : dim);
    return name ? { ...next, title: name } : next;
  };

  /** 改 spec：头标卡绑了统计字段但还没选数据集 → 自动用当前数据集（否则统计算不出来） */
  const applySpec = (key: string, next: ComponentSpec) => {
    const needsDataset = next.banner?.stats?.some((stat) => stat.metric) && !next.binding.dataset_id;
    const prev = items.find((i) => i.key === key);
    const withTitle = syncTitle(prev?.spec, next);
    const spec = needsDataset
      ? { ...withTitle, binding: { ...withTitle.binding, dataset_id: activeDatasetId ?? datasets[0]?.id ?? null } }
      : withTitle;
    patchItem(key, { spec });
  };

  const patchItem = (key: string, patch: Partial<CanvasItem>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
    setDirty(true);
  };

  /** 多选对齐：以选中集合的外接矩形为基准（与设计软件一致，不需要栅格） */
  const alignSelection = useCallback((mode: (typeof ALIGN_ACTIONS)[number]["mode"]) => {
    if (selectedKeys.length < 2) return;
    setItems((prev) => {
      const chosen = prev.filter((i) => selectedKeys.includes(i.key));
      if (chosen.length < 2) return prev;
      const minX = Math.min(...chosen.map((i) => i.x));
      const maxX = Math.max(...chosen.map((i) => i.x + i.w));
      const minY = Math.min(...chosen.map((i) => i.y));
      const maxY = Math.max(...chosen.map((i) => i.y + i.h));
      return prev.map((item) => {
        if (!selectedKeys.includes(item.key)) return item;
        switch (mode) {
          case "left": return { ...item, x: minX };
          case "right": return { ...item, x: maxX - item.w };
          case "hcenter": return { ...item, x: Math.round(minX + (maxX - minX - item.w) / 2) };
          case "top": return { ...item, y: minY };
          case "bottom": return { ...item, y: maxY - item.h };
          case "vcenter": return { ...item, y: Math.round(minY + (maxY - minY - item.h) / 2) };
          default: return item;
        }
      });
    });
    setDirty(true);
  }, [selectedKeys]);

  /** 等间距分布：**两端固定不动**，只把中间元素按相等间隙重排（≥3 个才生效） */
  const distributeSelection = useCallback((axis: "x" | "y") => {
    if (selectedKeys.length < 3) return;
    setItems((prev) => {
      const chosen = prev.filter((i) => selectedKeys.includes(i.key))
        .sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
      if (chosen.length < 3) return prev;
      const first = chosen[0];
      const last = chosen[chosen.length - 1];
      const start = axis === "x" ? first.x : first.y;
      const end = axis === "x" ? last.x + last.w : last.y + last.h;
      const total = chosen.reduce((sum, i) => sum + (axis === "x" ? i.w : i.h), 0);
      const gap = (end - start - total) / (chosen.length - 1);
      let cursor = start;
      const next = new Map<string, number>();
      chosen.forEach((i, index) => {
        /* 首位固定、末位精确贴住终点，中间按未取整游标落位 —— 避免逐个 round 累积出 1px 误差 */
        const size = axis === "x" ? i.w : i.h;
        const pos = index === 0
          ? start
          : index === chosen.length - 1 ? end - size : cursor;
        next.set(i.key, pos);
        cursor += size + gap;
      });
      return prev.map((item) => {
        const pos = next.get(item.key);
        if (pos === undefined) return item;
        /* 保留 0.1px 精度：画布本身会按 stageScale 缩放，取整反而让间隙忽大忽小（11/12 交替） */
        const precise = Math.round(pos * 10) / 10;
        return axis === "x"
          ? { ...item, x: precise }
          : { ...item, y: Math.max(0, precise) };
      });
    });
    setDirty(true);
  }, [selectedKeys]);

  /** 明细表「行详情」里正在编辑的组件卡片 */
  const [detailCardKey, setDetailCardKey] = useState("");
  const detailCard = useMemo(() => {
    if (!selectedItem || !detailCardKey) return null;
    const detail = selectedItem.spec?.table_view?.detail;
    if (!detail?.enabled) return null;
    return (detail.items ?? []).find((card) => card.key === detailCardKey) ?? null;
  }, [selectedItem, detailCardKey]);
  const patchDetailCard = useCallback((next: ComponentSpec) => {
    const current = selectedItem;
    const tv = current?.spec?.table_view;
    if (!current || !detailCardKey || !tv?.detail) return;
    patchItem(current.key, {
      spec: {
        ...current.spec,
        table_view: {
          ...tv,
          detail: {
            ...tv.detail,
            items: (tv.detail.items ?? []).map((card) => (card.key === detailCardKey ? { ...card, spec: next } : card)),
          },
        },
      },
    });
  }, [selectedItem, detailCardKey, patchItem]);

  const handlePick = (field: { name: string }, group: "metric" | "dimension" | "id") => {
    /** 字段只作用于图表；标题 / 文字 / 筛选栏被选中时字段面板照常显示，但不写绑定 */
    if (!selectedItem || (selectedItem.type || "chart") !== "chart" || group === "id") return;
    const binding = { ...selectedItem.spec.binding };
    if (group === "metric") {
      binding.metric = field.name;
      /** 柱/线/饼/明细表这类没维度画不出来：点指标时补一个默认「列」 */
      const needsDim = ["bar", "hbar", "line", "area", "pie", "donut", "wordcloud",
        "table", "scatter", "rank_list", "combo", "heatmap"].includes(selectedItem.kind);
      if (!binding.dimension && needsDim) {
        binding.dimension = groups.dimensions.find((f) => f.role === "dimension")?.name
          ?? groups.dimensions[0]?.name
          ?? null;
      }
    } else {
      binding.dimension = field.name;
    }
    applySpec(selectedItem.key, { ...selectedItem.spec, binding });
  };

  /** 从标尺拖出参考线（上标尺 → 横线，左标尺 → 竖线） */
  const startPullGuide = (axis: "x" | "y") => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const el = canvasRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const id = `g_${Date.now().toString(36)}${Math.floor(Math.random() * 99)}`;
    setGuidesVisible(true);
    /** 参考线可以落进版面两侧的溢出区（浅灰带）；横线可以一直放到画布可见底部（内容矮也能放） */
    const bleed = stageOffsetX / (stageScale || 1);
    const bottomLimit = Math.max(Math.max(stageHeight, 620), (el.scrollTop + el.clientHeight) / (stageScale || 1));
    const clampPos = (value: number) => (axis === "x"
      ? Math.min(DESIGN_W + bleed, Math.max(-bleed, value))
      : Math.min(bottomLimit, Math.max(0, value)));
    const inside = (clientX: number, clientY: number) =>
      clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    const resolve = (ev: PointerEvent) => {
      const raw = axis === "x"
        ? (ev.clientX - box.left + el.scrollLeft - stageOffsetX) / (stageScale || 1)
        : (ev.clientY - box.top + el.scrollTop) / (stageScale || 1);
      const others = guidesVisible ? guides.filter((g) => g.axis === axis).map((g) => g.pos) : [];
      const hit = ev.altKey
        ? { snapped: false, center: false, pos: Math.round(raw) }
        : snapGuide(axis, raw, items, DESIGN_W, stageScale || 1, others, Math.max(stageHeight, 620));
      return { snapped: hit.snapped, center: hit.center, pos: Math.round(clampPos(hit.pos)) };
    };
    const onMove = (ev: PointerEvent) => {
      if (!inside(ev.clientX, ev.clientY)) { surfaceRef.current?.previewGuide(null); surfaceRef.current?.showTip(null); return; }
      const next = resolve(ev);
      surfaceRef.current?.previewGuide({ id, axis, pos: next.pos, snapped: next.snapped });
      surfaceRef.current?.showTip({ axis, pos: next.pos, x: ev.clientX, y: ev.clientY, snapped: next.snapped, center: next.center });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      surfaceRef.current?.previewGuide(null);
      surfaceRef.current?.showTip(null);
      if (!inside(ev.clientX, ev.clientY)) return;
      setGuides((prev) => [...prev, { id, axis, pos: resolve(ev).pos }]);
      setDirty(true);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const moveGuide = (id: string, pos: number) => {
    setGuides((prev) => prev.map((g) => (g.id === id ? { ...g, pos } : g)));
    setDirty(true);
  };

  const removeGuide = (id: string) => {
    setGuides((prev) => prev.filter((g) => g.id !== id));
    setDirty(true);
  };

  /** 落库：publish=false 只存草稿（不动发布状态），publish=true 保存并发布 */
  const persist = useCallback(async (publish: boolean) => {
    if (!doc || saving) return;
    setSaving(publish ? "publish" : "save");
    try {
      const list = detailEditKey ? commitDetailEdit() : items;
      const stashed = stashView(doc, list, false);
      const nextDoc: DashboardDoc = {
        ...stashed,
        published: publish ? true : stashed.published,
      };
      const res = await client.put(`/bi/dashboards/${docId}`, { doc: nextDoc, publish });
      // 以服务端回包为准，拿到 published_at 之类的服务端字段
      setDoc((res.data?.doc as DashboardDoc) || nextDoc);
      setDirty(false);
      setRevision((r) => r + 1);
      /* 顶栏「最近编辑」按 updated_at 排：刚存完把自己顶到最前 */
      client.get("/bi/dashboards")
        .then((r) => setDocs(r.data?.dashboards || []))
        .catch(() => {});
      setToast({
        open: true,
        msg: publish ? "已发布到「我的看板」" : "已保存",
        severity: "success",
      });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast({ open: true, msg: detail || (publish ? "发布失败" : "保存失败"), severity: "error" });
    } finally {
      setSaving(null);
    }
  }, [doc, docId, items, view, guides, saving, stashView, detailEditKey, commitDetailEdit]);

  const handleSave = useCallback(() => { void persist(false); }, [persist]);
  const handlePublish = useCallback(() => { void persist(true); }, [persist]);

  /** 点击添加：落在当前视口中间且整块留在版面内（宽元素不会被顶到右边溢出区） */
  const centerPosition = (width = 320) => {
    const el = canvasRef.current;
    if (!el) return { x: 12, y: 12 };
    const centered = (el.scrollLeft + el.clientWidth / 2 - stageOffsetX) / (stageScale || 1) - width / 2;
    const x = Math.min(Math.max(0, centered), Math.max(0, DESIGN_W - width));
    const y = (el.scrollTop + 80) / (stageScale || 1);
    return { x: Math.round(x / 8) * 8, y: Math.max(0, Math.round(y / 8) * 8) };
  };

  /** 元素几何：编辑器里在顶层，文档装进来的在 layout 里 */
  const boardBox = (it: CanvasItem) => {
    const raw = it as unknown as {
      x?: number; y?: number; w?: number; h?: number;
      layout?: { x?: number; y?: number; w?: number; h?: number };
    };
    const l = raw.layout ?? {};
    return { x: raw.x ?? l.x ?? 0, y: raw.y ?? l.y ?? 0, w: raw.w ?? l.w ?? 0, h: raw.h ?? l.h ?? 0 };
  };
  /** 落点所在的画板（整版块/页面元素都按光标判断） */
  const boardAtPoint = (px: number, py: number) => items.find((it) => {
    if (it.type !== "board") return false;
    const b = boardBox(it);
    return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;
  });

  /** 页面元素（标题 / 文字 / 分割线）落进画板时也按画板内宽收窄 */
  const fitToBoard = (pos: { x: number; y: number }, w: number) => {
    const host = boardAtPoint(pos.x, pos.y);
    if (!host) return { x: pos.x, w };
    const b = boardBox(host);
    const pad = 16;
    const width = Math.min(w, Math.max(100, b.w - pad * 2));
    const x = Math.max(b.x + pad, Math.min(pos.x, b.x + b.w - pad - width));
    return { x, w: width };
  };

  const addElement = (type: "heading" | "text" | "divider" | "filter" | "board", at?: { x: number; y: number }) => {
    if (type === "filter") { addFilter(at); return; }
    if (type === "board") {
      /* 画板：框出一块区域当弹窗范围（组件直接摆在里面），铺在最底层，不抢内部组件的点击 */
      const size = ELEMENT_SIZE.board;
      const pos = at ?? centerPosition(size.w);
      /* 自动编号：已有画板取最大序号 +1（画板、画板2、画板3…），换页也接着编 */
      let maxNo = 0;
      const scan = (list: CanvasItem[]) => list.forEach((it) => {
        if (it.type !== "board") return;
        const m = /^画板(\d+)?$/.exec(String(it.text || ""));
        if (m) maxNo = Math.max(maxNo, m[1] ? Number(m[1]) : 1);
      });
      scan(items);
      Object.values(doc?.views ?? []).forEach((v) => {
        scan((v.items ?? []) as unknown as CanvasItem[]);
        Object.values(v.items_map ?? {}).forEach((list) => scan((list ?? []) as unknown as CanvasItem[]));
      });
      const label = maxNo === 0 ? "画板" : `画板${maxNo + 1}`;
      const board: CanvasItem = {
        key: newKey("bd"), kind: "section", spec: emptySpec(label), type: "board",
        ...pos, w: size.w, h: size.h, text: label, raw: { type: "board" },
      };
      setItems((prev) => [board, ...prev]);
      selectOnly(board.key);
      setDirty(true);
      return;
    }
    const width = type === "text" ? 720 : 980;
    const pos = at ?? centerPosition(width);
    const fitted = fitToBoard(pos, width);
    const base: CanvasItem = {
      key: newKey(type === "heading" ? "h" : type === "text" ? "t" : "d"),
      kind: "section", spec: emptySpec(type), type, x: fitted.x, y: pos.y,
      w: fitted.w,
      h: type === "heading" ? 56 : type === "text" ? 48 : 24,
      text: type === "heading" ? "新标题" : type === "text" ? "在这里写说明文字" : "",
      note: "", index: type === "heading" ? "一" : "", icon: "grid",
      size: 13, weight: 400, align: "left",
      raw: { type },
    };
    setItems((prev) => [...prev, base]);
    selectOnly(base.key);
    setDirty(true);
  };

  /** 工具栏「矩形」：按形状新建一个形状元素（type 沿用 divider，外观参数进 spec.shape） */
  const addShape = (kind: ShapeKind, at?: { x: number; y: number }) => {
    const size = SHAPE_SIZE[kind];
    const pos = at ?? centerPosition(size.w);
    const spec = emptySpec(SHAPE_LABEL[kind]);
    spec.shape = { ...SHAPE_DEFAULT[kind] };
    const item: CanvasItem = {
      key: newKey("s"), kind: "section", spec, type: "divider",
      x: pos.x, y: pos.y, w: size.w, h: size.h,
      text: "", note: "", index: "", icon: "grid", size: 13, weight: 400, align: "left",
      raw: { type: "divider" },
    };
    setItems((prev) => [...prev, item]);
    selectOnly(item.key);
    setDirty(true);
  };

  const addFilter = (at?: { x: number; y: number }) => {
    const pos = at ?? centerPosition(DESIGN_W);
    /* 工具栏「筛选栏」和组件库那张走同一份配置：库里有就照库，没有才用最小默认 */
    const fromLib = components.find((c) => c.code === "base.filter");
    const spec = fromLib ? normalizeSpec(fromLib.spec, fromLib.name) : emptySpec("筛选栏");
    if (!fromLib) {
      spec.filter = {
        fields: [{ id: "keyword", label: "搜索", type: "search", default: "", options: [], multiple: false, placeholder: "搜索", width: 200, note: "" }],
        inline: true,
      };
    }
    const item: CanvasItem = {
      key: newKey("f"), kind: "filter", spec, type: "filter",
      /* 筛选栏通栏：贴左铺满 1440，刚好到版面边界；56 = 控件 32 + 上下各 12，
         开「底部背景」时白卡正好贴住控件，不会空出一大圈 */
      x: 0, y: pos.y, w: DESIGN_W, h: 56,
      component: fromLib?.code,
      raw: { type: "filter" },
    };
    setItems((prev) => [...prev, item]);
    selectOnly(item.key);
    setDirty(true);
  };

  /** 整版块的组件：默认贴左铺满 1440（正好到版面边界，不进溢出区） */
  const FULL_WIDTH_KINDS = new Set<ComponentKind>(["banner", "nav", "filter", "table"]);

  /** 各类组件的默认落版尺寸（头标卡整版宽、筛选栏通栏、指标卡单块） */
  /** 各类组件的默认落版尺寸 —— 与组件库「放大查看」共用 sizes.ts，两处不会再漂移 */
  const KIND_SIZE = COMPONENT_SIZE;

  /** 新增组件实例：默认配置来自组件库（库里那张卡怎么配的，画布上就是什么样） */
  const addChart = (kind: ComponentKind, at?: { x: number; y: number }, from?: ComponentItem) => {
    const size = KIND_SIZE[kind] ?? { w: 420, h: 300 };
    /** 头标卡 / 导航菜单卡 / 筛选栏是整版块：默认贴左铺满 1440，绝不越过版面右侧（拖放落点也不影响） */
    const fullWidth = FULL_WIDTH_KINDS.has(kind);
    const pos = at ?? centerPosition(size.w);
    const x = fullWidth ? 0 : pos.x;
    const w = fullWidth ? DESIGN_W : size.w;
    const spec = from?.spec
      ? normalizeSpec(from.spec, from.name)
      : kind === "banner" ? emptyBannerSpec()
        : kind === "nav" ? emptyNavSpec()
          : emptySpec(KIND_LABEL[kind] || "组件");
    /* 落在画板里：默认用画板绑定的数据集（省得每张卡再选一次） */
    const hitX = pos.x;
    const hitY = pos.y;
    const hostBoard = items.find((it) => {
      if (it.type !== "board") return false;
      const b = boardBox(it);
      return hitX >= b.x && hitX <= b.x + b.w && hitY >= b.y && hitY <= b.y + b.h;
    });
    const hostDataset = (hostBoard?.spec?.binding as { dataset_id?: number | null } | undefined)?.dataset_id;

    if (hostDataset && kind !== "banner" && kind !== "nav") {
      spec.binding = { ...spec.binding, dataset_id: hostDataset };
    }
    /* 导航菜单卡直接按本看板的页面铺好菜单，每个标签都挂好目标页，拿来就能用 */
    if (kind === "nav" && doc && doc.views.length > 1 && !spec.nav.items.length) {
      const tones = ["indigo", "amber", "slate", "teal", "rose", "violet"];
      spec.nav.items = doc.views.map((v, index) => ({
        label: v.title || v.key,
        tone: tones[index % tones.length],
        active: v.key === view,
        page: v.key,
      }));
    }

    /* 组件库模板里绑的是「演示数据集」；画布上有当前数据集时一律以用户的数据集为准 */
    const datasetId = activeDatasetId ?? datasets[0]?.id;
    if (datasetId) spec.binding.dataset_id = datasetId;
    /* 换了数据集，模板里那些字段名可能这张表没有 —— 拖进来之前先自检清掉，别让卡带着死字段
       （只有「这套字段确实属于要用的数据集」时才清，字段还没加载完就不动） */
    if (datasetId && insertFields.datasetId === datasetId) {
      const allowed = new Set([
        ...insertFields.groups.dimensions,
        ...insertFields.groups.metrics,
        ...insertFields.groups.identifiers,
      ].map((f) => f.name));
      Object.assign(spec, pruneSpecFields(spec, allowed));
    }
    /* 指标卡 / 结论卡 / 分节标题没有维度概念：模板里若还留着维度，这里清掉 */
    if (["kpi", "insight", "section"].includes(kind)) spec.binding.dimension = null;
    /* 落进画板：宽度贴着画板内宽、位置夹在画板里（大组件如明细表不再撑出画板） */
    let finalX = x;
    let finalY = pos.y;
    let finalW = w;
    let finalH = size.h;
    if (hostBoard) {
      const b = boardBox(hostBoard);
      const pad = 16;
      const innerW = Math.max(100, b.w - pad * 2);
      const innerH = Math.max(68, b.h - pad * 2);
      finalW = Math.min(w, innerW);
      finalH = Math.min(size.h, innerH);
      finalX = Math.max(b.x + pad, Math.min(pos.x, b.x + b.w - pad - finalW));
      finalY = Math.max(b.y + pad, Math.min(pos.y, b.y + b.h - pad - finalH));
    }
    const item: CanvasItem = {
      key: newKey("c"), kind, spec,
      type: kind === "filter" ? "filter" : "chart",
      x: finalX, y: finalY, w: finalW, h: finalH,
      component: from?.code,
      raw: { type: kind === "filter" ? "filter" : "chart" },
    };
    setItems((prev) => [...prev, item]);
    selectOnly(item.key);
    setDirty(true);
  };

  /** 点类型栏：选中图表就换形态（保留字段绑定），否则按组件库配置新增一张 */
  const pickComponent = (component: ComponentItem) => {
    const contentKind = ["banner", "nav", "section", "insight", "filter"].includes(component.kind);
    if (selectedItem && isChart) {
      if (contentKind) {
        const size = KIND_SIZE[component.kind] ?? { w: selectedItem.w, h: selectedItem.h };
        const full = FULL_WIDTH_KINDS.has(component.kind);
        patchItem(selectedItem.key, {
          kind: component.kind,
          spec: normalizeSpec(component.spec, component.name),
          /* 换成内容块时把高矮也归位，整版块贴左铺满，别留一张 460 高的空白分节 */
          x: full ? 0 : selectedItem.x,
          w: full ? DESIGN_W : selectedItem.w,
          h: size.h,
        });
      } else {
        /* 指标卡/结论卡这类「小卡」有自己的尺寸，换成它们时归位，别留一张 1428 宽的空壳 */
        const preset = KIND_SIZE[component.kind];
        patchItem(selectedItem.key, preset
          ? { kind: component.kind, w: preset.w, h: preset.h }
          : { kind: component.kind });
      }
      return;
    }
    addChart(component.kind, undefined, component);
  };

  const pointFromEvent = (e: React.DragEvent) => {
    const el = canvasRef.current;
    if (!el) return { x: 12, y: 12 };
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left + el.scrollLeft - stageOffsetX) / (stageScale || 1);
    const y = (e.clientY - rect.top + el.scrollTop) / (stageScale || 1);
    return { x: Math.max(0, Math.round(x / 8) * 8), y: Math.max(0, Math.round(y / 8) * 8) };
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    let data: { kind?: string; chartKind?: string; element?: string; component?: string } = {};
    try { data = JSON.parse(e.dataTransfer.getData("text/plain") || "{}"); } catch { return; }
    const at = pointFromEvent(e);
    if (data.kind === "chart" && data.chartKind) {
      const from = data.component ? components.find((c) => c.code === data.component) : undefined;
      addChart(data.chartKind as ComponentKind, at, from);
    }
    else if (data.kind === "element" && data.element) addElement(data.element as "heading" | "text" | "divider" | "filter", at);
  };

  /** 工具栏元素按钮的默认落版尺寸（与 addElement / addFilter 保持一致） */
  const ELEMENT_SIZE: Record<"heading" | "text" | "divider" | "filter" | "board", { w: number; h: number }> = {
    heading: { w: 980, h: 56 },
    text: { w: 720, h: 48 },
    divider: { w: 980, h: 24 },
    filter: { w: DESIGN_W, h: 56 },
    board: { w: 480, h: 620 },
  };

  /** 从类型栏 / 工具栏「拖」一个新组件进来
   *  —— 不用浏览器原生拖放（只有半透明鬼影、落点看不见），改成指针拖：
   *  画布上实时画出落位框（跟着指针 + 磁吸 + 中线吸附），松手才 new 一张。 */
  const beginInsertDrag = (payload:
    | { type: "chart"; kind: ComponentKind; component?: ComponentItem; label: string }
    | { type: "element"; element: "heading" | "text" | "divider" | "filter" | "board"; label: string }
    | { type: "shape"; shape: ShapeKind; label: string }) =>
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      const scroller = canvasRef.current;
      if (!scroller) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const size = payload.type === "chart"
        ? (KIND_SIZE[payload.kind] ?? { w: 420, h: 300 })
        : payload.type === "shape" ? SHAPE_SIZE[payload.shape] : ELEMENT_SIZE[payload.element];
      const fullWidth = payload.type === "chart"
        ? FULL_WIDTH_KINDS.has(payload.kind)
        : payload.type === "element" && payload.element === "filter";
      const w = fullWidth ? DESIGN_W : size.w;
      const boardH = Math.max(stageHeight, 620);
      let moved = false;
      let target: { x: number; y: number } | null = null;
      /* 整块画布切到「抓取中」光标（参考线的 ↔ 也会被压住，免得误会能调线） */
      scroller.dataset.insertDrag = "1";

      const onMove = (ev: PointerEvent) => {
        if (!moved) {
          if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
          moved = true;
          document.body.style.cursor = "grabbing";
        }
        const box = scroller.getBoundingClientRect();
        const inside = ev.clientX >= box.left && ev.clientX <= box.right
          && ev.clientY >= box.top && ev.clientY <= box.bottom;
        if (!inside) {
          target = null;
          surfaceRef.current?.previewInsert(null);
          surfaceRef.current?.showSnap([]);
          return;
        }
        const sx = (ev.clientX - box.left + scroller.scrollLeft - stageOffsetX) / (stageScale || 1);
        const sy = (ev.clientY - box.top + scroller.scrollTop) / (stageScale || 1);
        const base = {
          x: fullWidth ? 0 : Math.max(0, Math.round(sx / 8) * 8),
          y: Math.max(0, Math.round(sy / 8) * 8),
          w, h: size.h,
        };
        const snapped = snapMove(
          base, 0, 0,
          items.map(({ x, y, w: itemW, h: itemH }) => ({ x, y, w: itemW, h: itemH })),
          stageScale || 1, DESIGN_W,
          guidesVisible ? {
            x: guides.filter((g) => g.axis === "x").map((g) => g.pos),
            y: guides.filter((g) => g.axis === "y").map((g) => g.pos),
          } : undefined,
          boardH,
        );
        const rect = {
          x: Math.min(Math.max(0, snapped.rect.x), Math.max(0, DESIGN_W - w)),
          y: Math.max(0, snapped.rect.y),
          w, h: size.h,
        };
        /* 整版块（明细表/头标卡）落位会被强制贴左到 x=0，但「落进哪个画板」要按光标判断 */
        target = { x: fullWidth ? Math.max(0, Math.round(sx / 8) * 8) : rect.x, y: rect.y };
        surfaceRef.current?.previewInsert(rect, payload.label);
        surfaceRef.current?.showSnap(snapped.guides);
      };

      /** commit = 落版；false = 取消（Esc / 拖出画布 / 触控被接管 / 窗口失焦） */
      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("blur", onCancel);
        window.removeEventListener("keydown", onKey, true);
        document.body.style.cursor = "";
        delete scroller.dataset.insertDrag;
        surfaceRef.current?.previewInsert(null);
        surfaceRef.current?.showSnap([]);
        if (!commit || !moved || !target) return;
        /* 拖完紧跟的那次 click 要吞掉，否则会被当成「点了一下类型栏」又新增一张 */
        const kill = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); window.removeEventListener("click", kill, true); };
        window.addEventListener("click", kill, true);
        setTimeout(() => window.removeEventListener("click", kill, true), 400);
        if (payload.type === "chart") addChart(payload.kind, target, payload.component);
        else if (payload.type === "shape") addShape(payload.shape, target);
        else addElement(payload.element, target);
      };
      /** 松手位置决定落不落版：落在画布外 = 放弃（不能凭「最后一次移动的位置」误建卡） */
      const onUp = (ev: PointerEvent) => {
        const box = scroller.getBoundingClientRect();
        const inside = ev.clientX >= box.left && ev.clientX <= box.right
          && ev.clientY >= box.top && ev.clientY <= box.bottom;
        finish(inside);
      };
      const onCancel = () => finish(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("blur", onCancel);
      window.addEventListener("keydown", onKey, true);
    };

  const usedKeys = selectedItem
    ? [selectedItem.spec?.binding?.dimension, selectedItem.spec?.binding?.metric].filter(Boolean) as string[]
    : [];

  const selectedType = selectedItem?.type || "chart";
  /** 筛选栏有两条来源（工具栏 type=filter / 组件库 type=chart + kind=filter），统一按 kind 判断 */
  const isFilterItem = !!selectedItem && (selectedType === "filter" || selectedItem.kind === "filter");
  const isChart = selectedType === "chart" && !isFilterItem;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "calc(100vh - 56px)", minHeight: 600, bgcolor: "#F7F9FD" }}>
      {/* 顶栏 */}
      <Box sx={{
        position: "relative", px: 2, height: 52, display: "flex", alignItems: "center", gap: 1,
        bgcolor: "#fff", borderBottom: "1px solid #EEF3FB",
        minWidth: 0, overflowX: "auto", "&::-webkit-scrollbar": { display: "none" },
      }}>
        <Typography onClick={() => nav("/bi/projects")}
          sx={{ fontSize: 12.5, color: "#4F46E5", cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0 }}>
          ← 项目
        </Typography>
        <Box sx={{ width: 8, flexShrink: 0 }} />
        {/* 看板 chip 次要：窄屏先收起，把位置让给页面 */}
        <Box sx={{ display: { xs: "none", xl: "flex" }, alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden", flexShrink: 1 }}>
        {recentDocs.map((d) => (renaming && d.id === docId ? (
          <TextField
            key={d.id}
            size="small"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => { void commitRename(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { void commitRename(); }
              if (e.key === "Escape") { setRenaming(false); }
            }}
            placeholder="项目名称"
            sx={{
              width: 132, flexShrink: 0,
              "& .MuiOutlinedInput-root": { height: 26, borderRadius: 999, fontSize: 11, bgcolor: "#fff" },
              "& .MuiOutlinedInput-input": { py: 0, px: 1.25 },
            }}
          />
        ) : (
          <Chip key={d.id} size="small" label={d.name}
            title={d.id === docId
              ? "点击改名"
              : (d.updated_at ? `最近编辑 ${formatChinaTime(d.updated_at).slice(0, 16)}` : undefined)}
            onDoubleClick={() => { if (d.id === docId) { setRenameDraft(d.name); setRenaming(true); } }}
            onClick={() => {
              if (d.id === docId) { setRenameDraft(d.name); setRenaming(true); return; }
              setSearch({ doc: String(d.id) });
            }}
            sx={{
              fontSize: 11, height: 24,
              bgcolor: d.id === docId ? "rgba(79,70,229,0.1)" : "#fff",
              color: d.id === docId ? "#4F46E5" : "#64748B",
              border: "1px solid", borderColor: d.id === docId ? "rgba(79,70,229,0.35)" : "#E8EEF8",
              cursor: d.id === docId ? "text" : "pointer",
            }} />
        )))}
        </Box>
        <Box sx={{ flex: 1, minWidth: 12 }} />

        {/* 编辑功能区（可拖到画布）：放在文档 chip 与右侧操作之间居中，窄屏也不会压到 chip */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          {/* 多选对齐（选中 ≥2 个才出现）：6 向对齐 + 两种等间距，两端固定 */}
          {selectedKeys.length >= 2 && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, mr: 0.25 }}>
              {ALIGN_ACTIONS.map((action, index) => (
                <Box key={action.mode} sx={{ display: "flex", alignItems: "center" }}>
                  {index === 3 && <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.25, borderColor: "#EEF3FB" }} />}
                  <IconButton
                    size="small"
                    title={action.tip}
                    aria-label={action.tip}
                    onClick={() => alignSelection(action.mode)}
                    sx={{
                      width: 26, height: 26, borderRadius: 1.25, color: "#334155",
                      "&:hover": { bgcolor: "rgba(15,23,42,0.05)" },
                    }}
                  >
                    {action.mode === "left" && <AlignHorizontalLeft sx={{ fontSize: 17 }} />}
                    {action.mode === "hcenter" && <AlignHorizontalCenter sx={{ fontSize: 17 }} />}
                    {action.mode === "right" && <AlignHorizontalRight sx={{ fontSize: 17 }} />}
                    {action.mode === "top" && <AlignVerticalTop sx={{ fontSize: 17 }} />}
                    {action.mode === "vcenter" && <AlignVerticalCenter sx={{ fontSize: 17 }} />}
                    {action.mode === "bottom" && <AlignVerticalBottom sx={{ fontSize: 17 }} />}
                  </IconButton>
                </Box>
              ))}
              <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.25, borderColor: "#EEF3FB" }} />
              {([{ axis: "x", tip: "水平等距（两端不动）" }, { axis: "y", tip: "垂直等距（两端不动）" }] as const).map((entry) => (
                <IconButton
                  key={entry.axis}
                  size="small"
                  title={selectedKeys.length >= 3 ? entry.tip : "选 3 个以上才能等距"}
                  aria-label={entry.axis === "x" ? "水平等距" : "垂直等距"}
                  disabled={selectedKeys.length < 3}
                  onClick={() => distributeSelection(entry.axis)}
                  sx={{
                    width: 26, height: 26, borderRadius: 1.25, color: "#334155",
                    "&:hover": { bgcolor: "rgba(15,23,42,0.05)" },
                    "&.Mui-disabled": { color: "#CBD5E1" },
                  }}
                >
                  <DistributeIcon axis={entry.axis} />
                </IconButton>
              ))}
              <Divider orientation="vertical" flexItem sx={{ my: 1.5, mx: 0.5, borderColor: "#EEF3FB" }} />
            </Box>
          )}
          {([
            { type: "heading", label: "标题", icon: <TitleIcon sx={{ fontSize: 16 }} /> },
            { type: "text", label: "文字", icon: <TextFields sx={{ fontSize: 16 }} /> },
          ] as const).map((entry) => (
            <Button
              key={entry.type}
              size="small"
              onPointerDown={beginInsertDrag({ type: "element", element: entry.type, label: entry.label })}
              onClick={() => addElement(entry.type)}
              startIcon={entry.icon}
              sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
            >
              {entry.label}
            </Button>
          ))}

          {/* 矩形：PS 式形状下拉（点开选形状，选中即加到视口中央；画布上可任意拖动 / 拉大小） */}
          <Button
            size="small"
            onClick={(event) => setShapeAnchor(event.currentTarget)}
            startIcon={<ShapeIcon kind="rect" size={15} />}
            endIcon={<ExpandMore sx={{ fontSize: 14 }} />}
            sx={{
              textTransform: "none", fontSize: 12, color: "#334155", minWidth: 0, px: 1,
              "& .MuiButton-endIcon": { ml: 0.25 },
            }}
          >
            矩形
          </Button>

          <Button
            size="small"
            onPointerDown={beginInsertDrag({ type: "element", element: "filter", label: "筛选栏" })}
            onClick={() => addElement("filter")}
            startIcon={<Tune sx={{ fontSize: 16 }} />}
            sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
          >
            筛选栏
          </Button>

          <Button
            size="small"
            onPointerDown={beginInsertDrag({ type: "element", element: "board", label: "画板" })}
            onClick={() => addElement("board")}
            startIcon={<CropSquare sx={{ fontSize: 15 }} />}
            sx={{ textTransform: "none", fontSize: 12, color: "#334155", cursor: "grab", minWidth: 0, px: 1 }}
          >
            画板
          </Button>

          <Divider orientation="vertical" flexItem sx={{ my: 1.75, mx: 0.5, borderColor: "#EEF3FB" }} />

          {/* 视图开关：画布外左右溢出区盖一层浅灰 */}
          <Button
            size="small"
            aria-pressed={bleedMask}
            title="画布外左右溢出区"
            onClick={() => setBleedMask((prev) => !prev)}
            startIcon={<CropFree sx={{ fontSize: 16 }} />}
            sx={{
              textTransform: "none", fontSize: 12, minWidth: 0, px: 1,
              color: bleedMask ? "#4F46E5" : "#334155",
              bgcolor: bleedMask ? "rgba(79,70,229,0.08)" : "transparent",
              "&:hover": { bgcolor: bleedMask ? "rgba(79,70,229,0.12)" : "rgba(15,23,42,0.04)" },
            }}
          >
            溢出区
          </Button>

          <Divider orientation="vertical" flexItem sx={{ my: 1.75, mx: 0.5, borderColor: "#EEF3FB" }} />

          {/* 撤销 / 重做 */}
          <IconButton
            size="small"
            title="撤销（⌘Z）"
            aria-label="撤销"
            disabled={!canUndo}
            onClick={() => undo()}
            sx={{
              width: 28, height: 28, borderRadius: 1.5, color: "#334155",
              "&:hover": { bgcolor: "rgba(15,23,42,0.04)" },
              "&.Mui-disabled": { color: "#CBD5E1" },
            }}
          >
            <Undo sx={{ fontSize: 17 }} />
          </IconButton>
          <IconButton
            size="small"
            title="重做（⇧⌘Z）"
            aria-label="重做"
            disabled={!canRedo}
            onClick={() => redo()}
            sx={{
              width: 28, height: 28, borderRadius: 1.5, color: "#334155",
              "&:hover": { bgcolor: "rgba(15,23,42,0.04)" },
              "&.Mui-disabled": { color: "#CBD5E1" },
            }}
          >
            <Redo sx={{ fontSize: 17 }} />
          </IconButton>
        </Box>

        <Box sx={{ flex: 1, minWidth: 12 }} />

        {/* 页面：同一看板下的多页，双击重命名、右键菜单（重命名/复制/删除）、＋新建 */}
        {doc && (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 0.25, mr: 1,
            maxWidth: 380, overflowX: "auto", flexShrink: 0,
            "&::-webkit-scrollbar": { display: "none" },
          }}>
            {doc.views.map((v) => {
              if (editingPage?.key === v.key) {
                return (
                  <TextField
                    key={v.key}
                    size="small"
                    autoFocus
                    value={editingPage.draft}
                    onChange={(e) => setEditingPage({ key: v.key, draft: e.target.value })}
                    onBlur={commitPageRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitPageRename();
                      if (e.key === "Escape") setEditingPage(null);
                    }}
                    inputProps={{ maxLength: 16 }}
                    sx={{
                      width: 108, flexShrink: 0,
                      "& .MuiOutlinedInput-root": { height: 26, borderRadius: 999, fontSize: 12 },
                      "& input": { py: 0, px: 1.25 },
                    }}
                  />
                );
              }
              const active = v.key === view;
              return (
                <Box
                  key={v.key}
                  onClick={() => { if (!active) switchView(v.key); }}
                  onDoubleClick={() => setEditingPage({ key: v.key, draft: v.title || v.key })}
                  onContextMenu={(e) => { e.preventDefault(); setPageMenu({ x: e.clientX, y: e.clientY, key: v.key }); }}
                  title={`${v.title || v.key} · 页面 ID ${v.key}`}
                  sx={{
                    px: 1.25, height: 26, borderRadius: 999, flexShrink: 0,
                    display: "flex", alignItems: "center", cursor: "pointer",
                    fontSize: 12, whiteSpace: "nowrap",
                    color: active ? "#4F46E5" : "#64748B",
                    fontWeight: active ? 600 : 400,
                    bgcolor: active ? "rgba(79,70,229,0.10)" : "transparent",
                    border: "1px solid", borderColor: active ? "rgba(79,70,229,0.30)" : "transparent",
                    transition: "background-color .14s, color .14s",
                    "&:hover": { bgcolor: active ? "rgba(79,70,229,0.10)" : "rgba(15,23,42,0.04)" },
                  }}
                >
                  {v.title || v.key}
                </Box>
              );
            })}
            <IconButton size="small" onClick={addPage} title="新建页面"
              sx={{ width: 26, height: 26, flexShrink: 0, "&:hover": { bgcolor: "rgba(15,23,42,0.04)" } }}>
              <Add sx={{ fontSize: 16, color: "#64748B" }} />
            </IconButton>
          </Box>
        )}

        {dirty && <Typography sx={{ fontSize: 11.5, color: "#F59E0B", mr: 1, whiteSpace: "nowrap", flexShrink: 0 }}>未保存</Typography>}
        <Button size="small" startIcon={<Visibility sx={{ fontSize: 15 }} />}
          onClick={() => {
            /* 预览 = 打开发布后的样子：**不塞 view**，让预览页按「首视页」落地
               （塞了 view 就会盖掉首视页，用户改首视页会以为没生效）；
               要看看别的页，在预览里点导航菜单，或地址后加 ?view=页面ID。筛选值照样带上。 */
            const search = new URLSearchParams();
            Object.entries(params).forEach(([key, value]) => {
              if (value === undefined || value === null || value === "" || value === "all") return;
              if (Array.isArray(value)) {
                if (value.length) search.set(`p_${key}`, value.join(","));
              } else {
                search.set(`p_${key}`, String(value));
              }
            });
            nav(`/bi/dashboards/${docId}?${search.toString()}`);
          }}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, whiteSpace: "nowrap", flexShrink: 0 }}>
          预览
        </Button>
        <Button size="small" variant="outlined" startIcon={<Save sx={{ fontSize: 15 }} />}
          disabled={!!saving || !doc || !dirty} onClick={handleSave}
          sx={{
            textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2,
            whiteSpace: "nowrap", flexShrink: 0,
            borderColor: "#D8E2F5", color: "#334155",
            "&:hover": { borderColor: "#B9C8E6", bgcolor: "rgba(79,70,229,0.04)" },
          }}>
          {saving === "save" ? "保存中…" : "保存"}
        </Button>
        <Button size="small" variant="contained" startIcon={<CloudUpload sx={{ fontSize: 15 }} />}
          disabled={!!saving || !doc} onClick={handlePublish}
          sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2.5, whiteSpace: "nowrap", flexShrink: 0 }}>
          {saving === "publish" ? "发布中…" : "发布我的看板"}
        </Button>
      </Box>

      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 左：数据集字段 —— 常驻显示，不随选中元素变化 */}
        {collapsed.left && <CollapseStrip side="left" label="数据集" onClick={() => togglePane("left")} />}
        <Box ref={leftW.paneRef} data-pane="left" sx={{
          width: collapsed.left ? 0 : "var(--pane-w, 232px)", flexShrink: 0, bgcolor: "#fff",
          minHeight: 0, display: "flex", flexDirection: "column",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.left ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={leftW.paneRef} />
          <CollapseButton dir="left" title="收起数据集" onClick={() => togglePane("left")} />
          <Box sx={{ px: 1.25, py: 1, borderBottom: "1px solid #F1F5FC", flexShrink: 0 }}>
            <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mb: 0.5 }}>数据集</Typography>
            <TextField
              select size="small" fullWidth
              value={fieldDatasetId ?? ""}
              onChange={(e) => {
                const id = Number(e.target.value);
                setActiveDatasetId(id);
                if (selectedItem && (selectedItem.type || "chart") === "chart") {
                  patchItem(selectedItem.key, {
                    spec: {
                      ...selectedItem.spec,
                      binding: {
                        ...selectedItem.spec.binding,
                        dataset_id: id, dimension: null, metric: null, series: null, split: null,
                      },
                    },
                  });
                }
              }}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12, bgcolor: "#fff" } }}
            >
              {datasets.map((dataset) => (
                <MenuItem key={dataset.id} value={dataset.id} sx={{ fontSize: 12 }}>
                  {dataset.name}
                </MenuItem>
              ))}
            </TextField>
            {datasetUsage > 0 && (
              <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mt: 0.75 }}>
                本看板 {datasetUsage} 个元素在用
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {fieldDatasetId ? (
              <FieldPanel datasetName={datasetName} groups={groups} usedKeys={usedKeys} onPick={handlePick} />
            ) : (
              <Hint text="先在上方选择数据集" />
            )}
          </Box>
        </Box>

        {!collapsed.left && <Splitter onMouseDown={leftW.onDragStart} />}
        {collapsed.mid && <CollapseStrip side="left" label="配置" onClick={() => togglePane("mid")} />}

        {/* 中：当前元素的配置 */}
        <Box ref={midW.paneRef} data-pane="mid" sx={{
          width: collapsed.mid ? 0 : "var(--pane-w, 336px)", flexShrink: 0, bgcolor: "#fff", minHeight: 0,
          display: "block",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.mid ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={midW.paneRef} />
          <CollapseButton dir="left" title="收起配置面板" onClick={() => togglePane("mid")} />
          {/* 页面 / 元素 ID：编辑在哪个页面就属于哪个页面，ID 精确到「这一页的这一个元素」 */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", pl: 2, pr: 5, pt: 1.5, pb: 1 }}>
            <IdChip label="页面" value={view} onCopied={(what) => setToast({ open: true, msg: `已复制${what} ID`, severity: "success" })} />
            {selectedItem && (
              <IdChip label="元素" value={selectedItem.key} onCopied={(what) => setToast({ open: true, msg: `已复制${what} ID`, severity: "success" })} />
            )}
          </Box>
          {!selectedItem ? (
            <Hint text={selectedKeys.length > 1 ? `已选 ${selectedKeys.length} 个元素` : "未选中元素"} />
          ) : selectedItem.type === "board" ? (
            <Box sx={{ px: 2, pt: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <TextField
                size="small" label="名称" value={selectedItem.text ?? "画板"}
                onChange={(e) => patchItem(selectedItem.key, { text: e.target.value })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
              />
              <TextField
                select size="small" label="数据集"
                value={(selectedItem.spec?.binding as { dataset_id?: number | null } | undefined)?.dataset_id ?? ""}
                onChange={(e) => {
                  const datasetId = e.target.value === "" ? null : Number(e.target.value);
                  patchItem(selectedItem.key, {
                    spec: {
                      ...selectedItem.spec,
                      binding: { ...(selectedItem.spec.binding as unknown as Record<string, unknown>), dataset_id: datasetId } as unknown as typeof selectedItem.spec.binding,
                    },
                  });
                }}
                helperText="拖进画板的组件默认用这个数据集"
                FormHelperTextProps={{ sx: { fontSize: 10.5, mx: 0, mt: 0.5 } }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
              >
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不绑定</MenuItem>
                {datasets.map((d) => (
                  <MenuItem key={d.id} value={d.id} sx={{ fontSize: 12.5 }}>{d.name}</MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: "flex", gap: 1.25 }}>
                <TextField
                  size="small" label="宽度" type="number" value={Math.round(selectedItem.w)}
                  onChange={(e) => patchItem(selectedItem.key, { w: Math.max(160, Number(e.target.value) || 160) })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
                />
                <TextField
                  size="small" label="高度" type="number" value={Math.round(selectedItem.h)}
                  onChange={(e) => patchItem(selectedItem.key, { h: Math.max(160, Number(e.target.value) || 160) })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
                />
              </Box>
              {/* 按当前屏幕真实可视高度给两档参考尺寸：满屏不会超过屏幕（超出部分靠弹窗滚动） */}
              <Box sx={{ display: "flex", gap: 0.75 }}>
                {([
                  { label: "半屏", h: Math.round(Math.max(360, (typeof window === "undefined" ? 900 : window.innerHeight) - 96) / 2) },
                  { label: "满屏", h: Math.round(Math.max(360, (typeof window === "undefined" ? 900 : window.innerHeight) - 96)) },
                ]).map((preset) => (
                  <Button
                    key={preset.label}
                    size="small"
                    onClick={() => patchItem(selectedItem.key, { h: preset.h })}
                    sx={{
                      flex: 1, minWidth: 0, py: 0.4, borderRadius: 1.5, textTransform: "none", fontSize: 11.5,
                      color: Math.round(selectedItem.h) === preset.h ? "#4F46E5" : "#475569",
                      border: "1px solid",
                      borderColor: Math.round(selectedItem.h) === preset.h ? "rgba(79,70,229,0.35)" : "#D8E2F5",
                      bgcolor: Math.round(selectedItem.h) === preset.h ? "rgba(79,70,229,0.06)" : "transparent",
                      "&:hover": { bgcolor: "rgba(15,23,42,0.03)" },
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Box>
            </Box>
          ) : detailCard ? (
            <>
              <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
                <Box
                  role="button"
                  onClick={() => setDetailCardKey("")}
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 11.5, color: "#4F46E5", cursor: "pointer" }}
                >
                  ← 返回明细表
                </Box>
              </Box>
              <QueryPanel
                kind={detailCard.kind as ComponentKind}
                spec={detailCard.spec}
                pages={(doc?.views ?? []).map((v) => ({ key: v.key, title: v.title || v.key }))}
                pageDatasets={pageDatasets}
                metricOptions={groups.metrics}
                dimensionOptions={groups.dimensions}
                identifierOptions={groups.identifiers}
                onChange={patchDetailCard}
              />
            </>
          ) : isChart ? (
            <QueryPanel
              kind={selectedItem.kind}
              spec={selectedItem.spec}
              pages={(doc?.views ?? []).map((v) => ({ key: v.key, title: v.title || v.key }))}
              pageDatasets={pageDatasets}
              metricOptions={groups.metrics}
              dimensionOptions={groups.dimensions}
              identifierOptions={groups.identifiers}
              payload={cards[selectedItem.key] ?? null}
              height={selectedItem.h}
              onResize={(h: number) => patchItem(selectedItem.key, { h: Math.max(60, Math.round(h)) })}
              onChange={(next: ComponentSpec) => applySpec(selectedItem.key, next)}
              components={components}
              boards={boardOptions}
              detailCardKey={detailCardKey}
              onEditDetailCard={setDetailCardKey}
              onEditDetailPanel={() => enterDetailEdit(selectedItem.key)}
            />
          ) : isFilterItem ? (
            <FilterFieldsEditor
              item={selectedItem}
              platform={activePlatform}
              columns={[...groups.dimensions, ...groups.metrics, ...groups.identifiers].map((f) => f.name)}
              datasetId={fieldDatasetId}
              onChange={(spec) => patchItem(selectedItem.key, { spec })}
              onEmpty={() => {
                /* 一个字段都不剩：这个筛选栏没有任何作用，跟着组件一起删掉，别留个空框 */
                removeItems([selectedItem.key]);
                setToast({ open: true, msg: "筛选栏的字段都删完了，组件一起移除了", severity: "success" });
              }}
            />
          ) : (
            <ElementForm item={selectedItem} onChange={(patch) => patchItem(selectedItem.key, patch)} />
          )}
        </Box>

        {!collapsed.mid && <Splitter onMouseDown={midW.onDragStart} />}

        {/* 画布（顶部 / 左侧标尺 + 版面） */}
        <CanvasDetailContext.Provider value={{ open: setInlineDetail, items, findBoard }}>
        <Box data-stage-wrap="1" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
          {detailEditKey && (
            <Box sx={{
              height: 34, flexShrink: 0, display: "flex", alignItems: "center", gap: 1, px: 1.5,
              bgcolor: "rgba(79,70,229,0.06)", borderBottom: "1px solid rgba(79,70,229,0.18)",
            }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#4F46E5" }}>
                正在编辑：行详情面板
              </Typography>
              <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>
                像页面一样拖动组件构建
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                onClick={() => setItems(commitDetailEdit())}
                sx={{
                  textTransform: "none", fontSize: 11.5, borderRadius: 1.5, minWidth: 0, px: 1.5, py: 0.25,
                  bgcolor: "#4F46E5", color: "#fff", "&:hover": { bgcolor: "#4338CA" },
                }}
              >
                完成
              </Button>
              <Button size="small" onClick={cancelDetailEdit}
                sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0, color: "#64748B" }}>
                取消
              </Button>
            </Box>
          )}
          <Box ref={stageRef} sx={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", bgcolor: "#FBFCFE" }}>
            {/* 顶部标尺 */}
            <Box sx={{ display: "flex", flexShrink: 0, height: RULER_SIZE }}>
              <Box sx={{
                width: RULER_SIZE, height: RULER_SIZE, flexShrink: 0, bgcolor: "#FBFCFE",
                borderRight: "1px solid #EEF3FB", borderBottom: "1px solid #EEF3FB",
              }} />
              <Box
                onPointerDown={startPullGuide("y")}
                sx={{
                  flex: 1, minWidth: 0, overflow: "hidden", borderBottom: "1px solid #EEF3FB",
                  cursor: "ns-resize",
                }}
              >
                <CanvasRuler
                  axis="x"
                  length={Math.max(1, boardWidth)}
                  scale={stageScale}
                  origin={stageOffsetX}
                  span={selectedBounds ? [selectedBounds.x0, selectedBounds.x1] : null}
                />
              </Box>
            </Box>

            <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
              {/* 左侧标尺 */}
              <Box ref={rulerRef}
                onPointerDown={startPullGuide("x")}
                sx={{
                  width: RULER_SIZE, flexShrink: 0, overflow: "hidden",
                  bgcolor: "#FBFCFE", borderRight: "1px solid #EEF3FB", cursor: "ew-resize",
                }}>
                <CanvasRuler
                  axis="y"
                  length={Math.max(1, stageViewportH)}
                  scale={stageScale}
                  origin={0}
                  scroll={canvasScrollTop}
                  span={selectedBounds ? [selectedBounds.y0, selectedBounds.y1] : null}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <BoardSurface
              ref={surfaceRef}
              scale={stageScale}
              offsetX={stageOffsetX}
              bleedMask={bleedMask}
              ghostNav={ghostNav}
              designWidth={DESIGN_W}
              designHeight={stageHeight}
              canvasRef={canvasRef}
              items={items}
              cards={cards}
              errors={{}}
              selectedKeys={selectedKeys}
              rendering={rendering}
              onBlankSelect={() => setSelectedKeys([])}
              onSelect={(key: string, additive: boolean) => {
                if (additive) toggleSelect(key);
                else if (!(selectedKeys.length > 1 && selectedKeys.includes(key))) selectOnly(key);
              }}
              onLayoutChange={(key, next) => {
                const current = items.find((i) => i.key === key);
                /* 拖动画板（尺寸没变）：区域内的组件一起跟着走 */
                if (current?.type === "board" && next.w === current.w && next.h === current.h) {
                  const dx = next.x - current.x;
                  const dy = next.y - current.y;
                  if (!dx && !dy) return;
                  const inside = new Set(items.filter((it) => {
                    if (it.key === current.key || it.type === "board") return false;
                    const cx = it.x + it.w / 2;
                    const cy = it.y + it.h / 2;
                    return cx >= current.x && cx <= current.x + current.w && cy >= current.y && cy <= current.y + current.h;
                  }).map((it) => it.key));
                  setItems((prev) => prev.map((item) => {
                    if (item.key === current.key) return { ...item, ...next };
                    if (inside.has(item.key)) return { ...item, x: Math.max(0, item.x + dx), y: Math.max(0, item.y + dy) };
                    return item;
                  }));
                  setDirty(true);
                  return;
                }
                const groupMove = current && selectedKeys.length > 1 && selectedKeys.includes(key)
                  && next.w === current.w && next.h === current.h;
                if (!current || !groupMove) { patchItem(key, next); return; }
                const dx = next.x - current.x;
                const dy = next.y - current.y;
                if (!dx && !dy) return;
                setItems((prev) => prev.map((item) => (
                  selectedKeys.includes(item.key)
                    ? { ...item, x: Math.max(0, item.x + dx), y: Math.max(0, item.y + dy) }
                    : item
                )));
                setDirty(true);
              }}
              onDelete={(key) => requestDelete([key])}
              onDrop={handleDrop}
              filterFields={paramDefs}
              filterValues={params}
              onFilterChange={(id, value) => setParams((p) => ({ ...p, [id]: value }))}
              onDuplicate={duplicateForDrag}
              currentPage={view}
              onTableMore={async (target) => {
                // 表格「查看更多」：按当前（未保存）版面和筛选拉全量行
                const res = await client.post(`/bi/dashboards/${docId}/rows`, {
                  view, params, items: items.map(toDocItem), item_key: target.key,
                });
                return { rows: res.data?.rows ?? [], columns: res.data?.columns ?? [] };
              }}
              guides={guides}
              guidesVisible={guidesVisible}
              onGuideMove={moveGuide}
              onGuideRemove={removeGuide}
              onGuideMenu={(event, id) => setGuideMenu({ x: event.clientX, y: event.clientY, id })}
              onBlankMenu={(event) => setGuideMenu({ x: event.clientX, y: event.clientY })}
            />
              </Box>
            </Box>
            {inlineDetail && (() => {
              const board = inlineDetail.board;
              /* 行标识列被清空过 → 按当前行的 ID 列兜底，避免「点哪行都显示全量」 */
              const detailKey = inlineDetail.detail.key_field || autoKeyFieldOf(inlineDetail.row);
              const items = board
                ? boardViewItems(board, detailKey, inlineDetail.row[detailKey])
                : [];
              /* 面板宽度按「画板宽 / 组件实际外接宽」里大的那个来：内容区 = 这个宽度，1:1 不缩放、不裁切 */
              const contentW = Math.max(board?.w ?? 0, ...items.map((it) => it.x + it.w), 320);
              const panelW = Math.round(Math.max(340, Math.min(contentW + 24, Math.max(340, stageWidth - 24))));
              const title = String(inlineDetail.row[detailKey] ?? "");
              return (
                <Box data-inline-detail="1" sx={{
                  // 顶部让出标尺那一条，面板只在版面区域里，不压标尺/工具栏
                  position: "absolute", top: RULER_SIZE, right: 0, bottom: 0, width: panelW,
                  /* 必须压在画布自己的图层之上：溢出区浅灰遮罩 50 / 参考线 56 / 落点提示 58，
                     否则面板右侧叠在溢出区的那一截会被灰层盖住，看着像组件跑到面板外面 */
                  bgcolor: "#fff", borderLeft: "1px solid #EEF3FB", zIndex: 60,
                  boxShadow: "-12px 0 28px -22px rgba(15,23,42,0.38)",
                  display: "flex", flexDirection: "column", minHeight: 0,
                }}>
                  <Box sx={{
                    px: 1.5, py: 1.1, display: "flex", alignItems: "center", gap: 1, flexShrink: 0,
                    borderBottom: "1px solid #EEF3FB",
                  }}>
                    <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", flex: 1, minWidth: 0 }}>
                      {title || "详情"}
                    </Typography>
                    <IconButton size="small" onClick={() => { setInlineDetail(null); setDetailCardKey(""); }} sx={{ color: "#94A3B8" }}>
                      <Close fontSize="small" sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Box>
                  {/* 滚动条走浮层（和画布其它面板一致）：不占一条空白，内容宽度也就不抖 */}
                  <Box sx={{
                    flex: 1, minHeight: 0, overflow: "auto", p: 1.5,
                    scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
                  }}>
                    {items.length ? <BoardViewer items={items} plain frameW={board?.w} frameH={board?.h} /> : (
                      <Typography sx={{ fontSize: 12, color: "#94A3B8", p: 2 }}>画板里还没有组件</Typography>
                    )}
                  </Box>
                </Box>
              );
            })()}
          </Box>
        </Box>
        </CanvasDetailContext.Provider>

        {!collapsed.right && <Splitter onMouseDown={rightW.onDragStart} />}
        {collapsed.right && <CollapseStrip side="right" label="图表类型" onClick={() => togglePane("right")} />}

        {/* 右：图表类型 */}
        <Box ref={rightW.paneRef} data-pane="right" sx={{
          width: collapsed.right ? 0 : "var(--pane-w, 168px)", flexShrink: 0, bgcolor: "#fff", minHeight: 0,
          display: "block",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.right ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={rightW.paneRef} />
          <CollapseButton dir="right" title="收起图表类型" onClick={() => togglePane("right")} />
          <ChartTypeRail
            components={components}
            kind={selectedItem?.kind ?? "kpi"}
            loading={componentsLoading}
            onPick={pickComponent}
            onDragInsert={(component, event) => beginInsertDrag({
              type: "chart", kind: component.kind, component, label: component.name,
            })(event)}
          />
        </Box>
      </Box>

      {/* 删除筛选栏确认：它绑了平台时，删掉会让这些平台的筛选失效 */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>删除筛选栏</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.7 }}>
            这个筛选栏绑定了平台：{deleteConfirm?.platforms.join("、")}。
            删除后这些平台的筛选条件会失效，看板只剩未筛选的数据。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteConfirm(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button color="error" variant="contained" sx={{ textTransform: "none", borderRadius: 2 }}
            onClick={() => { removeItems(deleteConfirm?.keys ?? []); setDeleteConfirm(null); }}>
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* 页面右键菜单：重命名 / 复制 / 删除 */}
      <Menu
        open={!!pageMenu}
        onClose={() => setPageMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={pageMenu ? { top: pageMenu.y, left: pageMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 148, borderRadius: 2 } } }}
      >
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => {
          const target = doc?.views.find((v) => v.key === pageMenu?.key);
          if (pageMenu && target) setEditingPage({ key: pageMenu.key, draft: target.title || target.key });
          setPageMenu(null);
        }}>
          重命名
        </MenuItem>
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => { if (pageMenu) duplicatePage(pageMenu.key); setPageMenu(null); }}>
          复制页面
        </MenuItem>
        <MenuItem sx={{ fontSize: 12.5 }} onClick={() => {
          if (pageMenu) {
            copyText(pageMenu.key);
            setToast({ open: true, msg: "已复制页面 ID", severity: "success" });
          }
          setPageMenu(null);
        }}>
          复制页面 ID
        </MenuItem>
        <MenuItem
          sx={{ fontSize: 12.5, color: (doc?.views.length ?? 1) > 1 ? "#B91C1C" : undefined }}
          disabled={(doc?.views.length ?? 1) <= 1}
          onClick={() => { if (pageMenu) deletePage(pageMenu.key); setPageMenu(null); }}
        >
          删除页面
        </MenuItem>
      </Menu>

      <Menu
        open={Boolean(shapeAnchor)}
        anchorEl={shapeAnchor}
        onClose={() => setShapeAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 132, py: 0.5 } } }}
      >
        {SHAPE_KINDS.map((kind) => (
          <MenuItem
            key={kind}
            dense
            onClick={() => { addShape(kind); setShapeAnchor(null); }}
            sx={{ fontSize: 12.5, gap: 1.25, color: "#334155" }}
          >
            <ShapeIcon kind={kind} size={16} />
            {SHAPE_LABEL[kind]}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={Boolean(guideMenu)}
        onClose={() => setGuideMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={guideMenu ? { top: guideMenu.y, left: guideMenu.x } : undefined}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 148 } } }}
      >
        {guideMenu?.id ? (
          <MenuItem
            dense
            onClick={() => { removeGuide(guideMenu.id!); setGuideMenu(null); }}
            sx={{ fontSize: 12.5 }}
          >
            删除这条参考线
          </MenuItem>
        ) : [
          <MenuItem
            key="toggle"
            dense
            onClick={() => { setGuidesVisible((v) => !v); setGuideMenu(null); }}
            sx={{ fontSize: 12.5, display: "flex", justifyContent: "space-between", gap: 3 }}
          >
            {guidesVisible ? "隐藏参考线" : "显示参考线"}
            <Box component="span" sx={{ fontSize: 11, color: "text.disabled" }}>
              {navigator.platform.includes("Mac") ? "⌘H" : "Ctrl+H"}
            </Box>
          </MenuItem>,
          <Divider key="d1" sx={{ my: 0.5 }} />,
          <MenuItem
            key="clear"
            dense
            disabled={guides.length === 0}
            onClick={() => { setGuides([]); setDirty(true); setGuideMenu(null); }}
            sx={{ fontSize: 12.5 }}
          >
            清除全部参考线
          </MenuItem>,
        ]}
      </Menu>

      <Snackbar open={toast.open} autoHideDuration={2400}
        onClose={() => setToast((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity={toast.severity} sx={{ borderRadius: 2 }}>{toast.msg}</Alert>
      </Snackbar>
    </Box>
  );
}

/** 画布里的筛选字段编辑器：把共用组件接回「整份 spec」的回调 */
function FilterFieldsEditor({ item, columns, datasetId, platform, onChange, onEmpty }: {
  item: CanvasItem;
  columns: string[];
  datasetId: number | null;
  platform?: string;
  onChange: (spec: ComponentSpec) => void;
  onEmpty?: () => void;
}) {
  return (
    <SharedFilterFieldsEditor
      platform={platform}
      onEmpty={onEmpty}
      fields={item.spec.filter?.fields ?? []}
      fieldsMap={item.spec.filter?.fields_map}
      columns={columns}
      datasetId={datasetId}
      onChange={(fields) => onChange({ ...item.spec, filter: filterWithFields(item.spec.filter, fields) })}
      onFieldsMapChange={(fields_map) => onChange({
        ...item.spec,
        filter: { ...(item.spec.filter || { inline: true }), fields: item.spec.filter?.fields ?? [], fields_map },
      })}
      background={!!item.spec.filter?.background}
      onBackgroundChange={(background) => onChange({
        ...item.spec,
        filter: { ...(item.spec.filter || { inline: true }), fields: item.spec.filter?.fields ?? [], background },
      })}
    />
  );
}

function Hint({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.7 }}>{text}</Typography>
    </Box>
  );
}

/** 复制到剪贴板（navigator.clipboard 在非安全上下文 / 失焦时会失败，退回 execCommand） */
function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
}

/** 页面 / 元素 ID 胶囊：点一下复制，用来精确定位「哪个看板哪一页的哪个元素」 */
function IdChip({ label, value, onCopied }: { label: string; value: string; onCopied: (label: string) => void }) {
  return (
    <Box
      role="button"
      title={`点击复制${label} ID`}
      onClick={() => { copyText(value); onCopied(label); }}
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.5,
        px: 0.75, py: 0.2, borderRadius: "6px",
        bgcolor: "rgba(15,23,42,0.035)", cursor: "pointer",
        fontSize: 10.5, color: "#475569",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        transition: "background-color .12s",
        "&:hover": { bgcolor: "rgba(15,23,42,0.07)" },
      }}
    >
      <Box component="span" sx={{ color: "#94A3B8", fontFamily: "inherit", fontSize: 10 }}>{label}</Box>
      {value}
      <ContentCopy sx={{ fontSize: 10.5, color: "#B6C2D2" }} />
    </Box>
  );
}

/** 形状参数的数值输入：编辑时留草稿（能正常输 0.1），失焦 / 回车才提交并夹到区间 */
function ShapeNumberField({ value, min, max, step = 1, onCommit }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    onCommit(Math.round(next * 100) / 100);
    setDraft(null);
  };
  return (
    <TextField
      size="small"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
      inputProps={{ inputMode: "decimal", min, max, step }}
      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 }, width: 96 }}
    />
  );
}

/** 形状的配色板：页面既有令牌里的主色 + 中性灰，另给一个系统取色器和「无」 */
const SHAPE_SWATCHES = ["#E9EFFB", "#CBD5E1", "#64748B", "#0F172A", "#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#F43F5E"];

function ColorSwatches({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const current = (value || "").toLowerCase();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      {SHAPE_SWATCHES.map((color) => (
        <Box
          key={color}
          role="button"
          aria-label={color}
          onClick={() => onChange(color)}
          sx={{
            width: 18, height: 18, borderRadius: "50%", bgcolor: color, cursor: "pointer",
            boxShadow: current === color.toLowerCase()
              ? "0 0 0 2px #fff, 0 0 0 3.5px #4F46E5"
              : "inset 0 0 0 1px rgba(15,23,42,0.1)",
            transition: "box-shadow .12s",
          }}
        />
      ))}
      <Box component="label" title="自定义颜色" sx={{
        position: "relative", width: 18, height: 18, borderRadius: "50%", cursor: "pointer",
        display: "grid", placeItems: "center", border: "1px dashed #CBD5E1",
        color: "#94A3B8", fontSize: 11, lineHeight: 1,
      }}>
        +
        <Box component="input" type="color" value={value || "#000000"}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: 0, p: 0, cursor: "pointer" }} />
      </Box>
      <Chip size="small" label="无" onClick={() => onChange("")}
        sx={{
          height: 18, fontSize: 10.5, "& .MuiChip-label": { px: 0.75 },
          bgcolor: value ? "transparent" : "rgba(15,23,42,0.06)",
          border: "1px solid #E8EEF8",
        }} />
    </Box>
  );
}

function ElementForm({ item, onChange }: { item: CanvasItem; onChange: (patch: Partial<CanvasItem>) => void }) {
  const label = (text: string) => (
    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5, letterSpacing: 0.2 }}>{text}</Typography>
  );

  /* 形状元素（老的分割线 = 直线）：形状 / 填充 / 描边 / 圆角 / 翻转 */
  if (item.type === "divider") {
    const shape = shapeOf(item.spec?.shape);
    const setShape = (patch: Partial<ShapeSpec>) => onChange({
      spec: { ...item.spec, shape: { ...shape, ...patch } },
    });
    const numberField = (value: number, min: number, max: number, onSet: (next: number) => void, step = 1) => (
      <ShapeNumberField value={value} min={min} max={max} step={step} onCommit={onSet} />
    );
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.75 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>形状</Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0.75 }}>
          {SHAPE_KINDS.map((kind) => (
            <Box
              key={kind}
              role="button"
              title={SHAPE_LABEL[kind]}
              onClick={() => setShape({
                kind,
                /* 从别的形状切回矩形时给个默认圆角，别一上来就是尖角 */
                ...(kind === "rect" && !shape.radius ? { radius: SHAPE_DEFAULT.rect.radius } : {}),
              })}
              sx={{
                height: 32, borderRadius: 1.5, display: "grid", placeItems: "center", cursor: "pointer",
                color: kind === shape.kind ? "#4F46E5" : "#64748B",
                bgcolor: kind === shape.kind ? "rgba(79,70,229,0.08)" : "transparent",
                border: "1px solid",
                borderColor: kind === shape.kind ? "rgba(79,70,229,0.32)" : "#EEF3FB",
                "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
              }}
            >
              <ShapeIcon kind={kind} size={15} />
            </Box>
          ))}
        </Box>

        <Box>
          {label("填充")}
          <ColorSwatches value={shape.fill} onChange={(fill) => setShape({ fill })} />
        </Box>

        <Box>
          {label("描边")}
          <ColorSwatches
            value={shape.stroke}
            onChange={(stroke) => setShape({ stroke, stroke_w: stroke && !shape.stroke_w ? 2 : shape.stroke_w })}
          />
        </Box>

        {shape.kind === "line" ? (
          <Box>
            {label("线粗")}
            {/* 任意数值，最小 0.1：0.5 = 半像素细线 */}
            {numberField(shape.stroke_w || 0.1, 0.1, 40, (stroke_w) => setShape({ stroke_w }), 0.1)}
          </Box>
        ) : shape.stroke ? (
          <Box>
            {label("描边宽度")}
            {numberField(shape.stroke_w || 2, 0, 40, (stroke_w) => setShape({ stroke_w }), 0.1)}
          </Box>
        ) : null}

        {shape.kind === "rect" && (
          <Box>
            {label("圆角")}
            {numberField(shape.radius || 0, 0, 200, (radius) => setShape({ radius }))}
          </Box>
        )}

        {shape.kind !== "line" && (
          <Box>
            {label("翻转")}
            <ToggleButtonGroup
              size="small"
              value={[shape.flip_x ? "x" : "", shape.flip_y ? "y" : ""].filter(Boolean)}
              onChange={(_, next: string[]) => setShape({ flip_x: next.includes("x"), flip_y: next.includes("y") })}
              sx={{ "& .MuiToggleButton-root": { px: 1.5, py: 0.4, fontSize: 11.5, textTransform: "none" } }}
            >
              <ToggleButton value="x">水平</ToggleButton>
              <ToggleButton value="y">垂直</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
        {item.type === "heading" ? "标题元素" : "文字元素"}
      </Typography>

      <Box>
        {label(item.type === "heading" ? "标题" : "文字")}
        <TextField
          size="small" fullWidth multiline minRows={item.type === "heading" ? 1 : 4}
          value={item.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }}
        />
      </Box>

      {item.type === "heading" && (
        <>
          <Box>
            {label("说明")}
            <TextField size="small" fullWidth value={item.note || ""}
              onChange={(e) => onChange({ note: e.target.value })}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
          </Box>
          <Box>
            {label("编号")}
            <TextField size="small" fullWidth value={item.index || ""}
              onChange={(e) => onChange({ index: e.target.value.slice(0, 4) })}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
          </Box>
        </>
      )}

      {item.type === "text" && (
        <>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              {label("字号")}
              <TextField size="small" fullWidth type="number" value={item.size ?? 13}
                onChange={(e) => onChange({ size: Number(e.target.value) })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              {label("字重")}
              <TextField size="small" fullWidth type="number" value={item.weight ?? 400}
                onChange={(e) => onChange({ weight: Number(e.target.value) })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
            </Box>
          </Box>
          <Box>
            {label("对齐")}
            <ToggleButtonGroup exclusive size="small" value={item.align || "left"}
              onChange={(_, next) => next && onChange({ align: next })}
              sx={{ "& .MuiToggleButton-root": { px: 1.5, py: 0.4, fontSize: 11.5, textTransform: "none" } }}>
              <ToggleButton value="left">左</ToggleButton>
              <ToggleButton value="center">中</ToggleButton>
              <ToggleButton value="right">右</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </>
      )}
    </Box>
  );
}

/** 筛选栏字段编辑器 —— 字段 / 控件类型 / 绑定数据集列 / 选项 */
