/** 列文字颜色：8 个色块（默认 + 7 色），值写 TableColumn.color */

import { Box, Tooltip } from "@mui/material";

/** 空串 = 跟随表格默认灰；其余为文字颜色 */
export const COLUMN_COLORS: { value: string; label: string }[] = [
  { value: "", label: "默认" },
  { value: "#0F172A", label: "深黑" },
  { value: "#E11D48", label: "红" },
  { value: "#F59E0B", label: "橙" },
  { value: "#10B981", label: "绿" },
  { value: "#0EA5E9", label: "蓝" },
  { value: "#6366F1", label: "紫" },
  { value: "#64748B", label: "灰" },
];

interface Props {
  value?: string;
  onChange: (next: string) => void;
}

export function ColorSwatches({ value, onChange }: Props) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      {COLUMN_COLORS.map((item) => {
        const active = (value || "") === item.value;
        return (
          <Tooltip key={item.label} title={item.label} placement="top" disableInteractive>
            <Box
              role="button"
              aria-label={`颜色 ${item.label}`}
              data-color={item.value}
              onClick={() => onChange(item.value)}
              sx={{
                width: 18,
                height: 18,
                borderRadius: "999px",
                cursor: "pointer",
                bgcolor: item.value || "#fff",
                border: item.value ? "1px solid rgba(15,23,42,0.08)" : "1px dashed #C7D2FE",
                boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #6366F1" : "none",
                transition: "box-shadow .14s",
                "&:hover": { boxShadow: active ? "0 0 0 2px #fff, 0 0 0 4px #6366F1" : "0 0 0 2px #E2E8F0" },
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}
