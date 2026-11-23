/** 组合图卡 —— 柱（体量）+ 线（质量）双轴，参考「价格带 × 日销量」 */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { AXIS, SERIES, TEXT, TOOLTIP } from "../skin/tokens";
import { chartOf, formatAxis, formatValue } from "../skin/format";
import { fitChart } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  /** 点柱/线弹出指定明细表（和环形图、指标卡徽标弹窗同一套） */
  onTopList?: (name?: string) => void;
}

export default function ComboCard({ payload, ui, compact, onTopList }: Props) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const series = (payload.series ?? []) as unknown as { name: string; bar: number; line: number }[];
  const barName = payload.bar_label || "柱";
  const lineName = payload.line_label || "线";

  if (!series.length) {
    return (
      <CardShell compact={compact} title={payload.title || "组合图"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  const names = series.map((s) => String(s.name ?? ""));
  const bars = series.map((s) => Number(s.bar ?? 0));
  const lines = series.map((s) => Number(s.line ?? 0));

  const option = {
    animation: ui.animate,
    animationDuration: 520,
    grid: { left: 4, right: compact ? 8 : 4, top: compact ? 8 : 34, bottom: 4, containLabel: !compact },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
    legend: {
      show: opts.show_legend && !compact,
      top: 0, right: 0, itemWidth: 9, itemHeight: 9, itemGap: 14,
      textStyle: { fontSize: 11, color: "#64748B" },
      data: [barName, lineName],
    },
    xAxis: {
      type: "category",
      data: names,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS.line } },
      axisLabel: { ...AXIS.label, show: !compact, hideOverlap: true, rotate: opts.label_rotate },
      name: opts.x_title || undefined,
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
    },
    yAxis: [
      {
        type: "value",
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { ...AXIS.label, show: !compact, formatter: (v: number) => formatAxis(v, opts) },
        splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
        name: opts.y_title || undefined,
        nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
      },
      {
        type: "value",
        show: !compact && !(box.w > 0 && box.w < 420),
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { ...AXIS.label, show: !compact && !(box.w > 0 && box.w < 420), formatter: (v: number) => formatAxis(v, opts) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: barName,
        type: "bar",
        data: bars,
        yAxisIndex: 0,
        barMaxWidth: Math.min(opts.bar_width, 40),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: "linear", x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: SERIES[0] }, { offset: 1, color: "rgba(59,130,246,0.65)" }],
          },
        },
        label: {
          show: opts.show_labels && !compact,
          position: "top", fontSize: 11, fontWeight: 700, color: "#334155",
          formatter: (p: { value: number }) => formatValue(p.value, payload.compute, opts),
        },
      },
      {
        name: lineName,
        type: "line",
        data: lines,
        yAxisIndex: payload.combo?.right_axis === false ? 0 : 1,
        smooth: opts.smooth,
        symbol: "circle",
        symbolSize: 7,
        showSymbol: !compact,
        lineStyle: { width: 2.4, color: token.main },
        itemStyle: { color: "#fff", borderColor: token.main, borderWidth: 2 },
      },
    ],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "组合图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={compact || opts.show_meta === false
        ? undefined
        : (payload.subtitle || payload.combo?.note || `柱 ${barName} · 线 ${lineName}`)}
    >
      <Box ref={boxRef} sx={{ width: "100%", height: "100%" }}>
        <ReactEChartsCore option={fitChart(option, box)} notMerge
          onEvents={onTopList ? { click: (params: { name?: string }) => onTopList(String(params?.name ?? "")) } : undefined}
          style={{ width: "100%", height: "100%" }} opts={{ renderer: "canvas" }} />
      </Box>
    </CardShell>
  );
}
