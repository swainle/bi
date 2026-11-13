/** 头标卡 —— 页头大图卡：kicker + 大标题（尾段渐变强调）+ 副标题 + 右侧统计 */

import { Box, Typography } from "@mui/material";
import type { BannerStat } from "../types";

interface Props {
  payload: {
    kicker?: string;
    title?: string;
    accent?: string;
    subtitle?: string;
    stats?: BannerStat[];
    tone?: string;
  };
  ui: { radius: number; accent: string; edge?: boolean; edge_px?: number; edge_alpha?: number; shadow_px?: number };
  compact?: boolean;
  /** 后端算好的实时统计（按 index 对齐）；绑了指标的统计以它为准 */
  computedStats?: { value?: string }[];
}

/** 底色 + 强调色：同一结构换色即另一套主题 */
const TONES: Record<string, {
  bg: string;
  ring: string;
  edge: string;
  shadow: string;
  wave: [string, string];
  accent: [string, string];
  kicker: string;
  title: string;
  sub: string;
}> = {
  sky: {
    bg: "linear-gradient(102deg, #F7FAFF 0%, #EFF5FE 42%, #E6F0FC 100%)",
    ring: "rgba(37,99,235,0.10)",
    edge: "rgba(37,99,235,0.22)",
    shadow: "37,99,235",
    wave: ["rgba(255,255,255,0.85)", "rgba(191,219,254,0.55)"],
    accent: ["#2563EB", "#0EA5A4"],
    kicker: "#5C7392",
    title: "#0B2545",
    sub: "#5C7392",
  },
  indigo: {
    bg: "linear-gradient(102deg, #FAF9FF 0%, #F1F0FE 42%, #E9E8FD 100%)",
    ring: "rgba(99,102,241,0.12)",
    edge: "rgba(99,102,241,0.24)",
    shadow: "99,102,241",
    wave: ["rgba(255,255,255,0.85)", "rgba(199,210,254,0.55)"],
    accent: ["#4F46E5", "#8B5CF6"],
    kicker: "#66699B",
    title: "#1B1B41",
    sub: "#646793",
  },
  teal: {
    bg: "linear-gradient(102deg, #F6FDFC 0%, #ECFAF8 42%, #E3F6F4 100%)",
    ring: "rgba(13,148,136,0.12)",
    edge: "rgba(13,148,136,0.24)",
    shadow: "13,148,136",
    wave: ["rgba(255,255,255,0.85)", "rgba(153,246,228,0.5)"],
    accent: ["#0D9488", "#0891B2"],
    kicker: "#4C7A78",
    title: "#0A2B29",
    sub: "#4C7A78",
  },
  warm: {
    bg: "linear-gradient(102deg, #FFFCF6 0%, #FEF7EC 42%, #FDF1E3 100%)",
    ring: "rgba(217,119,6,0.12)",
    edge: "rgba(217,119,6,0.24)",
    shadow: "217,119,6",
    wave: ["rgba(255,255,255,0.85)", "rgba(253,230,138,0.45)"],
    accent: ["#D97706", "#EA580C"],
    kicker: "#8A7355",
    title: "#2A2013",
    sub: "#8A7355",
  },
  rose: {
    bg: "linear-gradient(102deg, #FFF9FB 0%, #FEF2F5 42%, #FDE9EF 100%)",
    ring: "rgba(244,63,94,0.12)",
    edge: "rgba(244,63,94,0.24)",
    shadow: "244,63,94",
    wave: ["rgba(255,255,255,0.85)", "rgba(254,205,211,0.5)"],
    accent: ["#F43F5E", "#E11D48"],
    kicker: "#8C6570",
    title: "#3B0A16",
    sub: "#8C6570",
  },
  violet: {
    bg: "linear-gradient(102deg, #FCFAFF 0%, #F7F2FE 42%, #F1EAFD 100%)",
    ring: "rgba(139,92,246,0.12)",
    edge: "rgba(139,92,246,0.24)",
    shadow: "139,92,246",
    wave: ["rgba(255,255,255,0.85)", "rgba(221,214,254,0.55)"],
    accent: ["#8B5CF6", "#6D28D9"],
    kicker: "#6E6390",
    title: "#1F1040",
    sub: "#6E6390",
  },
  slate: {
    bg: "linear-gradient(102deg, #FAFBFD 0%, #F4F7FA 42%, #EDF2F7 100%)",
    ring: "rgba(100,116,139,0.14)",
    edge: "rgba(100,116,139,0.26)",
    shadow: "100,116,139",
    wave: ["rgba(255,255,255,0.85)", "rgba(203,213,225,0.55)"],
    accent: ["#475569", "#334155"],
    kicker: "#5B6B7C",
    title: "#0F172A",
    sub: "#5B6B7C",
  },
};

