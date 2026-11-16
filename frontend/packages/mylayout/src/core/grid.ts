// @mylayout/core — 网格布局系统
import type { GridCard, Rect, LayoutConfig } from '../types';
import { SpatialHash } from '../utils/collision';
import { computeSnap } from '../utils/snap';
import { HistoryManager } from './history';
import { DEFAULT_CONFIG } from '../utils/constants';
import { gridXToPx, gridYToPx, gridWToPx, gridHToPx, toPixelCard, pxToGridX, pxToGridY } from '../utils/transform';

/**
 * GridSystem — BI看板布局引擎核心
 *
 * 职责：
 * 1. 管理卡片位置（grid单位 + pixel单位双坐标系）
 * 2. 拖拽过程中的碰撞检测 + 吸附计算
 * 3. 占位符渲染（拖拽时计算最终位置，不修改实际状态）
 * 4. 撤销/重做委托给 HistoryManager
 */
export class GridSystem {
  config: Required<LayoutConfig>;
  canvasWidth: number;
  history: HistoryManager;
  hash: SpatialHash;

  constructor(canvasWidth: number, config: Partial<LayoutConfig> = {}) {
    this.canvasWidth = canvasWidth;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<LayoutConfig>;
    this.history = new HistoryManager();
    this.hash = new SpatialHash(this.config.cellPadding * 4);
  }

  updateCanvasWidth(w: number): void {
    this.canvasWidth = w;
  }

  // ═══════ Grid ↔ Pixel 转换 ═══════

  gridToPixel(card: GridCard): { x: number; y: number; w: number; h: number } {
    return {
      x: gridXToPx(card.x, this.config),
      y: gridYToPx(card.y, this.config),
      w: gridWToPx(card.w, this.config),
      h: gridHToPx(card.h, this.config),
    };
  }

  pixelToGrid(px: number, py: number): { x: number; y: number } {
    return {
      x: pxToGridX(px, this.canvasWidth, this.config),
      y: pxToGridY(py, this.config),
    };
  }

  // ═══════ 碰撞检测 ═══════

  /** 重建空间哈希索引 */
  buildIndex(cards: GridCard[]): void {
    const rects = cards.map(c => ({
      id: c.id,
      rect: this.cardToRect(c),
    }));
    this.hash.build(rects);
  }

  /** 检测拖拽移动后的碰撞 */
  detectCollisions(movingId: string, movingRect: Rect, allCards: GridCard[]): string[] {
    const cards = allCards
      .filter(c => c.id !== movingId)
      .map(c => ({ id: c.id, rect: this.cardToRect(c) }));

    // 重建索引（含移动卡片的新位置）
    this.hash.build([...cards, { id: movingId, rect: movingRect }]);
    const collisions = this.hash.query(movingRect);
    return collisions.filter(id => id !== movingId);
  }

  // ═══════ 吸附 ═══════

  /** 计算拖拽中的吸附引导线 */
  computeSnapGuides(movingId: string, movingRect: Rect, allCards: GridCard[]) {
    const cards = allCards
      .filter(c => c.id !== movingId)
      .map(c => ({ id: c.id, rect: this.cardToRect(c) }));

    this.hash.build(cards.map(c => ({ id: c.id, rect: c.rect })));

    return computeSnap(
      { id: movingId, rect: movingRect },
      cards,
      this.hash,
      this.config,
    );
  }

  // ═══════ 占位符 ═══════

  /**
   * 计算拖拽占位：在 targetRect 位置插入卡片，向下推移被碰撞的卡片
   * 返回更新后的卡片位置（不修改原状态）
   */
  computePlaceholder(movingId: string, targetRect: Rect, cards: GridCard[]): GridCard[] {
    const result = [...cards];
    const target = this.pixelToGrid(targetRect.x, targetRect.y);

    for (const card of result) {
      if (card.id === movingId) {
        card.x = target.x;
        card.y = target.y;
        break;
      }
    }

    // 简单碰撞重排：被碰撞的卡片向下移动
    for (const card of result) {
      if (card.id === movingId || card.locked) continue;
      const cardRect = this.cardToRect(card);
      if (SpatialHash.intersects(cardRect, targetRect)) {
        card.y += 1; // 下移一行
      }
    }

    return result;
  }

  // ═══════ 工具方法 ═══════

  cardToRect(card: GridCard): Rect {
    const px = gridXToPx(card.x, this.config);
    const py = gridYToPx(card.y, this.config);
    const pw = gridWToPx(card.w, this.config);
    const ph = gridHToPx(card.h, this.config);
    return { x: px, y: py, w: pw, h: ph };
  }

  /** 将像素偏移转换为网格偏移 */
  deltaToGrid(dx: number, dy: number): { dx: number; dy: number } {
    const colW = (this.canvasWidth - this.config.cellPadding) / this.config.columns - this.config.cellPadding;
    return {
      dx: Math.round(dx / (colW + this.config.cellPadding)),
      dy: Math.round(dy / (this.config.rowHeight + this.config.cellPadding)),
    };
  }
}
