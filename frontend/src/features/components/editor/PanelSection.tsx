/** 面板排版基元 —— 所有组件配置面板共用同一套「面板标题 + 分区标题」节奏 */

import { useState, type ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { ExpandMore } from "@mui/icons-material";

/** 面板标题（最上面一行，如「头标卡」「明细表」） */
export function PanelTitle({ children }: { children: ReactNode }) {
  return (
    <Typography sx={{ fontSize: 12, fontWeight: 700, color: "#0F172A", mb: 1.75 }}>
      {children}
    </Typography>
  );
}

/** 分区：11.5/600 的小标题 + 12 的下间距；first=true 时不额外留上边距。
 *  collapsible=true 时标题可点击折叠（默认展开，箭头随状态旋转）。 */
export function PanelSection({
  title, action, first, children, collapsible = true, defaultOpen = true,
}: {
  title: ReactNode;
  action?: ReactNode;
  first?: boolean;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <Box
      onClick={collapsible ? () => setOpen((v) => !v) : undefined}
      sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        mb: open ? 1.25 : 0,
        cursor: collapsible ? "pointer" : "default",
        color: collapsible ? "#64748B" : undefined,
        "&:hover": collapsible ? { color: "#4F46E5" } : undefined,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: collapsible ? "inherit" : "#64748B" }}>{title}</Typography>
        {collapsible && (
          <Box sx={{ display: "inline-flex", transition: "transform .14s", transform: open ? "rotate(180deg)" : "none" }}>
            <ExpandMore sx={{ fontSize: 15 }} />
          </Box>
        )}
      </Box>
      {action ? <Box onClick={(e) => e.stopPropagation()}>{action}</Box> : null}
    </Box>
  );
  return (
    <Box sx={{ mt: 0, mb: 2 }}>
      {header}
      {open && children}
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
