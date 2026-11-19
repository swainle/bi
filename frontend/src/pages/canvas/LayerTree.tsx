import { useEffect, useMemo, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { ChevronRight, DragIndicator, ExpandMore } from "@mui/icons-material";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import type { CanvasItem } from "../../features/components/boardTypes";
import { KIND_LABEL } from "../../features/components/registry";
import { layerTree, reorderLayers, type LayerNode } from "./layers";

export default function LayerTree({ items, selectedKeys, pageTitle, onSelect, onReorder }: {
  items: CanvasItem[];
  selectedKeys: string[];
  pageTitle: string;
  onSelect: (key: string) => void;
  onReorder: (items: CanvasItem[]) => void;
}) {
  const roots = useMemo(() => layerTree(items), [items]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [pageOpen, setPageOpen] = useState(true);
  const toggle = (key: string) => setClosed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  useEffect(() => {
    setClosed((prev) => new Set([...prev].filter((key) => !roots.find((node) => node.item.key === key)?.children.some((child) => selectedKeys.includes(child.item.key)))));
    if (selectedKeys.length) setPageOpen(true);
  }, [roots, selectedKeys]);

  const list = (nodes: LayerNode[], parent: string | null) => (
    <Droppable droppableId={`layers:${parent ?? ""}`} type={`layers:${parent ?? ""}`}>
      {(drop) => <Box ref={drop.innerRef} {...drop.droppableProps} role={parent ? "group" : "tree"} aria-label={parent ? undefined : "组件图层"} sx={{ minHeight: 12 }}>
        {nodes.map(({ item, children }, index) => {
          const label = item.text || item.spec.title || KIND_LABEL[item.kind] || "组件";
          const board = item.type === "board";
          const open = !closed.has(item.key);
          return <Draggable key={item.key} draggableId={`layer:${item.key}`} index={index} disableInteractiveElementBlocking>
            {(drag, snapshot) => <Box ref={drag.innerRef} {...drag.draggableProps} style={drag.draggableProps.style}
              role="treeitem" aria-selected={selectedKeys.includes(item.key)} aria-expanded={board ? open : undefined}>
              <Box onClick={() => onSelect(item.key)} tabIndex={0}
                onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onSelect(item.key); } }}
                title={label} sx={{ display: "flex", alignItems: "center", minHeight: 30, pl: parent ? 1.5 : 0.25, pr: 0.5, borderRadius: 1, cursor: "pointer",
                  bgcolor: snapshot.isDragging || selectedKeys.includes(item.key) ? "rgba(99,102,241,0.1)" : "#fff", "&:hover": { bgcolor: "#F1F5FD" } }}>
                <IconButton size="small" {...drag.dragHandleProps} aria-label={`拖动图层：${label}`} onClick={(event) => event.stopPropagation()} sx={{ p: 0.25, cursor: "grab" }}>
                  <DragIndicator sx={{ fontSize: 14, color: "#94A3B8" }} />
                </IconButton>
                {board ? <IconButton size="small" aria-label={`${open ? "折叠" : "展开"}${label}`} onClick={(event) => { event.stopPropagation(); toggle(item.key); }} sx={{ p: 0.25 }}>
                  {open ? <ExpandMore sx={{ fontSize: 16 }} /> : <ChevronRight sx={{ fontSize: 16 }} />}
                </IconButton> : <Box component="span" sx={{ width: 17, textAlign: "center", color: "#94A3B8", fontSize: 11 }}>{item.type === "text" ? "T" : item.type === "heading" ? "H" : "▦"}</Box>}
                <Typography noWrap sx={{ fontSize: 11.5, color: selectedKeys.includes(item.key) ? "#4F46E5" : "#475569", fontWeight: selectedKeys.includes(item.key) ? 600 : 400 }}>{label}</Typography>
              </Box>
              {board && open && list(children, item.key)}
            </Box>}
          </Draggable>;
        })}
        {drop.placeholder}
      </Box>}
    </Droppable>
  );

  return <>
    <Box component="button" onClick={() => setPageOpen((prev) => !prev)} aria-expanded={pageOpen} sx={{ display: "flex", alignItems: "center", gap: 0.5, width: "100%", p: 0.75, border: 0, bgcolor: "transparent", color: "#64748B", cursor: "pointer", textAlign: "left" }}>
      {pageOpen ? <ExpandMore sx={{ fontSize: 16 }} /> : <ChevronRight sx={{ fontSize: 16 }} />}
      <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 600 }}>{pageTitle || "当前页面"}</Typography>
    </Box>
    <DragDropContext onDragEnd={({ source, destination }) => {
      if (!destination || source.droppableId !== destination.droppableId) return;
      const parent = source.droppableId.slice("layers:".length) || null;
      const next = reorderLayers(items, parent, source.index, destination.index);
      if (next !== items) onReorder(next);
    }}>
      {pageOpen && list(roots, null)}
    </DragDropContext>
    {!items.length && <Typography sx={{ p: 1.5, fontSize: 11.5, color: "#94A3B8" }}>当前页面暂无组件</Typography>}
  </>;
}
