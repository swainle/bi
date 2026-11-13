/** 字段面板（编辑页左栏）—— 从语义数据集解析出的字段，点击即加入查询 */

import { useMemo, useState } from "react";
import { Box, InputAdornment, TextField, Typography } from "@mui/material";
import { Search } from "@mui/icons-material";
import type { FieldOption } from "../types";

export interface FieldGroup {
  metrics: FieldOption[];
  dimensions: FieldOption[];
  /** 标识：链接 id / sku_id 等，可拖去筛选，但不参与分组与聚合 */
  identifiers: FieldOption[];
}

export type FieldGroupKey = "metric" | "dimension" | "id";

interface Props {
  datasetName: string;
  groups: FieldGroup;
  usedKeys: string[];
  onPick: (field: FieldOption, group: FieldGroupKey) => void;
}

const ICON: Record<string, string> = {
  measure: "#",
  dimension: "Ss",
  time: "◷",
  metric: "Σ",
  id: "ID",
};

function FieldRow({
  field, group, used, onPick,
}: { field: FieldOption; group: FieldGroupKey; used: boolean; onPick: Props["onPick"] }) {
  const isMetric = group === "metric";
  const isId = group === "id";
  return (
    <Box
      draggable={!used}
      onDragStart={(e) => {
        const payload = { kind: "field", name: field.name, role: field.role, group };
        e.dataTransfer.setData("text/plain", JSON.stringify(payload));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => !used && !isId && onPick(field, group)}
      sx={{
        display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.55,
        borderRadius: 1.5, cursor: used ? "default" : "grab",
        "&:active": { cursor: used ? "default" : "grabbing" },
        opacity: used ? 0.42 : 1,
        transition: "background .12s",
        "&:hover": { bgcolor: used ? "transparent" : "rgba(99,102,241,0.07)" },
      }}
    >
      <Box sx={{
        width: 18, textAlign: "center", fontSize: isId ? 9 : 10.5, fontWeight: 700,
        color: isMetric ? "#7C3AED" : isId ? "#94A3B8" : "#0EA5E9",
      }}>
        {ICON[field.role] ?? (isMetric ? "Σ" : "#")}
      </Box>
      <Typography sx={{
        fontSize: 12, color: "#0F172A", flex: 1,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {field.name}
      </Typography>
    </Box>
  );
}

export default function FieldPanel({ datasetName, groups, usedKeys, onPick }: Props) {
  const [keyword, setKeyword] = useState("");

  const filter = (list: FieldOption[]) => {
    const kw = keyword.trim();
    return kw ? list.filter((f) => f.name.includes(kw)) : list;
  };

  const metrics = useMemo(() => filter(groups.metrics), [groups.metrics, keyword]);
  const dims = useMemo(() => filter(groups.dimensions), [groups.dimensions, keyword]);
  const ids = useMemo(() => filter(groups.identifiers), [groups.identifiers, keyword]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{ px: 1.5, pt: 1.5, pb: 1, borderBottom: "1px solid #EEF3FB" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
          <Box sx={{
            width: 18, height: 18, borderRadius: 0.75, border: "1px solid #CBD5E1",
            display: "grid", placeItems: "center", fontSize: 10, color: "#64748B",
          }}>
            ▦
          </Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }} noWrap>
            {datasetName}
          </Typography>
        </Box>
        <TextField
          size="small" fullWidth placeholder="搜索字段"
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 15, color: "text.disabled" }} />
              </InputAdornment>
            ),
          }}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12, bgcolor: "#fff" } }}
        />
      </Box>

      <Box sx={{ flex: 1, py: 1 }}>
        <Typography sx={{ px: 1.5, fontSize: 11, fontWeight: 600, color: "#94A3B8", mb: 0.5 }}>
          指标 {metrics.length}
        </Typography>
        {metrics.map((f) => (
          <FieldRow key={`m-${f.name}`} field={f} group="metric"
            used={usedKeys.includes(f.name)} onPick={onPick} />
        ))}

        <Typography sx={{ px: 1.5, fontSize: 11, fontWeight: 600, color: "#94A3B8", mt: 1.5, mb: 0.5 }}>
          列 {dims.length}
        </Typography>
        {dims.map((f) => (
          <FieldRow key={`d-${f.name}`} field={f} group="dimension"
            used={usedKeys.includes(f.name)} onPick={onPick} />
        ))}

        {ids.length > 0 && (
          <>
            <Typography sx={{ px: 1.5, fontSize: 11, fontWeight: 600, color: "#94A3B8", mt: 1.5, mb: 0.5 }}>
              标识 {ids.length}
            </Typography>
            {ids.map((f) => (
              <FieldRow key={`i-${f.name}`} field={f} group="id"
                used={usedKeys.includes(f.name)} onPick={onPick} />
            ))}
          </>
        )}
      </Box>
    </Box>
  );
}
