/** 画布面 —— 网格背景 + 卡片集合 + 空态 + 拖放接收
 *
 * 拖拽（卡片 / 参考线）全程不 setState：位置、吸附线、坐标提示都直接写 DOM，
 * 松手才提交一次，React 只渲染「结果」，不渲染「过程」—— 这样 20 张卡 + ECharts 也能拖得丝滑。
 */

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import { Box, Typography } from "@mui/material";
import BoardCard from "./BoardCard";
import CanvasResizeHandles from "./CanvasResizeHandles";
import type { CanvasItem } from "../boardTypes";
import type { CanvasSize, FilterFieldSpec, Guide as DocGuide, RenderPayload } from "../types";
import NavCard, { type NavPayload, type NavUi } from "../renderers/NavCard";
import { snapGuide, type Guide } from "./snapping";

/** 拖动参考线时的实时坐标提示 */
export interface GuideTip {
  axis: "x" | "y";
  pos: number;
  x: number;
  y: number;
  snapped: boolean;
  center: boolean;
}

export interface BoardSurfaceHandle {
  /** 标尺拉线的实时预览（直接写 DOM，不触发 React 重渲染） */
  previewGuide: (guide: (DocGuide & { snapped?: boolean }) | null) => void;
  showTip: (tip: GuideTip | null) => void;
  /** 从类型栏 / 工具栏拖新组件时的落位预览（屏幕坐标层，空画布也看得见） */
  previewInsert: (rect: { x: number; y: number; w: number; h: number } | null, label?: string) => void;
  /** 拖动新组件时的吸附线（复用卡片拖动那套节点池） */
  showSnap: (guides: Guide[]) => void;
}

interface Props {
  canvasRef: RefObject<HTMLDivElement>;
  items: CanvasItem[];
  cards: Record<string, RenderPayload>;
  errors: Record<string, string>;
  selectedKeys: string[];
  rendering: boolean;
  onSelect: (key: string, additive: boolean) => void;
  /** 点画布空白处 → 取消选择 */
  onBlankSelect?: () => void;
  onLayoutChange: (key: string, next: { x: number; y: number; w: number; h: number }) => void;
  onDelete: (key: string) => void;
  onDrop: (e: React.DragEvent) => void;
  scale?: number;
  /** 画布左右出血（CSS px），让版面居中、不贴边 */
  offsetX?: number;
  offsetY?: number;
  /** 画布外溢出区是否盖一层浅灰提醒 */
  bleedMask?: boolean;
  /** 别的页面上开着「跳转页全展示」的导航卡：本页只做只读预览，避免误编辑 */
  ghostNav?: CanvasItem | null;
  designWidth?: number;
  designHeight?: number;
  onResizeCanvas?: (size: CanvasSize) => void;
  filterFields?: FilterFieldSpec[];
  filterValues?: Record<string, unknown>;
  /** 本页卡片读的数据集：给了就做「逐级筛选」 */
  filterDatasets?: number[];
  /** 指标卡徽标点击（TOP N 榜单弹窗） */
  onTopList?: (itemKey: string, top?: RenderPayload["top"]) => void;
  onFilterChange?: (id: string, value: unknown) => void;
  /** 手工参考线（拖标尺拉出来的） */
  guides?: DocGuide[];
  /** 参考线是否可见（⇧⌘H 切换） */
  guidesVisible?: boolean;
  onGuideMove?: (id: string, pos: number) => void;
  onGuideRemove?: (id: string) => void;
  onGuideMenu?: (event: React.MouseEvent, id: string) => void;
  onBlankMenu?: (event: React.MouseEvent) => void;
  /** ⌥ + 拖动：原位复制一份（PS 手感） */
  onDuplicate?: (key: string) => void;
  /** 当前页 key：卡片里的导航菜单卡据此高亮所在页 */
  currentPage?: string;
}

