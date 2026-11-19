import { formatChinaTime } from "../utils/time";
/** 统一编辑画布 —— 在自由画布上编辑业务看板（组件实例 + 页面元素 + 页面参数） */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  Menu, MenuItem, Snackbar, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import {
  Add, AlignHorizontalCenter, AlignHorizontalLeft, AlignHorizontalRight, AlignVerticalBottom,
  AlignVerticalCenter, AlignVerticalTop, AutoAwesome,
  ChevronLeft, ChevronRight, Close, CloudUpload, ContentCopy, CropFree, CropSquare, DeleteOutline, ExpandMore,
  Redo, Save, TextFields, Title as TitleIcon, Tune, Undo, Visibility,
} from "@mui/icons-material";
import client from "../api/client";
import BoardSurface, { type BoardSurfaceHandle } from "../features/components/board/BoardSurface";
import TopListDialog from "../features/components/board/TopListDialog";
import FieldPanel from "../features/components/editor/FieldPanel";
import QueryPanel from "../features/components/editor/QueryPanel";
import AiLayoutBar, { type LayoutOp } from "../features/components/editor/AiLayoutBar";
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

import {
  ACCENTS, ALIGN_ACTIONS, type DashboardBrief, baseKind, boundPlatforms, dedupeByKey,
  emptyBannerSpec, emptyNavSpec, emptySpec, hasPlatformSwitcher, isEmptyFilterItem,
  isFilterBarItem, isViewLevelItem, newKey, normalizeSpec, pruneSpecFields, toCanvasItem, toDocItem,
} from "./canvas/spec";
import { CollapseButton, CollapseStrip, DistributeIcon, Splitter, paneAnimating, useResizableWidth } from "./canvas/controls";
import { FilterFieldsEditor, Hint, IdChip, copyText, ElementForm } from "./canvas/panels";
import PageTabs from "./canvas/PageTabs";
import CanvasDialogs from "./canvas/CanvasDialogs";
import LeftDatasetPane from "./canvas/LeftDatasetPane";
import MiddleConfigPane from "./canvas/MiddleConfigPane";
import ChartRailPane from "./canvas/ChartRailPane";
import EditorToolbar from "./canvas/EditorToolbar";
import CanvasStage from "./canvas/CanvasStage";
import { useCanvasHistory } from "./canvas/useCanvasHistory";
import { useCanvasClipboard } from "./canvas/useCanvasClipboard";


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
  /** 这份看板是不是 Agent 建的（发布二次确认里说明来源，来自后端归属登记） */
  const [agentGenerated, setAgentGenerated] = useState(false);
  /** 发布二次确认（发布必须用户自己点） */
  const [publishConfirm, setPublishConfirm] = useState(false);
  /** 「AI 推荐组件」进行中：按当前数据集字段推荐并插入 */
  const [recommendBusy, setRecommendBusy] = useState(false);
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
    try { return JSON.parse(localStorage.getItem("mcbi.editor.collapsed") ?? localStorage.getItem("mzbi.editor.collapsed") ?? "{}"); } catch { return {}; }
  });
  const togglePane = useCallback((key: "left" | "mid" | "right") => {
    paneAnimating.active = true;
    window.clearTimeout(paneAnimTimer.current);
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem("mcbi.editor.collapsed", JSON.stringify(next));
      return next;
    });
    // 动画 240ms + 余量：结束后解除冻结并补测画布宽
    paneAnimTimer.current = window.setTimeout(() => {
      paneAnimating.active = false;
      syncStageWidth();
    }, 300);
  }, [syncStageWidth]);
  /** 三栏宽度：可拖拽（PS 式），记在本地，刷新后保留 */
  const leftW = useResizableWidth("mcbi.editor.leftW", 232, 180, 420, 1, syncStageWidth);
  const midW = useResizableWidth("mcbi.editor.midW", 336, 280, 560, 1, syncStageWidth);
  const rightW = useResizableWidth("mcbi.editor.rightW", 168, 140, 340, -1, syncStageWidth);
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
  /* ── 撤销 / 重做（快照栈 + 拖拽一步 + 快捷键，见 canvas/useCanvasHistory） ── */
  const {
    canUndo, canRedo, undo, redo, pushHistory, resetHistory, snapOf,
    prevSnap, itemsRef, guidesRef,
  } = useCanvasHistory({ items, guides, setItems, setGuides, setDirty, canvasRef });
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
  const { copySelection, pasteSelection, duplicateForDrag } = useCanvasClipboard({
    items, selectedKeys, setItems, setSelectedKeys, setDirty, setToast,
  });

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
      setAgentGenerated(Boolean(res.data?.agent_generated));
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

  /** 页面上的所有画板（含其他页面与分套里的）：明细表弹窗要能选到
   *  标签带上页面名 —— 画板默认都叫「画板」，跨页时就分不清是哪一块了 */
  const boardOptions = useMemo(() => {
    const found: { key: string; label: string }[] = [];
    const collect = (list: unknown[] | undefined, pageTitle: string) => {
      (list ?? []).forEach((raw) => {
        const it = raw as { key?: string; type?: string; text?: string };
        if (it?.type !== "board" || !it.key) return;
        const name = it.text || "画板";
        found.push({ key: it.key, label: pageTitle && pageTitle !== name ? `${pageTitle} · ${name}` : name });
      });
    };
    const currentTitle = (doc?.views ?? []).find((v) => v.key === view)?.title || "";
    collect(items, currentTitle);
    (doc?.views ?? []).forEach((v) => {
      const title = v.title || v.key;
      collect(v.items as unknown[], title);
      Object.values(v.items_map ?? {}).forEach((list) => collect(list as unknown[], title));
    });
    return [...new Map(found.map((b) => [b.key, b])).values()];
  }, [items, doc, view]);

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
      /* 整页渲染要跑十几张卡的 SQL，死数据源会让它到 30s+；
         默认 15s 会把请求掐掉，卡片全清空、看着像「绑定数据集没效果」，所以这里单独放宽 */
      client.post(`/bi/dashboards/${docId}/render`, {
        view, params, items: items.map(toDocItem),
      }, { timeout: 120000 })
        .then((res) => {
          const data: DashboardRender = res.data;
          setCards(data.cards || {});
          setParamDefs(data.param_defs || []);
          if (!initialized.current) {
            initialized.current = true;
            setParams((prev) => ({ ...data.params, ...prev }));
          }
        })
        .catch((err) => {
          /* 失败别清空卡片（清空 = 满屏「暂无数据」，看不出是渲染失败还是真的没数据） */
          const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
          setToast({
            open: true,
            msg: detail || "渲染失败或超时（数据源可能连不上），已保留上次结果",
            severity: "error",
          });
        })
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

  /** 本页卡片**实际读**的数据集（后端按平台分套切过表）：筛选栏「逐级筛选」按它取候选值 */
  const filterDataIds = useMemo(() => {
    const usage = new Map<number, number>();
    Object.values(cards).forEach((card) => {
      const id = Number((card as unknown as { dataset_id?: number } | null)?.dataset_id);
      if (Number.isFinite(id) && id > 0) usage.set(id, (usage.get(id) ?? 0) + 1);
    });
    /* 卡片最多的那张排第一：筛选栏的「逐级候选值」只按它取（混用会把不同口径的词表并在一起） */
    return [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [cards]);

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

  /** AI 整理：一次应用 = 一个撤销步（先入栈，再把新快照视为已记录） */
  const applyAiLayout = useCallback((ops: LayoutOp[]) => {
    if (!ops.length) return;
    const before = snapOf(itemsRef.current, guidesRef.current);
    pushHistory(before);
    const byKey = new Map(ops.map((op) => [op.key, op]));
    const next = itemsRef.current.map((item) => {
      const op = byKey.get(item.key);
      return op ? { ...item, x: op.x, y: op.y, w: op.w, h: op.h } : item;
    });
    prevSnap.current = snapOf(next, guidesRef.current);
    setItems(next);
    setDirty(true);
  }, [pushHistory, snapOf]);

  /** A4：按当前数据集字段推荐组件，整排落到页面底部（一次插入 = 一个撤销步） */
  const insertRecommended = useCallback(async () => {
    const datasetId = fieldDatasetId ?? datasets[0]?.id;
    if (!datasetId || recommendBusy) return;
    setRecommendBusy(true);
    try {
      const res = await client.post("/bi/ai/recommend", { dataset_id: datasetId, limit: 4 },
        { timeout: 60000 });
      const list = (res.data?.items || []) as DocItem[];
      if (!list.length) {
        setToast({ open: true, msg: "这个数据集没有可推荐的组件", severity: "error" });
        return;
      }
      const bottom = itemsRef.current.length
        ? Math.max(...itemsRef.current.map((item) => item.y + item.h)) + 16
        : 0;
      const heightOf = (raw: DocItem) => Number(raw.layout?.h || raw.h || 260);
      const normal = list.filter((raw) => {
        const kind = String(raw.component || "").replace("base.", "");
        return !FULL_WIDTH_KINDS.has(kind as ComponentKind);
      });
      const full = list.filter((raw) => !normal.includes(raw));
      /* 普通卡片一排等分；整宽元素（明细表）另起一行铺满 1440 */
      const cardW = normal.length
        ? Math.floor((DESIGN_W - 16 * (normal.length - 1)) / normal.length / 8) * 8
        : 0;
      const added = normal.map((raw, index) => toCanvasItem({
        ...raw,
        key: newKey("ai"),
        layout: { x: index * (cardW + 16), y: bottom, w: cardW, h: heightOf(raw) },
      }));
      let cursor = bottom + (normal.length
        ? Math.max(...normal.map(heightOf)) + 16
        : 0);
      full.forEach((raw) => {
        const h = heightOf(raw);
        added.push(toCanvasItem({
          ...raw,
          key: newKey("ai"),
          layout: { x: 0, y: cursor, w: DESIGN_W, h },
        }));
        cursor += h + 16;
      });
      const before = snapOf(itemsRef.current, guidesRef.current);
      pushHistory(before);
      const next = [...itemsRef.current, ...added];
      prevSnap.current = snapOf(next, guidesRef.current);
      setItems(next);
      setSelectedKeys(added.map((item) => item.key));
      setDirty(true);
      setToast({ open: true, msg: `已插入 ${added.length} 个推荐组件`, severity: "success" });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast({ open: true, msg: detail || "推荐失败，可手动添加组件", severity: "error" });
    } finally {
      setRecommendBusy(false);
    }
  }, [fieldDatasetId, datasets, recommendBusy, snapOf, pushHistory]);

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
  /** 指标卡右上角徽标 → TOP N 榜单弹窗（只读；编辑器里也能点开看） */
  const [topKey, setTopKey] = useState<string | null>(null);
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
  /** 发布必须用户二次确认：点按钮 → 弹窗确认 → 才落库（Agent 侧工具也禁止直接发布） */
  const handlePublish = useCallback(() => setPublishConfirm(true), []);

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
      const allFields = [
        ...insertFields.groups.dimensions,
        ...insertFields.groups.metrics,
        ...insertFields.groups.identifiers,
      ];
      const allowed = new Set(allFields.map((f) => f.name));
      const roleOf = new Map(allFields.map((f) => [f.name, String(f.role || "")]));
      Object.assign(spec, pruneSpecFields(spec, allowed, roleOf));
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
      <EditorToolbar
        nav={nav} recentDocs={recentDocs} docId={docId} renaming={renaming} renameDraft={renameDraft}
        setRenameDraft={setRenameDraft} setRenaming={setRenaming} commitRename={commitRename} setSearch={setSearch}
        items={items} selectedKeys={selectedKeys} designWidth={DESIGN_W} fullWidthKinds={Array.from(FULL_WIDTH_KINDS)}
        applyAiLayout={applyAiLayout} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo}
        recommendBusy={recommendBusy} insertRecommended={insertRecommended}
        alignSelection={alignSelection} distributeSelection={distributeSelection}
        beginInsertDrag={beginInsertDrag} addElement={addElement} setShapeAnchor={setShapeAnchor}
        bleedMask={bleedMask} setBleedMask={setBleedMask}
        doc={doc} view={view} editingPage={editingPage} setEditingPage={setEditingPage}
        commitPageRename={commitPageRename} switchView={switchView} setPageMenu={setPageMenu} addPage={addPage}
        dirty={dirty} params={params} handleSave={handleSave} handlePublish={handlePublish} saving={saving}
      />

      <Box sx={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* 左：数据集字段 —— 常驻显示，不随选中元素变化 */}
        <LeftDatasetPane
          datasets={datasets} fieldDatasetId={fieldDatasetId} setActiveDatasetId={setActiveDatasetId}
          selectedItem={selectedItem} patchItem={patchItem} datasetUsage={datasetUsage}
          datasetName={datasetName} groups={groups} usedKeys={usedKeys} handlePick={handlePick}
          collapsed={collapsed} togglePane={togglePane} leftW={leftW}
        />

        {!collapsed.left && <Splitter onMouseDown={leftW.onDragStart} />}
        <MiddleConfigPane
          collapsed={collapsed} togglePane={togglePane} midW={midW} view={view} setToast={setToast}
          selectedItem={selectedItem} selectedKeys={selectedKeys} patchItem={patchItem} datasets={datasets}
          detailCard={detailCard} setDetailCardKey={setDetailCardKey} doc={doc} pageDatasets={pageDatasets}
          groups={groups} patchDetailCard={patchDetailCard} isChart={isChart} cards={cards} applySpec={applySpec}
          components={components} boardOptions={boardOptions} detailCardKey={detailCardKey}
          enterDetailEdit={enterDetailEdit} isFilterItem={isFilterItem} activePlatform={activePlatform}
          fieldDatasetId={fieldDatasetId} removeItems={removeItems}
        />

        {!collapsed.mid && <Splitter onMouseDown={midW.onDragStart} />}

        <CanvasStage
          view={view} docId={docId} designWidth={DESIGN_W} items={items} cards={cards} paramDefs={paramDefs} params={params}
          guides={guides} guidesVisible={guidesVisible} stageWidth={stageWidth}
          stageViewportH={stageViewportH} canvasScrollTop={canvasScrollTop} boardWidth={boardWidth}
          stageScale={stageScale} stageOffsetX={stageOffsetX} stageHeight={stageHeight}
          selectedKeys={selectedKeys} selectedBounds={selectedBounds} bleedMask={bleedMask}
          rendering={rendering} inlineDetail={inlineDetail} detailEditKey={detailEditKey}
          ghostNav={ghostNav} filterDataIds={filterDataIds}
          stageRef={stageRef} rulerRef={rulerRef} canvasRef={canvasRef} surfaceRef={surfaceRef}
          setInlineDetail={setInlineDetail} setItems={setItems} setParams={setParams}
          setSelectedKeys={setSelectedKeys} setTopKey={setTopKey} setDetailCardKey={setDetailCardKey}
          setDirty={setDirty} setGuideMenu={setGuideMenu}
          selectOnly={selectOnly} toggleSelect={toggleSelect} duplicateForDrag={duplicateForDrag}
          requestDelete={requestDelete} findBoard={findBoard} commitDetailEdit={commitDetailEdit}
          cancelDetailEdit={cancelDetailEdit} patchItem={patchItem} moveGuide={moveGuide}
          removeGuide={removeGuide} startPullGuide={startPullGuide} handleDrop={handleDrop}
        />

        {!collapsed.right && <Splitter onMouseDown={rightW.onDragStart} />}
        {collapsed.right && <CollapseStrip side="right" label="图表类型" onClick={() => togglePane("right")} />}

        <ChartRailPane
          collapsed={collapsed} togglePane={togglePane} rightW={rightW} components={components}
          selectedItem={selectedItem} componentsLoading={componentsLoading}
          pickComponent={pickComponent} beginInsertDrag={beginInsertDrag}
        />
      </Box>

      <CanvasDialogs
        topKey={topKey} setTopKey={setTopKey} docId={docId} view={view} params={params} items={items} toDocItem={toDocItem}
        deleteConfirm={deleteConfirm} setDeleteConfirm={setDeleteConfirm} removeItems={removeItems}
        pageMenu={pageMenu} setPageMenu={setPageMenu} doc={doc} setEditingPage={setEditingPage}
        duplicatePage={duplicatePage} copyText={copyText} setToast={setToast} deletePage={deletePage}
        shapeAnchor={shapeAnchor} setShapeAnchor={setShapeAnchor} addShape={addShape}
        guideMenu={guideMenu} setGuideMenu={setGuideMenu} removeGuide={removeGuide}
        guidesVisible={guidesVisible} setGuidesVisible={setGuidesVisible} guides={guides} setGuides={setGuides} setDirty={setDirty}
        publishConfirm={publishConfirm} setPublishConfirm={setPublishConfirm} persist={persist}
        saving={saving} agentGenerated={agentGenerated} toast={toast}
      />
    </Box>
  );
}

/** 画布里的筛选字段编辑器：把共用组件接回「整份 spec」的回调 */
