import { describe, expect, it } from "vitest";
import { boardAt, validBoardSize } from "./boardResize";
import { emptySpec } from "./spec";
import type { CanvasItem } from "../../features/components/boardTypes";

describe("画板尺寸菜单", () => {
  const outer: CanvasItem = { key: "outer", type: "board", kind: "section", spec: emptySpec("画板"), x: 100, y: 100, w: 800, h: 600 };
  const inner: CanvasItem = { ...outer, key: "inner", x: 200, y: 200, w: 200, h: 200 };

  it("命中目标画板，重叠时优先较小的画板，空白处不显示尺寸入口", () => {
    expect(boardAt([outer, inner], 250, 250)?.key).toBe("inner");
    expect(boardAt([outer, inner], 800, 600)?.key).toBe("outer");
    expect(boardAt([outer, inner], 0, 0)).toBeUndefined();
    expect(boardAt([{ ...outer, type: "chart" }], 250, 250)).toBeUndefined();
  });

  it("只接受至少 160 px 的安全整数", () => {
    for (const value of ["160", "1440", "2160"]) expect(validBoardSize(value)).toBe(true);
    for (const value of ["", "159", "0", "-200", "160.5", "NaN", "Infinity", "9007199254740992"]) {
      expect(validBoardSize(value)).toBe(false);
    }
  });
});
