/** 明细表的单个列配置卡（可折叠的「选项卡」）.
 *
 * 标题 = 列头（空则用字段名）+ 类型 / 宽度摘要；点标题展开内容。
 * 内容里依次是：字段（拖入框）/ 列头 / 类型 / 对齐 / 分隔符（标签）/ 格式 / 颜色 / 行数 / 宽度。
 * 删除按钮放在标题右侧（hover 才出现），避免收起时找不到入口。
 */

import { useState, type ReactNode } from "react";
import { Box, IconButton, MenuItem, Popover, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Close, ExpandMore } from "@mui/icons-material";
import type { TableColumn } from "../types";
import { AxisInput } from "./AxisInput";
import { ColorSwatches, COLUMN_COLORS } from "./ColorSwatches";
import { GROUP_CARD_SX } from "./PanelSection";
import { Row, fieldSx } from "./Row";
import { COLUMN_FORMATS, parseFormat, sampleOf } from "../skin/patternFormat";

/** 标签按值配色可选的内置颜色（复用列颜色的 7 个实色，去掉「默认」） */
const TAG_COLORS = COLUMN_COLORS.filter((item) => item.value).map((item) => item.value);

const TYPES: { value: TableColumn["type"]; label: string }[] = [
  { value: "text", label: "文本" },
  { value: "number", label: "数值" },
  { value: "percent", label: "百分比" },
  { value: "money", label: "金额" },
  { value: "image", label: "图片" },
  { value: "badge", label: "徽标" },
  { value: "rank", label: "排名" },
  { value: "dual", label: "主副值" },
  { value: "tag", label: "标签" },
  { value: "link", label: "链接" },
  { value: "date", label: "日期" },
];

const TYPE_LABEL: Record<TableColumn["type"], string> = Object.fromEntries(
  TYPES.map((item) => [item.value, item.label]),
) as Record<TableColumn["type"], string>;

/** 格式下拉：跟随整表 + 9 个内置格式串（右侧显示样例，选之前就知道长什么样）。
 *  「跟随整表」用哨兵值 `auto`：MUI 把空串当「未选择」，会显示成一片空白。 */
const FORMATS: { value: string; label: string; sample?: string }[] = [
  { value: "auto", label: "跟随整表" },
  ...COLUMN_FORMATS.map((pattern) => ({ value: pattern, label: pattern, sample: sampleOf(pattern) })),
];

/** 旧文档里存的是枚举值（int / w / pct…），不在新下拉里，仍要显示出来，免得一打开就变成空白 */
const LEGACY_LABEL: Record<string, string> = {
  int: "整数", w: "万", pct: "百分比", money: "金额", date: "日期", text: "原样文本",
};

/** 只有这几种类型的值会走数字格式化，其余类型设「格式」等于无效配置 */
const NUMERIC_TYPES = new Set<TableColumn["type"]>(["number", "percent", "money"]);

interface Props {
  name: string;
  column: TableColumn;
  /** 可换绑的字段（不含自己） */
  options: string[];
  onRebind: (next: string | null) => void;
  onPatch: (patch: Partial<TableColumn>) => void;
  onRemove: () => void;
  /** 拖拽把手（由列表注入，避免整卡可拖影响输入框选择文字） */
  handle?: ReactNode;
  /** 新建的列默认展开，其余默认收起 */
  defaultOpen?: boolean;
}

const selectSx = {
  ...fieldSx,
  flex: 1,
  minWidth: 0,
  borderRadius: "8px",
  fontSize: 12,
  "& .MuiSelect-select": { py: 0.75, fontSize: 12 },
} as const;

