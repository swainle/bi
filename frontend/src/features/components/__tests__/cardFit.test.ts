import { describe, expect, it } from "vitest";

import { NARROW_WIDTH, TIGHT_HEIGHT, cardFit, fitChart } from "../skin/CardFit";

/** 取一份典型柱状图的 option（够用即可，只验证收敛行为） */
// 用宽松类型：这里断言的是「运行时收敛结果」，不需要被 ECharts option 的具体类型约束
function barOption(): any {
  return {
    grid: { left: 4, right: 12, top: 26, bottom: 4, containLabel: true },
    legend: { show: true, data: ["A", "B"] },
    xAxis: { type: "category", data: ["甲", "乙", "丙"], axisLabel: { show: true, rotate: 24 } },
    yAxis: { type: "value", axisLabel: { show: true }, splitLine: { show: true } },
    series: [{ type: "bar", data: [1, 2, 3], label: { show: true, position: "top" } }],
  };
}

describe("cardFit 口径", () => {
  it("按图体尺寸判定 tight / narrow，未测量时一律宽松", () => {
    const unmeasured = cardFit({ w: 0, h: 0 });
    expect(unmeasured.tight).toBe(false);
    expect(unmeasured.narrow).toBe(false);
    expect(unmeasured.slot(5)).toBe(999);

    expect(cardFit({ w: 190, h: TIGHT_HEIGHT - 1 }).tight).toBe(true);
    expect(cardFit({ w: 190, h: 200 }).tight).toBe(false);
    expect(cardFit({ w: NARROW_WIDTH - 1, h: 200 }).narrow).toBe(true);
    expect(cardFit({ w: 712, h: 340 }).narrow).toBe(false);
    expect(cardFit({ w: 190, h: 200 }).slot(10)).toBeCloseTo(17, 5);
  });
});

describe("fitChart", () => {
  it("宽松尺寸原样返回（不改变大卡观感）", () => {
    const option = barOption();
    expect(fitChart(option, { w: 712, h: 340 })).toBe(option);
  });

  it("图体太矮：轴、图例、数值标签、网格留白全部收敛，只留图形", () => {
    const fitted = fitChart(barOption(), { w: 190, h: 39 });
    expect(fitted.xAxis.axisLabel.show).toBe(false);
    expect(fitted.yAxis.axisLabel.show).toBe(false);
    expect(fitted.yAxis.splitLine.show).toBe(false);
    expect(fitted.legend.show).toBe(false);
    expect(fitted.series[0].label.show).toBe(false);
    expect(fitted.grid).toMatchObject({ top: 4, bottom: 4, left: 4, right: 8 });
  });

  it("窄但不矮：只做防重叠，类目标签仍然保留", () => {
    const fitted = fitChart(barOption(), { w: 300, h: 160 });
    expect(fitted.xAxis.axisLabel.show).toBe(true);
    expect(fitted.xAxis.axisLabel.hideOverlap).toBe(true);
    expect(fitted.legend.show).toBe(true);
  });

  it("窄卡里每格太挤时数值标签不画，够宽则保留", () => {
    const crowded = {
      ...barOption(),
      series: [{ type: "bar", data: Array.from({ length: 10 }, (_, i) => i), label: { show: true } }],
    };
    // 300 宽放 10 根 → 每根 28px，放不下「59,691」这种标签
    expect(fitChart(crowded, { w: 300, h: 160 }).series[0].label.show).toBe(false);

    const roomie = { ...barOption(), series: [{ type: "bar", data: [1, 2], label: { show: true } }] };
    expect(fitChart(roomie, { w: 300, h: 160 }).series[0].label.show).toBe(true);
  });

  it("不改动原 option（纯函数）", () => {
    const source = barOption();
    fitChart(source, { w: 190, h: 39 });
    expect(source.xAxis.axisLabel.show).toBe(true);
    expect(source.legend.show).toBe(true);
  });
});
