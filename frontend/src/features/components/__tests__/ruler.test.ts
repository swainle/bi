import { describe, expect, it } from "vitest";
import { rulerMarks } from "../editor/CanvasRuler";

describe("标尺原点", () => {
  it("画布左上角对应零点，平移和缩放后刻度仍与设计坐标一致", () => {
    const marks = rulerMarks(800, 0.5, 120, 1920);
    expect(marks.find((mark) => mark.value === 0)?.pos).toBe(120);
    expect(marks.find((mark) => mark.value === 200)?.pos).toBe(220);
  });

  it("超过 1440 的尺寸正常显示，画布移出视口后只计算可见刻度", () => {
    const marks = rulerMarks(800, 1, -1600, 2400);
    expect(marks.find((mark) => mark.value === 2000)?.pos).toBe(400);
    expect(marks.every((mark) => mark.pos >= -2 && mark.pos <= 802 && mark.value <= 2400)).toBe(true);
    expect(marks.length).toBeLessThan(100);
    expect(rulerMarks(800, 1, 900, 2400)).toEqual([]);
  });
});
