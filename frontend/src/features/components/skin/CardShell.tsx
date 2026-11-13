/** 卡片外壳 —— 左侧色条标题 + 右侧说明 + 底部注释（对齐榜单端卡片样式） */

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { CARD, TEXT } from "./tokens";

interface Props {
  title: string;
  accent: string;
  meta?: ReactNode;
  note?: string;
  children: ReactNode;
  padding?: number;
  compact?: boolean;   // 缩略图模式：只画图体
  /** 隐藏标题（留出图体的空间） */
  hideTitle?: boolean;
}

export default function CardShell({ title, accent, meta, note, children, padding = 16, compact, hideTitle }: Props) {
  return (
    <Box
      sx={{
        ...CARD,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        p: compact ? "8px" : `${padding}px`,
        boxSizing: "border-box",
      }}
    >
      {!compact && !hideTitle && (
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.25, flexShrink: 0, minWidth: 0 }}>
        <Typography
          sx={{
            ...TEXT.title,
            flex: 1,
            minWidth: 0,
            pl: 1.25,
            borderLeft: `3px solid ${accent}`,
            lineHeight: 1.25,
          }}
          noWrap
        >
          {title}
        </Typography>
        {meta ? (
          <Typography sx={{ ...TEXT.meta, flexShrink: 0, whiteSpace: "nowrap", ml: 1 }}>{meta}</Typography>
        ) : null}
      </Box>
      )}

      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</Box>

      {note && !compact ? (
        <Typography sx={{ ...TEXT.note, mt: 1, flexShrink: 0 }} noWrap>
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}
