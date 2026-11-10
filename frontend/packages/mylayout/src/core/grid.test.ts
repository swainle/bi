import { describe, it, expect } from 'vitest';
import { GridSystem } from '../core/grid';
import type { GridCard } from '../types';

describe('GridSystem', () => {
  const canvasWidth = 1200;
  const grid = new GridSystem(canvasWidth);

  it('converts grid to pixel', () => {
    const card: GridCard = { id: 'c1', x: 0, y: 0, w: 4, h: 3 };
    const px = grid.gridToPixel(card);
    expect(px.x).toBeGreaterThan(0);
    expect(px.y).toBeGreaterThan(0);
    expect(px.w).toBeGreaterThan(100);
    expect(px.h).toBeGreaterThan(200);
  });

  it('pixel to grid round-trips correctly', () => {
    const gridPos = grid.pixelToGrid(8, 8);
    expect(gridPos.x).toBe(0);
    expect(gridPos.y).toBe(0);
  });

  it('detects collisions between overlapping cards', () => {
    const cards: GridCard[] = [
      { id: 'a', x: 0, y: 0, w: 6, h: 3 },
      { id: 'b', x: 3, y: 1, w: 6, h: 3 },
    ];
    grid.buildIndex(cards);
    const movingRect = grid.cardToRect(cards[0]!);
    const colls = grid.detectCollisions('a', movingRect, cards);
    expect(colls).toContain('b');
  });

  it('no collisions when cards are separate', () => {
    const cards: GridCard[] = [
      { id: 'a', x: 0, y: 0, w: 4, h: 3 },
      { id: 'b', x: 8, y: 0, w: 4, h: 3 },
    ];
    grid.buildIndex(cards);
    const movingRect = grid.cardToRect(cards[0]!);
    const colls = grid.detectCollisions('a', movingRect, cards);
    expect(colls.length).toBe(0);
  });

  it('computes placeholder positions', () => {
    const cards: GridCard[] = [
      { id: 'a', x: 0, y: 0, w: 6, h: 3 },
      { id: 'b', x: 0, y: 3, w: 6, h: 3 },
    ];
    const targetRect = grid.cardToRect({ id: 'a', x: 0, y: 0, w: 6, h: 3 });
    const result = grid.computePlaceholder('a', targetRect, cards);
    expect(result.length).toBe(2);
  });
});
