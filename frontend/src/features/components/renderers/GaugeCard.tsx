/** 仪表盘 —— 单个聚合值 + 目标刻度（最大值由后端按数量级取整，面板 y_max 可覆盖） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import { chartOf, formatAxis, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

export default function GaugeCard({ payload, ui, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const value = Number(payload.gauge_value ?? 0);
  const max = Number(payload.max ?? 0) > 0 ? Number(payload.max) : Math.max(value * 1.2, 100);
  const unit = payload.unit || "";

  const option = {
    animation: ui.animate,
    animationDuration: 520,
    animationEasing: "cubicOut",
    series: [{
      type: "gauge",
      startAngle: 210,
      endAngle: -30,
      min: 0,
      max,
      splitNumber: 5,
      radius: compact ? "92%" : "82%",
      center: ["50%", compact ? "58%" : "56%"],
      progress: { show: true, width: compact ? 8 : 12, itemStyle: { color: token.main } },
      axisLine: { lineStyle: { width: compact ? 8 : 12, color: [[1, "rgba(148,163,184,0.16)"]] } },
      pointer: { width: compact ? 3 : 4, length: "62%", itemStyle: { color: token.main } },
      axisTick: { show: false },
      splitLine: { length: compact ? 6 : 9, lineStyle: { color: "#E2E8F0", width: 1 } },
      axisLabel: {
        show: !compact,
        distance: 14,
        fontSize: 10,
        color: "#94A3B8",
        formatter: (number: number) => formatAxis(number, opts),
      },
      anchor: { show: true, size: compact ? 8 : 10, itemStyle: { color: token.main } },
      title: { show: false },
      detail: {
        valueAnimation: true,
        offsetCenter: [0, "44%"],
        fontSize: compact ? 16 : 26,
        fontWeight: 700,
        color: "#0F172A",
        formatter: () => `${formatValue(value, payload.compute, opts)}${unit}`,
      },
      data: [{ value }],
    }],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "仪表盘"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (payload.subtitle || payload.metric_label || undefined)}
    >
      {Number.isFinite(value) ? (
        <ReactEChartsCore
          option={option}
          notMerge
          lazyUpdate
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      ) : (
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      )}
    </CardShell>
  );
}
