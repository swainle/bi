/** 雷达图 —— 每个轴一个维度值，单指标画成轮廓（对比多个类目的强弱） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT, TOOLTIP } from "../skin/tokens";
import { fitChart } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import { chartOf } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

function niceMax(value: number): number {
  if (value <= 0) return 100;
  const exp = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / exp) * exp;
}

export default function RadarCard({ payload, ui, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const series = (payload.series ?? [])
    .map((point) => ({ name: String(point.name ?? ""), value: Number(point.value ?? 0) }))
    .filter((point) => point.value > 0);

  if (series.length < 3) {
    return (
      <CardShell compact={compact} title={payload.title || "雷达图"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>
          {series.length ? "至少需要 3 个维度" : "暂无数据"}
        </Box>
      </CardShell>
    );
  }

  const max = niceMax(Math.max(...series.map((point) => point.value)));
  const option = {
    animation: ui.animate,
    animationDuration: 480,
    animationEasing: "cubicOut",
    tooltip: { trigger: "item", ...TOOLTIP },
    radar: {
      indicator: series.map((point) => ({
        name: point.name.length > 8 ? `${point.name.slice(0, 8)}…` : point.name,
        max,
      })),
      radius: compact ? "64%" : "66%",
      center: ["50%", compact ? "52%" : "55%"],
      splitNumber: 4,
      axisName: { fontSize: compact ? 9 : 11, color: "#64748B" },
      axisLine: { lineStyle: { color: "#E8EEF8" } },
      splitLine: { lineStyle: { color: "#E8EEF8" } },
      splitArea: { areaStyle: { color: ["rgba(99,102,241,0.03)", "rgba(99,102,241,0.06)"] } },
    },
    series: [{
      type: "radar",
      symbolSize: compact ? 3 : 4,
      lineStyle: { color: token.main, width: 2 },
      itemStyle: { color: token.main },
      areaStyle: { color: token.soft },
      data: [{
        name: payload.metric_label || payload.title || "指标",
        value: series.map((point) => point.value),
      }],
    }],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "雷达图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (payload.subtitle || undefined)}
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
