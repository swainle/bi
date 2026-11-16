import { describe, it, expect, beforeEach } from 'vitest';
import { computeSnap } from '../utils/snap';
import { SpatialHash } from '../utils/collision';
import type { Rect } from '../types';

interface AdCard { id: string; rect: Rect; }

describe('computeSnap', () => {
  let hash: SpatialHash;
  const threshold = 5;

  beforeEach(() => {
    hash = new SpatialHash(50);
  });

  function makeCard(id: string, x: number, y: number, w: number, h: number): AdCard {
    return { id, rect: { x, y, w, h } };
  }

  it('snaps left edge to nearby card left edge', () => {
    const targets: AdCard[] = [
      makeCard('t1', 100, 0, 80, 60),
    ];
    hash.build(targets.map(t => ({ id: t.id, rect: t.rect })));

    const moving = makeCard('m', 102, 0, 80, 60); // 2px from left edge
    const guides = computeSnap(moving, targets, hash, { snapThreshold: threshold });

    const xGuides = guides.filter(g => g.type === 'x');
    expect(xGuides.length).toBeGreaterThan(0);
    expect(xGuides.some(g => Math.abs(g.pos - 100) <= 1)).toBe(true);
  });

  it('snaps top edge to nearby card top edge', () => {
    const targets: AdCard[] = [
      makeCard('t1', 0, 200, 80, 60),
    ];
    hash.build(targets.map(t => ({ id: t.id, rect: t.rect })));

    const moving = makeCard('m', 0, 203, 80, 60); // 3px from top edge
    const guides = computeSnap(moving, targets, hash, { snapThreshold: threshold });

    const yGuides = guides.filter(g => g.type === 'y');
    expect(yGuides.length).toBeGreaterThan(0);
    expect(yGuides.some(g => Math.abs(g.pos - 200) <= 1)).toBe(true);
  });

  it('snaps right edge to nearby card right edge', () => {
    const targets: AdCard[] = [
      makeCard('t1', 0, 0, 180, 60), // right edge at 180
    ];
    hash.build(targets.map(t => ({ id: t.id, rect: t.rect })));

    const moving = makeCard('m', 0, 0, 182, 60); // right edge at 182, 2px from target
    const guides = computeSnap(moving, targets, hash, { snapThreshold: threshold });

    const xGuides = guides.filter(g => g.type === 'x');
    expect(xGuides.some(g => Math.abs(g.pos - 180) <= 1)).toBe(true);
  });

  it('no snap when distance exceeds threshold', () => {
    const targets: AdCard[] = [
      makeCard('t1', 100, 0, 80, 60),
    ];
    hash.build(targets.map(t => ({ id: t.id, rect: t.rect })));

    const moving = makeCard('m', 120, 0, 80, 60); // 20px away
    const guides = computeSnap(moving, targets, hash, { snapThreshold: 3 });

    const xGuides = guides.filter(g => g.type === 'x');
    expect(xGuides.length).toBe(0);
  });

  it('snaps horizontal center', () => {
    const targets: AdCard[] = [
      makeCard('t1', 100, 0, 80, 60), // center x = 140
    ];
    hash.build(targets.map(t => ({ id: t.id, rect: t.rect })));

    const moving = makeCard('m', 0, 0, 60, 40); // center x = 30
    // Move moving card so its center approaches 140
    const moved = makeCard('m', 109, 0, 60, 40); // center x = 139, 1px from target center
    const guides = computeSnap(moved, targets, hash, { snapThreshold: threshold });

    const xGuides = guides.filter(g => g.type === 'x');
    expect(xGuides.length).toBeGreaterThan(0);
  });

  it('handles empty target list', () => {
    const moving = makeCard('m', 100, 200, 80, 60);
    const guides = computeSnap(moving, [], hash);
    expect(guides.length).toBe(0);
  });
});
