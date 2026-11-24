/** 画布编辑器 · 画布舞台（标尺 / 吸附 / 参考线 / 拖拽交互 / 空态） */

import type { Dispatch, RefObject, SetStateAction } from "react";
import { Box, Button, IconButton, Typography } from "@mui/material";
import { Close } from "@mui/icons-material";

import BoardSurface, { type BoardSurfaceHandle } from "../../features/components/board/BoardSurface";
import BoardViewer from "../../features/components/board/BoardViewer";
import {
  CanvasDetailContext, autoKeyFieldOf, boardViewItems,
  type BoardArea, type InlineDetailPayload,
} from "../../features/components/board/canvasDetail";
import CanvasRuler, { RULER_SIZE } from "../../features/components/editor/CanvasRuler";
import client from "../../api/client";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { CanvasSize, FilterFieldSpec, Guide, RenderPayload, SortDir } from "../../features/components/types";
import type { GuideMenuState } from "./CanvasDialogs";
import { toDocItem } from "./spec";
import { boardAt } from "./boardResize";

export default function CanvasStage({
  view, docId, designWidth, items, cards, paramDefs, params, guides, guidesVisible,
  stageWidth, stageViewportH, boardWidth, stageScale, stageOffsetX, stageOffsetY, stageHeight, zoomTo,
  selectedKeys, selectedBounds, bleedMask, rendering, inlineDetail, detailEditKey, ghostNav, filterDataIds,
  stageRef, rulerRef, canvasRef, surfaceRef,
  setInlineDetail, setItems, setParams, setSelectedKeys, setTopKey, setTopSort, setDetailCardKey, setDirty, setGuideMenu,
  selectOnly, toggleSelect, duplicateForDrag, requestDelete, findBoard, commitDetailEdit, cancelDetailEdit,
  patchItem, moveGuide, removeGuide, startPullGuide, handleDrop, onResizeCanvas, onCardDragState,
}: {
  view: string;
  docId: number;
  designWidth: number;
  items: CanvasItem[];
  cards: Record<string, RenderPayload>;
  paramDefs: FilterFieldSpec[];
  params: Record<string, unknown>;
  guides: Guide[];
  guidesVisible: boolean;
  stageWidth: number;
  stageViewportH: number;
  zoomTo: (scale: number | null) => void;
  boardWidth: number;
  stageScale: number;
  stageOffsetX: number;
  stageOffsetY: number;
  stageHeight: number;
  onResizeCanvas: (size: CanvasSize) => void;
  /** 卡片开始/结束拖拽：画布据此暂停实时合并，避免松手瞬间被别人的旧版面覆盖 */
  onCardDragState?: (dragging: boolean, key?: string) => void;
  selectedKeys: string[];
  selectedBounds: { x0: number; y0: number; x1: number; y1: number } | null;
  bleedMask: boolean;
  rendering: boolean;
  inlineDetail: InlineDetailPayload | null;
  detailEditKey: string | null;
  ghostNav: CanvasItem | null;
  filterDataIds: number[];
  stageRef: RefObject<HTMLDivElement>;
  rulerRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLDivElement>;
  surfaceRef: RefObject<BoardSurfaceHandle>;
  setInlineDetail: (v: InlineDetailPayload | null) => void;
  setItems: Dispatch<SetStateAction<CanvasItem[]>>;
  setParams: Dispatch<SetStateAction<Record<string, unknown>>>;
  setSelectedKeys: Dispatch<SetStateAction<string[]>>;
  setTopKey: (v: string | null) => void;
  /** 徽标弹窗的默认排序（只在弹窗内生效，关闭即恢复） */
  setTopSort: (v: { field: string; sort: SortDir } | null) => void;
  setDetailCardKey: (v: string) => void;
  setDirty: (v: boolean) => void;
  setGuideMenu: (v: GuideMenuState) => void;
  selectOnly: (key: string | null) => void;
  toggleSelect: (key: string) => void;
  duplicateForDrag: (key: string) => void;
  requestDelete: (keys: string[]) => void;
  findBoard: (key: string | undefined) => BoardArea | null;
  commitDetailEdit: () => CanvasItem[];
  cancelDetailEdit: () => void;
  patchItem: (key: string, patch: Partial<CanvasItem>) => void;
  moveGuide: (id: string, pos: number) => void;
  removeGuide: (id: string) => void;
  startPullGuide: (axis: "x" | "y") => (event: React.PointerEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
}) {
  return (
    <>
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
                  extent={designWidth}
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
                  origin={stageOffsetY}
                  extent={stageHeight}
                  span={selectedBounds ? [selectedBounds.y0, selectedBounds.y1] : null}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <BoardSurface
              ref={surfaceRef}
              scale={stageScale}
              offsetX={stageOffsetX}
              offsetY={stageOffsetY}
              bleedMask={bleedMask}
              ghostNav={ghostNav}
              designWidth={designWidth}
              designHeight={stageHeight}
              onResizeCanvas={onResizeCanvas}
              onDragStateChange={onCardDragState}
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
              filterDatasets={filterDataIds}
              onTopList={(key, top) => {
                setTopKey(key);
                setTopSort({ field: String(top?.sort_field || ""), sort: (top?.sort ?? "") as SortDir });
              }}
              onFilterChange={(id, value) => setParams((p) => ({ ...p, [id]: value }))}
              onDuplicate={duplicateForDrag}
              currentPage={view}
              guides={guides}
              guidesVisible={guidesVisible}
              onGuideMove={moveGuide}
              onGuideRemove={removeGuide}
              onGuideMenu={(event, id) => setGuideMenu({ x: event.clientX, y: event.clientY, id })}
              onBlankMenu={(event) => {
                const el = canvasRef.current;
                if (!el) return;
                const rect = el.getBoundingClientRect();
                const clickedKey = (event.target as HTMLElement).closest("[data-board-key]")?.getAttribute("data-board-key");
                const board = items.find((item) => item.key === clickedKey && item.type === "board")
                  ?? boardAt(items, (event.clientX - rect.left - stageOffsetX) / stageScale,
                    (event.clientY - rect.top - stageOffsetY) / stageScale);
                setGuideMenu({ x: event.clientX, y: event.clientY, boardKey: board?.key });
              }}
            />
              </Box>
            </Box>
            <Box sx={{ position: "absolute", right: 16, bottom: 16, zIndex: 20, display: "flex", alignItems: "center", bgcolor: "background.paper", border: "1px solid #E2E8F0", borderRadius: 1.5, boxShadow: 1 }}>
              <Button size="small" aria-label="缩小画布" title="缩小（Ctrl + -）" disabled={stageScale <= 0.25} onClick={() => zoomTo(stageScale - 0.1)} sx={{ minWidth: 32 }}>−</Button>
              <Button size="small" title="恢复 100%（Ctrl + 0）" onClick={() => zoomTo(1)} sx={{ minWidth: 56 }}>{Math.round(stageScale * 100)}%</Button>
              <Button size="small" aria-label="放大画布" title="放大（Ctrl + +）" disabled={stageScale >= 2} onClick={() => zoomTo(stageScale + 0.1)} sx={{ minWidth: 32 }}>+</Button>
              <Button size="small" onClick={() => zoomTo(null)} title="适应窗口；空格 + 左键或中键拖动画布" sx={{ px: 1 }}>适应窗口</Button>
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
    </>
  );
}
