import { describe, it, expect } from 'vitest';
import { gridXToPx, gridYToPx, toPixelCard, pxToGridX, pxToGridY } from '../utils/transform';
import type { GridCard } from '../types';

describe('transform utilities', () => {
  const config = { columns: 12, rowHeight: 80, cellPadding: 8 };

  describe('gridXToPx', () => {
    it('column 0 should start at cellPadding', () => {
      expect(gridXToPx(0, config)).toBe(8);
    });

    it('column 1 should be colW + cellPadding apart', () => {
      const col0 = gridXToPx(0, config);
      const col1 = gridXToPx(1, config);
      expect(col1 - col0).toBe(88); // 80 + 8
    });
  });

  describe('gridYToPx', () => {
    it('row 0 should start at cellPadding', () => {
      expect(gridYToPx(0, config)).toBe(8);
    });

    it('row 1 should be rowHeight + cellPadding apart', () => {
      expect(gridYToPx(1, config) - gridYToPx(0, config)).toBe(88);
    });
  });

  describe('toPixelCard', () => {
    const card: GridCard = { id: 'test', x: 0, y: 0, w: 4, h: 3 };
    const canvasWidth = 1200;

    it('converts grid card to pixel coordinates', () => {
      const pc = toPixelCard(card, canvasWidth, config);
      expect(pc.px).toBe(8);
      expect(pc.py).toBe(8);
      expect(pc.pw).toBeGreaterThan(0);
      expect(pc.ph).toBeGreaterThan(0);
    });

    it('pixel width accounts for cellPadding', () => {
      const pc = toPixelCard(card, canvasWidth, config);
      // 4 * (colW + 8) - 8 = 4 * colW + 24
      const colW = (canvasWidth - 8) / 12 - 8;
      expect(pc.pw).toBeCloseTo(4 * colW + 24, 0);
    });
  });

  describe('pxToGridX / pxToGridY', () => {
    it('round-trip: grid → px → grid', () => {
      const canvasWidth = 1200;
      const x = 3;
      const px = gridXToPx(x, config);
      const back = pxToGridX(px, canvasWidth, config);
      expect(back).toBe(x);
    });

    it('round-trip: grid y', () => {
      const y = 2;
      const py = gridYToPx(y, config);
      const back = pxToGridY(py, config);
      expect(back).toBe(y);
    });
  });
});
