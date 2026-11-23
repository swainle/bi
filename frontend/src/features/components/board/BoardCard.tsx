/** 画布卡片 —— 渲染器自己就是一张卡；这里只负责定位、拖动、缩放、删除 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Box, IconButton } from "@mui/material";
import { Close } from "@mui/icons-material";
import { RENDERERS } from "../registry";
import ShapeView, { shapeOf } from "../shapes";
import FilterBar from "../renderers/FilterBar";
import BannerCard from "../renderers/BannerCard";
import NavCard, { type NavPayload, type NavUi } from "../renderers/NavCard";
import type { ComponentKind, FilterFieldSpec, RenderPayload } from "../types";
import type { CanvasItem } from "../boardTypes";
import { snapMove, snapResize, MIN_H, MIN_W, type Guide, type MinSize, type Rect, type ResizeEdge } from "./snapping";
import { sizeOfKind } from "../sizes";
import { sectionPayload } from "./sectionPayload";

interface Props {
  item: CanvasItem;
  payload: RenderPayload | null;
  error?: string;
  selected: boolean;
  onSelect: (additive: boolean) => void;
  onLayoutChange: (next: { x: number; y: number; w: number; h: number }) => void;
  onDelete: () => void;
  scale?: number;
  zIndex?: number;
  /** 同视图其它元素的位置（磁吸参考） */
  others?: Rect[];
  /** 手工参考线的吸附坐标 */
  guideLines?: { x: number[]; y: number[] };
  designWidth?: number;
  designHeight?: number;
  onGuides?: (guides: Guide[]) => void;
  /** 拖拽实况：位置一律直接写 DOM，松手才回调 onLayoutChange 提交一次 */
  registerNode?: (el: HTMLDivElement | null) => void;
  /** 画板拖动时一起位移的元素 key（画板区域内的组件） */
  followers?: string[];
  getCardNode?: (key: string) => HTMLElement | null;
  /** ⌥ + 拖动：先在原位复制一份，原元素继续被拖走（PS 手感） */
  onDuplicateForDrag?: () => void;
  onGhostStart?: () => void;
  onGhost?: (dx: number, dy: number) => void;
  onGhostEnd?: () => void;
  filterFields?: FilterFieldSpec[];
  filterValues?: Record<string, unknown>;
  onFilterChange?: (id: string, value: unknown) => void;
  /** 本页卡片读的数据集：给了就做「逐级筛选」（下游下拉随上游条件收窄） */
  filterDatasets?: number[];
  /** 指标卡右上角徽标被点（打开指定明细表弹窗；带上这张卡的弹窗配置，排序只在弹窗内生效） */
  onTopList?: (itemKey: string, top?: RenderPayload["top"]) => void;
  /** 当前编辑的页面 key：导航卡据此高亮「你在哪一页」 */
  currentPage?: string;
}

type DragState = {
  mode: "move" | "resize";
  /** 缩放时被拖动的是哪条边（上 / 下 / 左 / 右 / 右下角） */
  edge: ResizeEdge;
  startX: number;
  startY: number;
  base: { x: number; y: number; w: number; h: number };
  /** 按下时就按住了 ⌥（= 拖动复制）：此时 ⌥ 不代表「关磁吸」 */
  altStart?: boolean;
};

/**
 * 四条边的缩放手柄：按屏幕像素给宽度（画布缩放后依然好抓），细条压在边线上
 * hit = 屏幕 10px 换算回设计坐标；悬停时只显示中间一根细线
 */
function edgeHandleStyle(edge: Exclude<ResizeEdge, "se">, hit: number): Record<string, unknown> {
  const half = Math.round(hit / 2);
  const gap = hit + 8;
  const horizontal = edge === "n" || edge === "s";
  return {
    ...(edge === "n" ? { top: -half } : edge === "s" ? { bottom: -half } : edge === "w" ? { left: -half } : { right: -half }),
    ...(horizontal ? { height: hit, left: gap, right: gap } : { width: hit, top: gap, bottom: gap }),
    cursor: horizontal ? "ns-resize" : "ew-resize",
    "&::after": {
      content: '""', position: "absolute", borderRadius: 2,
      bgcolor: "transparent", transition: "background-color .12s",
      ...(horizontal ? { left: 0, right: 0, top: "35%", bottom: "35%" } : { top: 0, bottom: 0, left: "35%", right: "35%" }),
    },
    "&:hover::after": { bgcolor: "rgba(99,102,241,0.55)" },
  } as Record<string, unknown>;
}

