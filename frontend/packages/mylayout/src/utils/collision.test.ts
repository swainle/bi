import { describe, it, expect, beforeEach } from 'vitest';
import { SpatialHash, rectIntersection, rectContains } from '../utils/collision';
import type { Rect } from '../types';

describe('SpatialHash', () => {
  let hash: SpatialHash;

  beforeEach(() => {
    hash = new SpatialHash(50);
  });

  it('inserts and queries cards', () => {
    hash.insert('card1', { x: 10, y: 10, w: 100, h: 80 });
    hash.insert('card2', { x: 200, y: 10, w: 100, h: 80 });

    const nearby = hash.query({ x: 0, y: 0, w: 120, h: 90 });
    expect(nearby).toContain('card1');
    expect(nearby).not.toContain('card2');
  });

  it('detects collisions between overlapping cards', () => {
    hash.insert('a', { x: 0, y: 0, w: 100, h: 80 });
    hash.insert('b', { x: 50, y: 40, w: 100, h: 80 });

    const colls = hash.detectAll(['a', 'b'], (id) => {
      return id === 'a'
        ? { x: 0, y: 0, w: 100, h: 80 }
        : { x: 50, y: 40, w: 100, h: 80 };
    });

    expect(colls.length).toBe(1);
    expect(colls[0]!.id1).toBeDefined();
    expect(colls[0]!.id2).toBeDefined();
  });

  it('handles non-overlapping cards with no collision', () => {
    hash.insert('a', { x: 0, y: 0, w: 100, h: 80 });
    hash.insert('b', { x: 200, y: 0, w: 100, h: 80 });

    const colls = hash.detectAll(['a', 'b'], (id) => {
      return id === 'a'
        ? { x: 0, y: 0, w: 100, h: 80 }
        : { x: 200, y: 0, w: 100, h: 80 };
    });

    expect(colls.length).toBe(0);
  });

  it('clear removes all entries', () => {
    hash.insert('a', { x: 0, y: 0, w: 50, h: 50 });
    hash.clear();
    const found = hash.query({ x: 0, y: 0, w: 60, h: 60 });
    expect(found.length).toBe(0);
  });

  it('Intersects detects touching edges as non-collision', () => {
    const a: Rect = { x: 0, y: 0, w: 100, h: 80 };
    const b: Rect = { x: 100, y: 0, w: 100, h: 80 }; // just touching
    expect(SpatialHash.intersects(a, b)).toBe(false);
  });

  it('Intersects detects overlapping', () => {
    const a: Rect = { x: 0, y: 0, w: 100, h: 80 };
    const b: Rect = { x: 50, y: 40, w: 100, h: 80 };
    expect(SpatialHash.intersects(a, b)).toBe(true);
  });
});

describe('rectIntersection', () => {
  it('returns null for non-overlapping rects', () => {
    expect(rectIntersection(
      { x: 0, y: 0, w: 100, h: 80 },
      { x: 200, y: 0, w: 100, h: 80 },
    )).toBeNull();
  });

  it('returns the overlap rect for intersecting', () => {
    const overlap = rectIntersection(
      { x: 0, y: 0, w: 100, h: 80 },
      { x: 50, y: 40, w: 100, h: 80 },
    );
    expect(overlap).toEqual({ x: 50, y: 40, w: 50, h: 40 });
  });
});

describe('rectContains', () => {
  const rect = { x: 10, y: 10, w: 100, h: 80 };

  it('point inside returns true', () => {
    expect(rectContains(rect, 50, 50)).toBe(true);
  });

  it('point outside returns false', () => {
    expect(rectContains(rect, 200, 50)).toBe(false);
  });

  it('point on edge returns true', () => {
    expect(rectContains(rect, 10, 10)).toBe(true);
  });
});
