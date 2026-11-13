/** 运算自定义 + 坐标轴 / 饼图参数（编辑页中栏） */

import { useState } from "react";
import { Box, Button, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import { chartOf, computeOf } from "../skin/format";
import { PanelSection } from "./PanelSection";
import type { ComponentKind, ComponentSpec } from "../types";

const TRANSFORMS: [string, string][] = [
  ["raw", "原值"], ["share", "占比%"], ["index", "指数化(首条=100)"],
  ["delta", "环比差值"], ["cumsum", "累计值"],
];
const ROTATES = [0, 30, 45, 90];
const LABEL_FORMATS: [string, string][] = [
  ["auto", "自动"], ["int", "整数"], ["w", "万"], ["k", "千分位"], ["pct", "百分比"],
];
const PIE_LABELS: [string, string][] = [
  ["name_pct", "名称+百分比"], ["pct", "仅百分比"], ["name", "仅名称"],
  ["value", "仅数值"], ["none", "不显示"],
];

const AXIS_KINDS: ComponentKind[] = ["bar", "line", "area", "scatter", "heatmap", "combo"];
const PIE_KINDS: ComponentKind[] = ["pie", "donut"];

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } } as const;
const groupSx = { "& .MuiToggleButton-root": { px: 1, py: 0.25, fontSize: 11.5, borderRadius: "8px !important" } } as const;

interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
}

