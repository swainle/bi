/** 榜单端皮肤令牌 —— 对齐「市场部BI看板模板」的视觉语言 */

import type { Accent } from "../types";

/** 卡片外壳 */
export const CARD = {
  bgcolor: "#fff",
  border: "1px solid #EFF3FB",
  borderRadius: "16px",
  boxShadow: "0 2px 10px rgba(15,23,42,0.045)",
} as const;

/** 标题 / 说明文字 */
export const TEXT = {
  title: { fontSize: 14.5, fontWeight: 700, color: "#0F172A", letterSpacing: -0.2 },
  meta: { fontSize: 11.5, color: "#94A3B8" },
  note: { fontSize: 11, color: "#94A3B8", lineHeight: 1.6 },
  label: { fontSize: 12.5, color: "#334155" },
  value: { fontSize: 13, fontWeight: 700, color: "#0F172A", fontVariantNumeric: "tabular-nums" },
} as const;

/** 图表坐标轴 */
export const AXIS = {
  label: { fontSize: 11, color: "#94A3B8" },
  line: "#EEF2F7",
  split: "#F1F5F9",
};

/** 主色序列（柱/线/多系列） */
export const SERIES = ["#3B82F6", "#14B8A6", "#F5872B", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#0EA5E9"];

/** 环形图配色（参考热卖种类） */
export const DONUT = ["#F5872B", "#10B981", "#8B5CF6", "#F97316", "#3B82F6", "#EC4899", "#14B8A6", "#A855F7"];

/** KPI 头标卡：柔和渐变底 + 同色系深色数字 */
export const KPI_BG: Record<Accent, string> = {
  indigo: "linear-gradient(135deg, #EDF2FE 0%, #E1EAFB 100%)",
  sky: "linear-gradient(135deg, #E8F4FD 0%, #D8ECFB 100%)",
  teal: "linear-gradient(135deg, #E6F6EF 0%, #D6F0E6 100%)",
  amber: "linear-gradient(135deg, #FEF4E3 0%, #FCEACD 100%)",
  rose: "linear-gradient(135deg, #FCEAEF 0%, #FADBE4 100%)",
  violet: "linear-gradient(135deg, #EFEAFC 0%, #E5DDFA 100%)",
  slate: "linear-gradient(135deg, #F1F5F9 0%, #E7EDF4 100%)",
};

export const KPI_INK: Record<Accent, string> = {
  indigo: "#1D4ED8",
  sky: "#0369A1",
  teal: "#047857",
  amber: "#B45309",
  rose: "#BE185D",
  violet: "#6D28D9",
  slate: "#475569",
};

/** 词云配色：高频红 → 中频深蓝灰 → 低频浅灰 */
export const CLOUD_COLORS = ["#E11D48", "#BE123C", "#1E293B", "#334155", "#475569", "#64748B", "#94A3B8"];

export function cloudColor(rank: number, total: number): string {
  if (total <= 1) return CLOUD_COLORS[0];
  const ratio = rank / Math.max(1, total - 1);
  if (ratio < 0.12) return CLOUD_COLORS[0];
  if (ratio < 0.3) return CLOUD_COLORS[2];
  if (ratio < 0.55) return CLOUD_COLORS[3];
  if (ratio < 0.8) return CLOUD_COLORS[4];
  return CLOUD_COLORS[6];
}

/** 统一 tooltip 皮肤 */
export const TOOLTIP = {
  /* 卡片有 overflow:hidden，提示框必须限制在图表内，否则边缘会被裁掉 */
  confine: true,
  borderWidth: 0,
  backgroundColor: "rgba(15,23,42,0.92)",
  padding: [8, 10],
  textStyle: { color: "#fff", fontSize: 12 },
  extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,0.18);",
} as const;
