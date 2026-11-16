// @mylayout/core — 空间哈希碰撞检测 O(n)
import type { Rect, Collision } from '../types';

/**
 * 空间哈希格网
 * 将画布划分为 cellSize×cellSize 的格网单元
 * 每个单元存储该区域内卡片的 id 列表
 *
 * 复杂度：
 * - insert: O(1)
 * - query: O(n) 但 n = 同格网单元内卡片数（通常 < 5）
 * - detectAll: O(k) k = 总卡片数 / 格网密度
 */
export class SpatialHash {
  private cells = new Map<string, string[]>();
  private cellSize: number;

  constructor(cellSize = 50) {
    this.cellSize = cellSize;
  }

  /** 清空所有格网 */
  clear(): void {
    this.cells.clear();
  }

  /** 从卡片数组构建格网 */
  build(rects: { id: string; rect: Rect }[]): void {
    this.clear();
    for (const { id, rect } of rects) {
      this.insert(id, rect);
    }
  }

  /** 插入单个卡片 */
  insert(id: string, rect: Rect): void {
    const keys = this.getKeys(rect);
    for (const key of keys) {
      const list = this.cells.get(key);
      if (list) {
        list.push(id);
      } else {
        this.cells.set(key, [id]);
      }
    }
  }

  /** 查询与指定矩形可能碰撞的卡片 */
  query(rect: Rect): string[] {
    const keys = this.getKeys(rect);
    const seen = new Set<string>();
    for (const key of keys) {
      const list = this.cells.get(key);
      if (list) {
        for (const id of list) seen.add(id);
      }
    }
    return Array.from(seen);
  }

  /** 检测所有两两碰撞 */
  detectAll(ids: string[], getRect: (id: string) => Rect): Collision[] {
    const collisions: Collision[] = [];
    const checked = new Set<string>();

    for (const id of ids) {
      const rect = getRect(id);
      const candidates = this.query(rect);
      for (const otherId of candidates) {
        if (id === otherId) continue;
        const pairKey = [id, otherId].sort().join('::');
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const otherRect = getRect(otherId);
        const overlap = rectIntersection(rect, otherRect);
        if (overlap) {
          collisions.push({ id1: id, id2: otherId, overlap });
        }
      }
    }
    return collisions;
  }

  /** 检查两个矩形是否碰撞 */
  static intersects(a: Rect, b: Rect): boolean {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  /** 获取覆盖指定矩形的格网 key 列表 */
  private getKeys(rect: Rect): string[] {
    const keys: string[] = [];
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.w) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.h) / this.cellSize);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
}

/** 计算两矩形交集 */
export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/** 判断矩形 a 是否包含点 (px, py) */
export function rectContains(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
