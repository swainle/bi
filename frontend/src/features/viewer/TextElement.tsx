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

export function TextElement({ item }: { item: DocItem }) {
  return (
    <Typography sx={{
      fontSize: item.size ?? 13,
      fontWeight: item.weight ?? 400,
      color: "#334155",
      textAlign: item.align ?? "left",
      whiteSpace: "pre-wrap",
      lineHeight: 1.75,
      px: 0.25,
    }}>
      {item.text}
    </Typography>
  );
}

/** 属性面板：文本元素 / 数据组件的配置 */