export function TableColumnCard({
  name, column, options, onRebind, onPatch, onRemove, handle, defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const numeric = NUMERIC_TYPES.has(column.type);
  const rows = Math.max(1, Number(column.rows) || 1);
  const title = column.label || name;
  const summary = `${TYPE_LABEL[column.type] ?? "文本"} · ${column.width ? `${column.width}px` : "宽度自动"}`;
  /** 标签列「按值配色」：每行 = 标签文本 + 内置色板选的颜色 */
  const valueColorRows = Object.entries(column.value_colors ?? {}) as [string, string][];
  const writeValueColors = (rows: [string, string][]) =>
    onPatch({ value_colors: Object.fromEntries(rows.filter(([text]) => text)) });
  const setValueText = (index: number, next: string) => {
    const rows: [string, string][] = [...valueColorRows];
    rows[index] = [next.trim().slice(0, 20), rows[index]?.[1] ?? TAG_COLORS[0]];
    writeValueColors(rows);
  };
  const setValueColorAt = (index: number, color: string) => {
    const rows: [string, string][] = [...valueColorRows];
    if (!rows[index]) return;
    rows[index] = [rows[index][0], color];
    writeValueColors(rows);
  };
  const [picker, setPicker] = useState<{ anchor: HTMLElement; index: number } | null>(null);
  const legacyFormat: { value: string; label: string; sample?: string }[] = column.format
    && parseFormat(column.format) === null
    && !FORMATS.some((item) => item.value === column.format)
    ? [{ value: column.format, label: `${LEGACY_LABEL[column.format] ?? column.format}（旧）` }]
    : [];
  const formatOptions = [...FORMATS, ...legacyFormat];

  return (
    <Box sx={{ ...GROUP_CARD_SX, gap: open ? 1 : 0, p: 1.25 }} data-column-card={name}>
      {/* 标题 = 列头：点一下展开 / 收起 */}
      <Box
        role="button"
        aria-expanded={open}
        data-slot="column-header"
        onClick={() => setOpen((value) => !value)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", minWidth: 0,
          "&:hover .column-title": { color: "#4F46E5" },
        }}
      >
        {handle}
        {column.color ? (
          <Box sx={{ width: 8, height: 8, borderRadius: "999px", bgcolor: column.color, flexShrink: 0 }} />
        ) : null}
        <Typography
          className="column-title"
          noWrap
          sx={{ fontSize: 12.5, fontWeight: 600, color: "#334155", flex: 1, minWidth: 0, transition: "color .14s" }}
        >
          {title}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: "#94A3B8", flexShrink: 0, mr: 0.25 }}>{summary}</Typography>
        <Box sx={{ display: "inline-flex", transition: "transform .14s", transform: open ? "rotate(180deg)" : "none" }}>
          <ExpandMore sx={{ fontSize: 15, color: "#94A3B8" }} />
        </Box>
        <IconButton
          size="small"
          title="删除该列"
          onClick={(event) => { event.stopPropagation(); onRemove(); }}
          sx={{ flexShrink: 0 }}
        >
          <Close sx={{ fontSize: 15 }} />
        </IconButton>
      </Box>

      {open ? (
        <>
          <Row label="字段">
            <AxisInput value={name} options={options} placeholder="拖到这里" onPick={onRebind} clearable={false} />
          </Row>

          <Row label="列头">
            <TextField
              size="small" fullWidth placeholder="列头" value={column.label} sx={fieldSx}
              inputProps={{ maxLength: 20 }}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
          </Row>

          <Row label="类型">
            <Select
              size="small" value={column.type} sx={selectSx} data-slot="column-type"
              onChange={(event) => onPatch({ type: event.target.value as TableColumn["type"] })}
            >
              {TYPES.map((item) => (
                <MenuItem key={item.value} value={item.value} sx={{ fontSize: 12 }}>{item.label}</MenuItem>
              ))}
            </Select>
          </Row>

          {/* 水平对齐：左 / 中 / 右 */}
          <Row label="对齐">
            <ToggleButtonGroup
              exclusive size="small" value={column.align || "left"} data-slot="column-align"
              onChange={(_event, next) => { if (next) onPatch({ align: next as TableColumn["align"] }); }}
              sx={{
                width: "100%",
                "& .MuiToggleButton-root": {
                  flex: 1, py: 0.25, height: 28, fontSize: 12, textTransform: "none",
                  color: "#64748B", borderColor: "#E2E8F0",
                },
                "& .MuiToggleButton-root.Mui-selected": {
                  color: "#4F46E5", bgcolor: "#EEF2FF", borderColor: "#C7D2FE",
                  "&:hover": { bgcolor: "#E8EDFF" },
                },
              }}
            >
              <ToggleButton value="left" aria-label="左对齐">左</ToggleButton>
              <ToggleButton value="center" aria-label="居中">中</ToggleButton>
              <ToggleButton value="right" aria-label="右对齐">右</ToggleButton>
            </ToggleButtonGroup>
          </Row>

          {/* 标签：一个单元格里怎么切成多个胶囊 */}
          {column.type === "tag" ? (
            <Row label="分隔符">
              <TextField
                size="small" fullWidth value={column.tag_split ?? ""} sx={fieldSx}
                placeholder="默认按 , ， 、 | 切分"
                inputProps={{ maxLength: 4 }}
                onChange={(event) => onPatch({ tag_split: event.target.value })}
              />
            </Row>
          ) : null}

          <Row label="格式">
            <Select
              size="small" value={column.format || "auto"}
              sx={{ ...selectSx, opacity: numeric ? 1 : 0.5 }}
              /* 下拉项里带了样例，但收起来时只显示格式串本身 */
              renderValue={(value) => (value === "auto" ? "跟随整表" : String(value))}
              disabled={!numeric} data-slot="column-format"
              title={numeric ? "按该列类型显示" : "只有数值 / 百分比 / 金额列支持格式"}
              onChange={(event) => onPatch({ format: event.target.value === "auto" ? "" : event.target.value })}
            >
              {formatOptions.map((item) => (
                <MenuItem
                  key={item.value || "auto"}
                  value={item.value}
                  sx={{ fontSize: 12, gap: 2, justifyContent: "space-between", minWidth: 168 }}
                >
                  <span>{item.label}</span>
                  {item.sample ? (
                    <Box component="span" sx={{ ml: "auto", color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>
                      {item.sample}
                    </Box>
                  ) : null}
                </MenuItem>
              ))}
            </Select>
          </Row>

          <Row label="颜色">
            <ColorSwatches value={column.color} onChange={(next) => onPatch({ color: next })} />
          </Row>

          <Row label="行数">
            <TextField
              size="small" type="number" value={rows} sx={{ ...fieldSx, maxWidth: 96 }}
              inputProps={{ min: 1, max: 4, step: 1 }}
              onChange={(event) => {
                const next = Math.max(1, Math.min(4, Number(event.target.value) || 1));
                onPatch({ rows: next });
              }}
            />
            <Box sx={{ fontSize: 10.5, color: "#94A3B8", ml: 0.5 }}>最多显示几行</Box>
          </Row>

          <Row label="宽度">
            <TextField
              size="small" type="number" value={column.width || ""} placeholder="自动" sx={{ ...fieldSx, maxWidth: 96 }}
              inputProps={{ min: 0, max: 420, step: 8 }}
              onChange={(event) => {
                const next = Math.max(0, Math.min(420, Number(event.target.value) || 0));
                onPatch({ width: next });
              }}
            />
            <Box sx={{ fontSize: 10.5, color: "#94A3B8", ml: 0.5 }}>0 = 自动</Box>
          </Row>

          {/* 标签列：按值配色（标签文本 → 内置色板里的颜色） */}
          {column.type === "tag" ? (
            <>
              <Box sx={{ mt: 1, mb: 0.75, fontSize: 11.5, fontWeight: 600, color: "#64748B" }}>按值配色</Box>
              {valueColorRows.map(([text, color], index) => (
                <Stack key={index} direction="row" spacing={0.75} alignItems="center"
                  sx={{ mb: 0.75 }} data-slot="tag-color-row">
                  <TextField
                    size="small" placeholder="标签文本" value={text}
                    onChange={(event) => setValueText(index, event.target.value)}
                    inputProps={{ maxLength: 20 }}
                    sx={fieldSx}
                  />
                  <Box
                    data-slot="tag-color-pick"
                    title="选颜色"
                    onClick={(event) => setPicker({ anchor: event.currentTarget, index })}
                    sx={{
                      width: 28, height: 28, flexShrink: 0, cursor: "pointer",
                      bgcolor: color || TAG_COLORS[0], borderRadius: "6px",
                      border: "1px solid rgba(15,23,42,0.08)",
                      "&:hover": { boxShadow: "0 0 0 2px #E2E8F0" },
                    }}
                  />
                  <IconButton size="small" title="删除这行"
                    onClick={() => writeValueColors(valueColorRows.filter((_, i) => i !== index))}>
                    <Close sx={{ fontSize: 15 }} />
                  </IconButton>
                </Stack>
              ))}
              <Box
                onClick={() => onPatch({ value_colors: { ...(column.value_colors ?? {}), "": TAG_COLORS[0] } })}
                data-slot="tag-color-add"
                sx={{
                  mt: 0.5, px: 1.25, py: 0.75, fontSize: 11.5, color: "#6366F1", textAlign: "center",
                  border: "1px dashed #C7D2FE", borderRadius: "8px", cursor: "pointer",
                  "&:hover": { borderColor: "#A5B4FC", bgcolor: "rgba(99,102,241,0.04)" },
                }}
              >
                ＋ 添加一行
              </Box>
              <Popover
                open={Boolean(picker)}
                anchorEl={picker?.anchor ?? null}
                onClose={() => setPicker(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              >
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0.75, p: 1 }}>
                  {TAG_COLORS.map((color) => (
                    <Box
                      key={color}
                      data-color={color}
                      onClick={() => { if (picker) setValueColorAt(picker.index, color); setPicker(null); }}
                      sx={{
                        width: 22, height: 22, borderRadius: "999px", bgcolor: color, cursor: "pointer",
                        border: "1px solid rgba(15,23,42,0.08)",
                        "&:hover": { boxShadow: "0 0 0 2px #fff, 0 0 0 3px #6366F1" },
                      }}
                    />
                  ))}
                </Box>
              </Popover>
            </>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
