/** 查询面板 · 常量 */

import type { ComponentKind } from "../types";

export const IMAGE_KEY = /图|image|img|pic|photo|url|链接/i;
export const STRONG_IMAGE_KEY = /图|image|img|pic|photo/i;

/** 缩略图设置 —— 放在中栏底部（运算之后）；图片字段只在后端挂载取图，不占表格列 */

export const AGG = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"];
/** 这些图表必须有维度才能分组出图；只拖了指标时自动补一个「列」，不然画不出来 */
export const NEEDS_DIMENSION: ComponentKind[] = [
  "bar", "hbar", "line", "area", "pie", "donut",
  "table", "scatter", "rank_list", "combo", "heatmap", "map",
];
export const GRAINS = ["", "hour", "day", "week", "month", "quarter", "year"];

export const dash = {
  border: "1px dashed #CBD5E1", borderRadius: 2, px: 1.25, py: 1,
  fontSize: 12, color: "#94A3B8", bgcolor: "#FBFCFE",
} as const;

export const OPS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN"];
