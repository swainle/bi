import { describe, expect, it } from "vitest";
import { resizeCanvasSize } from "../board/canvasResize";

describe("画布边缘尺寸拖动", () => {
  const base = { width: 1440, height: 620 };

  it("按当前缩放换算实际像素，只调整被拖动的轴", () => {
    expect(resizeCanvasSize(base, "e", 100, 80, 0.5)).toEqual({ width: 1640, height: 620 });
    expect(resizeCanvasSize(base, "s", 100, 80, 2)).toEqual({ width: 1440, height: 660 });
    expect(resizeCanvasSize(base, "se", 100, 80, 0.5)).toEqual({ width: 1640, height: 780 });
  });

  it("支持缩小，结果取整且最小宽高为 160 px", () => {
    expect(resizeCanvasSize(base, "se", -10000, -10000, 0.25)).toEqual({ width: 160, height: 160 });
    expect(resizeCanvasSize(base, "se", 1, -1, 2)).toEqual({ width: 1441, height: 620 });
  });
});
