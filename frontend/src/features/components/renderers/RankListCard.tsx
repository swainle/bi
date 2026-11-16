/** 榜卡 —— TOP5 / 机会词列表：序号 + 名称 + 分值 + 标签 + 理由色点 */

import { Box, Typography } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import { chartOf, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  onSliceClick?: (name: string) => void;
}

const QUAD_LABEL: Record<string, { t: string; color: string; bg: string }> = {
  blue: { t: "蓝海", color: "#0F766E", bg: "#CCFBF1" },
  pot: { t: "潜力", color: "#6D28D9", bg: "#EDE9FE" },
  red: { t: "红海", color: "#BE123C", bg: "#FFE4E6" },
  drop: { t: "放弃", color: "#64748B", bg: "#F1F5F9" },
};

export default function RankListCard({ payload, ui, compact, onSliceClick }: Props) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const items = payload.items ?? [];
  const raw = payload as unknown as { show_rank?: boolean; show_score?: boolean; show_tags?: boolean };
  const showRank = raw.show_rank !== false;
  const showScore = raw.show_score !== false;
  const showTags = raw.show_tags !== false;

  if (!items.length) {
    return (
      <CardShell compact={compact} title={payload.title || "排行"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
      </CardShell>
    );
  }

  const max = Math.max(...items.map((i) => Number(i.value ?? 0)), 1);

  return (
    <CardShell
      compact={compact}
      title={payload.title || "排行"}
      accent={token.main}
      meta={chartShowMeta(payload) ? (payload.subtitle || (payload.count ? `共 ${payload.count} 项` : undefined)) : undefined}
      note={compact ? undefined : payload.subtitle || undefined}
    >
      <Box sx={{ height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: 0.25, pr: 0.25 }}>
        {items.map((item, index) => {
          const value = Number(item.value ?? 0);
          const quad = item.quad ? QUAD_LABEL[item.quad] : null;
          return (
            <Box
              key={`${item.name}-${index}`}
              onClick={() => onSliceClick?.(String(item.name ?? ""))}
              sx={{
                display: "flex", alignItems: "center", gap: 1.25,
                px: 0.75, py: compact ? 0.35 : 0.6, borderRadius: 1.5,
                cursor: onSliceClick ? "pointer" : "default",
                "&:hover": { bgcolor: "rgba(15,23,42,0.028)" },
                minWidth: 0,
              }}
            >
              {showRank && (<Box sx={{
                width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                display: "grid", placeItems: "center",
                bgcolor: index < 3 ? token.soft : "#F1F5F9",
                color: index < 3 ? token.main : "#94A3B8",
                fontSize: 10.5, fontWeight: 700,
              }}>
                {index + 1}
              </Box>)}

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: compact ? 11.5 : 12.5, color: "#1E293B", fontWeight: index < 3 ? 600 : 400 }} noWrap title={item.name}>
                  {item.name}
                </Typography>
                {!compact && (
                  <Box sx={{ mt: 0.35, height: 3, borderRadius: 999, bgcolor: "#F1F5F9", overflow: "hidden" }}>
                    <Box sx={{
                      height: "100%", borderRadius: 999,
                      width: `${Math.max(4, (value / max) * 100)}%`,
                      background: `linear-gradient(90deg, ${token.main}, ${token.gradient[0]})`,
                    }} />
                  </Box>
                )}
              </Box>

              {!compact && showTags && item.tags?.length ? (
                <Box sx={{ display: "flex", gap: 0.4, flexShrink: 0 }}>
                  {item.tags.slice(0, 3).map((tag) => (
                    <Box key={tag} sx={{
                      px: 0.6, height: 17, borderRadius: 999, display: "grid", placeItems: "center",
                      bgcolor: "#F1F5F9", color: "#64748B", fontSize: 9.5,
                    }}>{tag}</Box>
                  ))}
                </Box>
              ) : null}

              {quad ? (
                <Box sx={{
                  px: 0.7, height: 18, borderRadius: 999, display: "grid", placeItems: "center",
                  bgcolor: quad.bg, color: quad.color, fontSize: 10, fontWeight: 600, flexShrink: 0,
                }}>{quad.t}</Box>
              ) : null}

              {showScore && item.score !== undefined ? (
                <Box sx={{
                  minWidth: 30, height: 20, px: 0.5, borderRadius: 1.25,
                  display: "grid", placeItems: "center",
                  bgcolor: token.soft, color: token.main, fontSize: 11, fontWeight: 700,
                  fontVariantNumeric: "tabular-nums", flexShrink: 0,
                }}>{item.score}</Box>
              ) : null}

              <Typography sx={{
                ...TEXT.value, width: 74, textAlign: "right", flexShrink: 0, color: "#0F172A",
              }}>
                {formatValue(value, payload.compute, opts)}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </CardShell>
  );
}

/** 右上说明：优先显示手填的「右上说明」，并受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}
