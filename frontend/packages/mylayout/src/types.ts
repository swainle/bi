// @mylayout/core — 类型定义

/** 12列网格布局卡片（grid单位） */
export interface GridCard {
  id: string;
  x: number;       // 列位置 (0-11)
  y: number;       // 行位置
  w: number;       // 列宽 (1-12)
  h: number;       // 行高
  minW?: number;
  minH?: number;
  zIndex?: number;
  locked?: boolean;
}

/** 像素坐标系卡片（渲染用） */
export interface PixelCard extends GridCard {
  px: number;      // 像素 x
  py: number;      // 像素 y
  pw: number;      // 像素 w
  ph: number;      // 像素 h
}

/** 矩形（用于碰撞检测） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 吸附引导线 */
export interface SnapGuide {
  type: 'x' | 'y';
  pos: number;     // 引导线位置
  from: number;    // 起点
  to: number;      // 终点
}

/** 碰撞结果 */
export interface Collision {
  id1: string;
  id2: string;
  overlap: Rect;
}

/** 命令接口（Command Pattern 撤销/重做） */
export interface Command {
  execute(): void;
  undo(): void;
  /** 用于调试 */
  label?: string;
}

/** 拖拽状态 */
export interface DragState {
  activeId: string;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

/** 布局引擎配置 */
export interface LayoutConfig {
  columns: number;        // 列数 (default: 12)
  rowHeight: number;      // 行高 px (default: 80)
  cellPadding: number;    // 单元格间距 px (default: 8)
  snapThreshold: number;  // 吸附阈值 px (default: 5)
  grid: number;           // 网格步进 px (default: 10)
}
