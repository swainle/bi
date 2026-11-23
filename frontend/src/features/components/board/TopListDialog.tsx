/** 指标卡徽标弹窗 —— 直接显示「指定的明细表」（透明无框，点行可弹抽屉）。
 *  打开时按指标卡配置的「排序列 / 排序」给一份默认排序；只作用于这份弹窗组件，
 *  关闭时组件卸载即恢复，页面上的明细表不受影响。 */

import { Box, Dialog } from "@mui/material";
import TableCard from "../renderers/TableCard";
import type { RenderPayload, SortDir, UiSpec } from "../types";

const tableUi: UiSpec = {
  accent: "indigo", radius: 8, min_height: 220, show_unit: false, animate: false, align: "left", columns: 1,
};

export default function TopListDialog({ open, onClose, payload, sortField = "", sort = "", filter = null }: {
  open: boolean;
  onClose: () => void;
  /** 按「点击的数据」过滤（环形图 / 组合图点扇区、柱子） */
  filter?: { column: string; value: string } | null;
  /** 弹窗要显示的明细表渲染结果（看板渲染里的 cards[table_key]） */
  payload?: RenderPayload | null;
  /** 排序列（空 = 用明细表自己的顺序） */
  sortField?: string;
  /** 排序方向（空 = 不指定） */
  sort?: SortDir;
}) {
  const initialSort = sortField && sort ? { key: sortField, desc: sort === "desc" } : null;
  /* 点哪个扇区 / 柱子，就只看那一行对应的明细 */
  const shown = payload && filter?.column && filter.value
    ? {
      ...payload,
      rows: (payload.rows ?? []).filter((row) => String((row as Record<string, unknown>)[filter.column] ?? "") === filter.value),
    }
    : payload;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "transparent", boxShadow: "none", border: "none", outline: "none",
          backdropFilter: "none", overflow: "visible",
          /* 透明纸不接点击：点表格以外的空白会落到遮罩上 → 关闭（只给表格本体开 pointer-events） */
          pointerEvents: "none",
        },
      }}
    >
      <Box sx={{ width: "92vw", maxWidth: 1400, height: "82vh", mx: "auto", pointerEvents: "auto" }}>
        {shown ? <TableCard payload={shown} ui={tableUi} initialSort={initialSort} /> : null}
      </Box>
    </Dialog>
  );
}
