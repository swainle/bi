/** 排行条形卡 —— 纯 CSS 排行条（参考「差评词 TOP6」）：右对齐标签 + 渐变条 + 数值 */

import { Box, Typography } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import { chartOf, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
}

export default function HbarCard({ payload, ui, compact, onSliceClick }: Props & { compact?: boolean; onSliceClick?: (name: string) => void }) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const series = payload.series ?? [];

  if (!series.length) {
    return <CardShell title={payload.title || "排行"} accent={token.main}>
      <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>
    </CardShell>;
  }

  const max = Math.max(...series.map((s) => Number(s.value ?? 0)), 1);
  const labelWidth = Math.min(120, Math.max(64, ...series.map((s) => String(s.name).length * 13)));
  // 阈值染色：达标项用高亮色（如「需求供给比 ≥3」）
  const highlight = accentOf(opts.hbar_highlight || "violet");
  const thresholdKey = opts.hbar_threshold_key;
  const thresholdGte = opts.hbar_threshold_gte;
  const isHit = (item: Record<string, unknown>) => {
    if (!thresholdKey || thresholdGte === null || thresholdGte === undefined) return false;
    const raw = item[thresholdKey] ?? item.value;
    return Number(raw ?? 0) >= thresholdGte;
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "排行"}
      accent={token.main}
      meta={chartShowMeta(payload) ? (payload.subtitle || payload.metric_label || undefined) : undefined}
      note={`${payload.dimension_label || ""} · 共 ${payload.count ?? series.length} 项`}
    >
      <Box sx={{
        height: "100%", display: "flex", flexDirection: "column",
        justifyContent: "center", gap: 1, overflow: "hidden",
      }}>
        {series.map((item, index) => {
          const value = Number(item.value ?? 0);
          const ratio = Math.max(0.06, value / max);
          const strong = index === 0 && !compact;
          return (
            <Box
              key={`${item.name}-${index}`}
              onClick={() => onSliceClick?.(String(item.name ?? ""))}
              sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, cursor: onSliceClick ? "pointer" : "default" }}
            >
              <Typography
                sx={{ ...TEXT.label, width: labelWidth, textAlign: "right", flexShrink: 0 }}
                noWrap
              >
                {String(item.name)}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0, height: 13, position: "relative" }}>
                <Box sx={{
                  width: `${ratio * 100}%`, height: "100%", borderRadius: "3px",
                  background: isHit(item as Record<string, unknown>)
                    ? `linear-gradient(90deg, ${highlight.main}, ${highlight.gradient[0]})`
                    : strong
                      ? `linear-gradient(90deg, ${token.main}, ${token.gradient[0]})`
                      : `linear-gradient(90deg, ${token.gradient[0]}, ${token.border})`,
                  transition: "width .3s ease",
                }} />
              </Box>
              <Typography sx={{ ...TEXT.value, width: 52, textAlign: "left", flexShrink: 0 }}>
                {opts.show_labels ? formatValue(value, payload.compute, opts) : ""}
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
