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

export function LayersPanel({ items, selected, onSelect, viewTitle }: {
  items: DocItem[];
  selected: string | null;
  onSelect: (key: string) => void;
  viewTitle: string;
}) {
  const label = (item: DocItem) => {
    if ((item.type || "chart") === "heading") return item.text || "标题";
    if (item.type === "text") return item.text?.slice(0, 16) || "文字";
    if (item.type === "divider") return "分割线";
    return item.spec?.title || item.title || item.component || "组件";
  };
  const glyph = (item: DocItem) => {
    if ((item.type || "chart") === "heading") return "H";
    if (item.type === "text") return "T";
    if (item.type === "divider") return "—";
    if (item.type === "filter") return "F";
    return "▦";
  };

  return (
    <Box sx={{
      width: 196, flexShrink: 0, borderRight: "1px solid #EEF3FB", bgcolor: "#fff",
      position: "sticky", top: 56, height: "calc(100vh - 56px)", overflowY: "auto",
      px: 1, py: 1.25,
    }}>
      <Typography sx={{ fontSize: 10.5, color: "#94A3B8", fontWeight: 600, px: 1, mb: 0.75, letterSpacing: 0.6 }}>
        图层 {viewTitle ? `· ${viewTitle}` : ""}
      </Typography>
      {items.map((item) => {
        const active = selected === item.key;
        return (
          <Box
            key={item.key}
            onClick={() => onSelect(item.key)}
            sx={{
              display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.55,
              borderRadius: 1.25, cursor: "pointer", mb: 0.25,
              bgcolor: active ? "rgba(79,70,229,0.08)" : "transparent",
              "&:hover": { bgcolor: active ? "rgba(79,70,229,0.08)" : "rgba(15,23,42,0.03)" },
            }}
          >
            <Box sx={{
              width: 18, height: 18, borderRadius: 0.75, flexShrink: 0,
              display: "grid", placeItems: "center", fontSize: 9.5,
              bgcolor: active ? "#4F46E5" : "#F1F5F9",
              color: active ? "#fff" : "#64748B",
            }}>
              {glyph(item)}
            </Box>
            <Typography sx={{
              fontSize: 11.5, color: active ? "#4F46E5" : "#475569",
              fontWeight: active ? 600 : 400, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis",
            }}>
              {label(item)}
            </Typography>
          </Box>
        );
      })}
      <Typography sx={{ fontSize: 10.5, color: "#B6C2D2", px: 1, mt: 1 }}>
        {items.length} 个元素
      </Typography>
    </Box>
  );
}
