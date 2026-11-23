/** 饼图/环形图的 ECharts option —— 抽成纯函数，便于单测与复用 */

import { DONUT, TOOLTIP } from "./tokens";
import type { ChartSpec, ComputeSpec } from "../types";

export interface PiePoint { name: string; value: number }

interface BuildArgs {
  series: PiePoint[];
  chart: ChartSpec;
  compute: ComputeSpec;
  accent: string;
  animate: boolean;
  donut?: boolean;
}

function labelText(mode: string, name: string, value: number, percent: number, decimals: number, slot = "v"): string {
  const pct = `${percent.toFixed(decimals)}%`;
  switch (mode) {
    case "pct": return `{${slot}|${pct}}`;
    case "name": return name;
    case "value": return value.toLocaleString("zh-CN");
    case "none": return "";
    default: return `{n|${name}}\n{${slot}|${pct}}`;
  }
}

export function buildPieOption({ series, chart, compute, accent, animate, donut }: BuildArgs) {
  const total = series.reduce((sum, s) => sum + Number(s.value ?? 0), 0) || 1;
  // 内径 0 = 实心饼；其余按 10–78% 收敛
  const innerPct = donut === false ? 0 : Math.max(0, Math.min(78, chart.pie_inner));
  const inner = innerPct === 0 ? "0%" : `${Math.max(10, innerPct)}%`;
  const decimals = compute.decimals ?? 0;
  const labelMode = chart.show_labels ? chart.pie_label : "none";
  const layout = chart.label_layout || "inside";
  const beside = layout === "beside";      // 紧贴图形外缘、无引导线
  const farOutside = layout === "outside"; // 离边缘远、带引导线
  const outside = beside || farOutside;
  const single = chart.single_slice && series.length === 1;
  const showLegend = chart.show_legend && labelMode === "none";

  return {
    total,
    option: {
      animation: animate,
      animationDuration: 520,
      color: DONUT,
      tooltip: { trigger: "item", ...TOOLTIP },
      legend: {
        show: showLegend,
        orient: series.length > 6 ? "vertical" : "horizontal",
        bottom: series.length > 6 ? 8 : 2,
        right: series.length > 6 ? 8 : undefined,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { fontSize: 10.5, color: "#94A3B8" },
      },
      series: [{
        type: "pie",
        radius: [inner, chart.pie_rose ? "78%" : "72%"],
        center: ["50%", "50%"],
        roseType: chart.pie_rose ? "radius" : undefined,
        startAngle: chart.pie_start,
        avoidLabelOverlap: true,
        padAngle: chart.pie_gap ? 1.2 : 0,
        itemStyle: {
          borderColor: "#fff",
          borderWidth: chart.pie_gap ? 2 : 0,
          borderRadius: chart.pie_gap ? 4 : 0,
        },
        label: {
          show: labelMode !== "none",
          position: single ? "center" : outside ? "outside" : "inside",
          /* 图形旁贴边（2px）、图形外明显离边（26px，再叠加引导线） */
          distance: beside ? 10 : farOutside ? 30 : 6,
          formatter: (p: { name: string; value: number; percent: number; dataIndex: number }) => {
            /* 百分比颜色跟随扇区：rich 里的 v0…vN 对应 DONUT 调色板，dataIndex 与配色同序 */
            const slot = `v${(p.dataIndex ?? 0) % DONUT.length}`;
            if (single) return `{n|${p.name}}\n{v|100%}`;
            return labelText(labelMode, p.name, p.value, p.percent, decimals, slot);
          },
          rich: {
            n: { fontSize: 11, color: "#64748B", lineHeight: 16 },
            v: { fontSize: 12, fontWeight: 700, color: accent, lineHeight: 16 },
            ...Object.fromEntries(DONUT.map((color, index) => [
              `v${index}`,
              { fontSize: 12, fontWeight: 700, color, lineHeight: 16 },
            ])),
          },
          fontSize: outside ? 10 : 11,
          color: "#475569",
        },
        // 图形旁 = 标签贴边，不画引导线；图形外 = 离边远、用折线引出来
        labelLine: {
          show: farOutside && !single && labelMode !== "none",
          length: 34, length2: 22,
          smooth: true, lineStyle: { color: "#CBD5E1" },
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        data: series.map((s) => ({ name: String(s.name), value: Number(s.value ?? 0) })),
      }],
    },
    totalValue: total,
  };
}
