/** 业务看板页 —— 页面元素 + 组件实例 + 参数筛选 + 动作浮层 + 就地编辑（类原型工具） */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, IconButton, Menu, MenuItem, Select, Snackbar, Tab, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import {
  ArrowDownward, ArrowUpward, BookmarkBorder, Close, Delete, Edit, FileDownload, HorizontalRule,
  Save, TextFields, Title as TitleIcon, Tune, ViewQuilt,
} from "@mui/icons-material";
import client from "../../api/client";
import { useAuth } from "../auth/useAuth";
import { useWatermarkText } from "../../hooks/useWatermarkText";
import WatermarkOverlay from "../../components/WatermarkOverlay";
import { CanvasDetailContext, asCanvasItem, boardOf, type BoardArea } from "../components/board/canvasDetail";
import { ACCENTS } from "../components/palette";
import { RENDERERS, KIND_LABEL, KIND_ROLE, ROLE_LABEL } from "../components/registry";
import ShapeView, { shapeOf } from "../components/shapes";
import { navHomePage } from "../components/navHome";
import FilterBar from "../components/renderers/FilterBar";
import NavCard, { type NavPayload, type NavUi } from "../components/renderers/NavCard";
import { useDatasetFields } from "../components/board/useDatasetFields";
import TopListDialog from "../components/board/TopListDialog";
import type {
  Accent, ComponentItem, ComponentSpec, DashboardDoc, DashboardRender, DashboardSummary,
  DatasetBrief, DocAction, DocItem, FilterFieldSpec, RenderPayload, UiSpec,
} from "../components/types";

import { GRID_GAP, DESIGN_W, toCsvText, downloadCsv, PAGE_X, DEFAULT_UI, FLOAT_BTN_SX, cellText, NUMERAL, ICONS, ACCENT_KEYS, readParamQuery, buildSearch } from "./utils";

export function OverlayHost({ overlay, onClose }: {
  overlay: { type: "modal" | "drawer"; title: string; kind: string; payload: RenderPayload } | null;
  onClose: () => void;
}) {
  const content = overlay ? (() => {
    const kind = overlay.payload.kind;
    const Renderer = kind ? RENDERERS[kind] : null;
    if (!Renderer) return <Typography sx={{ p: 2, fontSize: 12, color: "#94A3B8" }}>无法渲染</Typography>;
    return <Box sx={{ height: "100%" }}><Renderer payload={overlay.payload} ui={overlay.payload.ui ?? DEFAULT_UI} /></Box>;
  })() : null;

  if (!overlay) return null;

  const bodyHeight = overlay.kind === "rank_list"
    ? Math.min(560, 110 + (overlay.payload.items?.length ?? 10) * 52)
    : overlay.kind === "table" ? "64vh" : 460;

  if (overlay.type === "drawer") {
    return (
      <Drawer anchor="right" open onClose={onClose}
        PaperProps={{ sx: { width: 780, maxWidth: "96vw" } }} aria-label={overlay.title}>
        <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
          <IconButton size="small" onClick={onClose}><Close sx={{ fontSize: 16 }} /></IconButton>
        </Box>
        <Box sx={{ p: 2, height: "calc(100% - 48px)" }}>{content}</Box>
      </Drawer>
    );
  }

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth
      PaperProps={{ sx: { borderRadius: 3 } }} aria-label={overlay.title}>
      <Box sx={{ px: 1.5, pt: 1, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <IconButton size="small" onClick={onClose}><Close sx={{ fontSize: 16 }} /></IconButton>
      </Box>
      <DialogContent sx={{ p: 2, pt: 0.5 }}>
        <Box sx={{ height: bodyHeight }}>{content}</Box>
      </DialogContent>
    </Dialog>
  );
}

