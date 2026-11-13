/** 外观与计算规则（编辑页中栏底部）—— 配色 / 格式 / 高度 / KPI 取数规则 */

import { useEffect, useState } from "react";
import { Box, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import type { Accent, ComponentKind, ComponentSpec } from "../types";

const ACCENTS: [Accent, string][] = [
  ["indigo", "#6366F1"], ["teal", "#10B981"], ["amber", "#F59E0B"], ["rose", "#F43F5E"],
  ["violet", "#8B5CF6"], ["sky", "#0EA5E9"], ["slate", "#64748B"],
];
const FORMATS: [string, string][] = [
  ["int", "整数"], ["w", "万"], ["pct", "百分比"], ["money", "金额"], ["date", "日期"], ["text", "文本"],
];
const HEADLINES: [string, string][] = [
  ["first", "首条"], ["max", "最大"], ["min", "最小"], ["mode", "众数"], ["latest", "最新"], ["total", "合计"],
];
const SHADOWS: [string, string][] = [["0", "无"], ["10", "弱"], ["16", "中"], ["26", "强"]];
const EDGE_WIDTHS: [string, string][] = [
  ["0.5", "极细 0.5px"], ["1", "细 1px"], ["1.5", "较细 1.5px"],
  ["2", "中 2px"], ["3", "粗 3px"],
];
const EDGE_ALPHAS: [string, string][] = [["10", "淡"], ["22", "常规"], ["36", "深"], ["52", "浓"]];
const HINTS: [string, string][] = [
  ["sum_topn", "前N合计"], ["avg_topn", "前N平均"], ["count_topn", "前N名计数"],
  ["total", "全量合计"], ["none", "不显示"],
];

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } } as const;

interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** 卡片当前高度（来自版面 layout.h）；改高度直接改版面 */
  height?: number;
  onResize?: (height: number) => void;
}

