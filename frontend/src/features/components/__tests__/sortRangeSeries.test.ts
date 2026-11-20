import { describe, expect, it } from "vitest";
import { sortRangeSeries } from "../renderers/sortRangeSeries";

describe("柱状图数字区间排序", () => {
  it("按区间升序，整条数据一起移动，不修改输入", () => {
    const series = [
      { name: ">60", value: 600 }, { name: "15-21", value: 150 },
      { name: "1-7", value: 10 }, { name: "57-60", value: 570 }, { name: "8-14", value: 80 },
    ];
    expect(sortRangeSeries(series)).toEqual([series[2], series[4], series[1], series[3], series[0]]);
    expect(series[0]).toEqual({ name: ">60", value: 600 });
  });

  it("支持不同分隔符、空白、负数和小数", () => {
    const series = [" 8 ～ 14 ", "0.5~7.5", "-7--1", "15–21", "22—28"].map((name) => ({ name }));
    expect(sortRangeSeries(series)).toEqual([series[2], series[1], series[0], series[3], series[4]]);
  });

  it("上限区间在前，下限区间按边界排列，相同下界按上界排列", () => {
    const series = [">=60", "≤0", "1-7", ">60", "<0", "1-5", "≥90", "<=-1"]
      .map((name) => ({ name }));
    expect(sortRangeSeries(series).map(({ name }) => name))
      .toEqual(["<=-1", "≤0", "<0", "1-5", "1-7", ">=60", ">60", "≥90"]);
  });

  it.each(["其他", "2026-11-20", "14-8", "商品1-7"])("混有 %s 时保留原顺序", (name) => {
    const series = [{ name: "8-14" }, { name }, { name: "1-7" }];
    expect(sortRangeSeries(series)).toBe(series);
  });

  it.each(["", "  ", null, undefined])("空分类 %s 不阻止区间排序，整条数据保留在最后", (name) => {
    const series = [
      { name, value: 768 }, { name: "22-28", value: 342 },
      { name: "15-21", value: 75 }, { name: "1-7", value: 54 },
      { name: "8-14", value: 27 }, { name: ">60", value: 2 },
    ];
    expect(sortRangeSeries(series)).toEqual([series[3], series[4], series[2], series[1], series[5], series[0]]);
    expect(series[0]).toEqual({ name, value: 768 });
  });

  it("多个空分类保留相对顺序，缺少名称也按空分类处理", () => {
    const series = [{ value: 1 }, { name: "8-14", value: 2 }, { name: "", value: 3 }, { name: "1-7", value: 4 }];
    expect(sortRangeSeries(series)).toEqual([series[3], series[1], series[0], series[2]]);
  });

  it("全为空分类时保留原顺序", () => {
    expect(sortRangeSeries([])).toEqual([]);
    const series = [{ value: 1 }, { name: "", value: 2 }, { name: null, value: 3 }];
    expect(sortRangeSeries(series)).toBe(series);
  });
});
