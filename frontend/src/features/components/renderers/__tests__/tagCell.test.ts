/** 明细表「标签」单元格的分隔与着色 */

import { describe, expect, it } from "vitest";
import { DEFAULT_TAG_INK, splitTags, tagInk, tint } from "../TagCell";

describe("splitTags：切分标签", () => {
  it("没设分隔符时按常见分隔符切", () => {
    expect(splitTags("人气,相关")).toEqual(["人气", "相关"]);
    expect(splitTags("人气，相关、热销|新品")).toEqual(["人气", "相关", "热销", "新品"]);
  });

  it("设了分隔符就只按它切", () => {
    expect(splitTags("榴莲千层(Mini Katoa) 盒装", "(")).toEqual(["榴莲千层", "Mini Katoa) 盒装"]);
    expect(splitTags("A,B、C", ",")).toEqual(["A", "B、C"]);
  });

  it("去空格、丢空段", () => {
    expect(splitTags("  人气 , , 相关  ")).toEqual(["人气", "相关"]);
    expect(splitTags("")).toEqual([]);
    expect(splitTags("   ")).toEqual([]);
  });
});

describe("tint：胶囊底色", () => {
  it("#RRGGBB 加 10% 透明度", () => {
    expect(tint("#E11D48")).toBe("#E11D481A");
  });

  it("#RGB 先展开成 #RRGGBB", () => {
    expect(tint("#f00")).toBe("#ff00001A");
  });

  it("非法颜色回落到默认蓝", () => {
    expect(tint("red")).toBe("#2563EB1A");
    expect(tint("")).toBe("#2563EB1A");
  });
});

describe("tagInk：按值配色 → 列统一色 → 默认色", () => {
  it("命中「按值配色」就用它", () => {
    expect(tagInk("人气", "#10B981", { "人气": "#E11D48" })).toBe("#E11D48");
  });

  it("没命中的用默认色（列上设了统一色就用统一色）", () => {
    expect(tagInk("相关", "#10B981", { "人气": "#E11D48" })).toBe("#10B981");
    expect(tagInk("相关")).toBe(DEFAULT_TAG_INK);
    expect(tagInk("相关", "", { "1": "#E11D48" })).toBe(DEFAULT_TAG_INK);
  });

  it("映射里是非法颜色时忽略它", () => {
    expect(tagInk("人气", "#10B981", { "人气": "red" })).toBe("#10B981");
  });
});
