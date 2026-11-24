/** 数值格式化 —— 统一按 compute（换算/小数/前后缀）与 chart.label_format 输出 */

import type { ChartSpec, ComputeSpec } from "../types";

const DEFAULT_CHART: ChartSpec = {
  show_labels: true, show_legend: true, show_grid: true,
  x_title: "", y_title: "", label_rotate: 0,
  y_min: null, y_max: null, bar_width: 26, smooth: true, label_format: "auto",
  scatter_mode: "point", trend_line: false, dot_size: 8, x_key: "", y_key: "", x_agg: "MAX", y_agg: "", size_key: "", log_x: false, log_y: false, size_log: false, quad_x: null, quad_y: null, tooltip_keys: [], extras: [],
  label_layout: "inside", single_slice: true,
  pie_inner: 46, pie_start: 90, pie_label: "name_pct", pie_gap: true, pie_rose: false,
  hbar_threshold_key: "", hbar_threshold_gte: null, hbar_highlight: "violet",
};

const DEFAULT_COMPUTE: ComputeSpec = {
  headline: "first", hint: "none", format: "int",
  bucket_size: null, bucket_start: null, bucket_count: 0,
  transform: "raw", scale: 1, offset: 0, decimals: 0, prefix: "", suffix: "",
};

export function chartOf(raw?: ChartSpec | null): ChartSpec {
  return { ...DEFAULT_CHART, ...(raw ?? {}) };
}

export function computeOf(raw?: Partial<ComputeSpec> | null): ComputeSpec {
  return { ...DEFAULT_COMPUTE, ...(raw ?? {}) };
}

/** 数值 → 展示文本；换算/前后缀优先，避免出现「0.0万%」这类叠加 */
export function formatValue(value: number, compute?: Partial<ComputeSpec> | null, chart?: Partial<ChartSpec> | null): string {
  const c = computeOf(compute);
  const decimals = c.decimals ?? 0;
  const isShare = c.transform === "share";
  const hasAffix = Boolean(c.prefix || c.suffix);

  // 占比换算：强制百分比，忽略「万」格式
  if (isShare) {
    return `${c.prefix}${value.toFixed(decimals || 1)}%${c.suffix}`;
  }

  // 面板「数字格式」优先（compute.format）：整数 / 万 / 百分比 / 金额 / 日期 / 文本
  const fmt = c.format ?? "int";
  const plain = () => value.toLocaleString("zh-CN", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
  if (fmt === "text" || fmt === "date") {
    return `${c.prefix}${String(value)}${c.suffix}`;
  }
  if (fmt === "money") {
    const text = Math.abs(value) < 10000
      ? `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : `¥${(value / 10000).toFixed(2)}万`;
    return `${c.prefix}${text}${c.suffix}`;
  }
  if (fmt === "pct") return `${c.prefix}${value.toFixed(decimals || 1)}%${c.suffix}`;
  if (fmt === "w") {
    const text = Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(decimals || 1)}万` : plain();
    return `${c.prefix}${text}${c.suffix}`;
  }

  // 整数格式：跟随图表的标签格式（万 / k / 百分比），否则千分位
  const mode = (chart?.label_format ?? "auto") as ChartSpec["label_format"];
  if (mode === "w") return `${c.prefix}${(value / 10000).toFixed(decimals || 1)}万${c.suffix}`;
  if (mode === "k") return `${c.prefix}${(value / 1000).toFixed(decimals || 1)}k${c.suffix}`;
  if (mode === "pct") return `${c.prefix}${value.toFixed(decimals || 1)}%${c.suffix}`;
  return `${c.prefix}${plain()}${c.suffix}`;
}

/** 轴标签格式化（保持简洁，不叠前后缀） */
export function formatAxis(value: number, chart?: Partial<ChartSpec> | null): string {
  const mode = chart?.label_format ?? "auto";
  if (mode === "w") return `${(value / 10000).toFixed(1)}万`;
  if (mode === "pct") return `${value}%`;
  if (mode === "k" && Math.abs(value) >= 10000) return `${(value / 1000).toFixed(0)}k`;
  return value.toLocaleString("zh-CN");
}
