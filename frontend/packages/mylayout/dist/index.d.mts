import { L as LayoutConfig, G as GridCard, P as PixelCard } from './types-DNNhqjF8.mjs';
export { C as Collision, a as Command, D as DragState, R as Rect, S as SnapGuide } from './types-DNNhqjF8.mjs';
export { BatchMoveCommand, GridSystem, HistoryManager, MoveCommand, SpatialHash, computeSnap, rectContains, rectIntersection } from './core/index.mjs';
export { useDrag, useResize } from './hooks/index.mjs';
export { DraggableCard, DroppableCanvas, PlaceholderOverlay } from './components/index.mjs';
import 'react';

declare const DEFAULT_CONFIG: LayoutConfig;

/** 网格列单位 → 像素 x */
declare function gridXToPx(col: number, config?: Partial<LayoutConfig>): number;
/** 网格行单位 → 像素 y */
declare function gridYToPx(row: number, config?: Partial<LayoutConfig>): number;
/** 网格宽 → 像素宽 */
declare function gridWToPx(cols: number, config?: Partial<LayoutConfig>): number;
/** 网格高 → 像素高 */
declare function gridHToPx(rows: number, config?: Partial<LayoutConfig>): number;
/** GridCard → PixelCard */
declare function toPixelCard(card: GridCard, canvasWidth: number, config?: Partial<LayoutConfig>): PixelCard;
/** 像素 x → 最近的网格列 */
declare function pxToGridX(px: number, canvasWidth: number, config?: Partial<LayoutConfig>): number;
/** 像素 y → 最近的网格行 */
declare function pxToGridY(py: number, config?: Partial<LayoutConfig>): number;

export { DEFAULT_CONFIG, GridCard, LayoutConfig, PixelCard, gridHToPx, gridWToPx, gridXToPx, gridYToPx, pxToGridX, pxToGridY, toPixelCard };
