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

const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } } as const;

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
          display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content", mt: 1.5,
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
        <Box sx={{ mt: 1.25 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <TextField select size="small" label="换算" value={compute.transform}
              onChange={(e) => setCompute({ transform: e.target.value as never })}
              sx={{ flex: 1, ...fieldSx }}>
              {TRANSFORMS.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
            </TextField>
            <TextField size="small" type="number" label="小数位" value={compute.decimals}
              onChange={(e) => setCompute({ decimals: Number(e.target.value) })}
              sx={{ width: 88, ...fieldSx }} />
          </Stack>
          <Stack direction="row" spacing={1}>
            <TextField size="small" type="number" label="乘数" value={compute.scale}
              onChange={(e) => setCompute({ scale: Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
            <TextField size="small" type="number" label="加数" value={compute.offset}
              onChange={(e) => setCompute({ offset: Number(e.target.value) })}
              sx={{ flex: 1, ...fieldSx }} />
            <TextField size="small" label="前缀" value={compute.prefix}
              onChange={(e) => setCompute({ prefix: e.target.value })}
              sx={{ width: 76, ...fieldSx }} />
            <TextField size="small" label="后缀" value={compute.suffix}
              onChange={(e) => setCompute({ suffix: e.target.value })}
              sx={{ width: 76, ...fieldSx }} />
          </Stack>
        </Box>
      )}
    </>
  );
}
