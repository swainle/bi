/** 热力矩阵卡 —— 两个维度 × 一个指标，颜色越深越集中 */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
}

export default function HeatmapCard({ payload, ui, compact }: Props & { compact?: boolean }) {
  const token = accentOf(ui.accent);
  const matrix = payload.matrix;

  if (!matrix || !matrix.cells.length) {
    return (
      <CardShell compact={compact} title={payload.title || "矩阵"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 11.5, color: "#94A3B8" }}>
          暂无数据
        </Box>
      </CardShell>
    );
  }

  const option = {
    animation: ui.animate,
    animationDuration: 420,
    grid: { left: 8, right: 16, top: 10, bottom: 30, containLabel: true },
    tooltip: {
      confine: true,
      position: "top",
      borderWidth: 0,
      backgroundColor: "rgba(17,24,39,0.92)",
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: (p: { value: [number, number, number] }) =>
        `${matrix.xLabels[p.value[0]]} · ${matrix.yLabels[p.value[1]]}<br/><b>${p.value[2].toLocaleString("zh-CN")}</b>`,
    },
    xAxis: {
      type: "category",
      data: matrix.xLabels,
      splitArea: { show: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#E5EAF3" } },
      axisLabel: { show: !compact, fontSize: 11, color: "#64748B" },
    },
    yAxis: {
      type: "category",
      data: matrix.yLabels,
      splitArea: { show: true },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#E5EAF3" } },
      axisLabel: { fontSize: 11, color: "#64748B" },
    },
    visualMap: {
      min: 0,
      max: matrix.max || 1,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: -2,
      itemHeight: 70,
      itemWidth: 9,
      textStyle: { fontSize: 10, color: "#94A3B8" },
      inRange: { color: ["#EEF3FB", token.gradient[0], token.main] },
    },
    series: [
      {
        type: "heatmap",
        data: matrix.cells,
        label: { show: true, fontSize: 10, color: "#334155" },
        itemStyle: { borderColor: "#fff", borderWidth: 2, borderRadius: 4 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(15,23,42,0.18)" } },
      },
    ],
  };

  return (
    <CardShell compact={compact} title={payload.title || "矩阵"} accent={token.main}>
      <ReactEChartsCore option={option} notMerge lazyUpdate style={{ height: "100%", width: "100%" }} />
    </CardShell>
  );
}
