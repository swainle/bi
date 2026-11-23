/** 面板配置行：左说明（76 宽）+ 右控件。全组件配置项统一用它，保证左边缘对齐。 */
import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";

export function Row({ label, children, mb = 0.5 }: { label: string; children: ReactNode; mb?: number }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb }}>
      <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>{label}</Typography>
      {children}
    </Box>
  );
}

/** 配置控件统一样式：圆角 8px、字号 12 */
export const fieldSx = {
  flex: 1,
  minWidth: 0,
  "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12 },
} as const;
