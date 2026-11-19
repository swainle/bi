/** 仪表盘 —— 单个聚合值 + 目标刻度（最大值由后端按数量级取整，面板 y_max 可覆盖） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import { chartOf, formatAxis, formatValue } from "../skin/format";
import { TIGHT_HEIGHT } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import type { RenderPayload, UiSpec } from "../types";

export default function GaugeCard({ payload, ui, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const value = Number(payload.gauge_value ?? 0);
  const max = Number(payload.max ?? 0) > 0 ? Number(payload.max) : Math.max(value * 1.2, 100);
  const unit = payload.unit || "";

  const text = `${formatValue(value, payload.compute, opts)}${unit}`;
  // 仪表盘半径按容器短边的一半算（ECharts 口径），数字必须装进圆环内圈：
  // 224×104 这种卡里，26px 的「151,880」比圆环还宽，会直接压在弧线上
  const short = Math.min(box.w || 320, box.h || 200);
  const ringWidth = compact ? 8 : short < 140 ? 9 : 12;
  const radiusPx = (compact ? 0.92 : 0.82) * (short / 2);
  const innerWidth = Math.max(24, 2 * radiusPx - 2 * ringWidth);
  const detailFont = Math.max(10, Math.min(
    compact ? 16 : 26,
    Math.round((innerWidth * 0.92) / (Math.max(3, text.length) * 0.6)),
  ));
  // 图体太矮（224×104 这类卡）：圆环和刻度都没地方放，退化成一行大数字，别画一个看不清的半圆
  const tiny = box.h > 0 && box.h < TIGHT_HEIGHT;

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
      progress: { show: true, width: ringWidth, itemStyle: { color: token.main } },
      axisLine: { lineStyle: { width: ringWidth, color: [[1, "rgba(148,163,184,0.16)"]] } },
      pointer: { width: compact ? 3 : 4, length: "62%", itemStyle: { color: token.main } },
      axisTick: { show: false },
      splitLine: { length: compact ? 6 : 9, lineStyle: { color: "#E2E8F0", width: 1 } },
      axisLabel: {
        show: !compact && short >= 140,
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
        fontSize: detailFont,
        fontWeight: 700,
        color: "#0F172A",
        formatter: () => text,
      },
      data: [{ value }],
    }],
  };

  if (tiny && !compact) {
    return (
      <CardShell
        compact={compact}
        title={payload.title || "仪表盘"}
        accent={token.main}
        hideTitle={opts.show_title === false}
        meta={opts.show_meta === false ? undefined : (payload.subtitle || payload.metric_label || undefined)}
      >
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", minHeight: 0 }}>
          <Box component="span" sx={{
            fontSize: Math.min(26, Math.max(15, box.h * 0.52)),
            fontWeight: 700, color: "#0F172A", lineHeight: 1,
            fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
          }}>
            {text}
          </Box>
        </Box>
      </CardShell>
    );
  }

  return (
    <CardShell
      compact={compact}
      title={payload.title || "仪表盘"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (payload.subtitle || payload.metric_label || undefined)}
    >
      {Number.isFinite(value) ? (
        <Box ref={boxRef} sx={{ width: "100%", height: "100%" }}>
          <ReactEChartsCore
            option={option}
            notMerge
            style={{ width: "100%", height: "100%" }}
            opts={{ renderer: "canvas" }}
          />
        </Box>
      ) : (
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      )}
    </CardShell>
  );
}
