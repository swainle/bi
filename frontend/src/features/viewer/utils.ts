/** 业务看板页 · 常量 / CSV / 参数解析 */

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


export const GRID_GAP = 16;
export const DESIGN_W = 1440;
/** 网页出血：1920 设计稿左右各留 60px */
/** 把二维数据拼成 CSV（带 BOM，Excel 打开不乱码） */
export function toCsvText(columns: string[], rows: unknown[][]): string {
  const esc = (value: unknown) => {
    const text = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map(esc).join(","), ...rows.map((row) => row.map(esc).join(","))].join("\r\n");
}

export function downloadCsv(filename: string, columns: string[], rows: unknown[][]) {
  const blob = new Blob(["\ufeff" + toCsvText(columns, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const PAGE_X = { xs: 3, md: "60px" } as const;

export const DEFAULT_UI = {
  accent: "indigo", radius: 14, min_height: 260, show_unit: true,
  animate: true, align: "left", columns: 1,
} as UiSpec;

/** 预览页右上角浮层按钮（编辑 / 导出同一套样式） */
export const FLOAT_BTN_SX = {
  position: "fixed", top: 68, zIndex: 40,
  textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 1.5,
  bgcolor: "rgba(255,255,255,0.94)", border: "1px solid #E8EEF8",
  boxShadow: "0 2px 10px rgba(15,23,42,0.07)", color: "#334155",
  opacity: 0.8, transition: "opacity .15s, border-color .15s, box-shadow .15s",
  "&:hover": { bgcolor: "#fff", opacity: 1, borderColor: "#D8E2F5", boxShadow: "0 4px 14px rgba(15,23,42,0.1)" },
} as const;

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export const NUMERAL: Record<string, string> = { "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6" };
export const ICONS = ["grid", "chart", "pie", "table", "cloud", "tag", "bulb"];
export const ACCENT_KEYS = Object.keys(ACCENTS) as Accent[];

export function readParamQuery(search: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  search.forEach((value, key) => {
    if (key.startsWith("p_")) out[key.slice(2)] = value;
  });
  return out;
}

export function buildSearch(view: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  if (view) search.set("view", view);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === "all") return;
    if (Array.isArray(value)) {
      if (value.length) search.set(`p_${key}`, value.join(","));
    } else {
      search.set(`p_${key}`, String(value));
    }
  });
  const query = search.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}
