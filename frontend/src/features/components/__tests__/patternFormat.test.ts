/** 明细表列格式串：解析与排版（`,.1%` / `,.2f` / `,d` / `+,.1%` / `$,.1f` 等） */

import { describe, expect, it } from "vitest";
import { COLUMN_FORMATS, formatByPattern, parseFormat, sampleOf } from "../skin/patternFormat";

describe("内置格式串", () => {
  it("就是面板里列的这 9 个", () => {
    expect([...COLUMN_FORMATS]).toEqual([
      ",.1%", ",.2%", ",.1f", ",.2f", ",.3f", ",d", "+,.1%", "+,.2%", "$,.1f",
    ]);
  });

  it("每个内置串都能解析", () => {
    for (const pattern of COLUMN_FORMATS) {
      expect(parseFormat(pattern), pattern).not.toBeNull();
    }
  });
});

describe("百分比", () => {
  it("比例值（<=1）先 ×100", () => {
    expect(formatByPattern(0.1234, ",.1%")).toBe("12.3%");
    expect(formatByPattern(0.1234, ",.2%")).toBe("12.34%");
  });

  it("已经是百分数的值不再乘 100", () => {
    expect(formatByPattern(12.34, ",.1%")).toBe("12.3%");
  });

  it("带正号时负值仍保留负号", () => {
    expect(formatByPattern(0.1234, "+,.1%")).toBe("+12.3%");
    expect(formatByPattern(-0.1234, "+,.1%")).toBe("-12.3%");
  });
});

describe("小数与千分位", () => {
  it("定点小数按位数四舍五入，并带千分位", () => {
    expect(formatByPattern(1234.56, ",.1f")).toBe("1,234.6");
    expect(formatByPattern(1234.56, ",.2f")).toBe("1,234.56");
    expect(formatByPattern(1234.5678, ",.3f")).toBe("1,234.568");
  });

  it("整数格式不带小数", () => {
    expect(formatByPattern(1234.56, ",d")).toBe("1,235");
    expect(formatByPattern(0, ",d")).toBe("0");
  });

  it("货币串加 $ 前缀", () => {
    expect(formatByPattern(1234.56, "$,.1f")).toBe("$1,234.6");
  });
});

describe("解析与回落", () => {
  it("空串 / 旧枚举 / 乱写都返回 null（调用方回落整表格式）", () => {
    for (const pattern of ["", "int", "w", "pct", "money", "date", "text", "万", ",", "+", "abc"]) {
      expect(formatByPattern(1, pattern), pattern).toBeNull();
    }
  });

  it("解析出的结构对得上", () => {
    expect(parseFormat("+,.2%")).toEqual({ plus: true, currency: false, group: true, decimals: 2, kind: "%" });
    expect(parseFormat("$,.1f")).toEqual({ plus: false, currency: true, group: true, decimals: 1, kind: "f" });
    expect(parseFormat(",d")).toMatchObject({ decimals: 0, kind: "d", group: true });
  });

  it("下拉样例：百分比用 0.1234，其它用 1234.56", () => {
    expect(sampleOf(",.1%")).toBe("12.3%");
    expect(sampleOf(",d")).toBe("1,235");
    expect(sampleOf("$,.1f")).toBe("$1,234.6");
  });
});
