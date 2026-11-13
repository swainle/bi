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
/* 词云主题色（2026-11-13 用户要求「颜色丰富一些」并按参考图给多套配色）：
   6 套 × 8 色，整套都压过饱和度，放在白卡片上不刺眼；尾部按排名混白，保住「大字重、小字轻」的层次。 */
export const CLOUD_PALETTES: { name: string; colors: string[] }[] = [
  { name: "潮彩", colors: ["#0EA5A5", "#3E7BFA", "#7C6CE0", "#F2A03D", "#3FB984", "#E2607D", "#5B8DEF", "#8C7AE6"] },
  { name: "甜韵", colors: ["#35C9A5", "#4FC3E8", "#A98BE8", "#F48FB1", "#6ED9B8", "#F5B971", "#F2994A", "#4C7DF0"] },
  { name: "希翼", colors: ["#12B3C9", "#1F6FEB", "#22A67A", "#2E3A8C", "#7A5AF8", "#F2994A", "#56CCF2", "#8FA3BF"] },
  { name: "谷韵", colors: ["#0F5132", "#116B5A", "#1F8A70", "#3DA58A", "#6FBF9B", "#9AD0B4", "#A8C0CE", "#7E94A8"] },
  { name: "复古", colors: ["#8C6D46", "#C7A17A", "#6B705C", "#A5A58D", "#B7B7A4", "#7D8CA3", "#9C6644", "#CB997E"] },
  { name: "炽情", colors: ["#E11D48", "#F97316", "#EAB308", "#DC2626", "#9333EA", "#2563EB", "#059669", "#334155"] },
];

/** 默认色板（「潮彩」）—— 老调用只用到这里 */
export const CLOUD_COLORS = CLOUD_PALETTES[0].colors;

/** 按名字取色板，名字不认识就回落到默认 */
export function cloudPalette(name?: string | null): string[] {
  return CLOUD_PALETTES.find((p) => p.name === name)?.colors ?? CLOUD_COLORS;
}

/** 往白色里混，做「轻量版」颜色（避免再引依赖，自己算 hex） */
function lighten(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const value = parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  const r = mix((value >> 16) & 255);
  const g = mix((value >> 8) & 255);
  const b = mix(value & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

/** 词色：按名次轮转主题色色板；越靠后越淡，最大那一批最饱和 */
export function cloudColor(rank: number, total: number, colors?: string[]): string {
  const palette = colors?.length ? colors : CLOUD_COLORS;
  const base = palette[((rank % palette.length) + palette.length) % palette.length];
  if (total <= 1) return base;
  const ratio = rank / Math.max(1, total - 1);
  if (ratio < 0.3) return base;
  if (ratio < 0.65) return lighten(base, 0.2);
  return lighten(base, 0.4);
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
