/** 导航菜单卡 —— 页头导航条：左侧品牌 + 中间菜单（圆点 / 当前页）+ 右侧状态与操作 */

import { Box, Typography } from "@mui/material";
import type { NavAction, NavItem } from "../types";

export interface NavPayload {
  brand?: string;
  brand_accent?: string;
  brand_tone?: string;
  items?: NavItem[];
  meta?: string;
  badge?: string;
  actions?: NavAction[];
  global_nav?: boolean;
  export_scope?: "primary" | "all" | "dataset";
  export_dataset_id?: number | null;
}

export interface NavUi {
  radius: number;
  accent: string;
  edge?: boolean;
  edge_px?: number;
  edge_alpha?: number;
  shadow_px?: number;
}

interface Props {
  payload: NavPayload;
  ui: NavUi;
  compact?: boolean;
  /** 当前所在页面 key（用于推导「当前页」高亮） */
  currentPage?: string;
  /** 点了挂了页面的菜单项：预览页据此切页 */
  onNavigate?: (page: string) => void;
  /** 右侧按钮被点（成品页据此执行动作，如导出 CSV） */
  onAction?: (label: string) => void;
}

/** 品牌标记、圆点、选中胶囊用的同色系色板（选中胶囊跟随该项自己的圆点色） */
const TONES: Record<string, { mark: [string, string]; dot: string; soft: string; text: string }> = {
  sky: { mark: ["#2563EB", "#38BDF8"], dot: "#3B82F6", soft: "rgba(37,99,235,0.10)", text: "#2563EB" },
  indigo: { mark: ["#6366F1", "#A5B4FC"], dot: "#6366F1", soft: "rgba(99,102,241,0.12)", text: "#4F46E5" },
  teal: { mark: ["#0D9488", "#2DD4BF"], dot: "#14B8A6", soft: "rgba(13,148,136,0.12)", text: "#0D9488" },
  warm: { mark: ["#F59E0B", "#FBBF24"], dot: "#F59E0B", soft: "rgba(245,158,11,0.14)", text: "#B45309" },
  slate: { mark: ["#64748B", "#94A3B8"], dot: "#94A3B8", soft: "rgba(100,116,139,0.12)", text: "#475569" },
  rose: { mark: ["#E11D48", "#FB7185"], dot: "#F43F5E", soft: "rgba(244,63,94,0.12)", text: "#E11D48" },
  amber: { mark: ["#D97706", "#FBBF24"], dot: "#F59E0B", soft: "rgba(217,119,6,0.14)", text: "#B45309" },
  violet: { mark: ["#7C3AED", "#A78BFA"], dot: "#8B5CF6", soft: "rgba(139,92,246,0.13)", text: "#7C3AED" },
};

