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

export function Slot({ label, children, collapsible = false, defaultOpen = false }: {
  label: string;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <Box sx={{ mb: 2 }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1.25 }}>
          {label}
        </Typography>
        {children}
      </Box>
    );
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content",
          mb: open ? 1.25 : 0, color: "#64748B", "&:hover": { color: "#4F46E5" },
        }}
      >
        <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>{label}</Typography>
        <Box sx={{ display: "inline-flex", transition: "transform .14s", transform: open ? "rotate(180deg)" : "none" }}>
          <ExpandMore sx={{ fontSize: 15 }} />
        </Box>
      </Box>
      {open && children}
    </Box>
  );
}
