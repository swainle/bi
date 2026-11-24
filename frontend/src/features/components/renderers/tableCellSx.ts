/** 明细表单元格样式：基础排版 + 列级「颜色 / 行数」覆盖.
 *
 * 从 TableCard 里抽出来（开发规范 §4.1：存量文件只减不增），同时让
 * 颜色与行数的口径只在一处定义 —— 表格和列详情弹窗将来都复用它。
 */

import type { CSSProperties } from "react";
import type { TableColumn } from "../types";

const INK = "#475569";

export function cellStyle(align: string, numeric = false, column?: TableColumn): CSSProperties {
  const rows = Math.max(0, Number(column?.rows) || 0);
  const base: CSSProperties = {
    padding: "8px 20px",
    fontSize: 12,
    color: column?.color || INK,
    textAlign: align as CSSProperties["textAlign"],
    borderBottom: "1px solid #F4F7FC",
    fontVariantNumeric: numeric ? "tabular-nums" : undefined,
    whiteSpace: "nowrap",
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  if (rows <= 1) return base;
  // 多行：换成「最多 N 行 + 省略号」，长文本会换行显示，单元格顶部对齐
  return {
    ...base,
    whiteSpace: "normal",
    textOverflow: "clip",
    lineHeight: 1.55,
    verticalAlign: "top",
    display: "-webkit-box",
    WebkitLineClamp: Math.min(rows, 4),
    WebkitBoxOrient: "vertical",
  };
}
