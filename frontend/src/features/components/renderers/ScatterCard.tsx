/** 散点卡 —— 点 / 气泡 / 四象限（对数轴 + 中位线 + 象限计数） */

import ReactEChartsCore from "echarts-for-react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { AXIS, TOOLTIP } from "../skin/tokens";
import { chartOf, formatAxis } from "../skin/format";
import type { RenderPayload, ScatterPoint, UiSpec } from "../types";

const QUAD_COLOR: Record<string, string> = {
  blue: "#14B8A6",
  red: "#F2694A",
  pot: "#7C5CFF",
  drop: "#C3CFE0",
};

const QUAD_LABEL: Record<string, string> = {
  blue: "蓝海区",
  red: "红海区",
  pot: "潜力区",
  drop: "放弃区",
};

export default function ScatterCard({ payload, ui, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const points = (payload.series ?? []) as unknown as ScatterPoint[];

  if (!points.length) {
    return (
      <CardShell compact={compact} title={payload.title || "散点"} accent={token.main} hideTitle={opts.show_title === false}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 11.5, color: "#94A3B8" }}>
          暂无数据
        </Box>
      </CardShell>
    );
  }

  /* 以当前配置为准（服务端 payload.mode 是上一次查询的结果，改完会滞后一帧） */
  const mode = opts.scatter_mode || payload.mode || "point";
  /* 轴名：手填的轴标题优先，其次四象限/气泡的键名，最后回退字段名 */
  const xLabel = opts.x_title || payload.x_label || opts.x_key;
  const yLabel = opts.y_title || payload.y_label || opts.y_key;
  const logX = Boolean(payload.log_x ?? opts.log_x);
  const logY = Boolean(payload.log_y ?? opts.log_y);
  const maxSize = Math.max(...points.map((p) => Number(p.size ?? 0)), 1);
  /* 点大小可调：气泡 / 四象限按同一基准等比放大 */
  const base = Math.max(3, Math.min(24, Number(opts.dot_size ?? 8)));
  const sizeOf = (p: ScatterPoint) =>
    mode === "bubble"
      ? base * 0.75 + (Number(p.size ?? 0) / maxSize) * base * 2.25
      : mode === "quadrant"
        ? base * 0.62 + (Number(p.size ?? 0) / maxSize) * base * 1.75
        : base;

  const data = points.map((p) => {
    const size = sizeOf(p);
    const color = mode === "quadrant" && p.quad ? QUAD_COLOR[p.quad] : token.main;
    return {
      name: p.name,
      value: [p.x, p.y],
      symbolSize: size,
      itemStyle: { color, opacity: 0.78, borderColor: "#fff", borderWidth: 1 },
      quad: p.quad,
      score: p.score,
      sizeValue: p.size,
    };
  });

  const medians = payload.medians;
  const markLine = medians && mode === "quadrant"
    ? {
      silent: true,
      symbol: "none",
      lineStyle: { color: "#CBD5E1", type: "dashed", width: 1 },
      label: { show: false },
      data: [
        { xAxis: medians.x },
        { yAxis: medians.y },
      ],
    }
    : undefined;

  /* 趋势线：对可见点做最小二乘，画一条从最小 x 到最大 x 的辅助线 */
  const trend = (() => {
    if (!opts.trend_line || points.length < 3) return null;
    const pts = points;
    const xs = pts.map((p) => Number(p.x)).filter((n) => Number.isFinite(n));
    const ys = pts.map((p) => Number(p.y)).filter((n) => Number.isFinite(n));
    if (xs.length < 3 || ys.length < 3) return null;
    const n = Math.min(xs.length, ys.length);
    const mx = xs.slice(0, n).reduce((a, b2) => a + b2, 0) / n;
    const my = ys.slice(0, n).reduce((a, b2) => a + b2, 0) / n;
    let num = 0; let den = 0;
    for (let i = 0; i < n; i += 1) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    if (!den) return null;
    const slope = num / den;
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    return { minX, maxX, at: (x: number) => my + slope * (x - mx), slope };
  })();

  const option = {
    animation: ui.animate,
    animationDuration: 460,
    grid: { left: 6, right: compact ? 8 : 10, top: compact ? 10 : 24, bottom: 6, containLabel: !compact },
    tooltip: {
      trigger: "item",
      ...TOOLTIP,
      formatter: (p: { data: { name?: string; value: [number, number]; quad?: string; score?: number; sizeValue?: number } }) => {
        const [x, y] = p.data.value;
        const lines = [`<b>${p.data.name ?? ""}</b>`,
          `${xLabel || "x"}：${formatAxis(x, opts)}`,
          `${yLabel || "y"}：${formatAxis(y, opts)}`];
        if (p.data.sizeValue !== undefined) lines.push(`${opts.size_key || "气泡"}：${formatAxis(p.data.sizeValue, opts)}`);
        if (p.data.quad) lines.push(`${QUAD_LABEL[p.data.quad] ?? p.data.quad} · 机会分 ${p.data.score ?? "-"}`);
        return lines.join("<br/>");
      },
    },
    xAxis: {
      type: logX ? "log" : "value",
      name: compact ? undefined : xLabel || undefined,
      nameLocation: "middle",
      nameGap: 24,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
      axisLine: { lineStyle: { color: AXIS.line } },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#94A3B8", formatter: (v: number) => formatAxis(v, opts) },
      splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
    },
    yAxis: {
      type: logY ? "log" : "value",
      name: compact ? undefined : yLabel || undefined,
      nameTextStyle: { fontSize: 10.5, color: "#94A3B8" },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontSize: 10, color: "#94A3B8", formatter: (v: number) => formatAxis(v, opts) },
      splitLine: { show: opts.show_grid && !compact, lineStyle: { color: AXIS.split, type: "dashed" } },
    },
    series: [
      {
        type: "scatter",
        data,
        markLine,
        emphasis: { itemStyle: { opacity: 1, borderWidth: 2 } },
      },
      ...(trend ? [{
        type: "line",
        name: "趋势",
        showSymbol: false,
        silent: true,
        lineStyle: { width: 2, type: "dashed", color: "rgba(15,23,42,0.35)" },
        data: [[trend.minX, trend.at(trend.minX)], [trend.maxX, trend.at(trend.maxX)]],
        tooltip: { show: false },
        z: 1,
      }] : []),
    ],
    graphic: mode === "quadrant" && !compact
      ? [
        quadLabel(QUAD_LABEL.pot, "#7C5CFF", "8%", "10%"),
        quadLabel(QUAD_LABEL.blue, "#0F766E", "78%", "10%"),
        quadLabel(QUAD_LABEL.drop, "#94A3B8", "8%", "86%"),
        quadLabel(QUAD_LABEL.red, "#BE123C", "78%", "86%"),
      ]
      : undefined,
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "散点"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false
        ? undefined
        : (payload.subtitle
          || (payload.quads ? Object.entries(payload.quads).map(([k, v]) => `${QUAD_LABEL[k] ?? k} ${v}`).join(" · ") : undefined))}
      note={compact ? undefined : payload.subtitle}
    >
      <ReactEChartsCore option={option} notMerge lazyUpdate
        style={{ width: "100%", height: "100%" }} opts={{ renderer: "canvas" }} />
    </CardShell>
  );
}

function quadLabel(text: string, color: string, left: string, top: string) {
  return {
    type: "text",
    left,
    top,
    style: { text, fill: color, fontSize: 10.5, fontWeight: 600, opacity: 0.9 },
    silent: true,
  };
}