/** 底色选项（面板里按色点选，和指标卡的外观配色同一套交互） */
export const BANNER_TONES: { value: string; label: string; dot: string }[] = [
  { value: "sky", label: "天蓝", dot: "#0EA5E9" },
  { value: "indigo", label: "靛蓝", dot: "#6366F1" },
  { value: "teal", label: "青绿", dot: "#10B981" },
  { value: "warm", label: "暖橙", dot: "#F59E0B" },
  { value: "rose", label: "玫红", dot: "#F43F5E" },
  { value: "violet", label: "紫罗兰", dot: "#8B5CF6" },
  { value: "slate", label: "石墨", dot: "#64748B" },
];

export default function BannerCard({ payload, ui, compact, computedStats }: Props) {
  const tone = TONES[payload.tone || "sky"] || TONES.sky;
  /**
   * 圆角走 ui.radius：默认 12，可在右侧面板调（0~28）
   * 注意 MUI 的 sx 里数字 borderRadius 会乘 theme.shape.borderRadius（这里是 8），必须带 px
   */
  const radiusPx = `${Math.max(0, Math.min(Math.round(ui?.radius ?? 12), 28))}px`;
  /** 同色系描边：默认开；阴影 0 = 关 */
  const edgeOn = ui?.edge !== false;
  /** 描边细项：线宽 1~4px、深浅取色板 alpha 的百分比 */
  const edgePx = Math.max(0, Math.min(Number(ui?.edge_px ?? 1), 4));
  const edgeAlpha = Math.max(0, Math.min(Math.round(ui?.edge_alpha ?? 22), 100)) / 100;
  const shadowPx = Math.max(0, Math.min(Math.round(ui?.shadow_px ?? 16), 40));
  const stats = (payload.stats || [])
    .map((s, index) => {
      if (!s) return null;
      const live = s.metric ? computedStats?.[index]?.value : undefined;
      return live !== undefined ? { ...s, value: live } : s;
    })
    .filter((s): s is BannerStat => !!s && !!(s.value || s.label));
  const title = payload.title || "";
  const accent = payload.accent || "";
  const kicker = payload.kicker || "";
  const subtitle = payload.subtitle || "";

  return (
    <Box sx={{
      position: "relative", height: "100%", overflow: "hidden",
      containerType: "inline-size",
      borderRadius: radiusPx, background: tone.bg,
      border: edgeOn ? `${edgePx}px solid rgba(${tone.shadow},${edgeAlpha})` : "none",
      boxShadow: shadowPx > 0
        ? `0 ${Math.round(shadowPx * 0.5)}px ${shadowPx}px -${Math.round(shadowPx * 0.4)}px rgba(${tone.shadow},0.22), 0 1px 2px rgba(15,23,42,0.04)`
        : "none",
      display: "flex", alignItems: "center",
      px: 4.5, py: 3.5, gap: 4,
      "@container (max-width: 900px)": { px: 3, py: 2.5, gap: 3 },
      "@container (max-width: 560px)": { px: 2, py: 1.5, gap: 2 },
      minWidth: 0,
    }}>
      {/* 装饰：右上光晕圆 + 右下弧线（纯 CSS/SVG，不用图片） */}
      <Box sx={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(70% 120% at 6% 10%, rgba(255,255,255,0.9), rgba(255,255,255,0) 60%)",
      }} />
      <Box sx={{
        position: "absolute", top: compact ? -140 : -240, right: compact ? -60 : -110,
        width: compact ? 300 : 560, height: compact ? 300 : 560, borderRadius: "50%",
        border: `1px solid ${tone.ring}`,
        background: "radial-gradient(circle at 60% 60%, rgba(255,255,255,0.85), rgba(255,255,255,0) 62%)",
      }} />
      <Box sx={{
        position: "absolute", top: compact ? 20 : 26, right: compact ? 110 : 300,
        width: compact ? 130 : 240, height: compact ? 130 : 240, borderRadius: "50%",
        border: `1px solid ${tone.ring}`,
      }} />
      <Box component="svg" viewBox="0 0 1440 220" preserveAspectRatio="none"
        sx={{ position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: "62%", pointerEvents: "none" }}>
        <defs>
          <linearGradient id="banner-wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={tone.wave[0]} />
            <stop offset="100%" stopColor={tone.wave[1]} />
          </linearGradient>
        </defs>
        <path d="M 300 220 C 700 176 1080 120 1440 46 L 1440 220 Z" fill="url(#banner-wave)" opacity="0.85" />
        <path d="M 640 220 C 900 204 1180 172 1440 118 L 1440 220 Z" fill={tone.wave[1]} opacity="0.6" />
        <path d="M 980 220 C 1160 208 1320 192 1440 172 L 1440 220 Z" fill={tone.wave[1]} opacity="0.45" />
      </Box>

      {/* 左：kicker / 大标题 / 副标题 */}
      <Box sx={{ position: "relative", minWidth: 0, flex: 1 }}>
        {kicker ? (
          <Typography sx={{
            fontSize: 12.5, fontWeight: 600, letterSpacing: 2.2,
            "@container (max-width: 900px)": { fontSize: 10.5, letterSpacing: 1.6 },
            "@container (max-width: 560px)": { fontSize: 9, letterSpacing: 1.2 },
            color: tone.kicker, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {kicker}
          </Typography>
        ) : null}
        {(title || accent) ? (
          <Typography sx={{
            mt: 0.75,
            fontSize: 42, fontWeight: 800, letterSpacing: -1.2,
            lineHeight: 1.15, color: tone.title,
            "@container (max-width: 900px)": { fontSize: 28, letterSpacing: -0.6 },
            "@container (max-width: 560px)": { fontSize: 18, mt: 0.4, letterSpacing: -0.3 },
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {title}
            {accent ? (
              <Box component="span" sx={{
                backgroundImage: `linear-gradient(92deg, ${tone.accent[0]}, ${tone.accent[1]})`,
                WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent",
                ml: title ? (compact ? 0.5 : 1) : 0,
              }}>
                {accent}
              </Box>
            ) : null}
          </Typography>
        ) : null}
        {subtitle ? (
          <Typography sx={{
            mt: 1.25, fontSize: 13.5, color: tone.sub,
            "@container (max-width: 900px)": { fontSize: 11, mt: 0.75 },
            "@container (max-width: 560px)": { fontSize: 9.5, mt: 0.4 },
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>

      {/* 右：统计（数字 + 单位 + 说明） */}
      {stats.length ? (
        <Box sx={{
          position: "relative", display: "flex", alignItems: "flex-end",
          gap: 5, flexShrink: 0, pr: 1,
          "@container (max-width: 900px)": { gap: 3 },
          /* 窄到缩略图尺寸：藏掉统计，留住 kicker + 标题 + 副标题，版面才不像被啃掉一块 */
          "@container (max-width: 620px)": { display: "none" },
        }}>
          {stats.map((stat, index) => (
            <Box key={`${stat.label}-${index}`} sx={{ textAlign: "center", minWidth: compact ? 26 : 56 }}>
              <Typography sx={{
                fontSize: 30, fontWeight: 800, color: tone.title,
                "@container (max-width: 900px)": { fontSize: 20 },
                letterSpacing: -0.6, lineHeight: 1.1, fontVariantNumeric: "tabular-nums",
              }}>
                {stat.value}
                {stat.unit ? (
                  <Box component="span" sx={{ fontSize: compact ? 8 : 12, fontWeight: 600, color: tone.sub, ml: 0.4 }}>
                    {stat.unit}
                  </Box>
                ) : null}
              </Typography>
              <Typography sx={{
                fontSize: 11.5, color: tone.kicker, mt: 0.6,
                "@container (max-width: 900px)": { fontSize: 9.5, mt: 0.3 },
                whiteSpace: "nowrap",
              }}>
                {stat.label}
              </Typography>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
