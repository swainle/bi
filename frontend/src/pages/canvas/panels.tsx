/** 画布编辑器 · 选中元素的配置面板（筛选栏字段 / 文字 / 形状） */

import { useState } from "react";
import { Box, Chip, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { ContentCopy } from "@mui/icons-material";

import SharedFilterFieldsEditor from "../../features/components/editor/FilterFieldsEditor";
import { filterWithFields } from "../../features/components/split";
import { SHAPE_DEFAULT, SHAPE_KINDS, SHAPE_LABEL, ShapeIcon, shapeOf } from "../../features/components/shapes";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { ComponentSpec, ShapeSpec } from "../../features/components/types";

export function FilterFieldsEditor({ item, columns, fieldOptions, datasetId, platform, onChange, onEmpty, onDatasetChange }: {
  item: CanvasItem;
  columns: string[];
  fieldOptions?: { name: string; role?: string }[];
  datasetId: number | null;
  platform?: string;
  onChange: (spec: ComponentSpec) => void;
  onEmpty?: () => void;
  /** 绑字段弹窗里换数据集：改的是这个筛选栏的 binding.dataset_id */
  onDatasetChange?: (id: number) => void;
}) {
  return (
    <SharedFilterFieldsEditor
      platform={platform}
      onEmpty={onEmpty}
      onDatasetChange={onDatasetChange}
      fields={item.spec.filter?.fields ?? []}
      fieldsMap={item.spec.filter?.fields_map}
      columns={columns}
      fieldOptions={fieldOptions}
      datasetId={datasetId}
      onChange={(fields) => onChange({ ...item.spec, filter: filterWithFields(item.spec.filter, fields) })}
      onFieldsMapChange={(fields_map) => onChange({
        ...item.spec,
        filter: { ...(item.spec.filter || { inline: true }), fields: item.spec.filter?.fields ?? [], fields_map },
      })}
      background={!!item.spec.filter?.background}
      onBackgroundChange={(background) => onChange({
        ...item.spec,
        filter: { ...(item.spec.filter || { inline: true }), fields: item.spec.filter?.fields ?? [], background },
      })}
    />
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.7 }}>{text}</Typography>
    </Box>
  );
}

/** 复制到剪贴板（navigator.clipboard 在非安全上下文 / 失焦时会失败，退回 execCommand） */
export function copyText(text: string) {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }
}

/** 页面 / 元素 ID 胶囊：点一下复制，用来精确定位「哪个看板哪一页的哪个元素」 */
export function IdChip({ label, value, onCopied }: { label: string; value: string; onCopied: (label: string) => void }) {
  return (
    <Box
      role="button"
      title={`点击复制${label} ID`}
      onClick={() => { copyText(value); onCopied(label); }}
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.5,
        px: 0.75, py: 0.2, borderRadius: "6px",
        bgcolor: "rgba(15,23,42,0.035)", cursor: "pointer",
        fontSize: 10.5, color: "#475569",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        transition: "background-color .12s",
        "&:hover": { bgcolor: "rgba(15,23,42,0.07)" },
      }}
    >
      <Box component="span" sx={{ color: "#94A3B8", fontFamily: "inherit", fontSize: 10 }}>{label}</Box>
      {value}
      <ContentCopy sx={{ fontSize: 10.5, color: "#B6C2D2" }} />
    </Box>
  );
}

/** 形状参数的数值输入：编辑时留草稿（能正常输 0.1），失焦 / 回车才提交并夹到区间 */
export function ShapeNumberField({ value, min, max, step = 1, onCommit }: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    const next = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : value;
    onCommit(Math.round(next * 100) / 100);
    setDraft(null);
  };
  return (
    <TextField
      size="small"
      value={shown}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
      inputProps={{ inputMode: "decimal", min, max, step }}
      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 }, width: 96 }}
    />
  );
}

/** 形状的配色板：页面既有令牌里的主色 + 中性灰，另给一个系统取色器和「无」 */
export const SHAPE_SWATCHES = ["#E9EFFB", "#CBD5E1", "#64748B", "#0F172A", "#4F46E5", "#0EA5E9", "#10B981", "#F59E0B", "#F43F5E"];

export function ColorSwatches({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const current = (value || "").toLowerCase();
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
      {SHAPE_SWATCHES.map((color) => (
        <Box
          key={color}
          role="button"
          aria-label={color}
          onClick={() => onChange(color)}
          sx={{
            width: 18, height: 18, borderRadius: "50%", bgcolor: color, cursor: "pointer",
            boxShadow: current === color.toLowerCase()
              ? "0 0 0 2px #fff, 0 0 0 3.5px #4F46E5"
              : "inset 0 0 0 1px rgba(15,23,42,0.1)",
            transition: "box-shadow .12s",
          }}
        />
      ))}
      <Box component="label" title="自定义颜色" sx={{
        position: "relative", width: 18, height: 18, borderRadius: "50%", cursor: "pointer",
        display: "grid", placeItems: "center", border: "1px dashed #CBD5E1",
        color: "#94A3B8", fontSize: 11, lineHeight: 1,
      }}>
        +
        <Box component="input" type="color" value={value || "#000000"}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: 0, p: 0, cursor: "pointer" }} />
      </Box>
      <Chip size="small" label="无" onClick={() => onChange("")}
        sx={{
          height: 18, fontSize: 10.5, "& .MuiChip-label": { px: 0.75 },
          bgcolor: value ? "transparent" : "rgba(15,23,42,0.06)",
          border: "1px solid #E8EEF8",
        }} />
    </Box>
  );
}

