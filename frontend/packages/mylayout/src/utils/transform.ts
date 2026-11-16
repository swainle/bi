// @mylayout/core — GridSystem：像素坐标 ↔ 网格坐标 转换
import type { GridCard, PixelCard, LayoutConfig } from '../types';
import { DEFAULT_CONFIG } from './constants';

/** 网格列单位 → 像素 x */
export function gridXToPx(col: number, config: Partial<LayoutConfig> = {}): number {
  const c = { ...DEFAULT_CONFIG, ...config };
  return col * (c.rowHeight || 80) + (col + 1) * c.cellPadding;
}

/** 网格行单位 → 像素 y */
export function gridYToPx(row: number, config: Partial<LayoutConfig> = {}): number {
  // y 用固定行高，不用列宽比例
  const c = { ...DEFAULT_CONFIG, ...config };
  return row * c.rowHeight + (row + 1) * c.cellPadding;
}

/** 网格宽 → 像素宽 */
export function gridWToPx(cols: number, config: Partial<LayoutConfig> = {}): number {
  const c = { ...DEFAULT_CONFIG, ...config };
  return cols * c.rowHeight + (cols - 1) * c.cellPadding;
}

/** 网格高 → 像素高 */
export function gridHToPx(rows: number, config: Partial<LayoutConfig> = {}): number {
  const c = { ...DEFAULT_CONFIG, ...config };
  return rows * c.rowHeight + (rows - 1) * c.cellPadding;
}

/** GridCard → PixelCard */
export function toPixelCard(card: GridCard, canvasWidth: number, config: Partial<LayoutConfig> = {}): PixelCard {
  const c = { ...DEFAULT_CONFIG, ...config };
  const colW = (canvasWidth - c.cellPadding) / c.columns - c.cellPadding;
  return {
    ...card,
    px: card.x * (colW + c.cellPadding) + c.cellPadding,
    py: card.y * c.rowHeight + (card.y + 1) * c.cellPadding,
    pw: card.w * (colW + c.cellPadding) - c.cellPadding,
    ph: card.h * c.rowHeight + (card.h - 1) * c.cellPadding,
  };
}

/** 像素 x → 最近的网格列 */
export function pxToGridX(px: number, canvasWidth: number, config: Partial<LayoutConfig> = {}): number {
  const c = { ...DEFAULT_CONFIG, ...config };
  const colW = (canvasWidth - c.cellPadding) / c.columns - c.cellPadding;
  return Math.round((px - c.cellPadding) / (colW + c.cellPadding));
}

/** 像素 y → 最近的网格行 */
export function pxToGridY(py: number, config: Partial<LayoutConfig> = {}): number {
  const c = { ...DEFAULT_CONFIG, ...config };
  return Math.round((py - c.cellPadding) / c.rowHeight);
}
