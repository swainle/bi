import { describe, expect, it } from "vitest";
import { canvasPanForOrigin, canvasPoint, clampZoom, zoomOrigin } from "./useCanvasViewport";

describe("画布缩放", () => {
  it("调整实际宽度后抵消自动居中的变化，固定左上角和查看比例", () => {
    const origin = { x: 100, y: -50 };
    for (const width of [500, 1440, 2000]) {
      const pan = canvasPanForOrigin(origin, 0.5, 1000, width);
      expect(Math.max(0, Math.round((1000 - width * 0.5) / 2)) + pan.x).toBe(origin.x);
      expect(24 + pan.y).toBe(origin.y);
    }
  });
  it("限制为 25% 到 200%，支持恢复 100%", () => {
    expect(clampZoom(0.1)).toBe(0.25);
    expect(clampZoom(2.1)).toBe(2);
    expect(clampZoom(1)).toBe(1);
  });

  it("画布向任意方向平移后，指针仍可准确换算为设计坐标", () => {
    expect(canvasPoint({ x: 300, y: 150 }, { x: -50, y: -200 }, 0.5)).toEqual({ x: 700, y: 700 });
    expect(canvasPoint({ x: 300, y: 150 }, { x: 400, y: 300 }, 2)).toEqual({ x: -50, y: -75 });
  });

  it("缩放保持鼠标下的设计坐标，允许原点在视口外，往返缩放不漂移", () => {
    const point = { x: 300, y: 150 };
    const origin = { x: -50, y: -200 };
    const enlarged = zoomOrigin(point, origin, 0.5, 2);
    expect(enlarged).toEqual({ x: -1100, y: -1250 });
    expect(canvasPoint(point, enlarged, 2)).toEqual(canvasPoint(point, origin, 0.5));
    expect(zoomOrigin(point, enlarged, 2, 0.5)).toEqual(origin);
  });
});