const BoardSurface = forwardRef<BoardSurfaceHandle, Props>(function BoardSurface({
  canvasRef, items, cards, errors, selectedKeys, rendering,
  onSelect, onBlankSelect, onLayoutChange, onDelete, onDrop,
  scale = 1, offsetX = 0, offsetY = 0, bleedMask = true, ghostNav = null, designWidth, designHeight = 620,
  filterFields, filterValues, filterDatasets, onTopList, onFilterChange,
  guides = [], guidesVisible = true, onGuideMove, onGuideRemove, onGuideMenu, onBlankMenu,
  onDuplicate, currentPage, onResizeCanvas,
}, ref) {
  const designW = designWidth ?? 1440;
  const boardHeight = Math.max(designHeight, 160);
  const stageScale = scale || 1;

  /* ── 实时层的 DOM 句柄（拖拽期间只碰这些，不碰 React）── */
  const guideNodes = useRef(new Map<string, HTMLDivElement>());
  const cardNodes = useRef(new Map<string, HTMLDivElement>());

  /** 画板 → 区域内的组件 key（拖画板时这些跟着一起动） */
  const boardMembers = useMemo(() => {
    const boards = items.filter((it) => it.type === "board");
    const map = new Map<string, string[]>();
    boards.forEach((board) => {
      map.set(board.key, items.filter((it) => {
        if (it.key === board.key || it.type === "board") return false;
        const cx = it.x + it.w / 2;
        const cy = it.y + it.h / 2;
        return cx >= board.x && cx <= board.x + board.w && cy >= board.y && cy <= board.y + board.h;
      }).map((it) => it.key));
    });
    return map;
  }, [items]);
  const snapLayer = useRef<HTMLDivElement | null>(null);
  const snapPool = useRef<HTMLDivElement[]>([]);
  const pendingNode = useRef<HTMLDivElement | null>(null);
  const tipNode = useRef<HTMLDivElement | null>(null);
  /** 拖新组件进来时的落位框 + 名称牌 */
  const insertNode = useRef<HTMLDivElement | null>(null);
  const insertLabel = useRef<HTMLDivElement | null>(null);
  /** 正在拖的参考线 / 卡片：提交前不清它的内联几何 */
  const liveGuide = useRef<string | null>(null);
  const ghostKey = useRef<string | null>(null);
  const selectedRef = useRef<string[]>(selectedKeys);
  selectedRef.current = selectedKeys;

  /** 一帧最多写一次 DOM：鼠标回报率高于刷新率时不重复劳动 */
  const frames = useRef(new Map<string, { id: number; job: (() => void) | null }>());
  const schedule = (key: string, job: () => void) => {
    let slot = frames.current.get(key);
    if (!slot) { slot = { id: 0, job: null }; frames.current.set(key, slot); }
    slot.job = job;
    if (slot.id) return;
    slot.id = requestAnimationFrame(() => {
      slot!.id = 0;
      const run = slot!.job;
      slot!.job = null;
      run?.();
    });
  };
  useLayoutEffect(() => () => {
    frames.current.forEach((slot) => { if (slot.id) cancelAnimationFrame(slot.id); });
  }, []);

  /** 提示浮层：位置 / 文案直接写 DOM */
  const showTip = (tip: GuideTip | null) => {
    const el = tipNode.current;
    if (!el) return;
    if (!tip) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${tip.x + 16}px`;
    el.style.top = `${tip.y - 34}px`;
    el.style.background = tip.snapped ? "rgba(79,70,229,0.94)" : "rgba(23,23,27,0.9)";
    el.textContent = `${tip.axis === "x" ? "X" : "Y"}: ${tip.pos} 像素${tip.snapped && tip.center ? " · 中线" : ""}`;
  };

  /** 标尺拉线时的预览线（还没落到 doc 里的那条） */
  const previewGuide = (guide: (DocGuide & { snapped?: boolean }) | null) => {
    const el = pendingNode.current;
    if (!el) return;
    if (!guide) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.background = guide.snapped ? "#FB7185" : "#38BDF8";
    if (guide.axis === "x") {
      el.style.left = `${offsetX + guide.pos * stageScale}px`;
      el.style.top = "0";
      el.style.width = "1.4px";
      el.style.height = "100%";
    } else {
      el.style.top = `${offsetY + guide.pos * stageScale}px`;
      el.style.left = "0";
      el.style.height = "1.4px";
      el.style.width = "100%";
    }
  };

  /** 吸附线：复用固定数量的 DOM 节点，内容由拖动方按帧刷新 */
  const paintSnap = (list: Guide[]) => {
    const layer = snapLayer.current;
    if (!layer) return;
    const pool = snapPool.current;
    const size = Math.max(2, list.length);
    while (pool.length < size) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.pointerEvents = "none";
      layer.appendChild(el);
      pool.push(el);
    }
    pool.forEach((el, index) => {
      const guide = list[index];
      if (!guide) { el.style.display = "none"; return; }
      el.style.display = "block";
      el.style.background = guide.center ? "transparent" : "#FB7185";
      el.style.borderLeft = guide.center && guide.axis === "x" ? "1.4px dashed #F43F5E" : "";
      el.style.borderTop = guide.center && guide.axis === "y" ? "1.4px dashed #F43F5E" : "";
      if (guide.axis === "x") {
        el.style.left = `${offsetX + guide.pos * stageScale}px`;
        el.style.top = "0";
        el.style.width = guide.center ? "0px" : "1.4px";
        el.style.height = "100%";
      } else {
        el.style.top = `${offsetY + guide.pos * stageScale}px`;
        el.style.left = "0";
        el.style.height = guide.center ? "0px" : "1.4px";
        el.style.width = "100%";
      }
    });
  };

  /** 从类型栏 / 工具栏拖新组件：落位框跟着指针走（屏幕坐标，空画布也能显示） */
  const previewInsert = (rect: { x: number; y: number; w: number; h: number } | null, label?: string) => {
    const el = insertNode.current;
    if (!el) return;
    if (!rect) { el.style.display = "none"; return; }
    const top = offsetY + rect.y * stageScale;
    el.style.display = "block";
    el.style.left = `${offsetX + rect.x * stageScale}px`;
    el.style.top = `${top}px`;
    el.style.width = `${rect.w * stageScale}px`;
    el.style.height = `${rect.h * stageScale}px`;
    const tag = insertLabel.current;
    if (tag) {
      tag.textContent = label ?? "";
      /* 落位框贴着画布顶部时，名称牌放进框里，别被标尺切掉 */
      tag.style.top = top < 24 ? "4px" : "-22px";
    }
  };

  useImperativeHandle(ref, () => ({ previewGuide, showTip, previewInsert, showSnap: paintSnap }));

  /** 拖动已有参考线：拖动中只改这一根线的内联位置，松手提交一次 */
  const startGuideDrag = (guide: DocGuide, event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const scroller = canvasRef.current;
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const node = guideNodes.current.get(guide.id) ?? null;
    const line = (node?.firstElementChild as HTMLElement | null) ?? null;
    /* 横线可以一直拖到画布可见底部（内容只有 600 高，也能把线放到下面的空白里，
       和 PS 一样「想放哪就放哪」）；竖线同理跨进左右溢出区 */
    const rightLimit = Math.max(designW, (scroller.clientWidth - offsetX) / stageScale);
    const bottomLimit = Math.max(boardHeight, (scroller.clientHeight - offsetY) / stageScale);
    const clamp = (value: number) => (guide.axis === "x"
      ? Math.min(rightLimit, Math.max(Math.min(0, -offsetX / stageScale), value))
      : Math.min(bottomLimit, Math.max(Math.min(0, -offsetY / stageScale), value)));
    /** 指针减去画布原点后再除缩放，两轴共用同一坐标系。 */
    const toDesign = (ev: PointerEvent) => (guide.axis === "x"
      ? (ev.clientX - box.left - offsetX) / stageScale
      : (ev.clientY - box.top - offsetY) / stageScale);
    const paint = (pos: number) => {
      if (!node) return;
      if (guide.axis === "x") node.style.left = `${offsetX + pos * stageScale - 3.5}px`;
      else node.style.top = `${offsetY + pos * stageScale - 3.5}px`;
    };
    liveGuide.current = guide.id;
    let pos = guide.pos;
    const onMove = (ev: PointerEvent) => {
      const raw = toDesign(ev);
      const others = guidesVisible
        ? guides.filter((g) => g.axis === guide.axis && g.id !== guide.id).map((g) => g.pos)
        : [];
      const hit = ev.altKey
        ? { snapped: false, center: false, pos: raw }
        : snapGuide(guide.axis, raw, items, designW, stageScale, others, boardHeight);
      pos = Math.round(clamp(hit.pos));
      schedule("guide", () => paint(pos));
      if (line) line.style.background = hit.snapped ? "#FB7185" : "#38BDF8";
      showTip({ axis: guide.axis, pos, x: ev.clientX, y: ev.clientY, snapped: hit.snapped, center: hit.center });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      showTip(null);
      const outside = ev.clientX < box.left - 8 || ev.clientX > box.right + 8 || ev.clientY < box.top - 8 || ev.clientY > box.bottom + 8;
      paint(pos);
      liveGuide.current = null;
      if (outside) onGuideRemove?.(guide.id);
      else if (pos !== guide.pos) onGuideMove?.(guide.id, pos);
    };
    /** 触控被系统接管：位置回原位 */
    const onCancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
      showTip(null);
      liveGuide.current = null;
      paint(guide.pos);
    };
    /** Esc：放弃这次拖动 */
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      ev.stopPropagation();
      onCancel();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
  };

  /** 一次拖拽结束（参考线 / 卡片）：提交后把内联几何还给 React 管 */
  useLayoutEffect(() => {
    if (ghostKey.current) return;
    cardNodes.current.forEach((el) => {
      if (el.style.transform) el.style.transform = "";
      if (el.style.willChange) el.style.willChange = "";
      if (el.style.zIndex) el.style.zIndex = "";
    });
    guideNodes.current.forEach((el, id) => {
      if (liveGuide.current === id) return;
      if (el.style.left || el.style.top) { el.style.left = ""; el.style.top = ""; }
      const line = el.firstElementChild as HTMLElement | null;
      if (line?.style.background) line.style.background = "";
    });
  });

  /** 多选拖动：其余选中的卡跟着位移（同一帧里一起走；坐标在设计空间里，父层会统一缩放） */
  const ghostOthers = (key: string, dx: number, dy: number) => {
    const tx = `translate3d(${dx}px, ${dy}px, 0)`;
    selectedRef.current.forEach((k) => {
      if (k === key) return;
      const el = cardNodes.current.get(k);
      if (el) el.style.transform = tx;
    });
  };

  return (
    <Box
      ref={canvasRef}
      data-drop="board"
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDrop={onDrop}
      onPointerDown={(e) => {
        /* 浮层（下拉菜单 / 弹窗）是 React 门户：DOM 上挂在 body，事件却按组件树冒泡到这里。
           不排掉的话，点一下筛选栏的下拉选项就会被当成「点了空白」，选中态与右侧配置面板一起丢。 */
        if (!e.currentTarget.contains(e.target as Node)) return;
        if ((e.target as HTMLElement).closest("[data-board-key]")) return;
        onBlankSelect?.();
      }}
      onContextMenu={(e) => { e.preventDefault(); onBlankMenu?.(e); }}
      sx={{
        flex: 1, minWidth: 0, position: "relative", overflow: "clip",
        touchAction: "none",
        '&[data-pan="ready"], &[data-pan="ready"] *': { cursor: "grab !important" },
        '&[data-pan="dragging"], &[data-pan="dragging"] *': { cursor: "grabbing !important", userSelect: "none" },
        /* 从类型栏拖组件进来时，整块画布（含参考线的 ↔ 光标）统一显示「抓取中」 */
        '&[data-insert-drag="1"], &[data-insert-drag="1"] *': { cursor: "grabbing !important" },
        backgroundColor: "#FCFDFF",
        backgroundImage:
          "radial-gradient(circle at 1px 1px, #DBE3F0 1px, transparent 0), linear-gradient(to right, rgba(226,232,240,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(226,232,240,0.5) 1px, transparent 1px)",
        backgroundSize: "8px 8px, 80px 80px, 80px 80px",
      }}
    >
      {items.length === 0 ? (
        <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
          <Box>
            <Typography sx={{ fontSize: 13, color: "text.disabled" }}>
              从右侧把图表类型拖进来
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.disabled", mt: 0.5 }}>
              可以拖很多张，点卡片再配字段
            </Typography>
          </Box>
        </Box>
      ) : null}
        <Box sx={{
          position: "absolute", left: offsetX, top: offsetY,
          transform: "translate3d(var(--canvas-pan-x, 0px), var(--canvas-pan-y, 0px), 0)",
          width: designWidth ? designWidth * scale : "100%",
          height: boardHeight * scale,
        }}>
          <Box sx={{
            position: "absolute", top: 0, left: 0,
            width: designWidth ?? "100%",
            height: boardHeight,
            outline: "1px solid #CBD5E1",
            isolation: "isolate",
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: "top left",
          }}>
          {/* 全展示导航：只读影格，让本页所见即所得，但不能选中/拖拽 */}
          {ghostNav && ghostNav.spec?.nav && (
            <Box sx={{
              position: "absolute", left: ghostNav.x, top: ghostNav.y,
              width: ghostNav.w, height: ghostNav.h,
              opacity: 0.55, pointerEvents: "none", zIndex: 2,
            }}>
              <NavCard
                payload={ghostNav.spec.nav as unknown as NavPayload}
                ui={ghostNav.spec.ui as unknown as NavUi}
                currentPage={currentPage}
              />
              <Box sx={{
                position: "absolute", right: 6, top: 6,
                px: 0.6, py: 0.1, borderRadius: 999, bgcolor: "rgba(15,23,42,0.5)",
                color: "#fff", fontSize: 9.5, lineHeight: 1.5, letterSpacing: 0.2,
              }}>
                全展示
              </Box>
            </Box>
          )}

          {items.map((item, index) => (
            <BoardCard
              key={item.key}
              item={item}
              payload={cards[item.key] ?? null}
              error={errors[item.key]}
              selected={selectedKeys.includes(item.key)}
              onSelect={(additive: boolean) => onSelect(item.key, additive)}
              onLayoutChange={(next) => onLayoutChange(item.key, next)}
              onDelete={() => onDelete(item.key)}
              scale={scale}
              zIndex={index}
              others={items.filter((i) => i.key !== item.key).map(({ x, y, w, h }) => ({ x, y, w, h }))}
              designWidth={designWidth ?? 1440}
              designHeight={boardHeight}
              registerNode={(el) => {
                if (el) cardNodes.current.set(item.key, el);
                else cardNodes.current.delete(item.key);
              }}
              followers={boardMembers.get(item.key) ?? []}
              getCardNode={(key) => cardNodes.current.get(key) ?? null}
              onGuides={(list) => paintSnap(list)}
              currentPage={currentPage}
              onDuplicateForDrag={() => onDuplicate?.(item.key)}
              onGhostStart={() => {
                ghostKey.current = item.key;
                const el = cardNodes.current.get(item.key);
                if (el) { el.style.zIndex = String(items.length + 1); el.style.willChange = "transform"; }
              }}
              onGhost={(dx, dy) => {
                if (ghostKey.current !== item.key) return;
                schedule("ghost", () => ghostOthers(item.key, dx, dy));
              }}
              onGhostEnd={() => {
                const el = cardNodes.current.get(item.key);
                if (el) { el.style.zIndex = ""; el.style.willChange = ""; }
                ghostKey.current = null;
              }}
              guideLines={guidesVisible ? {
                x: guides.filter((g) => g.axis === "x").map((g) => g.pos),
                y: guides.filter((g) => g.axis === "y").map((g) => g.pos),
              } : undefined}
              filterFields={filterFields}
              filterValues={filterValues}
              filterDatasets={filterDatasets}
              onTopList={onTopList}
              onFilterChange={onFilterChange}
            />
          ))}

          </Box>

          {/* 画布四周留白：跟随画布边界平移，不拦截操作。 */}
          {bleedMask && (
            <Box
              aria-hidden
              data-bleed-mask
              sx={{
                position: "absolute", inset: 0,
                boxShadow: "0 0 0 100000px rgba(148,163,184,0.13)",
                pointerEvents: "none", zIndex: 50,
              }}
            />
          )}
          {onResizeCanvas && <CanvasResizeHandles width={designW} height={boardHeight} scale={stageScale} onResize={onResizeCanvas} />}

        </Box>

          {/* 参考线（手工 + 吸附）：独立图层，压在溢出区遮罩之上，横线一律横贯整条画布 ——
              版面两侧的浅灰溢出区也照直穿过，不再在版面边界处断掉 */}
          <Box sx={{
            position: "absolute", inset: 0,
            zIndex: 56, pointerEvents: "none",
          }}>
            {guidesVisible && guides.map((guide) => (
              <Box
                key={`g-${guide.id}`}
                ref={(el: HTMLDivElement | null) => {
                  if (el) guideNodes.current.set(guide.id, el);
                  else guideNodes.current.delete(guide.id);
                }}
                data-guide={`${guide.axis}:${guide.pos}`}
                onPointerDown={(event) => startGuideDrag(guide, event)}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onGuideMenu?.(event, guide.id); }}
                sx={{
                  position: "absolute", pointerEvents: "auto",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  ...(guide.axis === "x"
                    ? { left: offsetX + guide.pos * scale - 3.5, top: 0, width: 7, height: "100%", cursor: "col-resize", transform: "translateX(var(--canvas-pan-x, 0px))" }
                    : { top: offsetY + guide.pos * scale - 3.5, left: 0, height: 7, width: "100%", cursor: "row-resize", transform: "translateY(var(--canvas-pan-y, 0px))" }),
                }}
              >
                <Box sx={{ bgcolor: "#38BDF8", ...(guide.axis === "x" ? { width: 1.4, height: "100%" } : { height: 1.4, width: "100%" }) }} />
              </Box>
            ))}

            {/* 标尺拉线时的预览线（由 BoardSurfaceHandle.previewGuide 驱动） */}
            <Box ref={pendingNode} sx={{ display: "none", position: "absolute", bgcolor: "#38BDF8" }} />

            {/* 吸附线（拖动卡片时出现，由 paintSnap 直接写 DOM） */}
            <Box ref={snapLayer} />
          </Box>

      {/* 从类型栏 / 工具栏拖组件进来时的落位框：跟着指针走，松手就落在这 */}
      <Box
        ref={insertNode}
        aria-hidden
        data-insert-preview
        sx={{
          display: "none", position: "absolute", zIndex: 58, pointerEvents: "none",
          border: "1.4px dashed #6366F1", borderRadius: "10px",
          bgcolor: "rgba(99,102,241,0.06)",
        }}
      >
        <Box
          ref={insertLabel}
          component="span"
          sx={{
            position: "absolute", left: -1, top: -22, px: 0.75, py: 0.1,
            borderRadius: "6px", bgcolor: "#4F46E5", color: "#fff",
            fontSize: 11, fontWeight: 500, lineHeight: 1.7, whiteSpace: "nowrap",
          }}
        />
      </Box>

      {/* 拖动参考线时的坐标提示 */}
      <Box
        ref={tipNode}
        sx={{
          display: "none", position: "fixed", zIndex: 1500,
          px: 0.9, py: 0.35, borderRadius: 1, fontSize: 11, fontWeight: 500,
          bgcolor: "rgba(23,23,27,0.9)",
          color: "#fff", pointerEvents: "none", whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums", boxShadow: "0 2px 8px rgba(15,23,42,0.18)",
        }}
      />

      {rendering && (
        <Box sx={{
          position: "absolute", right: 12, bottom: 12, px: 1.25, py: 0.5,
          bgcolor: "rgba(15,23,42,0.82)", color: "#fff", borderRadius: 2, fontSize: 11,
        }}>
          计算中…
        </Box>
      )}
    </Box>
  );
});

export default BoardSurface;
