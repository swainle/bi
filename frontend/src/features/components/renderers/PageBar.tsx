/** 明细表分页条 —— 总数 + 每页条数 + 页码（‹ 1 2 3 … 5 ›）。
 *  纯前端翻页：数据仍是一次取回的行（明细表最多 2000 行），这里只切显示。
 *
 *  对齐口径（2026-11-21 修）：整行是一个 24px 高的 flex 行，
 *  文字 / 下拉框 / 页码 / 箭头全部按「24px 行高 + 11.5px 字号」垂直居中，
 *  不再各自用不同的 line-height（之前下拉框高 1.5px、页码低 0.8px，看起来不齐）。 */

import { Box, IconButton, MenuItem, Select, Typography } from "@mui/material";
import { ChevronLeft, ChevronRight, ExpandMore, MoreHoriz } from "@mui/icons-material";
import { PAGE_SIZES, pageItems } from "./pagerItems";

interface Props {
  total: number;
  /** 当前页，从 1 开始 */
  page: number;
  pageSize: number;
  accent: string;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

/** 分页条行高：文字、页码方块、箭头共用，保证同一条水平线 */
const ROW_H = 24;
const FONT = { fontSize: 11.5, lineHeight: `${ROW_H}px` } as const;
const MUTED = "#94A3B8";
const INK = "#64748B";

export default function PageBar({ total, page, pageSize, accent, onPage, onPageSize }: Props) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);

  const numberSx = (active: boolean) => ({
    width: ROW_H,
    height: ROW_H,
    p: 0,
    border: 0,
    borderRadius: "8px",
    display: "block",
    textAlign: "center" as const,
    cursor: "pointer",
    font: "inherit",
    fontSize: 11.5,
    // 与「共 N 条 / 每页 X 条」用同一个 24px 行盒 —— 基线才会真的在同一条线上
    lineHeight: `${ROW_H}px`,
    fontVariantNumeric: "tabular-nums",
    bgcolor: active ? accent : "transparent",
    color: active ? "#fff" : INK,
    transition: "background .12s, color .12s",
    "&:hover": active ? {} : { bgcolor: "rgba(15,23,42,0.05)", color: "#0F172A" },
  });

  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 1, flexWrap: "wrap", pt: 1, mt: 0.5, borderTop: "1px solid #F4F7FC", flexShrink: 0,
    }}>
      <Typography sx={{ ...FONT, color: MUTED, whiteSpace: "nowrap" }}>
        共 {Math.max(0, total)} 条
      </Typography>

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, height: ROW_H }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, height: ROW_H }}>
          <Typography sx={{ ...FONT, color: MUTED, whiteSpace: "nowrap" }}>每页</Typography>
          <Select
            variant="standard"
            disableUnderline
            value={pageSize}
            IconComponent={ExpandMore}
            onChange={(event) => onPageSize(Number(event.target.value))}
            inputProps={{ "aria-label": "每页条数" }}
            sx={{
              ...FONT,
              color: INK,
              height: ROW_H,
              "& .MuiSelect-select": {
                py: 0, pr: "18px !important", minHeight: ROW_H, boxSizing: "border-box",
                fontSize: 11.5, lineHeight: `${ROW_H}px`,
              },
              "& .MuiSvgIcon-root": { fontSize: 16, color: MUTED, right: 0, top: "calc(50% - 8px)" },
            }}
          >
            {Array.from(new Set([...PAGE_SIZES, pageSize])).sort((a, b) => a - b).map((size) => (
              <MenuItem key={size} value={size} sx={{ fontSize: 12, minHeight: 28 }}>{size}</MenuItem>
            ))}
          </Select>
          <Typography sx={{ ...FONT, color: MUTED, whiteSpace: "nowrap" }}>条</Typography>
        </Box>

        <IconButton
          size="small" aria-label="上一页" disabled={current <= 1}
          onClick={() => onPage(current - 1)}
          sx={{ width: ROW_H, height: ROW_H, p: 0, color: INK }}
        >
          <ChevronLeft sx={{ fontSize: 16 }} />
        </IconButton>

        {pageItems(current, pages).map((item, index) => (
          item === "ellipsis" ? (
            <Box
              key={`gap-${index}`}
              sx={{ width: 14, height: ROW_H, display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <MoreHoriz sx={{ fontSize: 14, color: MUTED }} />
            </Box>
          ) : (
            <Box
              key={item}
              component="button"
              type="button"
              aria-label={`第 ${item} 页`}
              aria-current={item === current ? "page" : undefined}
              onClick={() => onPage(item)}
              sx={numberSx(item === current)}
            >
              {item}
            </Box>
          )
        ))}

        <IconButton
          size="small" aria-label="下一页" disabled={current >= pages}
          onClick={() => onPage(current + 1)}
          sx={{ width: ROW_H, height: ROW_H, p: 0, color: INK }}
        >
          <ChevronRight sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
}