export function ElementForm({ item, onChange }: { item: CanvasItem; onChange: (patch: Partial<CanvasItem>) => void }) {
  const label = (text: string) => (
    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5, letterSpacing: 0.2 }}>{text}</Typography>
  );

  /* 形状元素（老的分割线 = 直线）：形状 / 填充 / 描边 / 圆角 / 翻转 */
  if (item.type === "divider") {
    const shape = shapeOf(item.spec?.shape);
    const setShape = (patch: Partial<ShapeSpec>) => onChange({
      spec: { ...item.spec, shape: { ...shape, ...patch } },
    });
    const numberField = (value: number, min: number, max: number, onSet: (next: number) => void, step = 1) => (
      <ShapeNumberField value={value} min={min} max={max} step={step} onCommit={onSet} />
    );
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.75 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>形状</Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 0.75 }}>
          {SHAPE_KINDS.map((kind) => (
            <Box
              key={kind}
              role="button"
              title={SHAPE_LABEL[kind]}
              onClick={() => setShape({
                kind,
                /* 从别的形状切回矩形时给个默认圆角，别一上来就是尖角 */
                ...(kind === "rect" && !shape.radius ? { radius: SHAPE_DEFAULT.rect.radius } : {}),
              })}
              sx={{
                height: 32, borderRadius: 1.5, display: "grid", placeItems: "center", cursor: "pointer",
                color: kind === shape.kind ? "#4F46E5" : "#64748B",
                bgcolor: kind === shape.kind ? "rgba(79,70,229,0.08)" : "transparent",
                border: "1px solid",
                borderColor: kind === shape.kind ? "rgba(79,70,229,0.32)" : "#EEF3FB",
                "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
              }}
            >
              <ShapeIcon kind={kind} size={15} />
            </Box>
          ))}
        </Box>

        <Box>
          {label("填充")}
          <ColorSwatches value={shape.fill} onChange={(fill) => setShape({ fill })} />
        </Box>

        <Box>
          {label("描边")}
          <ColorSwatches
            value={shape.stroke}
            onChange={(stroke) => setShape({ stroke, stroke_w: stroke && !shape.stroke_w ? 2 : shape.stroke_w })}
          />
        </Box>

        {shape.kind === "line" ? (
          <Box>
            {label("线粗")}
            {/* 任意数值，最小 0.1：0.5 = 半像素细线 */}
            {numberField(shape.stroke_w || 0.1, 0.1, 40, (stroke_w) => setShape({ stroke_w }), 0.1)}
          </Box>
        ) : shape.stroke ? (
          <Box>
            {label("描边宽度")}
            {numberField(shape.stroke_w || 2, 0, 40, (stroke_w) => setShape({ stroke_w }), 0.1)}
          </Box>
        ) : null}

        {shape.kind === "rect" && (
          <Box>
            {label("圆角")}
            {numberField(shape.radius || 0, 0, 200, (radius) => setShape({ radius }))}
          </Box>
        )}

        {shape.kind !== "line" && (
          <Box>
            {label("翻转")}
            <ToggleButtonGroup
              size="small"
              value={[shape.flip_x ? "x" : "", shape.flip_y ? "y" : ""].filter(Boolean)}
              onChange={(_, next: string[]) => setShape({ flip_x: next.includes("x"), flip_y: next.includes("y") })}
              sx={{ "& .MuiToggleButton-root": { px: 1.5, py: 0.4, fontSize: 11.5, textTransform: "none" } }}
            >
              <ToggleButton value="x">水平</ToggleButton>
              <ToggleButton value="y">垂直</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0F172A" }}>
        {item.type === "heading" ? "标题元素" : "文字元素"}
      </Typography>

      <Box>
        {label(item.type === "heading" ? "标题" : "文字")}
        <TextField
          size="small" fullWidth multiline minRows={item.type === "heading" ? 1 : 4}
          value={item.text || ""}
          onChange={(e) => onChange({ text: e.target.value })}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }}
        />
      </Box>

      {item.type === "heading" && (
        <>
          <Box>
            {label("说明")}
            <TextField size="small" fullWidth value={item.note || ""}
              onChange={(e) => onChange({ note: e.target.value })}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
          </Box>
          <Box>
            {label("编号")}
            <TextField size="small" fullWidth value={item.index || ""}
              onChange={(e) => onChange({ index: e.target.value.slice(0, 4) })}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
          </Box>
        </>
      )}

      {item.type === "text" && (
        <>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              {label("字号")}
              <TextField size="small" fullWidth type="number" value={item.size ?? 13}
                onChange={(e) => onChange({ size: Number(e.target.value) })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
            </Box>
            <Box sx={{ flex: 1 }}>
              {label("字重")}
              <TextField size="small" fullWidth type="number" value={item.weight ?? 400}
                onChange={(e) => onChange({ weight: Number(e.target.value) })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
            </Box>
          </Box>
          <Box>
            {label("对齐")}
            <ToggleButtonGroup exclusive size="small" value={item.align || "left"}
              onChange={(_, next) => next && onChange({ align: next })}
              sx={{ "& .MuiToggleButton-root": { px: 1.5, py: 0.4, fontSize: 11.5, textTransform: "none" } }}>
              <ToggleButton value="left">左</ToggleButton>
              <ToggleButton value="center">中</ToggleButton>
              <ToggleButton value="right">右</ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </>
      )}
    </Box>
  );
}

/** 筛选栏字段编辑器 —— 字段 / 控件类型 / 绑定数据集列 / 选项 */
