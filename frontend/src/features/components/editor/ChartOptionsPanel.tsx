/** 运算自定义 + 坐标轴 / 饼图参数（编辑页中栏） */

import { Box, MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { chartOf, computeOf } from "../skin/format";
import { PanelSection } from "./PanelSection";
import { Row, fieldSx } from "./Row";
import type { ComponentKind, ComponentSpec } from "../types";

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

const groupSx = { "& .MuiToggleButton-root": { px: 1, py: 0.25, fontSize: 11.5, borderRadius: "8px !important" } } as const;

interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** all = 全部（默认）；text = 只要文字部分；axis = 只要坐标轴 / 显示开关（柱状图把这块搬进「附加」用） */
  mode?: "all" | "text" | "axis" | "pie" | "prefs" | "elements";
}

export default function ChartOptionsPanel({ kind, spec, onChange, mode = "all" }: Props) {
  const chart = chartOf(spec.chart);
  const combo = spec.combo ?? { bar_name: "", line_name: "", right_axis: true, smooth: true };
  const setCombo = (patch: Partial<typeof combo>) => onChange({ ...spec, combo: { ...combo, ...patch } });
  const setChart = (patch: Partial<typeof chart>) =>
    onChange({ ...spec, chart: { ...chart, ...patch } });

  const isAxis = AXIS_KINDS.includes(kind);
  const isPie = PIE_KINDS.includes(kind);
  const isCombo = kind === "combo";

  // 分节标题没有数值，也没有运算/图例
  if (kind === "section") return null;

  /** 坐标轴 / 显示开关这块要不要画（柱状图只在这里画，文字在另一处） */
  const showAxisBlock = mode === "all" || mode === "axis";
  const showPrefsBlock = mode === "all" || mode === "prefs";
  const showTextBlock = mode === "all" || mode === "text";

  return (
    <Box>
      {/* ── 饼图参数（环形图的「附加」用它） ── */}
      {isPie && (mode === "all" || mode === "pie") && (
        <>
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            <Row label="内径 %">
              <TextField size="small" type="number" value={chart.pie_inner}
                onChange={(e) => setChart({ pie_inner: Number(e.target.value) })}
                sx={fieldSx} />
            </Row>
            <Row label="起始角">
              <TextField size="small" type="number" value={chart.pie_start}
                onChange={(e) => setChart({ pie_start: Number(e.target.value) })}
                sx={fieldSx} />
            </Row>
            <Row label="标签内容">
              <TextField select size="small" value={chart.pie_label}
                onChange={(e) => setChart({ pie_label: e.target.value as never })}
                sx={fieldSx}>
                {PIE_LABELS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
              </TextField>
            </Row>
            <Row label="文字位置">
              <ToggleButtonGroup exclusive size="small" value={chart.label_layout || "inside"}
                onChange={(_, v) => v !== null && setChart({ label_layout: v as "inside" | "beside" | "outside" })}
                sx={{ ...groupSx, flex: 1, gap: 1 }}>
                <ToggleButton value="inside" sx={{ flex: 1 }}>图形上</ToggleButton>
                <ToggleButton value="beside" sx={{ flex: 1 }}>图形旁</ToggleButton>
                <ToggleButton value="outside" sx={{ flex: 1 }}>图形外</ToggleButton>
              </ToggleButtonGroup>
            </Row>
          </Stack>
        </>
      )}

      {showTextBlock && (<>
        {/* ── 文字：卡片标题 / 右上说明 / 系列名 / 轴标题 —— 所有「可改名字」的地方收在同一组 ── */}
        <PanelSection title="文字" collapsible defaultOpen={false}>
        <Stack spacing={1}>
          <Row label="卡片标题">
            <TextField size="small" value={spec.title}
              onChange={(e) => onChange({ ...spec, title: e.target.value })}
              sx={fieldSx} />
          </Row>
          <Row label={kind === "kpi" || kind === "insight" ? "副标题" : "右上说明"}>
            <TextField size="small" value={spec.subtitle || ""}
              placeholder={spec.binding.metric || "留空 = 指标名"}
              onChange={(e) => onChange({ ...spec, subtitle: e.target.value })}
              sx={fieldSx} />
          </Row>
          {isCombo && (
            <>
              <Row label="柱名称">
                <TextField size="small" value={combo.bar_name}
                  onChange={(e) => setCombo({ bar_name: e.target.value.slice(0, 16) })}
                  sx={fieldSx} />
              </Row>
              <Row label="线名称">
                <TextField size="small" value={combo.line_name}
                  onChange={(e) => setCombo({ line_name: e.target.value.slice(0, 16) })}
                  sx={fieldSx} />
              </Row>
            </>
          )}
          {isAxis && (
            <>
              <Row label="横轴标题">
                <TextField size="small" value={chart.x_title}
                  placeholder={spec.binding.dimension || "不显示"}
                  onChange={(e) => setChart({ x_title: e.target.value })}
                  sx={fieldSx} />
              </Row>
              <Row label="纵轴标题">
                <TextField size="small" value={chart.y_title}
                  placeholder={spec.binding.metric || "不显示"}
                  onChange={(e) => setChart({ y_title: e.target.value })}
                  sx={fieldSx} />
              </Row>
            </>
          )}
        </Stack>
      </PanelSection>

      {/* ── 散点的三种画法 ── */}
      {kind === "scatter" && (
        <PanelSection title="散点">
          <ToggleButtonGroup exclusive size="small" value={chart.scatter_mode}
            onChange={(_, v) => v !== null && setChart({
              scatter_mode: v,
              ...(v === "point" ? { size_key: "" } : {}),
            })}
            sx={{ ...groupSx, mb: 1.5 }}>
            <ToggleButton value="point">点</ToggleButton>
            <ToggleButton value="bubble">气泡</ToggleButton>
            <ToggleButton value="quadrant">四象限</ToggleButton>
          </ToggleButtonGroup>
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            <Row label="点大小">
              <TextField size="small" type="number" value={chart.dot_size ?? 8}
                onChange={(e) => setChart({ dot_size: Math.max(3, Math.min(24, Number(e.target.value) || 8)) })}
                sx={fieldSx} />
            </Row>
            <Row label="横轴刻度">
              <TextField select size="small" value={chart.log_x ? "log" : "linear"}
                onChange={(e) => setChart({ log_x: e.target.value === "log" })}
                sx={fieldSx}>
                <MenuItem value="linear" sx={{ fontSize: 12.5 }}>线性</MenuItem>
                <MenuItem value="log" sx={{ fontSize: 12.5 }}>对数</MenuItem>
              </TextField>
            </Row>
            <Row label="纵轴刻度">
              <TextField select size="small" value={chart.log_y ? "log" : "linear"}
                onChange={(e) => setChart({ log_y: e.target.value === "log" })}
                sx={fieldSx}>
                <MenuItem value="linear" sx={{ fontSize: 12.5 }}>线性</MenuItem>
                <MenuItem value="log" sx={{ fontSize: 12.5 }}>对数</MenuItem>
              </TextField>
            </Row>
          </Stack>
        </PanelSection>
        )}
      </>)}

      {isCombo && showPrefsBlock && (
        <PanelSection title="首选项">
          {isCombo && (
            <Row label="柱 / 线">
              <Box sx={{ flex: 1, minWidth: 0, display: "flex", gap: 1 }}>
                <ToggleButton value="axis" size="small" selected={combo.right_axis}
                  onChange={() => setCombo({ right_axis: !combo.right_axis })}
                  sx={groupSx["& .MuiToggleButton-root"]}>右轴</ToggleButton>
                <ToggleButton value="smooth" size="small" selected={combo.smooth}
                  onChange={() => setCombo({ smooth: !combo.smooth })}
                  sx={groupSx["& .MuiToggleButton-root"]}>曲线平滑</ToggleButton>
              </Box>
            </Row>
          )}
          {isCombo && <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="elements" />}
        </PanelSection>
      )}

      {/* ── 坐标轴（柱/线/散点/热力/组合） ── */}
      {showAxisBlock && isAxis && (
        <>
          {/* 在「附加」里用的时候外层已经有「坐标轴」标题了，这里不再重复 */}
          {mode !== "axis" && (
            <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.75, mt: 1.5 }}>
              坐标轴
            </Typography>
          )}
          <Stack spacing={1} sx={{ mb: 1.5 }}>
            <Row label="Y 最小">
              <TextField size="small" type="number" value={chart.y_min ?? ""}
                onChange={(e) => setChart({ y_min: e.target.value === "" ? null : Number(e.target.value) })}
                sx={fieldSx} />
            </Row>
            <Row label="Y 最大">
              <TextField size="small" type="number" value={chart.y_max ?? ""}
                onChange={(e) => setChart({ y_max: e.target.value === "" ? null : Number(e.target.value) })}
                sx={fieldSx} />
            </Row>
            {kind === "bar" && (
              <Row label="柱宽">
                <TextField size="small" type="number" value={chart.bar_width}
                  onChange={(e) => setChart({ bar_width: Number(e.target.value) })}
                  sx={fieldSx} />
              </Row>
            )}
            <Row label="数值格式">
              <TextField select size="small" value={chart.label_format}
                onChange={(e) => setChart({ label_format: e.target.value as never })}
                sx={fieldSx}>
                {LABEL_FORMATS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
              </TextField>
            </Row>
            <Row label="标签旋转">
              <TextField select size="small" value={chart.label_rotate ?? 0}
                onChange={(e) => setChart({ label_rotate: Number(e.target.value) })}
                sx={fieldSx}>
                {ROTATES.map((r) => (
                  <MenuItem key={r} value={r} sx={{ fontSize: 12.5 }}>{r ? `${r}°` : "自动"}</MenuItem>
                ))}
              </TextField>
            </Row>
          </Stack>
        </>
      )}

      {/* ── 显示开关（只列该图适用的；明细表没有数值标签/图例） ── */}
      {((mode === "elements") || (showPrefsBlock && isAxis && !(isCombo && mode === "prefs")) || ((mode === "all" || mode === "pie") && isPie)) && (
      <Row label="组件元素" mb={0}>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexWrap: "wrap", gap: 1 }}>
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
        {(isPie && (mode === "all" || mode === "pie")) && (
          <ToggleButton
            value="gap" size="small" selected={chart.pie_gap}
            onChange={() => setChart({ pie_gap: !chart.pie_gap })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            分隔
          </ToggleButton>
        )}
        {(isPie && (mode === "all" || mode === "pie")) && (
          <ToggleButton
            value="rose" size="small" selected={chart.pie_rose}
            onChange={() => setChart({ pie_rose: !chart.pie_rose })}
            sx={groupSx["& .MuiToggleButton-root"]}
          >
            玫瑰图
          </ToggleButton>
        )}
      </Box>
      </Row>
      )}
    </Box>
  );
}
