/** 图表槽位的中文叫法 —— 按图表类型给「横轴 / 纵轴 / 分类 / 数值」这类更直观的名字。
 *  只影响文案，数据模型（binding.dimension / metric）完全不动。 */

import type { ComponentKind } from "../types";

export interface AxisLabels {
  /** 维度槽（分组字段） */
  dimension: string;
  /** 指标槽（聚合数值） */
  metric: string;
  /** 口径块里维度那行的叫法（没有维度时不用） */
  dimensionHint?: string;
  metricHint?: string;
}

const DEFAULT: AxisLabels = { dimension: "维度", metric: "指标" };

const BY_KIND: Partial<Record<ComponentKind, AxisLabels>> = {
  /* 先只上柱状图：横轴放分类、纵轴算数值，用户确认观感后再铺到其它图 */
  bar: { dimension: "横轴（分类）", metric: "纵轴（数值）", dimensionHint: "分组字段", metricHint: "聚合数值" },
  combo: { dimension: "横轴（分类）", metric: "左轴（柱）", dimensionHint: "分组字段", metricHint: "柱状数值" },
  line: { dimension: "横轴（时间 / 分类）", metric: "纵轴（数值）", dimensionHint: "时间或分类", metricHint: "聚合数值" },
  scatter: { dimension: "点名称（可选）", metric: "纵轴（数值）", dimensionHint: "点的标签", metricHint: "Y 数值" },
  area: { dimension: "横轴（时间 / 分类）", metric: "纵轴（数值）", dimensionHint: "时间或分类", metricHint: "聚合数值" },
};

export function axisLabels(kind: ComponentKind): AxisLabels {
  return BY_KIND[kind] ?? DEFAULT;
}
