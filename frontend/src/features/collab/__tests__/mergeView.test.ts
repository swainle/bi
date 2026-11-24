/** 实时同步的纯函数：元素级合并 + 分套取元素 + 轮询退避 */

import { describe, expect, it } from "vitest";
import type { CanvasItem } from "../../components/boardTypes";
import type { DocView } from "../../components/types";
import { mergeItems, remoteItemsFor } from "../mergeView";
import { nextBackoffMs } from "../useBoardSync";

const item = (key: string, x: number, extra: Record<string, unknown> = {}) => (
  { key, kind: "bar", x, y: 10, w: 100, h: 80, spec: {} as never, ...extra } as unknown as CanvasItem
);

describe("mergeItems：按元素 key 合并", () => {
  it("远端新增的元素会加上", () => {
    const result = mergeItems([item("a", 0)], [item("a", 0), item("b", 50)]);
    expect(result.items.map((i) => i.key)).toEqual(["a", "b"]);
    expect(result).toMatchObject({ changed: true, added: 1, updated: 0, removed: 0 });
  });

  it("两边都有的元素以远端为准，并计为 updated", () => {
    const result = mergeItems([item("a", 0)], [item("a", 88)]);
    expect(result.items[0].x).toBe(88);
    expect(result).toMatchObject({ changed: true, added: 0, updated: 1, removed: 0 });
  });

  it("本地独有的元素视为远端已删除", () => {
    const result = mergeItems([item("a", 0), item("gone", 5)], [item("a", 0)]);
    expect(result.items.map((i) => i.key)).toEqual(["a"]);
    expect(result).toMatchObject({ changed: true, removed: 1 });
  });

  it("内容完全一致时不标记变化（避免无谓重渲染 / 撤销栈抖动）", () => {
    const result = mergeItems([item("a", 1), item("b", 2)], [item("a", 1), item("b", 2)]);
    expect(result.changed).toBe(false);
    expect(result.items.map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("顺序以远端为准（列顺序 / 层级跟着远端）", () => {
    const result = mergeItems([item("a", 0), item("b", 0)], [item("b", 0), item("a", 0)]);
    expect(result.items.map((i) => i.key)).toEqual(["b", "a"]);
    expect(result.changed).toBe(true);
  });

  it("两边都空不炸", () => {
    expect(mergeItems([], [])).toMatchObject({ items: [], changed: false });
  });
});

describe("remoteItemsFor：分套版面取当前平台那一套", () => {
  const view = {
    key: "main", title: "页",
    items: [{ key: "filter", type: "filter" }],
    items_map: { 天猫: [{ key: "t1" }], 拼多多: [{ key: "p1" }] },
  } as unknown as DocView;

  it("没指定平台 → 只取共用那套", () => {
    expect(remoteItemsFor(view, null).map((i) => i.key)).toEqual(["filter"]);
  });

  it("指定平台 → 共用 + 该平台那套（与后端 view_items_for 同口径）", () => {
    expect(remoteItemsFor(view, "天猫").map((i) => i.key)).toEqual(["filter", "t1"]);
  });

  it("平台没配专套 → 回落共用那套", () => {
    expect(remoteItemsFor(view, "京东").map((i) => i.key)).toEqual(["filter"]);
  });

  it("单套版面（没有 items_map）不受影响", () => {
    const single = { key: "main", title: "页", items: [{ key: "a" }] } as unknown as DocView;
    expect(remoteItemsFor(single, "天猫").map((i) => i.key)).toEqual(["a"]);
  });
});

describe("mergeItems：钉住本地正在动的元素（pinned）", () => {
  it("正在拖的元素保留本地位置，其余元素照常跟随远端", () => {
    const result = mergeItems([item("dragged", 0), item("other", 0)], [item("dragged", 999), item("other", 50)], ["dragged"]);
    const byKey = Object.fromEntries(result.items.map((i) => [i.key, i.x]));
    expect(byKey).toEqual({ dragged: 0, other: 50 });   // 拖的那个用本地，另一个跟远端
    expect(result).toMatchObject({ updated: 1, added: 0, removed: 0 });
  });

  it("钉住的元素即使远端没给也不当成被删除", () => {
    const result = mergeItems([item("dragged", 0), item("other", 0)], [item("other", 0)], ["dragged"]);
    expect(result.items.map((i) => i.key)).toEqual(["other"]);   // 顺序按远端
    expect(result.removed).toBe(0);                              // 但不算删除
  });

  it("没有钉住时行为不变（以远端为准）", () => {
    const result = mergeItems([item("a", 0)], [item("a", 88)]);
    expect(result.items[0].x).toBe(88);
  });
});

describe("nextBackoffMs：失败退避", () => {
  it("正常按 1 秒；失败后 5s / 15s / 60s 封顶", () => {
    expect(nextBackoffMs(0, 1000)).toBe(1000);
    expect(nextBackoffMs(1, 1000)).toBe(5000);
    expect(nextBackoffMs(2, 1000)).toBe(15000);
    expect(nextBackoffMs(3, 1000)).toBe(60000);
    expect(nextBackoffMs(99, 1000)).toBe(60000);
  });

  it("间隔可配置时，正常轮询用配置值", () => {
    expect(nextBackoffMs(0, 3000)).toBe(3000);
  });
});
