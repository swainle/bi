/** 环形图 / 饼图 —— 内径、起始角、标签内容、块间隔、图例都可配置 */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import { fitChart } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import { chartOf, computeOf } from "../skin/format";
import { buildPieOption } from "../skin/pieOption";
import type { RenderPayload, UiSpec } from "../types";

export default function PieCard({ payload, ui, donut, compact, onSliceClick, onTopList }: { payload: RenderPayload; ui: UiSpec; donut?: boolean; compact?: boolean; onSliceClick?: (name: string) => void; onTopList?: (name?: string) => void }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const compute = computeOf(payload.compute);
  const series = payload.series ?? [];
  const isDonut = donut ?? opts.pie_inner > 0;

  if (!series.length) {
    return (
      <CardShell compact={compact} title={payload.title || "占比"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  const { option, totalValue } = buildPieOption({
    series: series.map((x) => ({ name: String(x.name), value: Number(x.value ?? 0) })),
    chart: compact ? { ...opts, show_labels: false, show_legend: false } : opts,
    compute, accent: token.main, animate: ui.animate,
    donut: donut ?? (opts.pie_inner > 0),
  });

  return (
    <CardShell
      compact={compact}
      title={payload.title || "占比"}
      accent={token.main}
      meta={chartShowMeta(payload)
        ? (payload.subtitle || (payload.top_share ? `TOP1 ${(payload.top_share * 100).toFixed(1)}%` : undefined))
        : undefined}
    >
      <Box ref={boxRef} sx={{ width: "100%", height: "100%" }}>
        <ReactEChartsCore
          option={fitChart(option, box)}
          onEvents={{ click: (params: { name?: string }) => { if (onTopList) onTopList(String(params?.name ?? "")); else onSliceClick?.(String(params?.name ?? "")); } }}
          notMerge
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </Box>
      <span style={{ display: "none" }}>{totalValue}</span>
    </CardShell>
  );
}

/** 右上说明：优先显示手填的「右上说明」，并受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}