export default function NavCard({ payload, ui, compact, currentPage, onNavigate, onAction }: Props) {
  const tone = TONES[payload.brand_tone || "sky"] || TONES.sky;
  const radius = `${Math.max(0, Math.min(Math.round(ui?.radius ?? 12), 28))}px`;
  const edgeOn = ui?.edge !== false;
  const edgePx = Math.max(0, Math.min(Number(ui?.edge_px ?? 1), 4));
  const edgeAlpha = Math.max(0, Math.min(Math.round(ui?.edge_alpha ?? 18), 100)) / 100;
  const shadowPx = Math.max(0, Math.min(Math.round(ui?.shadow_px ?? 8), 40));

  const brand = payload.brand || "";
  const accent = payload.brand_accent || "";
  const items = (payload.items || []).filter((item) => item && item.label);
  const actions = (payload.actions || []).filter((action) => action && action.label);

  return (
    <Box sx={{
      position: "relative", height: "100%", minWidth: 0, overflow: "hidden",
      containerType: "inline-size",
      display: "flex", alignItems: "center",
      bgcolor: "#FFFFFF",
      borderRadius: radius,
      border: edgeOn ? `${edgePx}px solid rgba(15,23,42,${edgeAlpha})` : "none",
      boxShadow: shadowPx > 0 ? `0 1px 2px rgba(15,23,42,0.04), 0 ${Math.round(shadowPx * 0.5)}px ${shadowPx}px -${Math.round(shadowPx * 0.6)}px rgba(15,23,42,0.10)` : "none",
      px: compact ? 2 : 2.5,
      gap: compact ? 2 : 3.5,
    }}>
      {/* 品牌：渐变标记 + 名称（尾段渐变强调） */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
        <Box sx={{
          width: compact ? 24 : 28, height: compact ? 24 : 28, borderRadius: "9px",
          background: `linear-gradient(135deg, ${tone.mark[0]}, ${tone.mark[1]})`,
          display: "flex", alignItems: "flex-end", justifyContent: "center", gap: "2px",
          pb: compact ? 0.75 : 0.9, boxShadow: `0 4px 10px -6px ${tone.mark[0]}`,
        }}>
          <Box sx={{ width: 3, height: 7, borderRadius: 1, bgcolor: "rgba(255,255,255,0.85)" }} />
          <Box sx={{ width: 3, height: 12, borderRadius: 1, bgcolor: "#fff" }} />
          <Box sx={{ width: 3, height: 9, borderRadius: 1, bgcolor: "rgba(255,255,255,0.7)" }} />
        </Box>
        <Typography sx={{
          fontSize: compact ? 14 : 15.5, fontWeight: 700, color: "#0F172A", letterSpacing: -0.2,
          whiteSpace: "nowrap", "@container (max-width: 560px)": { fontSize: 13.5 },
        }}>
          {brand}
          {accent ? (
            <Box component="span" sx={{
              backgroundImage: "linear-gradient(92deg, #2563EB, #0D9488)",
              WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", ml: 0.25,
            }}>
              {accent}
            </Box>
          ) : null}
        </Typography>
      </Box>

      {/* 菜单：圆点 + 标签，当前页是高亮胶囊 */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, overflow: "hidden",
        flex: "1 1 auto",
      }}>
        {items.map((item, index) => {
          const itemTone = TONES[item.tone || "slate"] || TONES.slate;
          const dot = itemTone.dot;
          /* 高亮只表示「你现在在哪一页」；菜单项上的 active 是「首视页」（打开看板先展示哪页），不参与高亮 */
          const isActive = !!item.page && item.page === currentPage;
          const clickable = !!item.page && !!onNavigate;
          return (
            <Box
              key={`${item.label}-${index}`}
              onClick={clickable ? (event) => { event.stopPropagation(); onNavigate?.(item.page as string); } : undefined}
              sx={{
              display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0,
              px: 1.25, height: 30, borderRadius: 999,
              bgcolor: isActive ? itemTone.soft : "transparent",
              transition: "background-color .14s",
              cursor: clickable ? "pointer" : "default",
              "&:hover": { bgcolor: isActive ? itemTone.soft : "rgba(15,23,42,0.035)" },
              /* 窄到缩略图尺寸时只留圆点，仍能看出这是一条导航 */
              "@container (max-width: 760px)": { px: 0.75, gap: 0, height: 24 },
            }}>
              <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: dot, flexShrink: 0 }} />
              <Typography sx={{
                fontSize: 13, whiteSpace: "nowrap",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? itemTone.text : "#475569",
                "@container (max-width: 760px)": { display: "none" },
              }}>
                {item.label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* 右侧：状态灰字 + 徽标 + 按钮 */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1.25, flexShrink: 0, ml: "auto",
        "@container (max-width: 900px)": { gap: 1 },
      }}>
        {payload.meta ? (
          <Typography sx={{
            fontSize: 11.5, color: "#94A3B8", whiteSpace: "nowrap",
            "@container (max-width: 1100px)": { display: "none" },
          }}>
            {payload.meta}
          </Typography>
        ) : null}
        {payload.badge ? (
          <Box sx={{
            px: 1, height: 22, borderRadius: 999, bgcolor: "#E9F8F0",
            display: "flex", alignItems: "center",
            fontSize: 11, fontWeight: 600, color: "#0F9D58", whiteSpace: "nowrap",
            /* 缩略图尺寸让位给菜单圆点，否则圆点会被挤没 */
            "@container (max-width: 620px)": { display: "none" },
          }}>
            {payload.badge}
          </Box>
        ) : null}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, "@container (max-width: 620px)": { display: "none" } }}>
          {actions.map((action, index) => {
            const primary = action.kind === "primary";
            const clickable = !!onAction;
            return (
              <Box
                key={`${action.label}-${index}`}
                onClick={clickable ? (event) => { event.stopPropagation(); onAction?.(action.label); } : undefined}
                sx={{
                  px: 1.5, height: 32, borderRadius: 1.5, display: "flex", alignItems: "center",
                  fontSize: 12.5, fontWeight: primary ? 600 : 400, whiteSpace: "nowrap",
                  color: primary ? "#fff" : "#334155",
                  bgcolor: primary ? "#2563EB" : "#fff",
                  border: primary ? "1px solid #2563EB" : "1px solid #D8E2F5",
                  boxShadow: primary ? "0 4px 10px -6px rgba(37,99,235,0.8)" : "none",
                  cursor: clickable ? "pointer" : "default",
                  transition: "filter .14s",
                  "&:hover": clickable ? { filter: "brightness(0.96)" } : undefined,
                }}
              >
                {action.label}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
