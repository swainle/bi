/** 瀑布图 —— 每一项从上一项的累计位置起跳，看对总量的贡献 */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { AXIS, TEXT, TOOLTIP } from "../skin/tokens";
import { chartOf, formatAxis, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

export default function WaterfallCard({ payload, ui, compact, onSliceClick }: { payload: RenderPayload; ui: UiSpec; compact?: boolean; onSliceClick?: (name: string) => void }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const rows = (payload.series ?? []).map((point) => ({
    name: String(point.name ?? ""),
    value: Number(point.value ?? 0),
  }));

  if (!rows.length) {
    return (
      <CardShell compact={compact} title={payload.title || "瀑布图"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  const placeholders: number[] = [];
  const values: number[] = [];
  const colors: string[] = [];
  const totals: number[] = [];
  let running = 0;
  rows.forEach((row) => {
    const start = running;
    const end = running + row.value;
    placeholders.push(Math.min(start, end));
    values.push(Math.abs(row.value));
    colors.push(row.value >= 0 ? token.main : "#F43F5E");
    running = end;
    totals.push(end);
  });

  const option = {
    animation: ui.animate,
    animationDuration: 480,
    animationEasing: "cubicOut",
    grid: {
      left: 4, right: 12, top: compact ? 10 : 26,
      bottom: 4, containLabel: !compact,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      ...TOOLTIP,
      formatter: (params: Array<{ dataIndex: number }>) => {
        const index = params?.[0]?.dataIndex ?? 0;
        const row = rows[index];
        const signed = `${row.value >= 0 ? "+" : ""}${formatValue(row.value, payload.compute, opts)}`;
        return `${row.name}<br/>贡献 ${signed}<br/>累计 ${formatValue(totals[index], payload.compute, opts)}`;
      },
    },
    xAxis: {
      type: "category",
      data: rows.map((row) => row.name),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS.line } },
      axisLabel: {
        ...AXIS.label,
        show: !compact,
        interval: 0,
        hideOverlap: true,
        formatter: (value: string) => (value.length > 6 ? `${value.slice(0, 6)}…` : value),
      },
    },
    yAxis: {
      type: "value",
      axisTick: { show: false },
      axisLine: { show: false },
      min: opts.y_min ?? undefined,
      max: opts.y_max ?? undefined,
      axisLabel: { ...AXIS.label, show: !compact, formatter: (value: number) => formatAxis(value, opts) },
      splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
    },
    series: [
      {
        name: "placeholder",
        type: "bar",
        stack: "total",
        silent: true,
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        data: placeholders,
      },
      {
        name: "贡献",
        type: "bar",
        stack: "total",
        barMaxWidth: opts.bar_width,
        itemStyle: { borderRadius: [4, 4, 0, 0] },
        label: {
          show: opts.show_labels !== false && !compact,
          position: "top",
          fontSize: 10.5,
          color: "#475569",
          formatter: (item: { dataIndex: number }) => {
            const row = rows[item.dataIndex];
            return `${row.value >= 0 ? "+" : ""}${formatValue(row.value, payload.compute, opts)}`;
          },
        },
        data: values.map((value, index) => ({ value, itemStyle: { color: colors[index] } })),
      },
    ],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "瀑布图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (payload.subtitle || undefined)}
    >
      <ReactEChartsCore
        option={option}
        onEvents={{ click: (params: { name?: string }) => onSliceClick?.(String(params?.name ?? "")) }}
        notMerge
        lazyUpdate
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
      />
    </CardShell>
  );
}
