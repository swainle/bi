/** 散点提示框的行拼装：顺序 / 去重 / 附加字段 / 象限机会分 */

import { describe, expect, it } from "vitest";
import { scatterTipLines } from "../skin/scatterTip";

const base = {
  xLabel: "popularity",
  yLabel: "supply_demand",
  sizeKey: "item_conversion",
  xKey: "popularity",
  yKey: "supply_demand",
  format: (v: number) => String(v),
  quadLabel: (q?: string) => ({ blue: "蓝海区", red: "红海区", pot: "潜力区", drop: "放弃区" }[q ?? ""] ?? ""),
};

describe("scatterTipLines：提示框内容", () => {
  it("顺序：名称 → X → Y → 气泡 → 附加字段 → 象限·机会分", () => {
    const lines = scatterTipLines({
      name: "冻干猫", x: 4807677, y: 10.72, sizeValue: 0.25, score: 38, quad: "blue",
      extras: [{ label: "转化率", key: "item_conversion", value: 0.25 }],
    }, base);
    expect(lines).toEqual([
      "<b>冻干猫</b>",
      "popularity：4807677",
      "supply_demand：10.72",
      "item_conversion：0.25",
      "转化率：0.25",
      "蓝海区 · 机会分 38",
    ]);
  });

  it("气泡字段和轴是同一列时不重复显示", () => {
    const lines = scatterTipLines({ name: "猫条", x: 6640000, y: 0, sizeValue: 6640000, score: 75, quad: "red" },
      { ...base, sizeKey: "popularity" });
    expect(lines.filter((line) => line.startsWith("popularity"))).toEqual(["popularity：6640000"]);
    expect(lines).toContain("红海区 · 机会分 75");
  });

  it("没绑气泡 / 没附加字段 / 没象限时也正常", () => {
    const lines = scatterTipLines({ name: "A", x: 1, y: 2 }, { ...base, sizeKey: undefined });
    expect(lines).toEqual(["<b>A</b>", "popularity：1", "supply_demand：2"]);
  });
});
