/** 词云卡 —— 标签云（参考「差评云」：高频红、低频灰，字号按提及次数） */

import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { cloudColor } from "../skin/tokens";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
}

export default function WordCloudCard({ payload, ui, compact }: Props) {
  const token = accentOf(ui.accent);
  const items = (payload.series ?? []).filter((s) => s.name);

  if (!items.length) {
    return (
      <CardShell title={payload.title || "词云"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 11.5, color: "#94A3B8" }}>
          暂无数据
        </Box>
      </CardShell>
    );
  }

  const sorted = [...items].sort((a, b) => Number(b.value) - Number(a.value));
  const max = Number(sorted[0].value) || 1;
  const min = Number(sorted[sorted.length - 1]?.value ?? 0) || 0;
  const span = Math.max(1, max - min);
  const base = compact ? 7.5 : 15;
  const range = compact ? 7 : 21;
  const words = sorted.slice(0, compact ? 14 : 60).map((item, index) => {
    const value = Number(item.value);
    const ratio = Math.max(0.12, (value - min) / span);
    return { index, name: String(item.name), value, size: base + ratio * range };
  });

  return (
    <CardShell
      compact={compact}
      title={payload.title || "词云"}
      accent={token.main}
      meta={chartShowMeta(payload) ? (payload.subtitle || (payload.count ? `${payload.count} 个词` : undefined)) : undefined}
      note={compact ? undefined : `字号 = 提及次数 · 共 ${payload.total?.toLocaleString("zh-CN") ?? "—"}`}
    >
      <Box sx={{
        height: "100%", display: "flex", flexWrap: "wrap",
        gap: compact ? "2px 8px" : "4px 14px",
        alignContent: "center", justifyContent: "center",
        overflow: "hidden", px: 0.5,
      }}>
        {words.map((word) => (
          <Box
            key={`${word.name}-${word.index}`}
            component="span"
            title={`${word.name} · ${word.value}`}
            sx={{
              fontSize: `${word.size.toFixed(1)}px`,
              fontWeight: word.size > base + range * 0.66 ? 700 : word.size > base + range * 0.33 ? 600 : 400,
              color: cloudColor(word.index, sorted.length),
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              flexShrink: 0,
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: 0.94,
              transition: ui.animate ? "transform .16s ease" : "none",
              "&:hover": { transform: "scale(1.06)" },
            }}
          >
            {word.name}
          </Box>
        ))}
      </Box>
    </CardShell>
  );
}

/** 右上说明：优先显示手填的「右上说明」，并受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}
