/** 查询面板（编辑页中栏）—— 维度 / 指标 / 过滤 / 行限制，对应 spec.binding */

import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Chip, Divider, IconButton, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { Add, Close, ExpandMore } from "@mui/icons-material";
import ChartOptionsPanel from "./ChartOptionsPanel";
import TableDetailSettings from "./TableDetailSettings";
import { BANNER_TONES } from "../renderers/BannerCard";
import StylePanel from "./StylePanel";
import DataCheckPanel from "./DataCheckPanel";
import { GROUP_CARD_SX, PanelSection, PanelTitle } from "./PanelSection";
import { KIND_LABEL } from "../registry";
import { axisLabels } from "./axisLabels";
import ComputeFields from "./ComputeFields";
import type { BannerStat, ComponentItem, ComponentKind, ComponentSpec, FieldOption, RenderPayload } from "../types";

import { AGG, GRAINS, IMAGE_KEY, NEEDS_DIMENSION, OPS, STRONG_IMAGE_KEY, dash } from "./queryConstants";
import type { Props } from "./queryTypes";
import { Slot } from "./Slot";
import { AxisInput } from "./AxisInput";

export function TableFieldsEditor({
  spec, onChange, metricOptions, dimensionOptions, identifierOptions, payload,
}: {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  metricOptions: FieldOption[];
  dimensionOptions: FieldOption[];
  identifierOptions: FieldOption[];
  payload?: RenderPayload | null;
}) {
  const b = spec.binding;
  const fields = b.dimensions ?? [];

  const setFields = (next: string[]) => {
    onChange({
      ...spec,
      binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: next,
        sort_field: next.includes(b.sort_field ?? "") ? b.sort_field : "" },
      table_view: { ...spec.table_view, columns: spec.table_view.columns.filter((column) => next.includes(column.key)) },
    });
  };
  const add = (name: string) => {
    if (fields.includes(name)) return;
    setFields([...fields, name]);
  };
  const remove = (name: string) => setFields(fields.filter((n) => n !== name));

  /** 拖动重排：字段顺序 = 表格列顺序 */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  /** 放 ref 里：drop 紧跟 dragstart 时 state 还没刷新 */
  const dragFromRef = useRef<number | null>(null);
  const moveField = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    setFields(next);
  };

  const groups: [string, FieldOption[]][] = [
    ["指标", metricOptions],
    ["列", dimensionOptions],
    ["标识", identifierOptions],
  ];

  return (
    <>
      <Slot label="字段" collapsible>
        <Stack spacing={1}>
          {fields.map((name, index) => {
            if (name === spec.table_view.thumb_key) return null;
            const configured = spec.table_view.columns.find((column) => column.key === name);
            return (
              <Box
                key={name}
                data-field-chip={name}
                draggable
                onDragStart={(e) => {
                  dragFromRef.current = index;
                  setDragFrom(index);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", name);
                }}
                onDragEnd={() => { dragFromRef.current = null; setDragFrom(null); setDragTo(null); }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragTo !== index) setDragTo(index);
                }}
                onDragLeave={() => setDragTo((cur) => (cur === index ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFromRef.current !== null) moveField(dragFromRef.current, index);
                  dragFromRef.current = null;
                  setDragFrom(null);
                  setDragTo(null);
                }}
                sx={{
                  position: "relative", display: "flex", alignItems: "center", gap: 1,
                  opacity: dragFrom === index ? 0.45 : 1,
                  cursor: "grab",
                  "&:active": { cursor: "grabbing" },
                  "&::before": dragTo === index && dragFrom !== null && dragFrom !== index
                    ? {
                        content: '""', position: "absolute", left: -5, top: 3, bottom: 3, width: 2,
                        borderRadius: 1, bgcolor: "#4F46E5",
                      }
                    : undefined,
                }}
              >
                <Box
                  sx={{
                    display: "flex", alignItems: "center", gap: 0.5, pl: 1.1, pr: 0.7, height: 28,
                    borderRadius: 1.5, border: "1px solid #E8EEF8", bgcolor: "#F8FAFD",
                    fontSize: 12.5, color: "#334155", flex: 1, minWidth: 0,
                  }}
                >
                  <Typography noWrap sx={{ fontSize: 12.5, minWidth: 0, flex: 1 }}>{name}</Typography>
                  <Close
                    onClick={(e) => { e.stopPropagation(); remove(name); }}
                    sx={{ fontSize: 14, color: "#94A3B8", cursor: "pointer", flexShrink: 0, "&:hover": { color: "#EF4444" } }}
                  />
                </Box>
                <TextField
                  size="small" fullWidth placeholder="显示名称" value={configured?.label ?? ""}
                  inputProps={{ maxLength: 20 }}
                  onChange={(event) => {
                    const numeric = metricOptions.some((field) => field.name === name);
                    const base = configured ?? payload?.columns?.find((column) => column.key === name)
                      ?? { key: name, label: name, type: numeric ? "number" as const : "text" as const,
                        align: numeric ? "right" as const : "left" as const, width: 0 };
                    const columns = spec.table_view.columns.filter((column) => column.key !== name);
                    columns.push({ ...base, label: event.target.value });
                    onChange({ ...spec, table_view: { ...spec.table_view, columns } });
                  }}
                  sx={{ flex: 1, minWidth: 0, "& .MuiInputBase-input": { fontSize: 12 }, "& .MuiOutlinedInput-root": { borderRadius: "8px" } }}
                />
              </Box>
            );
          })}
          <AxisInput
            value=""
            options={Array.from(new Set(groups.flatMap(([, options]) => options.map((f) => f.name))))
              .filter((name) => !fields.includes(name))}
            placeholder="拖到这里"
            onPick={(name) => { if (name) add(name); }}
          />
        </Stack>

      </Slot>

    </>
  );
}

/** 名字像图片的字段排在前面（主图 / image / pic 优先，其次 url / 链接） */