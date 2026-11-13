/** KPI 头标卡 —— 柔和渐变底 + 同色系大数字（参考榜单端头标卡片） */

import { useEffect, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { accentOf } from "../palette";
import { KPI_BG, KPI_INK } from "../skin/tokens";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
}

/** "2,000" / "1.2万" → 可滚动数值 */
function parseShown(value: string): { num: number; prefix: string; suffix: string; decimals: number } | null {
  const match = /^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/.exec(value);
  if (!match) return null;
  const num = Number(match[2].replace(/,/g, ""));
  if (Number.isNaN(num)) return null;
  const decimals = match[2].includes(".") ? match[2].split(".")[1].length : 0;
  return { num, prefix: match[1], suffix: match[3], decimals };
}

export default function KpiCard({ payload, ui }: Props) {
  const token = accentOf(ui.accent);
  const shown = payload.value ?? "-";
  const fmt = payload.compute?.format;
  // 日期 / 文本不滚动（否则 2026-12-04 会被当成数字滚成 341-12-04）
  const numeric = fmt !== "date" && fmt !== "text" && !/^\d{4}-\d{2}-\d{2}$/.test(shown);
  const parsed = ui.animate && numeric ? parseShown(shown) : null;
  const [progress, setProgress] = useState(parsed ? 0 : 1);
  const raf = useRef<number>(0);

  useEffect(() => {
    if (!parsed) { setProgress(1); return; }
    const start = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setProgress(t < 1 ? 1 - Math.pow(1 - t, 3) : 1);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, ui.animate]);

  let display = shown;
  if (parsed) {
    const current = parsed.num * progress;
    display = `${parsed.prefix}${current.toLocaleString("zh-CN", {
      minimumFractionDigits: parsed.decimals,
      maximumFractionDigits: parsed.decimals,
    })}${parsed.suffix}`;
  }

  const ink = KPI_INK[ui.accent] ?? token.main;
  const centered = ui.align === "center";
  /** 有底部副标题时收一点内边距和行距，否则 104 高的卡会把副标题挤出去 */
  const hasSub = payload.chart?.show_meta !== false && !!(payload.subtitle || payload.hint);

  return (
    <Box
      sx={{
        height: "100%",
        borderRadius: "18px",
        background: KPI_BG[ui.accent] ?? KPI_BG.indigo,
        border: "1px solid rgba(255,255,255,0.9)",
        boxShadow: "0 2px 10px rgba(15,23,42,0.035)",
        px: 2,
        py: hasSub ? 1.25 : 1.75,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        textAlign: centered ? "center" : "left",
        gap: hasSub ? 0.5 : 0.75,
        position: "relative",
        overflow: "hidden",
        "&::after": {
          content: '""',
          position: "absolute",
          right: -26,
          top: -30,
          width: 92,
          height: 92,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.5)",
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, position: "relative", width: "100%" }}>
        {payload.chart?.show_title !== false && (
          <Typography sx={{ fontSize: 12.5, color: "#64748B", fontWeight: 500, flex: 1, minWidth: 0 }} noWrap>
            {payload.title || ""}
          </Typography>
        )}
        {ui.badge ? (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 0.25,
            px: 0.875, height: 18, borderRadius: 999,
            bgcolor: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(255,255,255,0.95)",
            fontSize: 10, fontWeight: 600, color: "#64748B", whiteSpace: "nowrap",
          }}>
            {ui.badge}
            <Box component="span" sx={{ fontSize: 10, color: "#94A3B8" }}>›</Box>
          </Box>
        ) : null}
      </Box>

      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, position: "relative" }}>
        <Typography
          sx={{
            fontSize: 30, fontWeight: 800, lineHeight: 1.1, letterSpacing: -0.8,
            color: ink, fontVariantNumeric: "tabular-nums",
          }}
        >
          {display}
        </Typography>
        {ui.show_unit && payload.unit ? (
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: ink, opacity: 0.9 }}>
            {payload.unit}
          </Typography>
        ) : null}
      </Box>

      {/* 底部副标题：手填的「副标题」优先，没填才用生成规则的结果 */}
      {payload.chart?.show_meta !== false && (payload.subtitle || payload.hint) ? (
        <Typography sx={{ fontSize: 11.5, color: "#94A3B8", position: "relative" }} noWrap>
          {payload.subtitle || payload.hint}
        </Typography>
      ) : null}
    </Box>
  );
}
