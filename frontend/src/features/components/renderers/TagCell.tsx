/** 明细表「标签」单元格：按分隔符切成多个圆角胶囊，文字色跟随该列设置的「颜色」.
 *
 * 从 TableCard 里拆出来（开发规范 §4.1：存量文件只减不增），顺带让「怎么切分」只有一处定义。
 */

import { Box } from "@mui/material";

/** 没设分隔符时按常见分隔符切：中英文逗号 / 顿号 / 竖线 */
const DEFAULT_SEPARATOR = /[,，、|]/;

export function splitTags(text: string, separator?: string): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const sep = String(separator ?? "").trim();
  return (sep ? raw.split(sep) : raw.split(DEFAULT_SEPARATOR)).map((part) => part.trim()).filter(Boolean);
}

/** 把 #RGB / #RRGGBB 转成 10% 透明度的底色（无需引额外工具函数） */
export function tint(color: string): string {
  const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color) ? color : "#2563EB";
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  return `${full}1A`;   // 26/255 ≈ 10%
}

export default function TagCell({
  text, separator, color,
}: {
  text: string;
  separator?: string;
  color?: string;
}) {
  const parts = splitTags(text, separator);
  if (!parts.length) return <>—</>;
  const ink = color || "#2563EB";
  return (
    <Box sx={{ display: "inline-flex", gap: 0.5, flexWrap: "wrap", alignItems: "center" }}>
      {parts.map((part, index) => (
        <Box
          key={`${part}-${index}`}
          component="span"
          sx={{
            px: 0.75,
            height: 18,
            lineHeight: "18px",
            borderRadius: "999px",
            bgcolor: tint(ink),
            color: ink,
            fontSize: 10.5,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {part}
        </Box>
      ))}
    </Box>
  );
}
