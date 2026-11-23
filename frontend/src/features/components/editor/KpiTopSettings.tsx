/** 指标卡「徽标弹窗」——点右上角徽标弹出指定明细表（组件特有） */

import { Autocomplete, Box, MenuItem, Switch, TextField } from "@mui/material";
import { Row, fieldSx } from "./Row";
import type { ComponentSpec, SortDir } from "../types";

type TopSpec = NonNullable<ComponentSpec["top"]>;

export function KpiTopSettings({ spec, onChange, tables = [], hideBadge = false, switchLabel = "徽标弹窗" }: {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** 页面上的明细表（弹窗目标，带列清单） */
  tables?: { key: string; label: string; columns?: { key: string; label: string }[] }[];
  /** 环形图没有「右上胶囊」，只留弹窗开关 */
  hideBadge?: boolean;
  /** 开关文案：指标卡叫「徽标弹窗」，环形图叫「点击弹窗」 */
  switchLabel?: string;
}) {
  const top: TopSpec = spec.top ?? {
    enabled: false, title: "", dim: "", metric: "", agg: "SUM", top_n: 10, columns: [], page_size: 10,
  };
  const setTop = (patch: Partial<TopSpec> & { table_key?: string }) =>
    onChange({ ...spec, top: { ...top, ...patch } as TopSpec });
  const tableKey = (top as TopSpec & { table_key?: string }).table_key ?? "";
  /** 排序列候选 = 弹出那张明细表的列 */
  const tableColumns = tables.find((table) => table.key === tableKey)?.columns ?? [];

  return (
    <Box>
      {!hideBadge && (
        <Row label="右上胶囊">
          <TextField size="small" placeholder="如 TOP10（留空则不显示）"
            value={spec.ui?.badge ?? ""}
            onChange={(e) => onChange({ ...spec, ui: { ...spec.ui, badge: e.target.value } })}
            inputProps={{ "aria-label": "右上胶囊文本", maxLength: 24 }}
            sx={fieldSx} />
        </Row>
      )}
      <Row label={switchLabel}>
        <Switch
          size="small"
          checked={!!top.enabled}
          onChange={(e) => setTop({ enabled: e.target.checked })}
          sx={{ ml: -0.75 }}
        />
      </Row>
      {top.enabled && (
        <>
          <Row label="弹出明细表">
            <TextField select size="small" value={tableKey}
              onChange={(e) => setTop({ table_key: e.target.value, sort_field: "" })}
              sx={fieldSx}>
              <MenuItem value="" sx={{ fontSize: 12.5 }}>不指定（先拖一张明细表）</MenuItem>
              {tables.map((table) => (
                <MenuItem key={table.key} value={table.key} sx={{ fontSize: 12.5 }}>{table.label}</MenuItem>
              ))}
            </TextField>
          </Row>
          {tableKey && (
            <>
              <Row label="排序列">
                <Autocomplete
                  size="small"
                  options={tableColumns.map((column) => column.key)}
                  value={top.sort_field || null}
                  onChange={(_, field) => {
                    /* 选了列就默认降序，否则「排序列选了、排序还是不指定」看着像没生效 */
                    setTop({ sort_field: field ?? "", sort: field ? (top.sort || "desc") : top.sort });
                  }}
                  getOptionLabel={(key) => tableColumns.find((c) => c.key === key)?.label ?? key}
                  renderInput={(params) => (
                    <TextField {...params} size="small" placeholder="输入或选择列"
                      inputProps={{ ...params.inputProps, "aria-label": "排序列" }} sx={fieldSx} />
                  )}
                  sx={{ flex: 1, minWidth: 0 }}
                />
              </Row>
              <Row label="排序">
                <TextField select size="small" value={top.sort ?? ""}
                  onChange={(e) => setTop({ sort: e.target.value as SortDir })}
                  inputProps={{ "aria-label": "排序方向" }}
                  sx={fieldSx}>
                  <MenuItem value="" sx={{ fontSize: 12.5 }}>不指定</MenuItem>
                  <MenuItem value="desc" sx={{ fontSize: 12.5 }}>降序</MenuItem>
                  <MenuItem value="asc" sx={{ fontSize: 12.5 }}>升序</MenuItem>
                </TextField>
              </Row>
            </>
          )}
        </>
      )}
    </Box>
  );
}
