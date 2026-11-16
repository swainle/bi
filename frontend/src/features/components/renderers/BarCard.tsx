/** 柱状卡 —— 圆角柱 + 虚线网格 + 顶部数值（参考「价格带 × 日销量」） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { AXIS, SERIES, TEXT, TOOLTIP } from "../skin/tokens";
import { chartOf, formatAxis, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
}

export default function BarCard({ payload, ui, compact, onSliceClick }: Props & { compact?: boolean; onSliceClick?: (name: string) => void }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const compute = payload.compute;
  const series = payload.series ?? [];
  const names = series.map((s) => String(s.name ?? ""));
  const values = series.map((s) => Number(s.value ?? 0));
  const horizontal = names.some((n) => n.length > 10);

  if (!series.length) {
    return (
      <CardShell compact={compact} title={payload.title || "柱状图"} accent={token.main} hideTitle={opts.show_title === false}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  /** 分类轴标签旋转角度（长标签自动斜排），轴名间距要按旋转量让开 */
  const rotate = opts.label_rotate || (!horizontal && names.some((n) => n.length > 4) ? 24 : 0);
  /* 轴名只认手填的「X 轴标题」：留空 = 不显示 */
  const categoryName = opts.x_title || undefined;
  const categoryAxis = {
    type: "category",
    data: names,
    axisTick: { show: false },
    axisLine: { lineStyle: { color: AXIS.line } },
    axisLabel: {
      ...AXIS.label,
      show: !compact,
      interval: 0,
      hideOverlap: true,
      rotate,
      formatter: (v: string) => (v.length > 9 ? `${v.slice(0, 9)}…` : v),
    },
    /* 轴名：手填的轴标题优先，没填就自动显示绑定的字段名（横轴 = 分类字段） */
    name: categoryName,
    nameLocation: "middle",
    nameGap: rotate ? 46 : 26,
    nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
  };
  const valueAxis = {
    type: "value",
    axisTick: { show: false },
    axisLine: { show: false },
    min: opts.y_min ?? undefined,
    max: opts.y_max ?? undefined,
    axisLabel: { ...AXIS.label, show: !compact, formatter: (v: number) => formatAxis(v, opts) },
    splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
    name: opts.y_title || undefined,
    nameGap: 12,
    nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
  };

  const option = {
    animation: ui.animate,
    animationDuration: 480,
    animationEasing: "cubicOut",
    grid: {
      left: compact ? 4 : 4, right: 12, top: compact ? 10 : 26,
      bottom: compact ? 4 : (categoryName ? 20 : 4), containLabel: !compact,
    },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? categoryAxis : valueAxis,
    series: [{
      type: "bar",
      data: values,
      barMaxWidth: opts.bar_width,
      itemStyle: {
        borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
        color: {
          type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: SERIES[0] },
            { offset: 1, color: "rgba(59,130,246,0.72)" },
          ],
        },
      },
      labelLayout: { hideOverlap: true },
      label: {
        show: opts.show_labels && !compact && values.length <= 12,
        position: horizontal ? "right" : "top",
        fontSize: 11,
        fontWeight: 700,
        color: "#334155",
        formatter: (p: { value: number }) => formatValue(p.value, compute, opts),
      },
    }],
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "柱状图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={compact || opts.show_meta === false
        ? undefined
        : (payload.subtitle || payload.metric_label || undefined)}
    >
      <ReactEChartsCore
        option={option}
        onEvents={{ click: (params: { name?: string }) => onSliceClick?.(String(params?.name ?? "")) }}
        notMerge
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
      />
    </CardShell>
  );
}
