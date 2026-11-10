// @mylayout/core — 性能基准测试
import { describe, it, expect, bench } from 'vitest';
import { SpatialHash } from '../utils/collision';
import { GridSystem } from '../core/grid';
import { computeSnap } from '../utils/snap';
import type { GridCard, Rect } from '../types';

// 生成100张随机卡片
function generateCards(count: number, canvasW: number, canvasH: number): GridCard[] {
  const cards: GridCard[] = [];
  for (let i = 0; i < count; i++) {
    cards.push({
      id: `card-${i}`,
      x: Math.floor(Math.random() * 12),
      y: Math.floor(Math.random() * 30),
      w: 2 + Math.floor(Math.random() * 5),
      h: 2 + Math.floor(Math.random() * 4),
    });
  }
  return cards;
}

describe('Performance Benchmarks', () => {
  const cards = generateCards(100, 1200, 2400);
  const grid = new GridSystem(1200);

  it('SpatialHash insert 100 cards < 5ms', () => {
    const hash = new SpatialHash(50);
    const start = performance.now();
    for (const c of cards) {
      hash.insert(c.id, grid.cardToRect(c));
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });

  it('SpatialHash query 100 cards < 3ms', () => {
    const hash = new SpatialHash(50);
    for (const c of cards) {
      hash.insert(c.id, grid.cardToRect(c));
    }
    const start = performance.now();
    const rect = grid.cardToRect(cards[0]!);
    hash.query(rect);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(3);
  });

  it('SpatialHash detectAll 100 cards < 10ms', () => {
    const hash = new SpatialHash(50);
    for (const c of cards) {
      hash.insert(c.id, grid.cardToRect(c));
    }
    const ids = cards.map(c => c.id);
    const start = performance.now();
    hash.detectAll(ids, (id) => {
      const c = cards.find(x => x.id === id)!;
      return grid.cardToRect(c);
    });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10);
  });

  it('GridSystem gridToPixel 100 cards < 2ms', () => {
    const start = performance.now();
    for (const c of cards) {
      grid.gridToPixel(c);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(2);
  });

  it('buildIndex 100 cards < 5ms', () => {
    const start = performance.now();
    grid.buildIndex(cards);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});
