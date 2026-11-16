/** 面板排版基元 —— 所有组件配置面板共用同一套「面板标题 + 分区标题」节奏 */

import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

/** 面板标题（最上面一行，如「头标卡」「明细表」） */
export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#0F172A", mb: 1.75 }}>
      {children}
    </Typography>
  );
}

/** 分区：11.5/600 的小标题 + 12 的下间距；first=true 时不额外留上边距 */
export function PanelSection({
  title, action, first, children,
}: {
  title: ReactNode;
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <Box sx={{ mt: first ? 0 : 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B" }}>{title}</Typography>
        {action}
      </Box>
      {children}
    </Box>
  );
}

/** 重复项的浅底卡片（统计项 / 菜单项 / 按钮 …）；删除按钮 hover 才出现 */
export const GROUP_CARD_SX = {
  border: "1px solid #EEF3FB",
  borderRadius: 2,
  bgcolor: "#FBFCFE",
  p: 1.5,
  display: "flex",
  flexDirection: "column",
  gap: 1.75,
  "& .MuiIconButton-root": { opacity: 0, transition: "opacity .12s" },
  "&:hover .MuiIconButton-root, &:focus-within .MuiIconButton-root": { opacity: 1 },
} as const;
