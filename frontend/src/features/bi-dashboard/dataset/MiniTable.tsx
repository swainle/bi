
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Drawer, FormControlLabel, IconButton,
  InputAdornment, MenuItem, Paper, Snackbar, Switch, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip,
  Typography,
} from "@mui/material";
import {
  Add, Close, DeleteOutline, Edit, History, Hub, PlayArrow, Refresh, Search,
  TableChart, UploadFileOutlined, VerifiedUser, VerifiedUserOutlined, VisibilityOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import client from "../../../api/client";
import ModelImportDialog from "../ModelImportDialog";

import { ROLES, TYPES, FORMATS, Field, Metric, MetricVersion, MetricUsage, Dataset, PhysTable, RemoteTable, SourceBrief, remoteField, td, th, DEMO_TABLE, _NUM, inferType, inferRole, RowRule, ColumnMask, DeptScopeRule, DEPT_MODES, RULE_ROLES, MASK_OPTIONS, FIELD_ROLE_LABEL } from "./types";

export function MiniTable({
  head, rows, empty, resizable = false,
}: { head: string[]; rows: React.ReactNode[][]; empty: string; resizable?: boolean }) {
  const [widths, setWidths] = useState<number[]>(() => {
    if (resizable) {
      try {
        const saved = JSON.parse(localStorage.getItem(FIELD_WIDTHS_KEY) || "null");
        if (Array.isArray(saved) && saved.length === head.length
          && saved.every((width) => Number.isFinite(width) && width >= 64 && width <= 2000)) return saved;
      } catch { /* 无有效设置时使用默认列宽 */ }
    }
    return FIELD_COLUMN_WIDTHS;
  });
  const drag = useRef<{ index: number; x: number; width: number; latest: number } | null>(null);
  const changeWidth = (index: number, width: number, persist = false) => {
    const next = widths.map((value, i) => i === index ? Math.max(64, Math.min(2000, width)) : value);
    setWidths(next);
    if (drag.current) drag.current.latest = next[index];
    if (persist) {
      try { localStorage.setItem(FIELD_WIDTHS_KEY, JSON.stringify(next)); } catch { /* 禁用存储时仍可调整 */ }
    }
  };
  return (
    <TableContainer component={Paper} elevation={0}
      sx={{ borderRadius: 2, border: "1px solid", borderColor: "#EEF3FB" }}>
      <Table size="small" sx={{ minWidth: "100%", ...(resizable && { tableLayout: "fixed", width: widths.reduce((sum, width) => sum + width, 0) }) }}>
        {resizable && <colgroup>{widths.map((width, i) => <col key={i} style={{ width }} />)}</colgroup>}
        <TableHead>
          <TableRow>
            {head.map((h, i) => (
              <TableCell key={i} sx={{ ...th, position: "relative", textAlign: i === head.length - 1 ? "right" : "left" }}>
                {h}
                {resizable && <Box role="separator" aria-label={`调整${h || "操作"}列宽`} aria-orientation="vertical"
                  tabIndex={0} aria-valuemin={64} aria-valuemax={2000} aria-valuenow={Math.round(widths[i])}
                  onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { index: i, x: e.clientX, width: widths[i], latest: widths[i] }; }}
                  onPointerMove={(e) => { if (drag.current?.index === i) changeWidth(i, drag.current.width + e.clientX - drag.current.x); }}
                  onPointerUp={() => { if (drag.current) changeWidth(i, drag.current.latest, true); drag.current = null; }}
                  onPointerCancel={() => { drag.current = null; }}
                  onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); changeWidth(i, widths[i] + (e.key === "ArrowRight" ? 20 : -20), true); } }}
                  sx={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "col-resize", touchAction: "none", "&:hover, &:focus-visible": { bgcolor: "primary.light" } }} />}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={head.length} sx={{ py: 5, textAlign: "center", borderBottom: 0 }}>
                <Typography sx={{ fontSize: 12, color: "text.disabled" }}>{empty}</Typography>
              </TableCell>
            </TableRow>
          ) : rows.map((cells, i) => (
            <TableRow key={i} hover>
              {cells.map((c, j) => (
                <TableCell key={j} sx={{ ...td, ...(resizable && { overflow: "hidden", overflowWrap: "anywhere" }), textAlign: j === head.length - 1 ? "right" : "left" }}>{c}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ── 字段编辑 ──────────────────────────────────────────── */


const FIELD_COLUMN_WIDTHS = [150, 220, 200, 90, 90, 64, 64, 100, 80];

const FIELD_WIDTHS_KEY = "mzbi.dataset.fieldWidths";