export default function ChartOptionsPanel({ kind, spec, onChange }: Props) {
  const compute = computeOf(spec.compute);
  const chart = chartOf(spec.chart);
  const combo = spec.combo ?? { bar_name: "", line_name: "", right_axis: true, smooth: true };
  const setCombo = (patch: Partial<typeof combo>) => onChange({ ...spec, combo: { ...combo, ...patch } });
  const setCompute = (patch: Partial<typeof compute>) =>
    onChange({ ...spec, compute: { ...compute, ...patch } });
  const setChart = (patch: Partial<typeof chart>) =>
    onChange({ ...spec, chart: { ...chart, ...patch } });

  const isAxis = AXIS_KINDS.includes(kind);
  const isPie = PIE_KINDS.includes(kind);
  const isCombo = kind === "combo";

  // 分节标题没有数值，也没有运算/图例
  if (kind === "section") return null;

  return (
    <Box>
      {/* ── 饼图参数 ── */}
      {isPie && (
        <>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.75, mt: 1.5 }}>
            环形
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" type="number" label="内径 %" value={chart.pie_inner}
              onChange={(e) => setChart({ pie_inner: Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
            <TextField size="small" type="number" label="起始角" value={chart.pie_start}
              onChange={(e) => setChart({ pie_start: Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
          </Stack>
          <TextField select size="small" fullWidth label="标签内容" value={chart.pie_label}
            onChange={(e) => setChart({ pie_label: e.target.value as never })}
            sx={{ mb: 1.5, ...fieldSx }}>
            {PIE_LABELS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
          </TextField>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.75 }}>
            文字位置
          </Typography>
          <ToggleButtonGroup exclusive size="small" value={chart.label_layout || "inside"}
            onChange={(_, v) => v !== null && setChart({ label_layout: v as "inside" | "beside" | "outside" })}
            sx={{ ...groupSx, mb: 2 }}>
            <ToggleButton value="inside">图形上</ToggleButton>
            <ToggleButton value="beside">图形旁</ToggleButton>
            <ToggleButton value="outside">图形外</ToggleButton>
          </ToggleButtonGroup>
        </>
      )}

      {/* ── 文字：卡片标题 / 右上说明 / 系列名 / 轴标题 —— 所有「可改名字」的地方收在同一组 ── */}
      <PanelSection title="文字">
        <Stack spacing={2}>
          <TextField size="small" fullWidth label="卡片标题" value={spec.title}
            onChange={(e) => onChange({ ...spec, title: e.target.value })}
            sx={fieldSx} />
          <TextField size="small" fullWidth label={kind === "kpi" || kind === "insight" ? "副标题" : "右上说明"} value={spec.subtitle || ""}
            placeholder={spec.binding.metric || "留空 = 指标名"}
            onChange={(e) => onChange({ ...spec, subtitle: e.target.value })}
            sx={fieldSx} />
          {isCombo && (
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth label="柱名称" value={combo.bar_name}
                onChange={(e) => setCombo({ bar_name: e.target.value.slice(0, 16) })}
                sx={fieldSx} />
              <TextField size="small" fullWidth label="线名称" value={combo.line_name}
                onChange={(e) => setCombo({ line_name: e.target.value.slice(0, 16) })}
                sx={fieldSx} />
            </Stack>
          )}
          {isAxis && (
            <Stack direction="row" spacing={1}>
              <TextField size="small" fullWidth label="横轴标题" value={chart.x_title}
                placeholder={spec.binding.dimension || "不显示"}
                onChange={(e) => setChart({ x_title: e.target.value })}
                sx={fieldSx} />
              <TextField size="small" fullWidth label="纵轴标题" value={chart.y_title}
                placeholder={spec.binding.metric || "不显示"}
                onChange={(e) => setChart({ y_title: e.target.value })}
                sx={fieldSx} />
            </Stack>
          )}
        </Stack>
      </PanelSection>

      {/* ── 散点的三种画法 ── */}
      {kind === "scatter" && (
        <PanelSection title="散点">
          <ToggleButtonGroup exclusive size="small" value={chart.scatter_mode}
            onChange={(_, v) => v !== null && setChart({
              scatter_mode: v,
              /* 切到点模式就把气泡字段清掉，避免留着一个不生效的配置 */
              ...(v === "point" ? { size_key: "" } : {}),
            })}
            sx={{ ...groupSx, mb: 1.5 }}>
            <ToggleButton value="point">点</ToggleButton>
            <ToggleButton value="bubble">气泡</ToggleButton>
            <ToggleButton value="quadrant">四象限</ToggleButton>
          </ToggleButtonGroup>
          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            <TextField size="small" type="number" label="点大小" value={chart.dot_size ?? 8}
              onChange={(e) => setChart({ dot_size: Math.max(3, Math.min(24, Number(e.target.value) || 8)) })}
              sx={{ width: 96, ...fieldSx }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="横轴刻度" value={chart.log_x ? "log" : "linear"}
              onChange={(e) => setChart({ log_x: e.target.value === "log" })}
              sx={{ flex: 1, ...fieldSx }}>
              <MenuItem value="linear" sx={{ fontSize: 12.5 }}>线性</MenuItem>
              <MenuItem value="log" sx={{ fontSize: 12.5 }}>对数</MenuItem>
            </TextField>
            <TextField select size="small" label="纵轴刻度" value={chart.log_y ? "log" : "linear"}
              onChange={(e) => setChart({ log_y: e.target.value === "log" })}
              sx={{ flex: 1, ...fieldSx }}>
              <MenuItem value="linear" sx={{ fontSize: 12.5 }}>线性</MenuItem>
              <MenuItem value="log" sx={{ fontSize: 12.5 }}>对数</MenuItem>
            </TextField>
          </Stack>
        </PanelSection>
      )}

      {isCombo && (
        <PanelSection title="柱 · 线">
          <Stack direction="row" spacing={1}>
            <Button size="small" variant={combo.right_axis ? "contained" : "outlined"}
              onClick={() => setCombo({ right_axis: !combo.right_axis })}
              sx={{ textTransform: "none", fontSize: 12 }}>右轴</Button>
            <Button size="small" variant={combo.smooth ? "contained" : "outlined"}
              onClick={() => setCombo({ smooth: !combo.smooth })}
              sx={{ textTransform: "none", fontSize: 12 }}>曲线平滑</Button>
          </Stack>
        </PanelSection>
      )}

      {/* ── 坐标轴（柱/线/散点/热力/组合） ── */}
      {isAxis && (
        <>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.75, mt: 1.5 }}>
            坐标轴
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" type="number" label="Y 最小" value={chart.y_min ?? ""}
              onChange={(e) => setChart({ y_min: e.target.value === "" ? null : Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
            <TextField size="small" type="number" label="Y 最大" value={chart.y_max ?? ""}
              onChange={(e) => setChart({ y_max: e.target.value === "" ? null : Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
            {kind === "bar" && (
              <TextField size="small" type="number" label="柱宽" value={chart.bar_width}
                onChange={(e) => setChart({ bar_width: Number(e.target.value) })}
                sx={{ width: 88, ...fieldSx }} />
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ mb: 2, alignItems: "center" }}>
            <TextField select size="small" label="数值格式" value={chart.label_format}
              onChange={(e) => setChart({ label_format: e.target.value as never })}
              sx={{ flex: 1, ...fieldSx }}>
              {LABEL_FORMATS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
            <ToggleButtonGroup exclusive size="small" value={chart.label_rotate}
              onChange={(_, v) => v !== null && setChart({ label_rotate: v })} sx={groupSx}>
              {ROTATES.map((r) => <ToggleButton key={r} value={r}>{r || "自动"}</ToggleButton>)}
            </ToggleButtonGroup>
          </Stack>
        </>
      )}

      {/* ── 显示开关（只列该图适用的；明细表没有数值标签/图例） ── */}
      {(isAxis || isPie) && (
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        <ToggleButton
          value="title" size="small" selected={chart.show_title !== false}
          onChange={() => setChart({ show_title: chart.show_title === false })}
          sx={groupSx["& .MuiToggleButton-root"]}
        >
          标题
        </ToggleButton>
        <ToggleButton
          value="meta" size="small" selected={chart.show_meta !== false}
          onChange={() => setChart({ show_meta: chart.show_meta === false })}
          sx={groupSx["& .MuiToggleButton-root"]}
        >
          说明
        </ToggleButton>
        <ToggleButton
          value="labels" size="small" selected={chart.show_labels}
          onChange={() => setChart({ show_labels: !chart.show_labels })}
          sx={groupSx["& .MuiToggleButton-root"]}
        >
          数值
        </ToggleButton>
        {isAxis && (
          <ToggleButton
            value="grid" size="small" selected={chart.show_grid}
            onChange={() => setChart({ show_grid: !chart.show_grid })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            网格
          </ToggleButton>
        )}
        <ToggleButton
          value="legend" size="small" selected={chart.show_legend}
          onChange={() => setChart({ show_legend: !chart.show_legend })}
          sx={groupSx["& .MuiToggleButton-root"]}
        >
          图例
        </ToggleButton>
        {kind === "scatter" && (
          <ToggleButton
            value="trend" size="small" selected={!!chart.trend_line}
            onChange={() => setChart({ trend_line: !chart.trend_line })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            趋势线
          </ToggleButton>
        )}
        {isPie && (
          <ToggleButton
            value="gap" size="small" selected={chart.pie_gap}
            onChange={() => setChart({ pie_gap: !chart.pie_gap })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            分隔
          </ToggleButton>
        )}
        {isPie && (
          <ToggleButton
            value="rose" size="small" selected={chart.pie_rose}
            onChange={() => setChart({ pie_rose: !chart.pie_rose })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            玫瑰图
          </ToggleButton>
        )}
      </Stack>
      )}
    </Box>
  );
}
