/** 折线 / 面积图 —— 平滑曲线 + 渐变填充 + 白环节点（参考「销量走势」） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { AXIS, TEXT, TOOLTIP } from "../skin/tokens";
import { fitChart } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import { chartOf, formatAxis } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  area?: boolean;
}

export default function LineCard({ payload, ui, area, compact }: Props & { compact?: boolean }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const series = payload.series ?? [];
  const names = series.map((s) => String(s.name ?? ""));
  const values = series.map((s) => Number(s.value ?? 0));

  if (!series.length) {
    return (
      <CardShell title={payload.title || "趋势"} accent={token.main} hideTitle={opts.show_title === false}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  const option = {
    animation: ui.animate,
    animationDuration: 520,
    grid: { left: 4, right: 14, top: 22, bottom: 4, containLabel: true },
    tooltip: { trigger: "axis", ...TOOLTIP },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: names,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: AXIS.line } },
      axisLabel: { ...AXIS.label, show: !compact, hideOverlap: true, rotate: opts.label_rotate },
      name: opts.x_title || undefined,
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
    },
    yAxis: {
      type: "value",
      axisTick: { show: false },
      axisLine: { show: false },
      min: opts.y_min ?? undefined,
      max: opts.y_max ?? undefined,
      axisLabel: { ...AXIS.label, show: !compact, formatter: (v: number) => formatAxis(v, opts) },
      splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
      name: opts.y_title || undefined,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
    },
    series: [{
      type: "line",
      data: values,
      smooth: opts.smooth ? 0.35 : false,
      showSymbol: values.length <= 24,
      symbol: "circle",
      symbolSize: 6,
      lineStyle: { width: 2, color: token.main },
      itemStyle: { color: "#fff", borderColor: token.main, borderWidth: 2 },
      areaStyle: area ? {
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: `${token.main}33` },
            { offset: 1, color: `${token.main}00` },
          ],
        },
      } : undefined,
    }],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "趋势"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={chartShowMeta(payload) ? (payload.subtitle || payload.metric_label || undefined) : undefined}
    >
      <Box ref={boxRef} sx={{ width: "100%", height: "100%" }}>
        <ReactEChartsCore
          option={fitChart(option, box)}
          notMerge
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </Box>
    </CardShell>
  );
}

/** 右上说明：优先显示手填的「右上说明」，并受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}
