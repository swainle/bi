/** 明细表的「字段」区：一列一张配置卡（列头 / 类型 / 格式 / 颜色 / 行数 / 宽度）.
 *
 * 字段顺序 = 表格列顺序，卡片可上下拖动排序；底部保留一个拖入框用于新增列。
 */

import { useRef, useState } from "react";
import { Box, Stack } from "@mui/material";
import { DragIndicator } from "@mui/icons-material";
import type { FieldOption, RenderPayload, TableColumn } from "../types";
import type { ComponentSpec } from "../types";
import { Slot } from "./Slot";
import { AxisInput } from "./AxisInput";
import { TableColumnCard } from "./TableColumnCard";

interface Props {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  metricOptions: FieldOption[];
  dimensionOptions: FieldOption[];
  identifierOptions: FieldOption[];
  payload?: RenderPayload | null;
}

const NUMBER_TYPES = new Set<TableColumn["type"]>(["number", "percent", "money"]);

/** 新建列时的默认对齐（数值右、排名中、其余左）；之后由面板「对齐」控件决定，换类型不再改 */
function alignOf(type: TableColumn["type"]): TableColumn["align"] {
  if (NUMBER_TYPES.has(type)) return "right";
  if (type === "rank") return "center";
  return "left";
}

export function TableFieldsEditor({
  spec, onChange, metricOptions, dimensionOptions, identifierOptions, payload,
}: Props) {
  const b = spec.binding;
  const fields = b.dimensions ?? [];
  const columns = spec.table_view.columns;

  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  /** 刚拖进来的那一列默认展开（其余折叠，面板才不会一屏铺满） */
  const [justAdded, setJustAdded] = useState<string | null>(null);
  /** 放 ref 里：drop 紧跟 dragstart 时 state 还没刷新 */
  const dragFromRef = useRef<number | null>(null);

  /** 换列清单：列配置、排序字段、缩略图字段都跟着走，不会留下孤儿配置 */
  const writeFields = (next: string[], extra: Partial<ComponentSpec["binding"]> = {}) => {
    onChange({
      ...spec,
      binding: {
        ...b, dimension: null, metric: null, metrics: [], dimensions: next,
        sort_field: next.includes(b.sort_field ?? "") ? b.sort_field : "",
        ...extra,
      },
      table_view: {
        ...spec.table_view,
        columns: spec.table_view.columns.filter((column) => next.includes(column.key)),
      },
    });
  };

  const remove = (name: string) => writeFields(fields.filter((n) => n !== name));

  const add = (name: string) => {
    if (!name || fields.includes(name)) return;
    setJustAdded(name);
    writeFields([...fields, name]);
  };

  const moveField = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    writeFields(next);
  };

  /** 换绑：字段名改掉，列配置整块搬过去（用户配好的列头/颜色/宽度不能丢） */
  const rebind = (from: string, next: string | null) => {
    if (!next) {
      remove(from);
      return;
    }
    if (next === from || fields.includes(next)) return;
    const moved = columns.find((column) => column.key === from);
    const rest = columns.filter((column) => column.key !== from && column.key !== next);
    const nextColumns = moved ? [...rest, { ...moved, key: next }] : rest;
    const renamed = fields.map((name) => (name === from ? next : name));
    onChange({
      ...spec,
      binding: {
        ...b, dimension: null, metric: null, metrics: [], dimensions: renamed,
        sort_field: b.sort_field === from ? next : (renamed.includes(b.sort_field ?? "") ? b.sort_field : ""),
      },
      table_view: {
        ...spec.table_view,
        columns: nextColumns,
        thumb_key: spec.table_view.thumb_key === from ? next : spec.table_view.thumb_key,
      },
    });
  };

  /** 该列的当前配置：没有就用后端推断的结果补一份默认值 */
  const columnOf = (name: string): TableColumn => {
    const configured = columns.find((column) => column.key === name);
    if (configured) return configured;
    const inferred = payload?.columns?.find((column) => column.key === name);
    if (inferred) return inferred;
    const numeric = metricOptions.some((field) => field.name === name);
    const type: TableColumn["type"] = numeric ? "number" : "text";
    return { key: name, label: name, type, align: alignOf(type), width: 0 };
  };

  const patchColumn = (name: string, patch: Partial<TableColumn>) => {
    const base = columnOf(name);
    /* 对齐由面板里的「对齐」控件显式决定，换类型不再偷偷改它（会对不上用户手动选的值） */
    const next: TableColumn = { ...base, ...patch };
    const rest = columns.filter((column) => column.key !== name);
    onChange({ ...spec, table_view: { ...spec.table_view, columns: [...rest, next] } });
  };

  const allNames = Array.from(new Set([
    ...metricOptions.map((field) => field.name),
    ...dimensionOptions.map((field) => field.name),
    ...identifierOptions.map((field) => field.name),
    ...fields,
  ]));
  const freeNames = allNames.filter((name) => !fields.includes(name));

  return (
    <Slot label="字段" collapsible>
      <Stack spacing={1.25}>
        {fields.map((name, index) => {
          if (name === spec.table_view.thumb_key) return null;
          const handle = (
            <Box
              draggable
              title="拖动调整列顺序"
              onDragStart={(event) => {
                dragFromRef.current = index;
                setDragFrom(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", name);
              }}
              onDragEnd={() => { dragFromRef.current = null; setDragFrom(null); setDragTo(null); }}
              sx={{
                width: 14, flexShrink: 0, display: "grid", placeItems: "center",
                color: "#B6C1F0", cursor: "grab", "&:active": { cursor: "grabbing" },
                "&:hover": { color: "#6366F1" },
              }}
            >
              <DragIndicator sx={{ fontSize: 15 }} />
            </Box>
          );

          return (
            <Box
              key={name}
              data-field-chip={name}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragTo !== index) setDragTo(index);
              }}
              onDragLeave={() => setDragTo((current) => (current === index ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFromRef.current !== null) moveField(dragFromRef.current, index);
                dragFromRef.current = null;
                setDragFrom(null);
                setDragTo(null);
              }}
              sx={{
                position: "relative",
                opacity: dragFrom === index ? 0.45 : 1,
                "&::before": dragTo === index && dragFrom !== null && dragFrom !== index
                  ? {
                      content: '""', position: "absolute", left: 0, right: 0, top: -5, height: 2,
                      borderRadius: 1, bgcolor: "#4F46E5",
                    }
                  : undefined,
              }}
            >
              <TableColumnCard
                name={name}
                column={columnOf(name)}
                options={[
                  // 当前字段也放进 options：否则 MUI 认为「值不在选项里」会告警，显示也可能异常
                  name,
                  ...allNames.filter((option) => option !== name && !fields.includes(option)),
                ]}
                onRebind={(next) => rebind(name, next)}
                onPatch={(patch) => patchColumn(name, patch)}
                onRemove={() => remove(name)}
                handle={handle}
                defaultOpen={name === justAdded}
              />
            </Box>
          );
        })}

        <AxisInput
          value=""
          options={freeNames}
          placeholder="＋ 添加字段"
          onPick={(name) => { if (name) add(name); }}
        />
      </Stack>
    </Slot>
  );
}
