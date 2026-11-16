/** 组件配色令牌 —— 只在这里定义，渲染器一律取用，不写死色值 */

import type { Accent } from "./types";

export interface AccentToken {
  main: string;
  soft: string;
  border: string;
  gradient: [string, string];
}

export const ACCENTS: Record<Accent, AccentToken> = {
  indigo: { main: "#6366F1", soft: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.22)", gradient: ["#818CF8", "#6366F1"] },
  teal: { main: "#10B981", soft: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.22)", gradient: ["#34D399", "#10B981"] },
  amber: { main: "#F59E0B", soft: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.24)", gradient: ["#FBBF24", "#F59E0B"] },
  rose: { main: "#F43F5E", soft: "rgba(244,63,94,0.08)", border: "rgba(244,63,94,0.22)", gradient: ["#FB7185", "#F43F5E"] },
  violet: { main: "#8B5CF6", soft: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.22)", gradient: ["#A78BFA", "#8B5CF6"] },
  sky: { main: "#0EA5E9", soft: "rgba(14,165,233,0.08)", border: "rgba(14,165,233,0.22)", gradient: ["#38BDF8", "#0EA5E9"] },
  slate: { main: "#64748B", soft: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)", gradient: ["#94A3B8", "#64748B"] },
};

export function accentOf(name?: string): AccentToken {
  return ACCENTS[(name as Accent) ?? "indigo"] ?? ACCENTS.indigo;
}

/** 卡片统一的表面样式（沿用页面既有令牌：圆角 / 边框 / 阴影） */
export function cardSurface(radius = 14) {
  return {
    bgcolor: "#fff",
    border: "1px solid #EEF3FB",
    borderRadius: `${radius}px`,
    boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
  } as const;
}
