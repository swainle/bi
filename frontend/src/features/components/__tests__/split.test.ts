import { describe, expect, it } from "vitest";

import type { FilterFieldSpec } from "../types";
import { filterWithFields, findSplitField, isSplitField, splitKeysOf } from "../split";

function field(overrides: Partial<FilterFieldSpec>): FilterFieldSpec {
  return {
    id: "platform",
    label: "平台",
    type: "select",
    options: [],
    multiple: false,
    placeholder: "",
    width: 120,
    note: "",
    ...overrides,
  };
}

describe("isSplitField", () => {
  it("空字段 / 没勾开关且没 dataset_map → 不是分套依据", () => {
    expect(isSplitField(undefined)).toBe(false);
    expect(isSplitField(null)).toBe(false);
    expect(isSplitField(field({}))).toBe(false);
    expect(isSplitField(field({ dataset_map: {} }))).toBe(false);
  });

  it("勾了 split 或 dataset_map 非空 → 是分套依据", () => {
    expect(isSplitField(field({ split: true }))).toBe(true);
    expect(isSplitField(field({ dataset_map: { 拼多多: 15 } }))).toBe(true);
  });
});

describe("splitKeysOf", () => {
  it("优先用 dataset_map 的键，否则退回选项值（过滤空值）", () => {
    expect(splitKeysOf(field({ dataset_map: { 拼多多: 15, 天猫: 21 } }))).toEqual(["拼多多", "天猫"]);
    expect(splitKeysOf(field({ options: [{ v: "A", t: "A" }, { v: "", t: "空" }] }))).toEqual(["A"]);
    expect(splitKeysOf(null)).toEqual([]);
  });
});

describe("findSplitField", () => {
  it("返回第一个分套依据字段", () => {
    const fields = [field({ id: "a" }), field({ id: "b", split: true }), field({ id: "c", split: true })];
    expect(findSplitField(fields)?.id).toBe("b");
    expect(findSplitField([])).toBeNull();
    expect(findSplitField(undefined)).toBeNull();
  });
});

describe("filterWithFields", () => {
  it("删掉分套依据 → 顺手清空 fields_map", () => {
    const before = { fields: [field({ split: true })], inline: true, fields_map: { 拼多多: [] } };
    const next = filterWithFields(before, [field({ id: "date", type: "date" })]);
    expect(next.fields_map).toEqual({});
    expect(next.fields).toHaveLength(1);
  });

  it("还保留分套依据 → fields_map 不动", () => {
    const map = { 拼多多: [] };
    const before = { fields: [field({ split: true })], inline: true, fields_map: map };
    const next = filterWithFields(before, [field({ split: true })]);
    expect(next.fields_map).toBe(map);
  });

  it("原本就没有分套 → 新字段里也不用清理", () => {
    const next = filterWithFields(undefined, [field({})]);
    expect(next.inline).toBe(true);
    expect(next.fields_map).toBeUndefined();
  });
});
