/** 画布磁吸对齐 —— 拖动 / 缩放时吸附到其它元素与画布中线，返回对齐参考线 */

export const GRID = 8;
/** 磁吸阈值（屏幕 px），换算成设计坐标 */
const SNAP_SCREEN_PX = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  axis: "x" | "y";
  pos: number;
  /** 是否吸附到画布中线（用于画虚线区分） */
  center?: boolean;
}

const grid = (value: number) => Math.round(value / GRID) * GRID;

function nearest(value: number, lines: number[], threshold: number) {
  let best: { delta: number; line: number } | null = null;
  for (const line of lines) {
    const delta = line - value;
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
      best = { delta, line };
    }
  }
  return best;
}

function linesOf(others: Rect[], designWidth: number, extra?: { x?: number[]; y?: number[] }, designHeight = 620) {
  const xs = [0, designWidth / 2, designWidth, ...(extra?.x ?? [])];
  const ys = [0, designHeight / 2, ...(extra?.y ?? [])];
  others.forEach((o) => {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  });
  return { xs, ys };
}

/** 拖动：左 / 中 / 右三条边一起找最近的对齐线 */
export function snapMove(
  base: Rect, dx: number, dy: number, others: Rect[], scale: number, designWidth: number,
  extra?: { x?: number[]; y?: number[] }, designHeight = 620,
): { rect: Rect; guides: Guide[] } {
  const threshold = SNAP_SCREEN_PX / Math.max(0.2, scale);
  const { xs, ys } = linesOf(others, designWidth, extra, designHeight);

  let x = base.x + dx;
  let y = base.y + dy;
  const guides: Guide[] = [];

  let bestX: { delta: number; line: number } | null = null;
  for (const offset of [0, base.w / 2, base.w]) {
    const hit = nearest(x + offset, xs, threshold);
    if (hit && (!bestX || Math.abs(hit.delta) < Math.abs(bestX.delta))) bestX = hit;
  }
  if (bestX) {
    x += bestX.delta;
    guides.push({ axis: "x", pos: bestX.line, center: Math.abs(bestX.line - designWidth / 2) < 0.5 });
  } else {
    x = grid(x);
  }

  let bestY: { delta: number; line: number } | null = null;
  for (const offset of [0, base.h / 2, base.h]) {
    const hit = nearest(y + offset, ys, threshold);
    if (hit && (!bestY || Math.abs(hit.delta) < Math.abs(bestY.delta))) bestY = hit;
  }
  if (bestY) {
    y += bestY.delta;
    guides.push({ axis: "y", pos: bestY.line, center: Math.abs(bestY.line - designHeight / 2) < 0.5 });
  } else {
    y = grid(y);
  }

  return {
    rect: { ...base, x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)) },
    guides,
  };
}

/** 缩放手柄所在的边：四条边 + 右下角 */
export type ResizeEdge = "n" | "s" | "e" | "w" | "se";

/** 元素的最小尺寸（设计坐标）—— 图表默认值；页面元素按类型取更小的值 */
/* 卡片最小尺寸：允许拖得很小（480 宽的画板能排 4 张指标卡），内容等比缩小、布局不乱 */
export const MIN_W = 100;
export const MIN_H = 68;
export interface MinSize { w: number; h: number }

/** 缩放：只有拖动的那些边参与吸附，对边保持不动 */
export function snapResize(
  base: Rect, dx: number, dy: number, others: Rect[], scale: number, designWidth: number,
  edge: ResizeEdge = "se", extra?: { x?: number[]; y?: number[] }, designHeight = 620,
  min: MinSize = { w: MIN_W, h: MIN_H },
): { rect: Rect; guides: Guide[] } {
  const threshold = SNAP_SCREEN_PX / Math.max(0.2, scale);
  const { xs, ys } = linesOf(others, designWidth, extra, designHeight);

  const guides: Guide[] = [];
  let x = base.x;
  let y = base.y;
  let w = base.w;
  let h = base.h;

  if (edge.includes("e")) {
    let right = base.x + base.w + dx;
    const hit = nearest(right, xs, threshold);
    if (hit) {
      right = hit.line;
      guides.push({ axis: "x", pos: hit.line, center: Math.abs(hit.line - designWidth / 2) < 0.5 });
    } else {
      right = grid(right);
    }
    w = right - base.x;
  } else if (edge.includes("w")) {
    const right = base.x + base.w;
    let left = base.x + dx;
    const hit = nearest(left, xs, threshold);
    if (hit) {
      left = hit.line;
      guides.push({ axis: "x", pos: hit.line, center: Math.abs(hit.line - designWidth / 2) < 0.5 });
    } else {
      left = grid(left);
    }
    x = left;
    w = right - left;
  }

  if (edge.includes("s")) {
    let bottom = base.y + base.h + dy;
    const hit = nearest(bottom, ys, threshold);
    if (hit) {
      bottom = hit.line;
      guides.push({ axis: "y", pos: hit.line, center: Math.abs(hit.line - designHeight / 2) < 0.5 });
    } else {
      bottom = grid(bottom);
    }
    h = bottom - base.y;
  } else if (edge.includes("n")) {
    const bottom = base.y + base.h;
    let top = base.y + dy;
    const hit = nearest(top, ys, threshold);
    if (hit) {
      top = hit.line;
      guides.push({ axis: "y", pos: hit.line, center: Math.abs(hit.line - designHeight / 2) < 0.5 });
    } else {
      top = grid(top);
    }
    y = top;
    h = bottom - top;
  }

  // 最小尺寸只约束「被拖的那条轴」，免得横向缩放把本来更矮的元素顶高
  if (edge.includes("e") || edge.includes("w")) {
    if (w < min.w) {
      if (edge.includes("w")) x = base.x + base.w - min.w;
      w = min.w;
    }
  }
  if (edge.includes("n") || edge.includes("s")) {
    if (h < min.h) {
      if (edge.includes("n")) y = base.y + base.h - min.h;
      h = min.h;
    }
  }

  return {
    rect: {
      x: Math.max(0, Math.round(x)), y: Math.max(0, Math.round(y)),
      w: Math.round(w), h: Math.round(h),
    },
    guides,
  };
}


/** 拖参考线时的吸附：只吸一条轴上的线（元素边线 / 中线 / 画布边 / 其它参考线） */
export function snapGuide(
  axis: "x" | "y", pos: number, others: Rect[], designWidth: number, scale: number, extra: number[] = [],
  designHeight = 620,
): { pos: number; snapped: boolean; center: boolean } {
  const threshold = SNAP_SCREEN_PX / Math.max(0.2, scale);
  const mid = axis === "x" ? designWidth / 2 : designHeight / 2;
  const lines = axis === "x"
    ? [0, mid, designWidth, ...extra]
    : [0, mid, ...extra];
  others.forEach((o) => {
    if (axis === "x") lines.push(o.x, o.x + o.w / 2, o.x + o.w);
    else lines.push(o.y, o.y + o.h / 2, o.y + o.h);
  });
  const hit = nearest(pos, lines, threshold);
  if (hit) return { pos: Math.round(hit.line), snapped: true, center: Math.abs(hit.line - mid) < 0.5 };
  return { pos: Math.round(pos), snapped: false, center: false };
}
