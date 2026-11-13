/** 分节标题 —— 页面的结构块（一、榜单概况 …），只占位不产数据 */

import { Box, Typography } from "@mui/material";
import { accentOf } from "../palette";

interface Props {
  payload: {
    title?: string;
    index?: string;
    note?: string;
    icon?: string;
  };
  ui: { accent: string };
  compact?: boolean;
}

const ICON_BG: Record<string, string> = {
  grid: "linear-gradient(135deg, #6366F1, #818CF8)",
  chart: "linear-gradient(135deg, #3B82F6, #60A5FA)",
  pie: "linear-gradient(135deg, #14B8A6, #2DD4BF)",
  table: "linear-gradient(135deg, #8B5CF6, #A78BFA)",
  cloud: "linear-gradient(135deg, #F43F5E, #FB7185)",
  tag: "linear-gradient(135deg, #10B981, #34D399)",
  bulb: "linear-gradient(135deg, #F59E0B, #FBBF24)",
};

const NUMERAL: Record<string, string> = { "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6" };

export default function SectionCard({ payload, ui, compact }: Props) {
  const token = accentOf(ui.accent);
  const gradient = ICON_BG[payload.icon || ""] || `linear-gradient(135deg, ${token.main}, ${token.gradient[0]})`;

  return (
    <Box sx={{
      height: "100%", display: "flex", alignItems: "center", gap: 1.25,
      px: compact ? 0.5 : 0.25, minWidth: 0,
      borderBottom: compact ? "none" : "1px solid #EEF3FB",
    }}>
      <Box sx={{
        width: 26, height: 26, borderRadius: "9px", flexShrink: 0,
        background: gradient, color: "#fff",
        display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700,
        boxShadow: "0 4px 10px -6px rgba(15,23,42,0.4)",
      }}>
        {NUMERAL[payload.index || ""] || payload.index || "·"}
      </Box>
      <Typography sx={{ fontSize: compact ? 13 : 15, fontWeight: 700, color: "#0F172A", letterSpacing: -0.2 }} noWrap>
        {payload.title || ""}
      </Typography>
      {payload.note ? (
        <Typography sx={{ fontSize: 11.5, color: "#94A3B8", ml: 0.25 }} noWrap>
          {payload.note}
        </Typography>
      ) : null}
    </Box>
  );
}
