/** 漏斗图 —— 按层级从大到小逐层收窄，看每一层的量级与流失 */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { SERIES, TEXT, TOOLTIP } from "../skin/tokens";
import { TIGHT_HEIGHT, fitChart } from "../skin/CardFit";
import { useBoxSize } from "../skin/useBoxSize";
import { chartOf, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

export default function FunnelCard({ payload, ui, compact, onSliceClick }: { payload: RenderPayload; ui: UiSpec; compact?: boolean; onSliceClick?: (name: string) => void }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const series = (payload.series ?? [])
    .map((point) => ({ name: String(point.name ?? ""), value: Number(point.value ?? 0) }))
    .filter((point) => point.value > 0);

  if (!series.length) {
    return (
      <CardShell compact={compact} title={payload.title || "漏斗图"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  // 图体太矮时：去掉上下留白、加粗最小尺寸，否则漏斗会被压成一条线
  const tall = box.h > 0 && box.h < TIGHT_HEIGHT;
  const showLegend = opts.show_legend && !compact && !tall;
  const option = {
    animation: ui.animate,
    animationDuration: 480,
    animationEasing: "cubicOut",
    tooltip: { trigger: "item", ...TOOLTIP },
    legend: {
      show: showLegend,
      bottom: 0,
      itemWidth: 8,
      itemHeight: 8,
      icon: "circle",
      textStyle: { fontSize: 10.5, color: "#94A3B8" },
    },
    series: [{
      type: "funnel",
      left: compact ? "4%" : "8%",
      right: compact ? "4%" : "8%",
      top: tall ? 0 : (compact ? 6 : 16),
      bottom: tall ? 0 : (showLegend ? 28 : (compact ? 6 : 12)),
      minSize: tall ? "45%" : "18%",
      maxSize: "100%",
      sort: "descending",
      gap: tall ? 1 : 2,
      label: {
        show: opts.show_labels !== false && !compact,
        position: "inside",
        color: "#fff",
        fontSize: 11.5,
        formatter: (item: { name?: string; value?: number }) =>
          `${item.name ?? ""}  ${formatValue(Number(item.value ?? 0), payload.compute, opts)}`,
      },
      labelLine: { show: false },
      itemStyle: { borderWidth: 0, borderRadius: 4 },
      emphasis: { label: { fontSize: 13, fontWeight: 600 } },
      data: series.map((point, index) => ({
        ...point,
        itemStyle: { color: SERIES[index % SERIES.length] },
      })),
    }],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "漏斗图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (payload.subtitle || undefined)}
    >
      <Box ref={boxRef} sx={{ width: "100%", height: "100%" }}>
        <ReactEChartsCore
          option={fitChart(option, box)}
          onEvents={{ click: (params: { name?: string }) => onSliceClick?.(String(params?.name ?? "")) }}
          notMerge
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
        />
      </Box>
    </CardShell>
  );
}
