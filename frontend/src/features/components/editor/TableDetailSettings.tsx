/** 明细表「弹窗」设置：开关 + 选画板 + 弹出方式 + 行标识列
 *
 *  弹窗内容 = 所选画板区域内的组件（画布上框出来的区域）。
 */

import { Box, MenuItem, Switch, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { PanelSection } from "./PanelSection";
import type { ComponentSpec } from "../types";

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } } as const;

interface Props {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** 行标识列候选（表格已选的列） */
  columns: string[];
  /** 页面上的画板（key + 名称） */
  boards?: { key: string; label: string }[];
}

export default function TableDetailSettings({ spec, onChange, columns, boards = [] }: Props) {
  const view = spec.table_view ?? ({ columns: [], sortable: false, page_size: 10, more: true, more_label: "", index_column: true } as ComponentSpec["table_view"]);
  const detail = view.detail ?? { enabled: false, key_field: "", items: [], board_key: "", popup: "right" as const };

  const patch = (next: Partial<typeof detail>) =>
    onChange({ ...spec, table_view: { ...view, detail: { ...detail, ...next } } });

  return (
    <PanelSection title="弹窗">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: detail.enabled ? 1.5 : 0 }}>
        <Typography sx={{ fontSize: 12.5, color: "#334155" }}>点击行弹出</Typography>
        <Switch
          size="small" checked={!!detail.enabled}
          onChange={(e) => {
            /* 打开弹窗顺手把行标识列补上（不补 = 点哪行都显示全量数据） */
            const key = detail.key_field || columns[0] || "";
            patch({ enabled: e.target.checked, ...(e.target.checked && key ? { key_field: key } : {}) });
          }}
          sx={{ mr: -0.75 }}
        />
      </Box>

      {detail.enabled && (
        <>
          <TextField
            select size="small" fullWidth label="弹窗画板" value={detail.board_key || ""}
            onChange={(e) => patch({ board_key: e.target.value })}
            helperText={boards.length ? "画板区域内的组件就是弹窗内容" : "先点工具栏「画板」框一块区域"}
            FormHelperTextProps={{ sx: { fontSize: 10.5, mx: 0, mt: 0.5 } }}
            sx={{ mb: 1.5, ...fieldSx }}
          >
            {boards.length === 0 && <MenuItem value="" disabled sx={{ fontSize: 12.5 }}>还没有画板</MenuItem>}
            {boards.map((board) => (
              <MenuItem key={board.key} value={board.key} sx={{ fontSize: 12.5 }}>{board.label}</MenuItem>
            ))}
          </TextField>

          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", mb: 0.75 }}>弹出位置</Typography>
          <ToggleButtonGroup
            exclusive size="small" fullWidth value={detail.popup || "right"}
            onChange={(_, value) => { if (value) patch({ popup: value }); }}
            sx={{ mb: 1.5, "& .MuiToggleButton-root": { py: 0.5, fontSize: 11.5, textTransform: "none", borderRadius: 1.5 } }}
          >
            <ToggleButton value="left">左侧</ToggleButton>
            <ToggleButton value="center">中间</ToggleButton>
            <ToggleButton value="right">右侧</ToggleButton>
          </ToggleButtonGroup>

          <TextField
            select size="small" fullWidth label="行标识列" value={detail.key_field || ""}
            onChange={(e) => patch({ key_field: e.target.value })}
            helperText="弹窗里的组件按这一列 = 当前行取数"
            FormHelperTextProps={{ sx: { fontSize: 10.5, mx: 0, mt: 0.5 } }}
            sx={{ ...fieldSx }}
          >
            <MenuItem value="" sx={{ fontSize: 12.5 }}>（不按行过滤）</MenuItem>
            {columns.map((column) => (
              <MenuItem key={column} value={column} sx={{ fontSize: 12.5 }}>{column}</MenuItem>
            ))}
          </TextField>
        </>
      )}
    </PanelSection>
  );
}
