import { describe, expect, it } from "vitest";
import type { CanvasItem } from "../../features/components/boardTypes";
import { clampLayerSplit, layerTree, reorderLayers } from "./layers";
import { emptySpec, toCanvasItem, toDocItem } from "./spec";

const card = (key: string, x = 0, y = 0): CanvasItem => ({ key, type: "chart", kind: "kpi", spec: emptySpec(key), x, y, w: 100, h: 100 });
const board: CanvasItem = { ...card("board", 200, 200), type: "board", w: 400, h: 400 };

describe("组件图层", () => {
  it("从前景到背景显示，组件归属最小的包含画板", () => {
    const small: CanvasItem = { ...board, key: "small", w: 200, h: 200 };
    const roots = layerTree([board, small, card("inside", 250, 250), card("outside")]);
    expect(roots.map((node) => node.item.key)).toEqual(["outside", "small", "board"]);
    expect(roots[1].children.map((node) => node.item.key)).toEqual(["inside"]);
    expect(roots[2].children).toEqual([]);
  });

  it("拖动根图层改变叠放顺序，画板子组件随组保留，保存往返不丢顺序与坐标", () => {
    const items = [board, card("inside", 250, 250), card("outside")];
    const next = reorderLayers(items, null, 1, 0);
    expect(next.map((item) => item.key)).toEqual(["outside", "board", "inside"]);
    expect(next.find((item) => item.key === "inside")).toBe(items[1]);
    expect(next.map(toDocItem).map(toCanvasItem).map((item) => [item.key, item.x, item.y])).toEqual(next.map((item) => [item.key, item.x, item.y]));
  });

  it("同一画板内拖动只改变子组件顺序，不改变归属和几何位置", () => {
    const items = [board, card("a", 250, 250), card("b", 350, 350), card("outside")];
    const next = reorderLayers(items, "board", 0, 1);
    expect(layerTree(next).find((node) => node.item.key === "board")?.children.map((node) => node.item.key)).toEqual(["a", "b"]);
    expect(next.every((item) => items.includes(item))).toBe(true);
    expect(reorderLayers(items, "missing", 0, 1)).toBe(items);
    expect(reorderLayers(items, null, 0, 0)).toBe(items);
    expect(reorderLayers(items, null, -1, 0)).toBe(items);
  });

  it("同尺寸重叠画板调整层级后，组件归属保持稳定", () => {
    const a = { ...board, key: "a" };
    const b = { ...board, key: "b" };
    const items = [a, b, card("inside", 250, 250)];
    const next = reorderLayers(items, null, 0, 1);
    expect(layerTree(next).find((node) => node.item.key === "a")?.children.map((node) => node.item.key)).toEqual(["inside"]);
    expect(layerTree(next).find((node) => node.item.key === "b")?.children).toEqual([]);
  });

  it("分隔条给上下两块保留可用高度", () => {
    expect(clampLayerSplit(0)).toBe(20);
    expect(clampLayerSplit(100)).toBe(80);
    expect(clampLayerSplit(35)).toBe(35);
  });
});