/** 卡片内容里「按下去要做别的事」的元素 —— 它们不能当成拖动起点 */
const NO_DRAG = '[data-no-drag],button,a,input,textarea,select,label,[role="button"],[role="combobox"],[role="menu"],[contenteditable="true"],.MuiInputBase-root,.MuiSelect-select';

/** 按下点是不是落在卡片内的可交互元素上（按钮 / 表单 / 自定义下拉这类 div 都靠 cursor:pointer 认）
 *  例外：ECharts 内部在悬停到数据点时会把自己设成 pointer，那是「悬停反馈」不是「可点按钮」，
 *  否则压在某根柱子 / 某个扇区上就拖不动卡片了。 */
function isInteractive(target: HTMLElement): boolean {
  const card = target.closest("[data-board-key]");
  const hit = target.closest(NO_DRAG);
  if (hit && card && card.contains(hit)) return true;
  const chart = target.closest(".echarts-for-react");
  let el: HTMLElement | null = target;
  while (el && el !== card) {
    const inChart = !!chart && chart.contains(el);
    if (!inChart && el.tagName !== "CANVAS" && getComputedStyle(el).cursor === "pointer") return true;
    el = el.parentElement;
  }
  return false;
}

/** 关掉磁吸时的纯几何缩放（同一条边拖动，对边钉住） */
function plainResize(base: Rect, edge: ResizeEdge, dx: number, dy: number, min: MinSize): Rect {
  let { x, y, w, h } = base;
  if (edge.includes("e")) w = base.w + dx;
  else if (edge.includes("w")) { w = base.w - dx; x = base.x + dx; }
  if (edge.includes("s")) h = base.h + dy;
  else if (edge.includes("n")) { h = base.h - dy; y = base.y + dy; }
  // 最小尺寸只约束被拖的那条轴
  if (edge.includes("e") || edge.includes("w")) {
    if (w < min.w) { if (edge.includes("w")) x = base.x + base.w - min.w; w = min.w; }
  }
  if (edge.includes("n") || edge.includes("s")) {
    if (h < min.h) { if (edge.includes("n")) y = base.y + base.h - min.h; h = min.h; }
  }
  return {
    x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
    w: Math.round(w), h: Math.round(h),
  };
}

