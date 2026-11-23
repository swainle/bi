import { formatChinaTime } from "../../utils/time";
/** 业务看板页 —— 页面元素 + 组件实例 + 参数筛选 + 动作浮层 + 就地编辑（类原型工具） */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, IconButton, Menu, MenuItem, Select, Snackbar, Tab, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import {
  ArrowDownward, ArrowUpward, BookmarkBorder, Close, Delete, Edit, FileDownload, HorizontalRule,
  Save, TextFields, Title as TitleIcon, Tune, ViewQuilt,
} from "@mui/icons-material";
import client from "../../api/client";
import { useAuth } from "../auth/useAuth";
import { useWatermarkText } from "../../hooks/useWatermarkText";
import WatermarkOverlay from "../../components/WatermarkOverlay";
import { CanvasDetailContext, asCanvasItem, boardOf, type BoardArea } from "../components/board/canvasDetail";
import { ACCENTS } from "../components/palette";
import { RENDERERS, KIND_LABEL, KIND_ROLE, ROLE_LABEL } from "../components/registry";
import ShapeView, { shapeOf } from "../components/shapes";
import { navHomePage } from "../components/navHome";
import FilterBar from "../components/renderers/FilterBar";
import NavCard, { type NavPayload, type NavUi } from "../components/renderers/NavCard";
import { useDatasetFields } from "../components/board/useDatasetFields";
import TopListDialog from "../components/board/TopListDialog";
import type {
  Accent, ComponentItem, ComponentSpec, DashboardDoc, DashboardRender, DashboardSummary,
  DatasetBrief, DocAction, DocItem, FilterFieldSpec, RenderPayload, SortDir, UiSpec,
} from "../components/types";

import { GRID_GAP, DESIGN_W, toCsvText, downloadCsv, PAGE_X, DEFAULT_UI, FLOAT_BTN_SX, cellText, NUMERAL, ICONS, ACCENT_KEYS, readParamQuery, buildSearch } from "./utils";
import { LayersPanel } from "./LayersPanel";
import { ToolbarButton } from "./ToolbarButton";
import { HeadingElement } from "./HeadingElement";
import { TextElement } from "./TextElement";
import { Inspector } from "./Inspector";
import { OverlayHost } from "./OverlayHost";

