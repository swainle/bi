/** 外观与计算规则（编辑页中栏底部）—— 配色 / 格式 / 高度 / KPI 取数规则 */

import { useEffect, useState } from "react";
import { Autocomplete, Box, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { CLOUD_PALETTES } from "../skin/tokens";
import { Row, fieldSx } from "./Row";
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

interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** 卡片当前高度（来自版面 layout.h）；改高度直接改版面 */
  height?: number;
  onResize?: (height: number) => void;
  /** 指标卡「徽标弹窗」用的字段候选 */
  metricOptions?: { name: string; role?: string }[];
  dimensionOptions?: { name: string; role?: string }[];
  identifierOptions?: { name: string; role?: string }[];
}

export default function StylePanel({
  kind, spec, onChange, height, onResize,
  metricOptions = [], dimensionOptions = [], identifierOptions = [],
}: Props) {
  const setUi = (patch: Partial<ComponentSpec["ui"]>) =>
    onChange({ ...spec, ui: { ...spec.ui, ...patch } });
  const setCompute = (patch: Partial<ComponentSpec["compute"]>) =>
    onChange({ ...spec, compute: { ...spec.compute, ...patch } });
  const setChart = (patch: Partial<ComponentSpec["chart"]>) =>
    onChange({ ...spec, chart: { ...spec.chart, ...patch } });
  /** 指标卡右上角徽标的弹窗（独立的 TOP N 榜单） */
  const top = spec.top ?? {
    enabled: false, title: "", dim: "", metric: "", agg: "SUM", top_n: 10, columns: [], page_size: 10,
  };
  const setTop = (patch: Partial<typeof top>) =>
    onChange({ ...spec, top: { ...top, ...patch } });
  /** 徽标里带数字就用它当默认条数（TOP10 → 10） */
  const badgeTopN = (() => {
    const hit = /TOP\s*(\d+)/i.exec(spec.ui.badge || "");
    const value = hit ? Number(hit[1]) : 0;
    return Number.isFinite(value) && value > 0 ? value : 10;
  })();
  /* 开关早就开着、但维度/指标是空的（早期在候选还没加载时打开过）：补上默认值，
     否则弹窗一点就报「没有配置指标」，看着像功能坏了 */
  useEffect(() => {
    if (kind !== "kpi" || !top.enabled) return;
    const dim = top.dim || dimensionOptions.find((f) => f.name.includes("标题"))?.name
      || dimensionOptions[0]?.name || "";
    const metric = top.metric || spec.binding.metric || metricOptions[0]?.name || "";
    if (!dim && !metric) return;
    if (dim === top.dim && metric === top.metric) return;
    setTop({ dim, metric, agg: top.agg || "SUM" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, top.enabled, top.dim, top.metric, dimensionOptions, metricOptions]);

  const columnChoices = [
    ...dimensionOptions.map((f) => f.name),
    ...identifierOptions.map((f) => f.name),
  ].filter((name, index, list) => list.indexOf(name) === index);

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

  /** 头标卡 / 导航菜单卡的外观：尺寸 → 阴影 → 描边细项，边缘齐 */
  if (kind === "banner" || kind === "nav") {
    const edgeOn = spec.ui.edge !== false;
    return (
      <Box>
        <Stack spacing={1}>
          <Row label="高度">
            <TextField size="small" type="number" value={heightText}
              onChange={(e) => setHeightText(e.target.value)}
              onBlur={commitHeight}
              onKeyDown={(e) => { if (e.key === "Enter") commitHeight(); }}
              sx={fieldSx} />
          </Row>
          <Row label="圆角">
            <TextField size="small" type="number" value={radiusText}
              onChange={(e) => setRadiusText(e.target.value)}
              onBlur={commitRadius}
              onKeyDown={(e) => { if (e.key === "Enter") commitRadius(); }}
              inputProps={{ min: 0, max: 28, step: 1 }}
              sx={fieldSx} />
          </Row>
          <Row label="阴影">
            <TextField select size="small" value={String(Math.round(spec.ui.shadow_px ?? 16))}
              onChange={(e) => setUi({ shadow_px: Number(e.target.value) })}
              sx={fieldSx}>
              {SHADOWS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
          </Row>
        </Stack>

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
          <Stack spacing={1}>
            <Row label="线宽">
              <TextField select size="small" value={String(spec.ui.edge_px ?? 1)}
                onChange={(e) => setUi({ edge_px: Number(e.target.value) })}
                sx={fieldSx}>
                {EDGE_WIDTHS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
              </TextField>
            </Row>
            <Row label="深浅">
              <TextField select size="small" value={String(Math.round(spec.ui.edge_alpha ?? 22))}
                onChange={(e) => setUi({ edge_alpha: Number(e.target.value) })}
                sx={fieldSx}>
                {EDGE_ALPHAS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
              </TextField>
            </Row>
          </Stack>
        )}
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>颜色</Typography>
        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
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
      </Box>

      {kind === "wordcloud" && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1 }}>主题色</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
            {CLOUD_PALETTES.map((palette) => {
              const active = (spec.chart.cloud_palette || CLOUD_PALETTES[0].name) === palette.name;
              return (
                <Box
                  key={palette.name}
                  onClick={() => setChart({ cloud_palette: palette.name })}
                  sx={{
                    px: 1, py: 0.75, borderRadius: 1.5, cursor: "pointer",
                    border: `1px solid ${active ? "#4F46E5" : "#D8E2F5"}`,
                    bgcolor: active ? "rgba(79,70,229,0.04)" : "#fff",
                    transition: "border-color .14s, background-color .14s, transform .14s",
                    "&:hover": { borderColor: "#4F46E5", transform: "translateY(-1px)" },
                  }}
                >
                  <Box sx={{ display: "flex", gap: "3px", mb: 0.5 }}>
                    {palette.colors.slice(0, 6).map((color, index) => (
                      <Box key={`${palette.name}-${index}`}
                        sx={{ flex: 1, height: 6, borderRadius: "3px", bgcolor: color }} />
                    ))}
                  </Box>
                  <Typography sx={{
                    fontSize: 11, textAlign: "center",
                    color: active ? "#4F46E5" : "#64748B", fontWeight: active ? 600 : 400,
                  }}>
                    {palette.name}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      <Stack spacing={1} sx={{ mb: 1.75 }}>
        {kind !== "section" && (
          <Row label="数字格式">
            <Autocomplete
              size="small"
              options={FORMATS.map(([v]) => v)}
              value={spec.compute.format}
              onChange={(_, value) => setCompute({ format: (value || "int") as ComponentSpec["compute"]["format"] })}
              getOptionLabel={(v) => FORMATS.find(([fv]) => fv === v)?.[1] || v}
              renderInput={(params) => (
                <TextField {...params} size="small" placeholder="整数" sx={fieldSx} />
              )}
              sx={{ flex: 1, minWidth: 0 }}
            />
          </Row>
        )}
        <Row label="高度">
          <TextField size="small" type="number" value={heightText}
            onChange={(e) => setHeightText(e.target.value)}
            onBlur={commitHeight}
            onKeyDown={(e) => { if (e.key === "Enter") commitHeight(); }}
            sx={fieldSx} />
        </Row>
      </Stack>

      {kind === "kpi" && (
        <Stack spacing={1}>
          <Row label="大数字">
            <TextField select size="small" value={spec.compute.headline}
              onChange={(e) => setCompute({ headline: e.target.value as ComponentSpec["compute"]["headline"] })}
              sx={fieldSx}>
              {HEADLINES.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
          </Row>
          <Row label="副标题规则">
            <TextField select size="small" value={spec.compute.hint}
              onChange={(e) => setCompute({ hint: e.target.value as ComponentSpec["compute"]["hint"] })}
              sx={fieldSx}>
              {HINTS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
          </Row>
        </Stack>
      )}
    </Box>
  );
}
