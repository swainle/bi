/** 查询面板（编辑页中栏）—— 维度 / 指标 / 过滤 / 行限制，对应 spec.binding */

import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { Add, Check, Close, ExpandMore } from "@mui/icons-material";
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  /** 字段区也能当拖拽落点 */
  const [dropField, setDropField] = useState(false);

  const setFields = (next: string[]) => {
    onChange({
      ...spec,
      binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: next },
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
      <Slot label="字段">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {fields.map((name, index) => (
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
                position: "relative",
                // 缩略图字段只在后端挂载，不在字段列表里显示
                display: name === spec.table_view.thumb_key ? "none" : "flex",
                alignItems: "center", gap: 0.5, pl: 1.1, pr: 0.7, height: 28,
                borderRadius: 1.5, border: "1px solid #E8EEF8", bgcolor: "#F8FAFD",
                fontSize: 12.5, color: "#334155",
                cursor: "grab", transition: "opacity .12s, border-color .12s",
                opacity: dragFrom === index ? 0.45 : 1,
                borderColor: dragTo === index && dragFrom !== index ? "rgba(79,70,229,0.45)" : "#E8EEF8",
                "&:active": { cursor: "grabbing" },
                // 落点提示：拖到哪个字段前就画一条竖线
                "&::before": dragTo === index && dragFrom !== null && dragFrom !== index
                  ? {
                      content: '""', position: "absolute", left: -5, top: 3, bottom: 3, width: 2,
                      borderRadius: 1, bgcolor: "#4F46E5",
                    }
                  : undefined,
              }}
            >
              {name}
              <Close
                onClick={(e) => { e.stopPropagation(); remove(name); }}
                sx={{ fontSize: 14, color: "#94A3B8", cursor: "pointer", "&:hover": { color: "#EF4444" } }}
              />
            </Box>
          ))}
          <Box
            onClick={(e) => setAnchor(e.currentTarget)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!dropField) setDropField(true);
            }}
            onDragLeave={() => setDropField(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropField(false);
              try {
                const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
                if (payload.kind === "field" && payload.name) add(String(payload.name));
              } catch {
                /* 不是字段拖拽，忽略 */
              }
            }}
            sx={{
              ...dash, px: 1.1, py: 0.5, fontSize: 12.5, cursor: "pointer",
              transition: "border-color .12s, background .12s, color .12s",
              borderColor: dropField ? "#6366F1" : undefined,
              bgcolor: dropField ? "rgba(99,102,241,0.05)" : undefined,
              color: dropField ? "#4F46E5" : undefined,
              "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" },
            }}
          >
            ＋ 添加字段
          </Box>
        </Box>

      </Slot>

      {fields.filter((name) => name !== spec.table_view.thumb_key).length > 0 && (
        <Slot label="列头名称">
          <Stack spacing={1}>
            {fields.filter((name) => name !== spec.table_view.thumb_key).map((name) => {
              const configured = spec.table_view.columns.find((column) => column.key === name);
              return (
                <TextField key={name} size="small" fullWidth label={name}
                  placeholder={name} value={configured?.label ?? ""}
                  InputLabelProps={{ shrink: true }} inputProps={{ maxLength: 20 }}
                  onChange={(event) => {
                    const numeric = metricOptions.some((field) => field.name === name);
                    const base = configured ?? payload?.columns?.find((column) => column.key === name)
                      ?? { key: name, label: name, type: numeric ? "number" as const : "text" as const,
                        align: numeric ? "right" as const : "left" as const, width: 0 };
                    const columns = spec.table_view.columns.filter((column) => column.key !== name);
                    columns.push({ ...base, label: event.target.value });
                    onChange({ ...spec, table_view: { ...spec.table_view, columns } });
                  }}
                  sx={{ "& .MuiOutlinedInput-root": { fontSize: 12.5, borderRadius: 1.5 } }} />
              );
            })}
          </Stack>
        </Slot>
      )}

      <Menu
        anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, maxHeight: 360, minWidth: 200 } } }}
      >
        {groups.map(([label, options]) => (
          options.length ? (
            <Box key={label}>
              <Typography sx={{ px: 1.5, pt: 1, pb: 0.5, fontSize: 10.5, color: "#94A3B8" }}>{label}</Typography>
              {options.map((f) => {
                const active = fields.includes(f.name);
                return (
                  <MenuItem
                    key={`${label}-${f.name}`}
                    onClick={() => { add(f.name); setAnchor(null); }}
                    sx={{ fontSize: 12.5, minHeight: 32 }}
                  >
                    <Box sx={{ flex: 1 }}>{f.name}</Box>
                    {active && <Check sx={{ fontSize: 14, color: "#4F46E5" }} />}
                  </MenuItem>
                );
              })}
            </Box>
          ) : null
        ))}
      </Menu>
    </>
  );
}

/** 名字像图片的字段排在前面（主图 / image / pic 优先，其次 url / 链接） */
