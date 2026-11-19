import { useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import type { CanvasSize } from "../types";
import { resizeCanvasSize, type CanvasResizeEdge } from "./canvasResize";

export default function CanvasResizeHandles({ width, height, scale, onResize }: CanvasSize & {
  scale: number;
  onResize: (size: CanvasSize) => void;
}) {
  const [draft, setDraft] = useState<CanvasSize | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);

  const start = (edge: CanvasResizeEdge) => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    cleanup.current?.();
    const base = { width, height };
    let next = base;
    const previousSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = edge === "e" ? "ew-resize" : edge === "s" ? "ns-resize" : "nwse-resize";
    setDraft(base);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== event.pointerId) return;
      next = resizeCanvasSize(base, edge, ev.clientX - event.clientX, ev.clientY - event.clientY, scale);
      setDraft(next);
    };
    const finish = (commit: boolean) => {
      cleanup.current?.();
      setDraft(null);
      if (commit && (next.width !== width || next.height !== height)) onResize(next);
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === event.pointerId) finish(true); };
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    };
    cleanup.current = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      document.body.style.userSelect = previousSelect;
      document.body.style.cursor = previousCursor;
      cleanup.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
  };

  const shown = draft ?? { width, height };
  return (
    <Box sx={{ position: "absolute", left: 0, top: 0, width: shown.width * scale, height: shown.height * scale, zIndex: 57, pointerEvents: "none", outline: draft ? "2px solid #6366F1" : undefined }}>
      {(["e", "s", "se"] as const).map((edge) => (
        <Box key={edge} data-canvas-resize={edge} title={edge === "e" ? "拖动调整画布宽度" : edge === "s" ? "拖动调整画布高度" : "拖动调整画布宽高"}
          onPointerDown={start(edge)} sx={{
            position: "absolute", pointerEvents: "auto", touchAction: "none",
            ...(edge === "e" ? { right: -5, top: 0, width: 10, height: "100%", cursor: "ew-resize" }
              : edge === "s" ? { bottom: -5, left: 0, height: 10, width: "100%", cursor: "ns-resize" }
                : { right: -6, bottom: -6, width: 14, height: 14, border: "2px solid #6366F1", bgcolor: "#fff", borderRadius: "2px", cursor: "nwse-resize" }),
            "&:hover": { bgcolor: "rgba(99,102,241,0.25)" },
          }} />
      ))}
      {draft && <Box sx={{ position: "absolute", right: 10, bottom: 10, px: 1, py: 0.5, bgcolor: "#4F46E5", color: "#fff", borderRadius: 1, fontSize: 12, whiteSpace: "nowrap" }}>{draft.width} × {draft.height} px</Box>}
    </Box>
  );
}
