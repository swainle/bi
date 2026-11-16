/** 形状元素（工具栏「矩形」）—— 形状定义、默认参数、渲染与图标
 *
 * 数据落在 `spec.shape`（ItemDef.spec 是自由字典，不用改后端模型）。
 * 老文档里 type=divider 的元素没有 shape → 兜底成「直线」，与原来的分割线外观一致。
 */

import { Box } from "@mui/material";
import type { ShapeKind, ShapeSpec } from "./types";

export const SHAPE_KINDS: ShapeKind[] = ["rect", "ellipse", "triangle", "polygon", "line", "star"];

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  rect: "矩形",
  ellipse: "椭圆",
  triangle: "三角形",
  polygon: "多边形",
  line: "直线",
  star: "星形",
};

/** 拖进画布时的默认尺寸（设计坐标 1440 版面） */
export const SHAPE_SIZE: Record<ShapeKind, { w: number; h: number }> = {
  rect: { w: 320, h: 200 },
  ellipse: { w: 240, h: 240 },
  triangle: { w: 240, h: 210 },
  polygon: { w: 240, h: 240 },
  line: { w: 480, h: 12 },
  star: { w: 240, h: 240 },
};

/** 各形状的默认外观（克制：淡底、无描边，需要的自己加） */
export const SHAPE_DEFAULT: Record<ShapeKind, ShapeSpec> = {
  rect: { kind: "rect", fill: "#E9EFFB", stroke: "", stroke_w: 0, radius: 12, flip_x: false, flip_y: false },
  ellipse: { kind: "ellipse", fill: "#E9EFFB", stroke: "", stroke_w: 0, radius: 0, flip_x: false, flip_y: false },
  triangle: { kind: "triangle", fill: "#E9EFFB", stroke: "", stroke_w: 0, radius: 0, flip_x: false, flip_y: false },
  polygon: { kind: "polygon", fill: "#E9EFFB", stroke: "", stroke_w: 0, radius: 0, flip_x: false, flip_y: false },
  line: { kind: "line", fill: "#E2E8F0", stroke: "", stroke_w: 1, radius: 0, flip_x: false, flip_y: false },
  star: { kind: "star", fill: "#E9EFFB", stroke: "", stroke_w: 0, radius: 0, flip_x: false, flip_y: false },
};

/** 老「分割线」的样子：1px 浅灰横线 */
const LEGACY_LINE: ShapeSpec = { kind: "line", fill: "#E2E8F0", stroke: "", stroke_w: 1, radius: 0, flip_x: false, flip_y: false };

/** 补齐缺省字段：文档里可能只有一部分参数（旧分割线 / 手工导入） */
export function shapeOf(raw?: Partial<ShapeSpec> | null): ShapeSpec {
  const kind = (raw?.kind && SHAPE_KINDS.includes(raw.kind) ? raw.kind : "line") as ShapeKind;
  return { ...SHAPE_DEFAULT[kind], ...(raw || {}), kind };
}

/* ── 图形路径（viewBox 0 0 100 100，非等比拉伸；描边用 non-scaling-stroke 保持粗细）── */
const PATHS: Partial<Record<ShapeKind, string>> = {
  triangle: "M50 4 L96 96 L4 96 Z",
  polygon: "M50 3 L91 26.5 L91 73.5 L50 97 L9 73.5 L9 26.5 Z",
  star: "M50 2 L61.2 34.6 L95.7 35.2 L68.1 55.9 L78.2 88.8 L50 69 L21.8 88.8 L31.9 55.9 L4.3 35.2 L38.8 34.6 Z",
};

/** 形状渲染：rect / ellipse 走 CSS（圆角和描边是像素级），其余走 SVG */
export default function ShapeView({ shape }: { shape: ShapeSpec }) {
  const flip = shape.flip_x || shape.flip_y
    ? `scale(${shape.flip_x ? -1 : 1}, ${shape.flip_y ? -1 : 1})`
    : undefined;
  const stroke = shape.stroke && shape.stroke_w ? `${shape.stroke_w}px solid ${shape.stroke}` : "none";

  if (shape.kind === "line") {
    /* 线粗支持小数（最小 0.1）：输入 0.5 就是半像素细线，不再四舍五入成整数 */
    const thickness = Math.max(0.1, Number(shape.stroke_w) || 0.1);
    return (
      <Box sx={{ width: "100%", height: "100%", display: "flex", alignItems: "center", transform: flip }}>
        <Box sx={{ width: "100%", height: `${thickness}px`, bgcolor: shape.fill, borderRadius: "999px" }} />
      </Box>
    );
  }

  if (shape.kind === "rect" || shape.kind === "ellipse") {
    return (
      <Box sx={{ width: "100%", height: "100%", transform: flip }}>
        <Box sx={{
          width: "100%", height: "100%",
          bgcolor: shape.fill || "transparent",
          border: stroke,
          borderRadius: shape.kind === "ellipse" ? "50%" : `${Math.max(0, shape.radius)}px`,
        }} />
      </Box>
    );
  }

  return (
    <Box sx={{ width: "100%", height: "100%", transform: flip, "& svg": { display: "block" } }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
        <path
          d={PATHS[shape.kind] || PATHS.triangle}
          fill={shape.fill || "transparent"}
          stroke={shape.stroke || "none"}
          strokeWidth={shape.stroke_w || 0}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Box>
  );
}

/** 小图标：菜单 / 面板里用同一个形状语言（不需要描边，单色即可） */
export function ShapeIcon({ kind, size = 16, color = "currentColor" }: { kind: ShapeKind; size?: number; color?: string }) {
  if (kind === "line") {
    return (
      <Box component="span" sx={{ width: size, height: 1.5, borderRadius: 999, bgcolor: color, display: "inline-block" }} />
    );
  }
  if (kind === "rect") {
    return (
      <Box component="span" sx={{ width: size, height: size * 0.72, border: `1.5px solid ${color}`, borderRadius: "2px", display: "inline-block" }} />
    );
  }
  if (kind === "ellipse") {
    return (
      <Box component="span" sx={{ width: size, height: size * 0.78, border: `1.5px solid ${color}`, borderRadius: "50%", display: "inline-block" }} />
    );
  }
  return (
    <Box component="span" sx={{ width: size, height: size, display: "inline-block" }}>
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <path d={PATHS[kind] || PATHS.triangle} fill="none" stroke={color} strokeWidth="8" strokeLinejoin="round" />
      </svg>
    </Box>
  );
}
