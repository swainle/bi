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
  onTopList?: (name?: string, column?: string) => void;
}

export default function ComboCard({ payload, ui, compact, onTopList }: Props) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const series = (payload.series ?? []) as unknown as { name: string; bar: number; line: number }[];
  const barName = payload.bar_label || "柱";
  const lineName = payload.line_label || "线";
  /** 右轴用自己那套格式（空 = 跟左轴） */
  const rightAxisFmt = (opts.y2_format || opts.label_format) as typeof opts.label_format;

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
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP,
      /* 提示框跟着「数值格式」走：柱按左Y格式、线按右Y格式，不再显示原始精度 */
      formatter: (items: { seriesName?: string; value?: number; marker?: string; axisValueLabel?: string }[]) => {
        if (!items?.length) return "";
        const head = `<div style="font-size:11px;color:#94A3B8;margin-bottom:4px">${items[0].axisValueLabel ?? ""}</div>`;
        const body = items.map((it) => {
          const right = it.seriesName === lineName;
          const fmt = right ? rightAxisFmt : opts.label_format;
          return `<div style="display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px">`
            + `${it.marker ?? ""}<span style="color:#CBD5E1">${it.seriesName ?? ""}</span>`
            + `<b style="margin-left:auto;color:#F8FAFC">${formatValue(Number(it.value ?? 0), payload.compute, { ...opts, label_format: fmt })}</b></div>`;
        }).join("");
        return head + body;
      },
    },
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
      /* 品牌名这类长类目：全部显示（不 hideOverlap），超长用省略号截断，靠 tooltip 看全名 */
      axisLabel: {
        ...AXIS.label, show: !compact, interval: 0, rotate: opts.label_rotate ?? 0,
        overflow: "truncate", width: 64,
      },
      name: opts.x_title || undefined,
      nameLocation: "middle",
      nameGap: 26,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
    },
    yAxis: [
      {
        type: "value",
        min: opts.y_min ?? undefined,
        max: opts.y_max ?? undefined,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { ...AXIS.label, show: !compact, formatter: (v: number) => formatAxis(v, opts) },
        splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
        name: opts.y_title || undefined,
        nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
      },
      {
        type: "value",
        /* 线的 Y 轴放右侧：不写 position 会叠在左轴上，看起来就是「没有刻度」 */
        position: "right",
        show: !compact,
        min: opts.y2_min ?? undefined,
        max: opts.y2_max ?? undefined,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { ...AXIS.label, show: !compact, formatter: (v: number) => formatAxis(v, { ...opts, label_format: rightAxisFmt }) },
        splitLine: { show: false },
        nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
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
          onEvents={onTopList ? { click: (params: { name?: string }) => onTopList(String(params?.name ?? ""), String(payload.dimension_label ?? "")) } : undefined}
          style={{ width: "100%", height: "100%" }} opts={{ renderer: "canvas" }} />
      </Box>
    </CardShell>
  );
}
