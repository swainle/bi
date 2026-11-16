import { describe, expect, it } from "vitest";

import { chartOf, computeOf, formatAxis, formatValue } from "../skin/format";

describe("computeOf / chartOf 默认值", () => {
  it("缺省值完整，且传入的字段覆盖默认", () => {
    const compute = computeOf({ decimals: 2 });
    expect(compute.format).toBe("int");
    expect(compute.decimals).toBe(2);
    expect(chartOf(null).label_format).toBe("auto");
    expect(chartOf({ ...chartOf(), label_format: "w" }).bar_width).toBe(26);
  });
});

describe("formatValue", () => {
  it("占比换算强制百分比，忽略万格式", () => {
    expect(formatValue(12.34, { transform: "share", decimals: 2, format: "w" })).toBe("12.34%");
    expect(formatValue(12.34, { transform: "share" })).toBe("12.3%");
  });

  it("金额：一万以下两位小数，一万以上按万", () => {
    expect(formatValue(1234, { format: "money" })).toBe("¥1,234.00");
    expect(formatValue(12345, { format: "money" })).toBe("¥1.23万");
  });

  it("万 / k / 百分比格式", () => {
    expect(formatValue(12345, { format: "w", decimals: 1 })).toBe("1.2万");
    expect(formatValue(12345, { decimals: 1 }, { label_format: "k" })).toBe("12.3k");
    expect(formatValue(56.7, {}, { label_format: "pct" })).toBe("56.7%");
  });

  it("前后缀只加一次，text/date 不套千分位", () => {
    expect(formatValue(1200, { prefix: "≈", suffix: " 元" })).toBe("≈1,200 元");
    expect(formatValue(20260101, { format: "date" })).toBe("20260101");
    expect(formatValue(88, { format: "text", suffix: "分" })).toBe("88分");
  });

  it("整数默认跟随图表标签格式，否则千分位", () => {
    expect(formatValue(1234567)).toBe("1,234,567");
    expect(formatValue(1500, {}, { label_format: "k" })).toBe("1.5k");
  });
});

describe("formatAxis", () => {
  it("轴标签保持简洁（万 / 百分比 / 大数 k）", () => {
    expect(formatAxis(12345, { label_format: "w" })).toBe("1.2万");
    expect(formatAxis(50, { label_format: "pct" })).toBe("50%");
    expect(formatAxis(15000, { label_format: "k" })).toBe("15k");
    expect(formatAxis(1200, { label_format: "k" })).toBe("1,200");
    expect(formatAxis(1200)).toBe("1,200");
  });
});
