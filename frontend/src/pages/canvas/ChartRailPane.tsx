/** 画布编辑器 · 右栏（图层树 / 图表类型） */

import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";

import ChartTypeRail from "../../features/components/editor/ChartTypeRail";
import OverlayScrollbar from "../../features/components/editor/OverlayScrollbar";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { ComponentItem, ComponentKind } from "../../features/components/types";
import { CollapseButton, CollapseStrip, type useResizableWidth } from "./controls";
import type { PaneCollapsed } from "./types";
import LayerTree from "./LayerTree";
import { clampLayerSplit } from "./layers";

const SPLIT_KEY = "mcbi.editor.layersSplit";

export default function ChartRailPane({
  collapsed, togglePane, rightW, components, selectedItem, componentsLoading, pickComponent, beginInsertDrag,
  items, selectedKeys, pageTitle, onSelect, onReorder,
}: {
  collapsed: PaneCollapsed;
  togglePane: (key: "left" | "mid" | "right") => void;
  rightW: ReturnType<typeof useResizableWidth>;
  components: ComponentItem[];
  selectedItem: CanvasItem | null;
  items: CanvasItem[];
  selectedKeys: string[];
  pageTitle: string;
  onSelect: (key: string) => void;
  onReorder: (items: CanvasItem[]) => void;
  componentsLoading: boolean;
  pickComponent: (component: ComponentItem) => void;
  beginInsertDrag: (payload: {
    type: "chart"; kind: ComponentKind; component?: ComponentItem; label: string;
  }) => (event: React.PointerEvent) => void;
}) {
  const treeRef = useRef<HTMLDivElement>(null);
  const typesRef = useRef<HTMLDivElement>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const [split, setSplit] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SPLIT_KEY));
      return saved >= 20 && saved <= 80 ? saved : 35;
    } catch { return 35; }
  });
  useEffect(() => {
    rightW.paneRef.current?.style.setProperty("--layers-height", `${split}%`);
    try { localStorage.setItem(SPLIT_KEY, String(split)); } catch { /* 浏览器禁用存储时仍可调整。 */ }
  }, [split, rightW.paneRef]);
  useEffect(() => () => cleanup.current?.(), []);
  const startSplit = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const pane = rightW.paneRef.current;
    if (!pane) return;
    cleanup.current?.();
    const bounds = pane.getBoundingClientRect();
    if (!bounds.height) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    let latest = split;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== event.pointerId) return;
      latest = clampLayerSplit(split + (ev.clientY - event.clientY) / bounds.height * 100);
      pane.style.setProperty("--layers-height", `${latest}%`);
    };
    const finish = (commit: boolean) => {
      cleanup.current?.();
      if (commit) setSplit(latest);
      else pane.style.setProperty("--layers-height", `${split}%`);
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); cancel(); } };
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
  };
  return (
    <>
      {collapsed.right && <CollapseStrip side="right" label="图表类型" onClick={() => togglePane("right")} />}
        {/* 右：图表类型 */}
        <Box ref={rightW.paneRef} data-pane="right" sx={{
          width: collapsed.right ? 0 : "var(--pane-w, 168px)", flexShrink: 0, bgcolor: "#fff", minHeight: 0,
          display: "flex", flexDirection: "column",
          position: "relative", overflow: "hidden",
          opacity: collapsed.right ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <CollapseButton dir="right" title="收起图表类型" onClick={() => togglePane("right")} />
          <Box sx={{ flex: "0 0 var(--layers-height, 35%)", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <Typography sx={{ px: 1.75, py: 1.5, pr: 4, fontSize: 12.5, fontWeight: 600, color: "#0F172A", borderBottom: "1px solid #EEF3FB" }}>图层 · {items.length}</Typography>
            <Box ref={treeRef} sx={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto", px: 0.5, scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
              <OverlayScrollbar targetRef={treeRef} />
              <LayerTree items={items} selectedKeys={selectedKeys} pageTitle={pageTitle} onSelect={onSelect} onReorder={onReorder} />
            </Box>
          </Box>
          <Box role="separator" aria-label="调整图层和图表类型面板高度" aria-orientation="horizontal" aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(split)} tabIndex={0}
            onPointerDown={startSplit} onKeyDown={(event) => {
              const next = event.key === "ArrowUp" ? split - 5 : event.key === "ArrowDown" ? split + 5 : event.key === "Home" ? 20 : event.key === "End" ? 80 : null;
              if (next !== null) { event.preventDefault(); setSplit(clampLayerSplit(next)); }
            }} sx={{ height: 7, flexShrink: 0, cursor: "row-resize", touchAction: "none", bgcolor: "#F1F5F9", borderBlock: "1px solid #E2E8F0", "&:hover, &:focus-visible": { bgcolor: "#C7D2FE" } }} />
          <Box ref={typesRef} sx={{ flex: 1, minHeight: 0, position: "relative", overflow: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}>
          <OverlayScrollbar targetRef={typesRef} />
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
    </>
  );
}
