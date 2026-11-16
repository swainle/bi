/** 结论卡 —— 左侧小标题 + 右侧结论句（参考需求端「结论」区块） */

import { Box, Typography } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
}

export default function InsightCard({ payload, ui, compact }: Props) {
  const token = accentOf(ui.accent);
  const items = payload.entries ?? [];

  if (!items.length) {
    return (
      <CardShell compact={compact} title={payload.title || "结论"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>
          当前筛选下没有可分析的结论
        </Box>
      </CardShell>
    );
  }

  return (
    <CardShell
      compact={compact}
      title={payload.title || "结论"}
      accent={token.main}
      meta={payload.subtitle || undefined}
    >
      <Box sx={{ height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: compact ? 0.5 : 1 }}>
        {items.map((item, index) => (
          <Box
            key={`${item.k}-${index}`}
            sx={{
              display: "flex", gap: 1.25, alignItems: "flex-start",
              px: 1.25, py: compact ? 0.5 : 0.9,
              borderRadius: 2, bgcolor: index === 0 ? token.soft : "#F8FAFD",
            }}
          >
            <Box sx={{
              flexShrink: 0, minWidth: 56, height: 22, px: 0.75,
              borderRadius: 1.25, display: "grid", placeItems: "center",
              bgcolor: index === 0 ? token.main : "rgba(15,23,42,0.06)",
              color: index === 0 ? "#fff" : "#64748B",
              fontSize: 10.5, fontWeight: 600,
            }}>
              {item.k}
            </Box>
            <Typography sx={{ fontSize: compact ? 11 : 12.5, color: "#334155", lineHeight: 1.7, flex: 1 }}>
              {item.v}
            </Typography>
          </Box>
        ))}
      </Box>
    </CardShell>
  );
}
