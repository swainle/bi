import type { CanvasSize } from "../types";

export type CanvasResizeEdge = "e" | "s" | "se";

export function resizeCanvasSize(base: CanvasSize, edge: CanvasResizeEdge, dx: number, dy: number, scale: number): CanvasSize {
  return {
    width: edge.includes("e") ? Math.max(160, Math.round(base.width + dx / scale)) : base.width,
    height: edge.includes("s") ? Math.max(160, Math.round(base.height + dy / scale)) : base.height,
  };
}
