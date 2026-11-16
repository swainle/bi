/** 画布编辑区（对标图2）—— 标尺 + 网格 + 可拖拽/可缩放的卡片节点 */

import { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import OpenWithIcon from "@mui/icons-material/OpenWith";
import { RENDERERS } from "../registry";
import type { ComponentKind, ComponentSpec, LayoutSpec, RenderPayload } from "../types";

const GRID = 8;
const RULER = 22;

const DEFAULT_LAYOUT: LayoutSpec = { x: 40, y: 56, w: 520, h: 320 };

const snap = (v: number) => Math.round(v / GRID) * GRID;

interface Props {
  spec: ComponentSpec;
  payload: RenderPayload | null;
  loading: boolean;
  error: string;
  onLayoutChange: (layout: LayoutSpec) => void;
  onKindChange?: (kind: ComponentKind) => void;
}

type DragState = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  base: LayoutSpec;
};

export default function CanvasEditor({
  spec, payload, loading, error, onLayoutChange, onKindChange,
}: Props) {
  const layout = spec.layout ?? DEFAULT_LAYOUT;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    observer.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (drag.mode === "move") {
        onLayoutChange({
          ...drag.base,
          x: Math.max(0, snap(drag.base.x + dx)),
          y: Math.max(0, snap(drag.base.y + dy)),
        });
      } else {
        onLayoutChange({
          ...drag.base,
          w: Math.max(160, snap(drag.base.w + dx)),
          h: Math.max(120, snap(drag.base.h + dy)),
        });
      }
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, onLayoutChange]);

  const start = (mode: DragState["mode"]) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDrag({ mode, startX: e.clientX, startY: e.clientY, base: layout });
  };

  const ticks = (total: number) => {
    const out: number[] = [];
    for (let v = 0; v <= total; v += 50) out.push(v);
    return out;
  };

  const Renderer = RENDERERS[(payload?.kind ?? "kpi") as ComponentKind] ?? RENDERERS.kpi;
  const dropProps = onKindChange
    ? {
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(true); },
        onDragLeave: () => setOver(false),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          setOver(false);
          try {
            const data = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
            if (data.kind === "chart" && data.chartKind) onKindChange(data.chartKind as ComponentKind);
          } catch { /* 忽略 */ }
        },
      }
    : {};

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{
        px: 2, py: 1.25, borderBottom: "1px solid #EEF3FB",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>画布</Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.disabled", fontVariantNumeric: "tabular-nums" }}>
          {layout.x},{layout.y} · {layout.w}×{layout.h}
          {loading ? " · 计算中…" : payload ? ` · ${payload.elapsed_ms ?? 0}ms` : ""}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex", bgcolor: "#F7F9FD" }}>
        {/* 左标尺 */}
        <Box sx={{ width: RULER, position: "relative", borderRight: "1px solid #E5EAF3", bgcolor: "#fff", flexShrink: 0 }}>
          {ticks(size.h).map((v) => (
            <Box key={v} sx={{ position: "absolute", top: v, left: 0, right: 0, height: 1, bgcolor: v % 100 === 0 ? "#E5EAF3" : "#F1F5F9" }} />
          ))}
          {ticks(size.h).filter((v) => v % 100 === 0 && v > 0).map((v) => (
            <Typography key={`l-${v}`} sx={{
              position: "absolute", top: v + 2, left: 2, fontSize: 9, color: "#94A3B8",
              writingMode: "vertical-rl", letterSpacing: -0.5,
            }}>
              {v}
            </Typography>
          ))}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* 上标尺 */}
          <Box sx={{ height: RULER, position: "relative", borderBottom: "1px solid #E5EAF3", bgcolor: "#fff", flexShrink: 0 }}>
            {ticks(size.w).map((v) => (
              <Box key={v} sx={{ position: "absolute", left: v, top: 0, bottom: 0, width: 1, bgcolor: v % 100 === 0 ? "#E5EAF3" : "#F1F5F9" }} />
            ))}
            {ticks(size.w).filter((v) => v % 100 === 0 && v > 0).map((v) => (
              <Typography key={`t-${v}`} sx={{ position: "absolute", left: v + 3, top: 4, fontSize: 9, color: "#94A3B8" }}>
                {v}
              </Typography>
            ))}
          </Box>

          {/* 画布 */}
          <Box
            ref={canvasRef}
            data-drop="preview"
            {...dropProps}
            sx={{
              flex: 1, minHeight: 0, position: "relative", overflow: "hidden",
              backgroundColor: "#FCFDFF",
              backgroundImage:
                "radial-gradient(circle at 1px 1px, #DBE3F0 1px, transparent 0), linear-gradient(to right, rgba(226,232,240,0.55) 1px, transparent 1px), linear-gradient(to bottom, rgba(226,232,240,0.55) 1px, transparent 1px)",
              backgroundSize: `${GRID}px ${GRID}px, 80px 80px, 80px 80px`,
              outline: over ? "2px dashed #6366F1" : "none",
              outlineOffset: -6,
              transition: "outline-color .12s",
            }}
          >
            {/* 卡片节点 */}
            <Box
              sx={{
                position: "absolute",
                left: layout.x,
                top: layout.y,
                width: layout.w,
                height: layout.h,
                bgcolor: "#fff",
                border: "1px solid",
                borderColor: drag ? "#A5B4FC" : "#E5EAF3",
                borderRadius: 2.5,
                boxShadow: drag ? "0 16px 40px -22px rgba(15,23,42,0.45)" : "0 6px 20px -16px rgba(15,23,42,0.35)",
                display: "flex",
                flexDirection: "column",
                overflow: "hidden",
              }}
            >
              <Box
                data-handle="move"
                onPointerDown={start("move")}
                sx={{
                  height: 30, px: 1.25, display: "flex", alignItems: "center", gap: 0.75,
                  borderBottom: "1px solid #F1F5F9", cursor: "grab", userSelect: "none",
                  bgcolor: "#FBFCFE",
                  "&:active": { cursor: "grabbing" },
                }}
              >
                <OpenWithIcon sx={{ fontSize: 13, color: "#94A3B8" }} />
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#334155", flex: 1 }} noWrap>
                  {spec.title}
                </Typography>
                <DragIndicatorIcon sx={{ fontSize: 13, color: "#CBD5E1" }} />
              </Box>

              <Box sx={{ flex: 1, minHeight: 0, p: 1.25, position: "relative" }}>
                {loading && !payload ? (
                  <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : error ? (
                  <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", px: 2 }}>
                    <Typography sx={{ fontSize: 12, color: "error.main", textAlign: "center" }}>{error}</Typography>
                  </Box>
                ) : payload ? (
                  <Renderer payload={payload} ui={spec.ui} />
                ) : (
                  <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                    <Typography sx={{ fontSize: 12, color: "text.disabled" }}>暂无数据</Typography>
                  </Box>
                )}
              </Box>

              {/* 右下缩放手柄 */}
              <Box
                data-handle="resize"
                onPointerDown={start("resize")}
                sx={{
                  position: "absolute", right: 0, bottom: 0, width: 18, height: 18, zIndex: 3,
                  cursor: "nwse-resize",
                  background: "linear-gradient(135deg, transparent 45%, #CBD5E1 45%, #CBD5E1 55%, transparent 55%, transparent 70%, #CBD5E1 70%, #CBD5E1 80%, transparent 80%)",
                }}
              />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