export default function StylePanel({ kind, spec, onChange, height, onResize }: Props) {
  const setUi = (patch: Partial<ComponentSpec["ui"]>) =>
    onChange({ ...spec, ui: { ...spec.ui, ...patch } });
  const setCompute = (patch: Partial<ComponentSpec["compute"]>) =>
    onChange({ ...spec, compute: { ...spec.compute, ...patch } });

  // 圆角：只对头标卡开放（其余卡片形状是写死的）
  const currentRadius = Math.round(spec.ui.radius ?? 12);
  const [radiusText, setRadiusText] = useState(String(currentRadius));
  useEffect(() => { setRadiusText(String(currentRadius)); }, [currentRadius]);
  const commitRadius = () => {
    const value = Math.round(Number(radiusText));
    if (!Number.isFinite(value)) { setRadiusText(String(currentRadius)); return; }
    setUi({ radius: Math.max(0, Math.min(value, 28)) });
  };

  // 高度：输入过程中不抖，失焦/回车才落到版面上
  const currentHeight = height ?? spec.ui.min_height;
  const [heightText, setHeightText] = useState(String(currentHeight));
  useEffect(() => { setHeightText(String(currentHeight)); }, [currentHeight]);
  const commitHeight = () => {
    const value = Math.round(Number(heightText));
    if (!Number.isFinite(value) || value < 60) { setHeightText(String(currentHeight)); return; }
    setUi({ min_height: value });
    onResize?.(value);
  };

  /** 头标卡 / 导航菜单卡的外观：两列网格，尺寸 → 阴影 → 描边细项，边缘齐 */
  if (kind === "banner" || kind === "nav") {
    const edgeOn = spec.ui.edge !== false;
    return (
      <Box>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1.25 }}>外观</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <TextField size="small" type="number" label="高度" value={heightText}
            onChange={(e) => setHeightText(e.target.value)}
            onBlur={commitHeight}
            onKeyDown={(e) => { if (e.key === "Enter") commitHeight(); }}
            sx={fieldSx} />
          <TextField size="small" type="number" label="圆角" value={radiusText}
            onChange={(e) => setRadiusText(e.target.value)}
            onBlur={commitRadius}
            onKeyDown={(e) => { if (e.key === "Enter") commitRadius(); }}
            inputProps={{ min: 0, max: 28, step: 1 }}
            sx={fieldSx} />
          <TextField select size="small" label="阴影" value={String(Math.round(spec.ui.shadow_px ?? 16))}
            onChange={(e) => setUi({ shadow_px: Number(e.target.value) })}
            sx={{ gridColumn: "1 / -1", ...fieldSx }}>
            {SHADOWS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
          </TextField>
        </Box>

        {/* 描边同属「外观」，不画分割线，只用行距分组：右侧开关，线宽/深浅挂在它下面 */}
        <Box
          onClick={() => setUi({ edge: !edgeOn })}
          sx={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            mt: 2.5, mb: edgeOn ? 1.25 : 0, mx: -1, px: 1, py: 0.5, borderRadius: 1.5,
            cursor: "pointer", transition: "background-color .12s",
            "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
          }}
        >
          <Typography sx={{ fontSize: 12.5, fontWeight: 500, color: "#334155" }}>描边</Typography>
          {/* 不要负边距/自定义内边距：那会把轨道推出面板、拇指也会垂到轨道外 */}
          <Switch size="small" checked={edgeOn}
            onChange={(e) => setUi({ edge: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
            sx={{ mr: 0, ml: 1 }} />
        </Box>

        {edgeOn && (
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <TextField select size="small" label="线宽" value={String(spec.ui.edge_px ?? 1)}
              onChange={(e) => setUi({ edge_px: Number(e.target.value) })}
              sx={fieldSx}>
              {EDGE_WIDTHS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
            <TextField select size="small" label="深浅" value={String(Math.round(spec.ui.edge_alpha ?? 22))}
              onChange={(e) => setUi({ edge_alpha: Number(e.target.value) })}
              sx={fieldSx}>
              {EDGE_ALPHAS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1.25 }}>外观</Typography>
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: 2 }}>
        {ACCENTS.map(([key, color]) => (
          <Box
            key={key}
            onClick={() => setUi({ accent: key })}
            sx={{
              width: 20, height: 20, borderRadius: "50%", cursor: "pointer",
              bgcolor: color,
              outline: spec.ui.accent === key ? `2px solid ${color}` : "none",
              outlineOffset: 2,
              transition: "transform .14s",
              "&:hover": { transform: "scale(1.12)" },
            }}
          />
        ))}
      </Box>

      <Stack direction="row" spacing={1} sx={{ mb: 1.75 }}>
        {kind !== "section" && (
        <TextField select size="small" label="数字格式" value={spec.compute.format}
          onChange={(e) => setCompute({ format: e.target.value as ComponentSpec["compute"]["format"] })}
          sx={{ flex: 1, ...fieldSx }}>
          {FORMATS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
        </TextField>
        )}
        {kind === "kpi" && (
          <TextField size="small" label="徽标" placeholder="TOP10" value={spec.ui.badge ?? ""}
            onChange={(e) => setUi({ badge: e.target.value })}
            sx={{ width: 84, ...fieldSx }} />
        )}
        <TextField size="small" type="number" label="高度" value={heightText}
          onChange={(e) => setHeightText(e.target.value)}
          onBlur={commitHeight}
          onKeyDown={(e) => { if (e.key === "Enter") commitHeight(); }}
          sx={{ width: 84, ...fieldSx }} />
      </Stack>

      {kind === "kpi" && (
        <Stack direction="row" spacing={1}>
          <TextField select size="small" label="大数字" value={spec.compute.headline}
            onChange={(e) => setCompute({ headline: e.target.value as ComponentSpec["compute"]["headline"] })}
            sx={{ flex: 1, ...fieldSx }}>
            {HEADLINES.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="副标题规则" value={spec.compute.hint}
            onChange={(e) => setCompute({ hint: e.target.value as ComponentSpec["compute"]["hint"] })}
            sx={{ flex: 1, ...fieldSx }}>
            {HINTS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
          </TextField>
        </Stack>
      )}
    </Box>
  );
}
