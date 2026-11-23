/** 运算（换算 / 小数位 / 乘数 / 加数 / 前缀 / 后缀）—— 折叠展示，放在「计算」分区里 */

import { useState } from "react";
import { Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { ExpandMore } from "@mui/icons-material";
import { computeOf } from "../skin/format";
import type { ComponentKind, ComponentSpec } from "../types";

const TRANSFORMS: [string, string][] = [
  ["raw", "原值"], ["share", "占比%"], ["index", "指数化(首条=100)"],
  ["delta", "环比差值"], ["cumsum", "累计值"],
];

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12.5 } } as const;

export default function ComputeFields({ kind, spec, onChange }: {
  kind: ComponentKind;
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
}) {
  const [open, setOpen] = useState(false);
  const compute = computeOf(spec.compute);
  const setCompute = (patch: Partial<typeof compute>) =>
    onChange({ ...spec, compute: { ...compute, ...patch } });

  // 分节标题没有数值，也就没有运算
  if (kind === "section") return null;

  const active = compute.transform !== "raw" || compute.scale !== 1 || compute.offset !== 0
    || compute.decimals !== 0 || !!compute.prefix || !!compute.suffix;

  return (
    <>
      <Box
        onClick={() => setOpen((prev) => !prev)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content", mt: 0, mb: open ? 1 : 2,
          color: "#64748B", "&:hover": { color: "#4F46E5" },
        }}
      >
        <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 600 }}>运算</Typography>
        <Box sx={{ display: "inline-flex", transition: "transform .14s", transform: open ? "rotate(180deg)" : "none" }}>
          <ExpandMore sx={{ fontSize: 15 }} />
        </Box>
        {active && !open && (
          <Typography component="span" sx={{ fontSize: 10.5, color: "#94A3B8" }}>已启用</Typography>
        )}
      </Box>
      {open && (
        <Stack spacing={1} sx={{ mt: 1.25 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>换算</Typography>
            <TextField select size="small" value={compute.transform}
              onChange={(e) => setCompute({ transform: e.target.value as never })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }}>
              {TRANSFORMS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>小数位</Typography>
            <TextField size="small" type="number" value={compute.decimals}
              onChange={(e) => setCompute({ decimals: Number(e.target.value) })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>乘数</Typography>
            <TextField size="small" type="number" value={compute.scale}
              onChange={(e) => setCompute({ scale: Number(e.target.value) })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>加数</Typography>
            <TextField size="small" type="number" value={compute.offset}
              onChange={(e) => setCompute({ offset: Number(e.target.value) })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>前缀</Typography>
            <TextField size="small" value={compute.prefix}
              onChange={(e) => setCompute({ prefix: e.target.value })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>后缀</Typography>
            <TextField size="small" value={compute.suffix}
              onChange={(e) => setCompute({ suffix: e.target.value })}
              sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
          </Box>
        </Stack>
      )}
    </>
  );
}