export default function DashboardPage() {
  const { id } = useParams();
  const location = useLocation();
  const inCanvas = location.pathname.startsWith("/bi/canvas");
  const docParam = new URLSearchParams(location.search).get("doc");
  const dashboardId = Number(id || docParam || 2);

  const [meta, setMeta] = useState<DashboardSummary | null>(null);
  const [doc, setDoc] = useState<DashboardDoc | null>(null);
  const [render, setRender] = useState<DashboardRender | null>(null);
  const [view, setView] = useState<string>("");
  /* 地址栏里的 p_* 就是外部传进来的筛选值（编辑器「预览」、发布链接、别人分享的链接都靠它） */
  const [params, setParams] = useState<Record<string, unknown>>(
    () => readParamQuery(new URLSearchParams(window.location.search)),
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<{ type: "modal" | "drawer"; title: string; kind: string; payload: RenderPayload } | null>(null);
  const [editing, setEditing] = useState(
    () => inCanvas || new URLSearchParams(window.location.search).get("edit") === "1",
  );
  const [dashboards, setDashboards] = useState<{ id: number; name: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [library, setLibrary] = useState<ComponentItem[]>([]);
  const [datasets, setDatasets] = useState<DatasetBrief[]>([]);
  const [toast, setToast] = useState("");
  const [exportAnchor, setExportAnchor] = useState<null | HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  const [favorites, setFavorites] = useState<{ id: number; name: string; view_key: string; params: Record<string, unknown>; updated_at: string }[]>([]);
  const [favAnchor, setFavAnchor] = useState<null | HTMLElement>(null);
  const [favOpen, setFavOpen] = useState(false);
  const [favName, setFavName] = useState("");
  const [favSaving, setFavSaving] = useState(false);
  /** 图表联动：点击某个类目 → 其它卡片按这一列过滤（临时，不写进看板） */
  const [crossFilter, setCrossFilter] = useState<{ column: string; value: string; label: string; itemKey: string } | null>(null);
  /** 下钻明细：联动后按这一列取原始行 */
  const [drill, setDrill] = useState<{
    open: boolean; loading: boolean; title: string; columns: string[];
    rows: Record<string, unknown>[]; error: string;
  }>({ open: false, loading: false, title: "", columns: [], rows: [], error: "" });
  const initialSearch = useRef(new URLSearchParams(window.location.search));
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [surfaceWidth, setSurfaceWidth] = useState(1440);
  const initialized = useRef(false);
  const saveTimer = useRef(0);
  const { hasPerm } = useAuth();

  const loadDoc = useCallback(async () => {
    const res = await client.get(`/bi/dashboards/${dashboardId}`);
    const summary = res.data as DashboardSummary;
    setMeta(summary);
    setDoc(summary.doc);
    /* 多选/按钮组的参数在地址栏里是 `a,b`，回填时要还原成数组，否则只当一整个值 */
    setParams((prev) => {
      const fields = (summary.doc.views ?? []).flatMap((v) => (v.items ?? []))
        .flatMap((item) => item.spec?.filter?.fields ?? []);
      const multiple = new Set(fields.filter((field) => field.multiple).map((field) => field.id));
      let changed = false;
      const next: Record<string, unknown> = { ...prev };
      Object.entries(prev).forEach(([key, value]) => {
        if (!multiple.has(key) || typeof value !== "string" || !value.includes(",")) return;
        next[key] = value.split(",").filter(Boolean);
        changed = true;
      });
      return changed ? next : prev;
    });
    const queryView = initialSearch.current.get("view");
    const validQuery = summary.doc.views?.some((v) => v.key === queryView) ? queryView : "";
    setView((prev) => prev || validQuery || navHomePage(summary.doc) || summary.doc.views?.[0]?.key || "");
  }, [dashboardId]);

  const fetchRender = useCallback(async (
    viewKey: string,
    nextParams: Record<string, unknown>,
    nextCross: { column: string; value: string } | null,
  ) => {
    setLoading(true);
    try {
      /* 整页渲染要跑十几张卡的 SQL（死数据源时会到 30s+），默认 15s 会把它掐掉 */
      const res = await client.post(`/bi/dashboards/${dashboardId}/render`, {
        view: viewKey,
        params: nextParams,
        cross_filters: nextCross ? [{ column: nextCross.column, value: nextCross.value }] : [],
      }, { timeout: 120000 });
      const data = res.data as DashboardRender;
      setRender(data);
      setError("");
      if (!initialized.current) {
        initialized.current = true;
        setParams((prev) => ({ ...data.params, ...prev }));
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "看板渲染失败");
    } finally {
      setLoading(false);
    }
  }, [dashboardId]);

  useEffect(() => {
    if (!dashboardId) return;
    initialized.current = false;
    /* 换看板时重置成「地址栏里带的那套」而不是空：否则 p_* 会被这一步抹掉、再被默认值顶替 */
    setParams(readParamQuery(initialSearch.current));
    setView("");
    setSelected(null);
    setCrossFilter(null);
    loadDoc().catch(() => setError("看板不存在"));
  }, [dashboardId, loadDoc]);

  useEffect(() => {
    if (!doc || !view) return;
    const timer = window.setTimeout(() => fetchRender(view, params, crossFilter), 180);
    return () => window.clearTimeout(timer);
  }, [doc, view, params, crossFilter, fetchRender]);

  useEffect(() => {
    if (!doc || !view) return;
    window.history.replaceState(null, "", buildSearch(view, params));
  }, [doc, view, params]);

  const currentView = useMemo(
    () => doc?.views.find((v) => v.key === view) ?? doc?.views[0] ?? null,
    [doc, view],
  );

  /** 当前平台（服务端算好的）：卡片按平台各一套，筛选栏共用 */
  const platform = render?.platform ?? "";
  const hasItemsMap = Boolean(currentView?.items_map && Object.keys(currentView.items_map).length);
  const items = useMemo(() => {
    const view = currentView;
    if (!view) return [];
    const map = view.items_map;
    if (!map || !Object.keys(map).length) return view.items ?? [];
    /* 页面级共用只有筛选栏：标题/文字/形状/卡片都归当前平台那一套
       （和后端 view_items_for 同一口径，否则「拼多多删标题连带天猫」在预览里也会复现） */
    const shared = (view.items ?? []).filter((it) => it.type === "filter");
    if (!platform) {
      const first = Object.values(map).find((list) => list.length) || [];
      return [...shared, ...first];
    }
    return [...shared, ...(map[platform] || [])];
  }, [currentView, platform]);

  /** 导航卡「导出 CSV」：把当前页用到的数据集整表导出（每个数据集一个 CSV，遵循同一套 RLS/脱敏/筛选） */
  /** 把若干数据集整表导出（每个一个 CSV） */
  const exportDatasets = useCallback(async (ids: number[]) => {
    if (!hasPerm("bi:data:export:detail")) {
      setToast("没有明细导出权限，请联系管理员开通");
      return;
    }
    if (!ids.length) { setToast("当前页还没有数据"); return; }
    let ok = 0;
    let truncated = false;
    const LIMIT = 5000;
    for (const id of ids) {
      try {
        const detail = await client.get(`/bi/semantic/datasets/${id}`);
        const fields = (detail.data?.fields ?? []) as { name: string }[];
        if (!fields.length) continue;
        const res = await client.post(`/bi/semantic/datasets/${id}/query`, {
          columns: fields.map((f) => ({ name: f.name })),
          limit: LIMIT,
        });
        const columns: string[] = res.data?.columns ?? fields.map((f) => f.name);
        const rows: unknown[][] = (res.data?.rows ?? []).map((row: unknown) => (
          Array.isArray(row) ? row : columns.map((col) => (row as Record<string, unknown>)?.[col])
        ));
        if (rows.length >= LIMIT) truncated = true;
        const stamp = formatChinaTime(new Date()).slice(0, 10);
        downloadCsv(`${detail.data?.name || "数据集"}-${stamp}.csv`, columns, rows);
        ok += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      } catch {
        /* 单个数据集失败不挡其它 */
      }
    }
    setToast(ok
      ? `已导出 ${ok} 个数据集 CSV${truncated ? `（单表上限 ${LIMIT} 行）` : ""}`
      : "导出失败");
  }, [hasPerm]);

  const exportCurrentPageData = useCallback(async (scope: "primary" | "all" | "dataset" = "primary", targetId?: number | null) => {
    /* 统计每个数据集在当前页被多少张卡引用：primary 只导用得最多的那个 */
    const usage = new Map<number, number>();
    items.forEach((it) => {
      const id = it.spec?.binding?.dataset_id;
      if (typeof id === "number") usage.set(id, (usage.get(id) ?? 0) + 1);
    });
    let ids = [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    if (scope === "dataset" && typeof targetId === "number") ids = ids.filter((id) => id === targetId);
    else if (scope === "primary") ids = ids.slice(0, 1);
    await exportDatasets(ids);
  }, [items, exportDatasets]);

  /** 跳转页全展示：从所有页面里找第一张开了开关的导航卡
   *  —— 只认 `nav.global_nav`（换形态后 kind / component 可能对不上），
   *  并且要连 `items_map[平台]` 一起找，否则带平台切换器的看板永远找不到。 */
  const globalNavItem = useMemo(() => {
    for (const v of doc?.views ?? []) {
      const all = [
        ...(v.items ?? []),
        ...Object.values(v.items_map ?? {}).flatMap((list) => list ?? []),
      ];
      const hit = all.find((it) => it.spec?.nav?.global_nav);
      if (hit) return hit;
    }
    return null;
  }, [doc]);


  /** 渲染用列表：当前页没放全局导航就把它叠在最上面（只在渲染层，不写回文档） */
  /** 给「弹窗画板」用的画布坐标版 items（DocItem 的坐标在 layout 里，画板判定要展平） */
  const canvasItems = useMemo(() => items.map((it) => asCanvasItem(it)), [items]);


  /** 按 key 找画板（含其它页面：弹窗画板可以放在别的页） */
  const findBoard = useCallback((key: string | undefined): BoardArea | null => {
    const local = boardOf(canvasItems as unknown as import("../components/boardTypes").CanvasItem[], key);
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
  }, [canvasItems, doc]);

  /** 画板与「画板区域内的组件」不直接铺在页面上：它们是弹窗内容 */
  const hiddenByBoard = useMemo(() => {
    const boards = canvasItems.filter((it) => it.type === "board");
    const keys = new Set<string>(boards.map((b) => String(b.key)));
    canvasItems.forEach((it) => {
      if (it.type === "board") return;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      if (boards.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)) keys.add(String(it.key));
    });
    return keys;
  }, [canvasItems]);

  const renderItems = useMemo(() => {
    if (!globalNavItem) return items;
    const hasGlobal = items.some((it) => it.spec?.nav?.global_nav);
    if (hasGlobal) return items;
    return [{ ...globalNavItem, key: `${globalNavItem.key}__global` }, ...items];
  }, [items, globalNavItem]);
  const cards = render?.cards ?? {};
  /** 指标卡右上角徽标 → 明细表弹窗（只读，不动页面状态；排序配置只在弹窗内生效） */
  const [topKey, setTopKey] = useState<string | null>(null);
  const [topSort, setTopSort] = useState<{ field: string; sort: SortDir } | null>(null);
  /** 这一页的卡片实际读的数据集（后端按平台分套切过表）：筛选栏「逐级筛选」按它取候选值 */
  const pageDatasets = useMemo(() => {
    const usage = new Map<number, number>();
    Object.values(cards).forEach((card) => {
      const id = Number((card as { dataset_id?: number } | null)?.dataset_id);
      if (Number.isFinite(id) && id > 0) usage.set(id, (usage.get(id) ?? 0) + 1);
    });
    /* 卡片最多的那张排第一：逐级候选值只按它取，避免把不同数据集的词表合并 */
    return [...usage.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [cards]);
  const paramFields: FilterFieldSpec[] = render?.param_defs ?? [];
  /** 宽屏按原尺寸居中，窄屏等比缩小，组件沿用画布内坐标。 */
  const designWidth = currentView?.canvas?.width ?? DESIGN_W;
  const surfaceScale = Math.min(1, surfaceWidth / designWidth);
  const surfaceOffsetX = (surfaceWidth - designWidth * surfaceScale) / 2;
  const surfaceHeight = currentView?.canvas?.height ?? (items.reduce((max, item) => {
    const layout = item.layout;
    if (!layout) return max;
    return Math.max(max, layout.y + layout.h);
  }, 320) + 24);

  /** 画板（设计区）之外的控件不铺在页面上：它们只是弹窗内容，点了才弹出来。
   *  编辑态（含编辑器）仍照常显示，否则拖出去就再也找不回来了。 */
  const outsidePage = useMemo(() => {
    const keys = new Set<string>();
    canvasItems.forEach((it) => {
      if (it.type === "board") return;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      if (cx < 0 || cy < 0 || cx > designWidth || cy > surfaceHeight) keys.add(String(it.key));
    });
    return keys;
  }, [canvasItems, designWidth, surfaceHeight]);

  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width ?? 0;
      if (width > 0) setSurfaceWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [doc]);

  const selectedItem = items.find((i) => i.key === selected) ?? null;
  const selectedIndex = items.findIndex((i) => i.key === selected);

  const resolveActionParams = (action: DocAction, row?: Record<string, unknown>) => {
    const out: Record<string, string> = {};
    Object.entries(action.params || {}).forEach(([key, rule]) => {
      if (typeof rule === "string" && rule.startsWith("$row.")) {
        const field = rule.slice(5);
        const value = row?.[field];
        if (value !== undefined && value !== null) out[key] = String(value);
      } else {
        out[key] = String(rule);
      }
    });
    return out;
  };

  const openOverlay = async (item: DocItem, trigger: "primary" | "row", row?: Record<string, unknown>) => {
    const action = trigger === "row" ? item.row_action : item.action;
    if (!action) return;
    try {
      const res = await client.post(`/bi/dashboards/${dashboardId}/overlay`, {
        item_key: item.key, trigger, view, params,
        action_params: resolveActionParams(action, row),
      });
      setOverlay({
        type: action.type, title: res.data.title || "",
        kind: String(res.data.payload?.kind || ""), payload: res.data.payload,
      });
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setToast(detail || "打开失败");
    }
  };

  // 深链：?open=卡片key&trigger=row|primary
  useEffect(() => {
    if (!render || !currentView || !doc) return;
    const search = new URLSearchParams(initialSearch.current.toString());
    const openKey = search.get("open");
    if (!openKey) return;
    const item = items.find((i) => i.key === openKey);
    if (!item) return;
    const trigger = search.get("trigger") === "row" ? "row" : "primary";
    if (trigger === "row") {
      const rows = render.cards[item.key]?.rows ?? [];
      if (!rows.length) return;
      openOverlay(item, "row", rows[0]);
    } else {
      openOverlay(item, "primary");
    }
    search.delete("open");
    search.delete("trigger");
    const nextQuery = search.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [render, currentView, doc]);

  // 深链选中元素：?edit=1&select=<序号或key>
  useEffect(() => {
    if (!editing || !currentView) return;
    const wanted = initialSearch.current.get("select");
    if (!wanted) return;
    const index = Number(wanted);
    const item = Number.isFinite(index) && String(index) === wanted
      ? items[index]
      : items.find((i) => i.key === wanted);
    if (item) setSelected(item.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, currentView]);

  useEffect(() => {
    if (!inCanvas) return;
    client.get("/bi/dashboards").then((res) => setDashboards(res.data?.dashboards || [])).catch(() => {});
  }, [inCanvas]);

  useEffect(() => {
    if (!editing) return;
    client.get("/bi/semantic/datasets").then((res) => setDatasets(res.data?.datasets || [])).catch(() => {});
    client.get("/bi/components", { params: { limit: 100 } }).then((res) => setLibrary(res.data?.components || [])).catch(() => {});
  }, [editing]);

  const onParamChange = (fieldId: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [fieldId]: value }));
  };

  // ── 保存：结构改动立即保存；输入类防抖 ──
  const persist = useCallback(async (next: DashboardDoc) => {
    setSaving(true);
    try {
      await client.put(`/bi/dashboards/${dashboardId}`, { doc: next });
      fetchRender(view, params, crossFilter);
    } catch {
      setToast("保存失败");
    } finally {
      setSaving(false);
    }
  }, [dashboardId, fetchRender, view, params, crossFilter]);

  const updateDoc = (next: DashboardDoc, debounce = false) => {
    setDoc(next);
    window.clearTimeout(saveTimer.current);
    if (debounce) {
      saveTimer.current = window.setTimeout(() => persist(next), 650);
    } else {
      persist(next);
    }
  };

  const patchItems = (mutate: (list: DocItem[]) => DocItem[], debounce = false) => {
    if (!doc || !currentView) return;
    const next: DashboardDoc = {
      ...doc,
      views: doc.views.map((v) => {
        if (v.key !== currentView.key) return v;
        // 分平台的看板：结构改动只动「当前平台那一套」
        if (!hasItemsMap) return { ...v, items: mutate([...v.items]) };
        const map = { ...(v.items_map || {}) };
        map[platform] = mutate([...(map[platform] || [])]);
        return { ...v, items_map: map };
      }),
    };
    updateDoc(next, debounce);
  };

  const updateItem = (key: string, patch: Partial<DocItem>, debounce = false) => {
    patchItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)), debounce);
  };

  const updateSpec = (key: string, spec: ComponentSpec, debounce = true) => {
    updateItem(key, { spec }, debounce);
  };

  const moveItem = (index: number, delta: number) => {
    patchItems((list) => {
      const target = index + delta;
      if (target < 0 || target >= list.length) return list;
      const [item] = list.splice(index, 1);
      list.splice(target, 0, item);
      return list;
    });
  };

  const resize = (index: number, spanDelta: number) => {
    patchItems((list) => list.map((item, i) =>
      i === index ? { ...item, span: Math.max(1, Math.min(12, item.span + spanDelta)) } : item));
  };

  const removeItem = (index: number) => {
    const key = items[index]?.key;
    patchItems((list) => list.filter((_, i) => i !== index));
    if (key === selected) setSelected(null);
  };

  const insertElement = (element: DocItem) => {
    patchItems((list) => [...list, element]);
    setSelected(element.key);
  };

  const nextKey = (prefix: string) => `${prefix}_${Date.now().toString(36).slice(-5)}`;

  const addHeading = () => insertElement({
    key: nextKey("h"), type: "heading", text: "新标题", note: "", index: "一", icon: "grid",
    span: 12, h: 56,
  });

  const addText = () => insertElement({
    key: nextKey("t"), type: "text", text: "在这里写说明文字", span: 12, h: 48, size: 13, weight: 400,
  });

  const addDivider = () => insertElement({ key: nextKey("d"), type: "divider", span: 12, h: 24 });

  const addComponent = (component: ComponentItem) => {
    const kind = component.kind;
    const isFilter = kind === "filter";
    insertElement({
      key: nextKey(component.code.replace(/\W/g, "")),
      type: isFilter ? "filter" : "chart",
      component: component.code,
      spec: JSON.parse(JSON.stringify(component.spec)),
      span: isFilter ? 12 : kind === "kpi" ? 3 : 6,
      h: isFilter ? 76 : kind === "kpi" ? 112 : 320,
    });
    setAddOpen(false);
  };

  const loadFavorites = useCallback(async () => {
    try {
      const res = await client.get(`/bi/dashboards/${dashboardId}/favorites`);
      setFavorites(res.data?.favorites || []);
    } catch {
      setFavorites([]);
    }
  }, [dashboardId]);

  useEffect(() => { void loadFavorites(); }, [loadFavorites]);

  /** 应用收藏：视图 + 筛选一起恢复（地址栏由下面的 effect 自动同步） */
  const applyFavorite = (fav: { name: string; view_key: string; params: Record<string, unknown> }) => {
    setFavAnchor(null);
    setCrossFilter(null);
    if (fav.view_key && fav.view_key !== view) setView(fav.view_key);
    setParams({ ...(fav.params || {}) });
    setToast(`已应用收藏：${fav.name}`);
  };

  const saveFavorite = async () => {
    if (!favName.trim()) return;
    setFavSaving(true);
    try {
      await client.post(`/bi/dashboards/${dashboardId}/favorites`, {
        name: favName.trim(), view, params,
      });
      setFavOpen(false);
      setFavName("");
      await loadFavorites();
      setToast("已保存当前视图与筛选");
    } catch (e: any) {
      setToast(e?.response?.data?.detail || "保存失败");
    } finally {
      setFavSaving(false);
    }
  };

  const removeFavorite = async (favId: number) => {
    try {
      await client.delete(`/bi/dashboards/${dashboardId}/favorites/${favId}`);
      await loadFavorites();
      setToast("已删除收藏");
    } catch (e: any) {
      setToast(e?.response?.data?.detail || "删除失败");
    }
  };

  /** 下钻：按联动的那一列取这张卡数据集的原始行 */
  const openDrill = async () => {
    if (!crossFilter) return;
    const title = `明细：${crossFilter.label}`;
    setDrill({ open: true, loading: true, title, columns: [], rows: [], error: "" });
    try {
      const res = await client.post(`/bi/dashboards/${dashboardId}/drill`, {
        view,
        params,
        item_key: crossFilter.itemKey,
        column: crossFilter.column,
        value: crossFilter.value,
      });
      setDrill({
        open: true, loading: false, title,
        columns: res.data?.columns || [],
        rows: res.data?.rows || [],
        error: "",
      });
    } catch (e: any) {
      setDrill({
        open: true, loading: false, title, columns: [], rows: [],
        error: e?.response?.data?.detail || "读取明细失败",
      });
    }
  };

  /** 整页导出：按当前视图 + 当前筛选参数生成（后端与看板同一渲染口径） */
  const exportBoard = async (format: "xlsx" | "html" | "pdf" | "png") => {
    setExportAnchor(null);
    setExporting(true);
    // 先同步开窗（用户点击手势内），拿到结果后再把 blob 塞进去；否则会被浏览器拦截
    const popup = format === "html" ? window.open("about:blank", "_blank") : null;
    try {
      const res = await client.post(
        `/bi/reports/export/${dashboardId}`,
        { view, params, format, title: meta?.name ? `${meta.name} 报表` : "",
          cross_filters: crossFilter ? [{ column: crossFilter.column, value: crossFilter.value }] : [] },
        { responseType: "blob", timeout: 120000 },
      );
      const disposition = String(res.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || `${meta?.name || "看板"}-${formatChinaTime(new Date()).slice(0, 10)}.${format}`;
      const url = URL.createObjectURL(res.data);
      if (format === "html") {
        if (popup) {
          popup.location.href = url;
          window.setTimeout(() => URL.revokeObjectURL(url), 60000);
          setToast("已打开报表，可在浏览器里打印为 PDF");
        } else {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = filename;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          URL.revokeObjectURL(url);
          setToast("已下载 HTML，打开后可打印为 PDF");
        }
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setToast(format === "xlsx" ? "已导出 Excel"
          : format === "pdf" ? "已导出 PDF" : "已导出 PNG");
      }
    } catch (e: any) {
      if (popup) popup.close();
      setToast(e?.response?.status === 403 ? "没有导出权限，请联系管理员开通" : "导出失败，请重试");
    } finally {
      setExporting(false);
    }
  };

  const canEdit = meta?.my_permission !== "view";
  const watermarkText = useWatermarkText();
  // 导出与后端同口径：xlsx 要明细权限，pdf/png/html 要汇总权限；都没有就不显示入口
  const canExportDetail = hasPerm("bi:data:export:detail");
  const canExportSummary = hasPerm("bi:data:export:summary");
  const canExport = canExportDetail || canExportSummary;

  if (error && !doc) {
    return <Box sx={{ p: 6 }}><Alert severity="error">{error}</Alert></Box>;
  }

  return (
    <Box sx={{
      display: "flex", height: "100%", minHeight: 0, overflowY: "auto",
      bgcolor: "#F7F9FD",
    }}>
      {inCanvas && (
        <LayersPanel
          items={items}
          selected={selected}
          onSelect={setSelected}
          viewTitle={currentView?.title || ""}
        />
      )}
      {/* 预览时「编辑 / 导出」不占版面：浮在右上角，设计页面从顶栏下方第一个像素开始 */}
      {!inCanvas && dashboardId > 0 && (
        <>
          {canExport && (
          <Button
            size="small"
            disabled={exporting}
            startIcon={exporting ? <CircularProgress size={13} /> : <FileDownload sx={{ fontSize: 15 }} />}
            onClick={(e) => setExportAnchor(e.currentTarget)}
            sx={{ ...FLOAT_BTN_SX, right: canEdit ? 88 : 20 }}
          >
            导出
          </Button>
          )}
          <Button
            size="small"
            startIcon={<BookmarkBorder sx={{ fontSize: 15 }} />}
            onClick={(e) => {
              setFavAnchor(e.currentTarget);
              void loadFavorites();
            }}
            sx={{ ...FLOAT_BTN_SX, right: canEdit ? 156 : 88 }}
          >
            收藏视图
          </Button>
          <Menu
            anchorEl={favAnchor}
            open={!!favAnchor}
            onClose={() => setFavAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { mt: 1, width: 280, borderRadius: "12px", border: "1px solid #EEF3FB" } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#1D1D1F" }}>
                收藏视图
              </Typography>
              <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.25 }}>
                保存当前视图与筛选，随时一键恢复
              </Typography>
            </Box>
            <Divider sx={{ borderColor: "#EEF3FB" }} />
            <Box sx={{ maxHeight: 260, overflow: "auto" }}>
              {favorites.length === 0 ? (
                <Box sx={{ py: 2.5, textAlign: "center" }}>
                  <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>暂无收藏</Typography>
                </Box>
              ) : favorites.map((fav) => (
                <Box key={fav.id} sx={{ display: "flex", alignItems: "center", px: 1, "&:hover": { bgcolor: "rgba(15,23,42,0.035)" } }}>
                  <Box
                    onClick={() => applyFavorite(fav)}
                    sx={{ flex: 1, minWidth: 0, px: 1, py: 1, cursor: "pointer" }}
                  >
                    <Typography noWrap sx={{ fontSize: 12.5, color: "#1D1D1F" }}>{fav.name}</Typography>
                    <Typography noWrap sx={{ fontSize: 10.5, color: "#94A3B8", mt: 0.25 }}>
                      {Object.keys(fav.params || {}).length} 个筛选 · {formatChinaTime(fav.updated_at).slice(5, 16)}
                    </Typography>
                  </Box>
                  <IconButton size="small" onClick={() => void removeFavorite(fav.id)} title="删除收藏">
                    <Delete sx={{ fontSize: 15, color: "#94A3B8" }} />
                  </IconButton>
                </Box>
              ))}
            </Box>
            <Divider sx={{ borderColor: "#EEF3FB" }} />
            <MenuItem
              dense
              onClick={() => {
                setFavAnchor(null);
                setFavName(`${meta?.name || "看板"} · 收藏`);
                setFavOpen(true);
              }}
              sx={{ fontSize: 12.5, color: "#4F46E5" }}
            >
              保存当前视图与筛选…
            </MenuItem>
          </Menu>
          <Menu
            anchorEl={exportAnchor}
            open={!!exportAnchor}
            onClose={() => setExportAnchor(null)}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 176, borderRadius: 2, border: "1px solid #EEF3FB" } } }}
          >
            {canExportDetail && (
              <MenuItem dense onClick={() => void exportBoard("xlsx")} sx={{ fontSize: 13 }}>
                Excel（.xlsx）
              </MenuItem>
            )}
            {canExportSummary && (
              <MenuItem dense onClick={() => void exportBoard("pdf")} sx={{ fontSize: 13 }}>
                PDF（.pdf）
              </MenuItem>
            )}
            {canExportSummary && (
              <MenuItem dense onClick={() => void exportBoard("png")} sx={{ fontSize: 13 }}>
                PNG 长图（.png）
              </MenuItem>
            )}
            {canExportSummary && (
              <MenuItem dense onClick={() => void exportBoard("html")} sx={{ fontSize: 13 }}>
                HTML / 打印为 PDF
              </MenuItem>
            )}
          </Menu>
        </>
      )}
      {!inCanvas && dashboardId > 0 && meta?.my_permission !== "view" && (
        <Button
          size="small"
          startIcon={<Edit sx={{ fontSize: 15 }} />}
          onClick={() => { window.location.href = `/bi/canvas?doc=${dashboardId}`; }}
          sx={{ ...FLOAT_BTN_SX, right: 20 }}
        >
          编辑
        </Button>
      )}
      {/* 图表联动提示：点柱子 / 饼块 / 排行项后出现，点 × 取消；可继续下钻看明细 */}
      {!inCanvas && crossFilter && (
        <Box sx={{ position: "fixed", left: 20, bottom: 20, zIndex: 45, display: "flex", alignItems: "center", gap: 1 }}>
          <Chip
            size="small"
            label={`联动：${crossFilter.label}`}
            onDelete={() => setCrossFilter(null)}
            sx={{
              height: 28, fontSize: 11.5, color: "#334155",
              bgcolor: "rgba(255,255,255,0.96)", border: "1px solid #D8E2F5",
              boxShadow: "0 2px 10px rgba(15,23,42,0.08)",
              "& .MuiChip-deleteIcon": { fontSize: 16, color: "#94A3B8" },
            }}
          />
          <Button
            size="small"
            onClick={() => void openDrill()}
            sx={{
              height: 28, px: 1.25, textTransform: "none", fontSize: 11.5, color: "#4F46E5",
              bgcolor: "rgba(255,255,255,0.96)", border: "1px solid #D8E2F5",
              boxShadow: "0 2px 10px rgba(15,23,42,0.08)", borderRadius: "999px",
              "&:hover": { bgcolor: "#fff" },
            }}
          >
            查看明细
          </Button>
        </Box>
      )}
      <Box sx={{
        flex: 1, minWidth: 0, pb: 8,
        pr: selectedItem && editing ? "352px" : 0,
        transition: "padding-right .16s ease",
      }}>
      {/* 多视图才需要切换条：单视图不占任何高度，设计页面直接顶到最上面 */}
      {/* 页面切换不在这里给：成品页只有导航卡一条导航（页面靠 ?view= 深链或导航卡跳转） */}

      {inCanvas && dashboards.length > 0 && (
        <Box sx={{ mx: PAGE_X, mb: 1, display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", mr: 0.5 }}>编辑看板</Typography>
          {dashboards.map((item) => (
            <Chip
              key={item.id}
              size="small"
              label={item.name}
              onClick={() => { if (item.id !== dashboardId) window.location.href = `/bi/canvas?doc=${item.id}`; }}
              sx={{
                fontSize: 11, height: 24, cursor: "pointer",
                bgcolor: item.id === dashboardId ? "rgba(79,70,229,0.1)" : "#fff",
                color: item.id === dashboardId ? "#4F46E5" : "#64748B",
                border: "1px solid",
                borderColor: item.id === dashboardId ? "rgba(79,70,229,0.35)" : "#E8EEF8",
                "&:hover": { bgcolor: "rgba(79,70,229,0.06)" },
              }}
            />
          ))}
        </Box>
      )}

      {/* 编辑功能区：标题 / 文字 / 分割线 / 组件 / 筛选栏 */}
      {editing && (
        <Box sx={{
          mx: PAGE_X, mb: 1.5, px: 1, py: 0.75,
          display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap",
          bgcolor: "#fff", border: "1px solid #E8EEF8", borderRadius: 2.5,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        }}>
          <ToolbarButton icon={<TitleIcon sx={{ fontSize: 16 }} />} label="标题" onClick={addHeading} />
          <ToolbarButton icon={<TextFields sx={{ fontSize: 16 }} />} label="文字" onClick={addText} />
          <ToolbarButton icon={<HorizontalRule sx={{ fontSize: 16 }} />} label="分割线" onClick={addDivider} />
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          <ToolbarButton icon={<ViewQuilt sx={{ fontSize: 16 }} />} label="组件" onClick={() => setAddOpen(true)} />
          <ToolbarButton icon={<Tune sx={{ fontSize: 16 }} />} label="筛选栏"
            onClick={() => {
              const filter = library.find((c) => c.kind === "filter");
              if (filter) addComponent(filter);
            }} />
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11, color: "#94A3B8", mr: 1 }}>
            {items.length} 个元素{selectedItem ? " · 已选中" : ""}
          </Typography>
        </Box>
      )}

      {/* 自由画布（只读，位置与画布编辑器一致） */}
      <Box ref={surfaceRef} sx={{ pb: 6 }}>
        <Box sx={{ position: "relative", width: "100%", height: surfaceHeight * surfaceScale }}>
          <CanvasDetailContext.Provider value={{ items: canvasItems as unknown as import("../components/boardTypes").CanvasItem[], findBoard }}>
          <Box sx={{
            position: "absolute", top: 0, left: surfaceOffsetX, width: designWidth, height: surfaceHeight,
            transform: `scale(${surfaceScale})`, transformOrigin: "top left",
          }}>
            {renderItems.filter((item) => !hiddenByBoard.has(String(item.key))
              && (editing || !outsidePage.has(String(item.key)))).map((item, index) => {
              const type = item.type || "chart";
              const layout = item.layout || { x: 12, y: 12, w: 400, h: item.h || 260 };
              const payload = cards[item.key];
              return (
                <Box key={item.key} sx={{
                  position: "absolute", zIndex: index, left: layout.x, top: layout.y, width: layout.w, height: layout.h,
                }}>
                  {type === "filter" ? (
                    <Box sx={{
                      height: "100%", display: "flex", alignItems: "center",
                      px: 0, py: 0, overflow: "hidden",
                    }}>
                      <FilterBar fields={paramFields} values={params}
                        surface={!!item.spec?.filter?.background}
                        datasets={pageDatasets}
                        onChange={(id, value) => setParams((p) => ({ ...p, [id]: value }))} />
                    </Box>
                  ) : type === "heading" ? (
                    <HeadingElement item={item} />
                  ) : type === "text" ? (
                    <TextElement item={item} />
                  ) : type === "divider" ? (
                    <ShapeView shape={shapeOf(item.spec?.shape)} />
                  ) : (item.component || "") === "base.nav" && item.spec?.nav ? (
                    <NavCard
                      payload={item.spec.nav as unknown as NavPayload}
                      ui={(item.spec.ui ?? DEFAULT_UI) as unknown as NavUi}
                      currentPage={view}
                      onAction={(label, isExport) => {
                        if (isExport || /导出|export/i.test(label)) {
                          const navSpec = item.spec?.nav;
                          void exportCurrentPageData(
                            (navSpec?.export_scope as "primary" | "all" | "dataset") || "primary",
                            navSpec?.export_dataset_id ?? null,
                          );
                        }
                      }}
                      onNavigate={(page) => {
                        if (doc?.views.some((v) => v.key === page)) {
                          setView(page);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }
                      }}
                    />
                  ) : payload?.error ? (
                    <Box sx={{
                      height: "100%", bgcolor: "#fff", border: "1px solid #FEE2E2", borderRadius: 3,
                      display: "grid", placeItems: "center", px: 2, textAlign: "center",
                    }}>
                      <Typography sx={{ fontSize: 12, color: "#B91C1C" }}>{payload.error}</Typography>
                    </Box>
                  ) : payload && payload.kind ? (
                    <Box
                      onClick={() => (item.action ? openOverlay(item, "primary") : undefined)}
                      sx={{ height: "100%", cursor: item.action ? "pointer" : "default", "& > *": { height: "100%" } }}>
                      {(() => {
                        const Renderer = RENDERERS[payload.kind];
                        if (!Renderer) return null;
                        return (
                          <Renderer
                            payload={payload}
                            ui={payload.ui ?? DEFAULT_UI}
                            currentPage={view}
                            onNavigate={(page) => {
                              if (doc?.views.some((v) => v.key === page)) {
                                setView(page);
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }
                            }}
                            onTopList={payload.top?.enabled ? () => {
                              const top = payload.top as { table_key?: string; sort_field?: string; sort?: SortDir } | undefined;
                              setTopSort({ field: String(top?.sort_field || ""), sort: top?.sort ?? "" });
                              setTopKey(String(top?.table_key || ""));
                            } : undefined}
                            onExport={payload.kind === "table" && typeof item.spec?.binding?.dataset_id === "number"
                              ? () => { void exportDatasets([item.spec?.binding?.dataset_id as number]); }
                              : undefined}
                            onSliceClick={!inCanvas && !editing && payload.dimension_label
                              ? (name: string) => {
                                const column = String(payload.dimension_label);
                                setCrossFilter((prev) => (
                                  prev && prev.column === column && prev.value === name
                                    ? null
                                    : { column, value: name, label: `${column} = ${name}`, itemKey: item.key }
                                ));
                              }
                              : undefined}
                            onRowClick={item.row_action ? (row) => openOverlay(item, "row", row) : undefined}
                          />
                        );
                      })()}
                    </Box>
                  ) : (
                    <Box sx={{ height: "100%", display: "grid", placeItems: "center" }}>
                      <CircularProgress size={16} />
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
          </CanvasDetailContext.Provider>
        </Box>
      </Box>

      <OverlayHost overlay={overlay} onClose={() => setOverlay(null)} />

      {/* 元素属性面板 */}
      <Inspector
        open={editing && Boolean(selectedItem)}
        item={selectedItem}
        datasets={datasets}
        onClose={() => setSelected(null)}
        onChange={(patch, debounce) => selectedItem && updateItem(selectedItem.key, patch, debounce)}
        onSpecChange={(spec, debounce) => selectedItem && updateSpec(selectedItem.key, spec, debounce)}
        onDelete={() => selectedIndex >= 0 && removeItem(selectedIndex)}
      />

      {/* 指标卡右上角徽标 → 明细表弹窗（只读，不改页面状态；排序只在弹窗内生效） */}
      {topKey && (
        <TopListDialog
          open
          onClose={() => { setTopKey(null); setTopSort(null); }}
          payload={cards[topKey] ?? null}
          sortField={topSort?.field ?? ""}
          sort={topSort?.sort ?? ""}
        />
      )}

      {/* 组件选择 */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontSize: 14, fontWeight: 700 }}>
          插入组件
          <Typography component="span" sx={{ fontSize: 11.5, color: "#94A3B8", ml: 1 }}>
            组件库按「类型」提供，插入后可调配置
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(188px, 1fr))", gap: 1 }}>
            {library.map((component) => (
              <Box key={component.code} onClick={() => addComponent(component)}
                sx={{
                  border: "1px solid #EEF3FB", borderRadius: 2, p: 1.25, cursor: "pointer",
                  "&:hover": { borderColor: "rgba(79,70,229,0.4)", bgcolor: "rgba(79,70,229,0.03)" },
                }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }} noWrap>
                  {component.name}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mt: 0.25 }} noWrap>
                  {ROLE_LABEL[KIND_ROLE[component.kind]]} · {KIND_LABEL[component.kind]}
                </Typography>
              </Box>
            ))}
          </Box>
        </DialogContent>
      </Dialog>

      {/* 保存收藏视图 */}
      <Dialog open={favOpen} onClose={() => setFavOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>保存收藏视图</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: "#475569", mb: 1.5 }}>
            会同时保存当前页面与筛选条件，下次从「收藏视图」一键恢复。
          </Typography>
          <TextField
            autoFocus
            size="small"
            fullWidth
            label="收藏名称"
            value={favName}
            onChange={(e) => setFavName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveFavorite(); }}
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setFavOpen(false)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            variant="contained"
            disabled={favSaving || !favName.trim()}
            onClick={() => void saveFavorite()}
            startIcon={favSaving ? <CircularProgress size={13} color="inherit" /> : null}
            sx={{ textTransform: "none", borderRadius: 2 }}
          >
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 下钻明细 */}
      <Dialog open={drill.open} onClose={() => setDrill((prev) => ({ ...prev, open: false }))} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>{drill.title}</DialogTitle>
        <DialogContent>
          {drill.loading ? (
            <Box sx={{ py: 6, display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>
          ) : drill.error ? (
            <Alert severity="error" sx={{ borderRadius: 2, fontSize: 12.5 }}>{drill.error}</Alert>
          ) : (
            <>
              <Box sx={{ border: "1px solid #EEF3FB", borderRadius: "12px", overflow: "auto", maxHeight: "60vh" }}>
                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <Box component="thead">
                    <Box component="tr">
                      {drill.columns.map((column) => (
                        <Box component="th" key={column} sx={{
                          position: "sticky", top: 0, zIndex: 1, bgcolor: "#F5F8FF", color: "#475569",
                          textAlign: "left", fontWeight: 600, px: 1.25, py: 0.9,
                          borderBottom: "1px solid #EEF3FB", whiteSpace: "nowrap",
                        }}>
                          {column}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {drill.rows.map((row, index) => (
                      <Box component="tr" key={index} sx={{ "&:hover": { bgcolor: "rgba(15,23,42,0.02)" } }}>
                        {drill.columns.map((column) => (
                          <Box component="td" key={column} sx={{
                            px: 1.25, py: 0.75, borderBottom: "1px solid #F5F7FB",
                            color: "#334155", maxWidth: 280, overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums",
                          }} title={cellText(row[column])}>
                            {cellText(row[column])}
                          </Box>
                        ))}
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
              <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 1 }}>
                共 {drill.rows.length} 行（最多 200 行）
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDrill((prev) => ({ ...prev, open: false }))} sx={{ textTransform: "none" }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(toast)} autoHideDuration={2200} onClose={() => setToast("")} message={toast} />
      <WatermarkOverlay text={watermarkText} />
      </Box>
    </Box>
  );
}

/** 左侧图层面板 —— 元素列表，点击选中、上下移动 */