export default function BoardCard({
  item, payload, error, selected, onSelect, onLayoutChange, onDelete, scale = 1, zIndex,
  others = [], guideLines, designWidth = 1440, designHeight = 620, onGuides,
  filterFields, filterValues, onFilterChange, filterDatasets, onTopList, currentPage,
  registerNode, onDuplicateForDrag, onGhostStart, onGhost, onGhostEnd,
  followers, getCardNode,
}: Props) {
  /** 卡片级报错（数据源连不上等）：卡片高度有限，最多显示两行，完整原因放 title */
  const cardError = error || (payload as { error?: string } | null)?.error || "";
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hover, setHover] = useState(false);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const liveRect = useRef<Rect | null>(null);
  const frame = useRef(0);

  /** 最小尺寸按元素类型：页面元素本来就矮，不能套图表那套 180×110 */
  const isPageElement = !!item.type && item.type !== "chart" && item.type !== "filter";
  /** 筛选栏是「控件条」不是卡片：最小高度只留控件本身的 32px + 一点余量，
   *  否则会被图表卡的最小 110 顶住 —— 拖矮反而变大、想贴住文字根本拉不下去 */
  const isBarElement = item.type === "filter";
  const MIN_SIZE: MinSize = isPageElement
    ? { w: 120, h: item.type === "divider" ? 16 : 36 }
    : isBarElement
      ? { w: 240, h: 36 }
      : { w: MIN_W, h: MIN_H };

  /** 拖动中组件不重渲染，回调与几何参数一律走 ref，避免闭包拿到过期值 */
  const ctx = useRef({
    onLayoutChange, onGuides, onGhostStart, onGhost, onGhostEnd, onDuplicateForDrag,
    others, guideLines, scale, designWidth, designHeight, MIN_SIZE,
  });
  ctx.current = {
    onLayoutChange, onGuides, onGhostStart, onGhost, onGhostEnd, onDuplicateForDrag,
    others, guideLines, scale, designWidth, designHeight, MIN_SIZE,
  };
  /** 画板拖动时，区域内组件的 DOM（跟着一起位移，拖动过程就同步，不等松手） */
  const followRef = useRef({ keys: followers ?? [], getNode: getCardNode });
  followRef.current = { keys: followers ?? [], getNode: getCardNode };
  const followedNodes = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (!drag) return;
    /** 只写内联几何：移动走 transform（不动布局；父层已按 scale 缩放，位移用设计坐标） */
    const paint = () => {
      const el = nodeRef.current;
      const rect = liveRect.current;
      if (!el || !rect) return;
      if (drag.mode === "move") {
        const dx = rect.x - drag.base.x;
        const dy = rect.y - drag.base.y;
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        /* 画板：区域里的组件跟着走（拖的时候就在动，不是松手才跳） */
        followedNodes.current.forEach((node) => {
          node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
          node.style.willChange = "transform";
        });
      } else {
        el.style.left = `${rect.x}px`;
        el.style.top = `${rect.y}px`;
        el.style.width = `${rect.w}px`;
        el.style.height = `${rect.h}px`;
      }
    };
    const onMove = (e: PointerEvent) => {
      const c = ctx.current;
      const dx = (e.clientX - drag.startX) / (c.scale || 1);
      const dy = (e.clientY - drag.startY) / (c.scale || 1);
      // 按住 ⌥/Alt：临时关掉磁吸，自由摆放
      const free = e.altKey && !drag.altStart;
      const next = free
        ? {
            rect: drag.mode === "move"
              ? { ...drag.base, x: Math.max(0, Math.round(drag.base.x + dx)), y: Math.max(0, Math.round(drag.base.y + dy)) }
              : plainResize(drag.base, drag.edge, dx, dy, c.MIN_SIZE),
            guides: [] as Guide[],
          }
        : drag.mode === "move"
          ? snapMove(drag.base, dx, dy, c.others, c.scale || 1, c.designWidth, c.guideLines, c.designHeight)
          : snapResize(drag.base, dx, dy, c.others, c.scale || 1, c.designWidth, drag.edge, c.guideLines, c.designHeight, c.MIN_SIZE);
      liveRect.current = next.rect;
      c.onGuides?.(next.guides);
      if (drag.mode === "move") c.onGhost?.(next.rect.x - drag.base.x, next.rect.y - drag.base.y);
      if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; paint(); });
    };
    /** 收尾：commit = 把最终矩形提交给 React；false = 原位作废（Esc / 触控取消 / 窗口失焦） */
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
      const c = ctx.current;
      const rect = liveRect.current;
      followedNodes.current.forEach((node) => {
        node.style.transform = "";
        node.style.willChange = "";
      });
      followedNodes.current = [];
      liveRect.current = null;
      c.onGuides?.([]);
      c.onGhostEnd?.();
      setDrag(null);
      document.body.style.userSelect = "";
      if (!commit || !rect) return;
      if (rect.x !== drag.base.x || rect.y !== drag.base.y || rect.w !== drag.base.w || rect.h !== drag.base.h) {
        /* 拖完紧跟的那次 click 要吞掉：否则「按着表头拖卡片」松手会把表排一遍序 */
        const kill = (event: Event) => {
          event.stopPropagation();
          event.preventDefault();
          window.removeEventListener("click", kill, true);
        };
        window.addEventListener("click", kill, true);
        setTimeout(() => window.removeEventListener("click", kill, true), 400);
        c.onLayoutChange(rect);
      }
    };
    const onUp = () => finish(true);
    /** 触控被系统接管 / Esc：原位作废，不落一步 */
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
    /* 窗口失焦（切到别的 App / 在窗口外松手）：当作取消，别让卡片卡在半空 */
    window.addEventListener("blur", onCancel);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", onCancel);
      window.removeEventListener("keydown", onKey, true);
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    };
  }, [drag]);

  /* 拖完：内联几何交还给 React（sx 里的 left/top/width/height 才是准的） */
  useLayoutEffect(() => {
    const el = nodeRef.current;
    if (!el || drag) return;
    if (el.style.transform) el.style.transform = "";
    if (el.style.left) el.style.left = "";
    if (el.style.top) el.style.top = "";
    if (el.style.width) el.style.width = "";
    if (el.style.height) el.style.height = "";
  });

  /** 起拖的统一入口：拖动用「按下点」当原点，阈值触发时不会跳一下 */
  const beginDrag = (mode: DragState["mode"], edge: ResizeEdge, clientX: number, clientY: number, altStart = false) => {
    liveRect.current = { ...item };
    followRef.current.keys.forEach((key) => {
      const node = followRef.current.getNode?.(key);
      if (node) followedNodes.current.push(node);
    });
    onGhostStart?.();
    /* 拖动期间禁止选中文字：整张卡都能抓，别一边拖一边把内容选蓝 */
    document.body.style.userSelect = "none";
    setDrag({ mode, edge, startX: clientX, startY: clientY, base: { ...item }, altStart });
  };

  /** 缩放手柄按下：只缩放，不经过「整卡拖动」那条路 */
  const startResize = (edge: ResizeEdge = "se") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(e.shiftKey || e.metaKey || e.ctrlKey);
    beginDrag("resize", edge, e.clientX, e.clientY);
  };

  /** 按在卡片内容上：先只选中，位移超过 4px 才真正开拖（单击 / 双击 / 内部控件都不受影响） */
  const pressBody = (event: React.PointerEvent) => {
    onSelect(event.shiftKey || event.metaKey || event.ctrlKey);
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (isInteractive(target)) return;
    /** 按下就按住 ⌥ = 拖动复制（PS：Alt + 拖动），再交给普通拖动逻辑 */
    const altStart = event.altKey;
    const startX = event.clientX;
    const startY = event.clientY;
    let armed = true;
    const cleanup = () => {
      armed = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onMove = (ev: PointerEvent) => {
      if (!armed) return;
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
      cleanup();
      if (altStart) ctx.current.onDuplicateForDrag?.();
      beginDrag("move", "se", startX, startY, altStart);
    };
    const onUp = () => cleanup();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const Renderer = RENDERERS[item.kind as ComponentKind] ?? RENDERERS.kpi;
  /* 卡片拖得比默认尺寸小时，内容整体等比缩小（字号跟着缩，布局不变）；页面元素不缩 */
  const baseSize = sizeOfKind(item.kind as ComponentKind);
  const contentScale = item.type && item.type !== "chart" && item.type !== "filter"
    ? 1
    /* 缩到最小也别让字太小：0.78 是下限（再小数字就看不清了），超出卡片的部分裁掉 */
    : Math.max(0.78, Math.min(1, item.w / baseSize.w, item.h / baseSize.h));
  const showChrome = hover || selected;
  /** 抓手按屏幕像素 10px 换算回设计坐标，画布缩小时也不会变细到点不中 */
  const EDGE_HIT = Math.max(8, Math.round(10 / (scale || 1)));
  const CORNER = Math.max(14, Math.round(12 / (scale || 1)));

  return (
    <Box
      data-board-key={item.key}
      ref={(el: HTMLDivElement | null) => {
        nodeRef.current = el;
        registerNode?.(el);
      }}
      onPointerDown={pressBody}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      sx={{
        position: "absolute",
        zIndex,
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.h,
        borderRadius: 2.5,
        outline: selected ? "2px solid #6366F1" : drag ? "2px solid #A5B4FC" : "none",
        outlineOffset: 2,
        /* 整张卡都能抓：悬停露「抓」，拖动中「抓紧」；内部可点元素自带 pointer，会盖住它 */
        cursor: drag?.mode === "move" ? "grabbing" : hover ? "grab" : "default",
        /* 编辑器里卡片内容不可划选（拖拽起手就整块移动）；预览页 / 发布页不受影响 */
        userSelect: "none",
      }}
    >
      {/* 内容：页面元素 / 渲染器自带卡片外观 */}
      <Box sx={{
        width: contentScale < 0.995 ? `${100 / contentScale}%` : "100%",
        height: contentScale < 0.995 ? `${100 / contentScale}%` : "100%",
        transform: contentScale < 0.995 ? `scale(${contentScale})` : undefined,
        transformOrigin: "top left",
        pointerEvents: drag ? "none" : "auto",
      }}>
        {item.type && item.type !== "chart" && item.type !== "filter" ? (
          <ElementBody item={item} />
        ) : item.type === "filter" ? (
          <Box sx={{
            height: "100%", display: "flex", alignItems: "center",
            px: 0, py: 0, overflow: "hidden",
          }}>
            <FilterBar
              fields={(item.spec?.filter?.fields?.length ? item.spec.filter.fields : filterFields) ?? []}
              fieldsMap={item.spec?.filter?.fields_map}
              values={filterValues ?? {}}
              datasets={filterDatasets}
              onChange={(id, value) => onFilterChange?.(id, value)}
              surface={!!item.spec?.filter?.background}
            />
          </Box>
        ) : item.kind === "banner" ? (
          /* 头标卡是静态内容：直接读 spec，改字即时生效，不必等重查 */
          <BannerCard
            payload={item.spec.banner}
            ui={item.spec.ui}
            /* 后端把 banner 内容摊平在 payload 顶层：统计值就在 payload.stats */
            computedStats={(payload as { stats?: { value?: string }[] } | null)?.stats}
          />
        ) : item.kind === "nav" ? (
          /* 导航菜单卡同理：品牌/菜单/按钮都从 spec 渲染 */
          <NavCard
            payload={item.spec.nav as unknown as NavPayload}
            ui={item.spec.ui as unknown as NavUi}
            currentPage={currentPage}
          />
        ) : cardError ? (
          <Box sx={{
            height: "100%", bgcolor: "#fff", border: "1px solid #EFF3FB", borderRadius: 2.5,
            display: "grid", placeItems: "center", px: 2,
          }}>
            <Box
              title={cardError}
              sx={{
                fontSize: 11.5, color: "error.main", textAlign: "center", lineHeight: 1.6,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                overflow: "hidden", overflowWrap: "anywhere",
              }}
            >
              {cardError}
            </Box>
          </Box>
        ) : payload || item.kind === "section" ? (
          <Renderer
            // 标题 / 副标题 / 图表选项（轴标题、柱宽、图例…）以当前配置为准，改完立刻生效（不必等重查）
            payload={{
              ...payload,
              // 行详情面板要知道是哪张明细表（写回它的 spec）
              detailBoardKey: item.key,
              title: item.spec.title || payload?.title,
              subtitle: item.spec.subtitle ?? payload?.subtitle,
              chart: { ...(payload?.chart || {}), ...(item.spec.chart || {}) },
              combo: { ...(payload?.combo || {}), ...(item.spec.combo || {}) },
              ui: item.spec.ui as unknown as RenderPayload["ui"],
              ...(item.kind === "section" ? sectionPayload(item.spec) : {}),
            }}
            ui={item.spec.ui}
            onTopList={() => onTopList?.(String((payload?.top as { table_key?: string } | undefined)?.table_key || ""), payload?.top)}
          />
        ) : (
          <Box sx={{
            height: "100%", bgcolor: "#fff", border: "1px dashed #E2E8F0", borderRadius: 2.5,
            display: "grid", placeItems: "center", fontSize: 11.5, color: "#94A3B8",
          }}>
            {item.spec?.binding?.metric || item.spec?.binding?.metrics?.length ? "暂无数据" : "待绑定数据"}
          </Box>
        )}
      </Box>

      {/* 删除 */}
      <IconButton
        size="small"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        sx={{
          position: "absolute", right: -8, top: -8, p: 0.25, zIndex: 4,
          bgcolor: "#fff", boxShadow: "0 1px 4px rgba(15,23,42,0.16)",
          opacity: showChrome ? 1 : 0, transition: "opacity .12s",
          "&:hover": { bgcolor: "#fff" },
        }}
      >
        <Close sx={{ fontSize: 13, color: "#64748B" }} />
      </IconButton>

      {/* 上下左右四条边都能拉：按屏幕像素给抓取宽度，悬停时中间亮一根细线 */}
      {(["n", "s", "e", "w"] as const).map((edge) => (
        <Box
          key={edge}
          data-handle={`resize-${edge}`}
          onPointerDown={startResize(edge)}
          sx={{
            position: "absolute", zIndex: 3,
            opacity: showChrome ? 1 : 0, transition: "opacity .12s",
            pointerEvents: showChrome ? "auto" : "none",
            ...edgeHandleStyle(edge, EDGE_HIT),
          }}
        />
      ))}

      {/* 右下缩放手柄 */}
      <Box
        data-handle="resize"
        onPointerDown={startResize()}
        sx={{
          position: "absolute", right: -2, bottom: -2, width: CORNER, height: CORNER, zIndex: 4,
          cursor: "nwse-resize", opacity: showChrome ? 1 : 0, transition: "opacity .12s",
          background:
            "linear-gradient(135deg, transparent 45%, #94A3B8 45%, #94A3B8 55%, transparent 55%, transparent 70%, #94A3B8 70%, #94A3B8 80%, transparent 80%)",
        }}
      />
    </Box>
  );
}


/** 页面元素：标题 / 文字 / 形状（编辑器与预览页共用） */
export function ElementBody({ item }: { item: CanvasItem }) {
  if (item.type === "board") {
    /* 画板：一块框出来的弹窗区域，本身只是边界标记，组件摆在里面 */
    return (
      <Box sx={{
        position: "relative", width: "100%", height: "100%", borderRadius: 2.5,
        border: "1.5px dashed #A5B4FC", bgcolor: "rgba(79,70,229,0.02)",
      }}>
        <Box sx={{
          position: "absolute", top: -10, left: 10, px: 0.75, bgcolor: "#fff",
          fontSize: 10.5, fontWeight: 600, color: "#4F46E5", whiteSpace: "nowrap", letterSpacing: 0.2,
        }}>
          {item.text || "画板"}
        </Box>
      </Box>
    );
  }
  if (item.type === "divider") {
    /* 形状元素（老的分割线 = 直线兜底） */
    return <ShapeView shape={shapeOf(item.spec?.shape)} />;
  }
  if (item.type === "heading") {
    const numeral: Record<string, string> = { "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6" };
    return (
      /* 下划线跟着文字走：与标题保持固定 6px 距离，元素拉高拉矮都在文字下方 */
      <Box sx={{ height: "100%", display: "flex", alignItems: "center" }}>
        <Box sx={{
          display: "flex", alignItems: "center", gap: 1.25, width: "100%",
          pr: 2,
        }}>
          <Box sx={{
            width: 26, height: 26, borderRadius: "9px", flexShrink: 0,
            background: "linear-gradient(135deg, #6366F1, #818CF8)", color: "#fff",
            display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
          }}>
            {numeral[item.index || ""] || item.index || "·"}
          </Box>
          <Box sx={{ fontSize: 15, fontWeight: 700, color: "#0F172A", letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {item.text || "标题"}
          </Box>
          {item.note ? (
            <Box sx={{ fontSize: 11.5, color: "#94A3B8", whiteSpace: "nowrap" }}>{item.note}</Box>
          ) : null}
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{
      fontSize: item.size ?? 13,
      fontWeight: item.weight ?? 400,
      color: "#334155",
      textAlign: item.align ?? "left",
      whiteSpace: "pre-wrap",
      lineHeight: 1.75,
      p: 0.25,
    }}>
      {item.text || "文字"}
    </Box>
  );
}
