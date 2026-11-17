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
  head, rows, empty,
}: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <TableContainer component={Paper} elevation={0}
      sx={{ borderRadius: 2, border: "1px solid", borderColor: "#EEF3FB" }}>
      <Table size="small" sx={{ minWidth: "100%" }}>
        <TableHead>
          <TableRow>
            {head.map((h, i) => (
              <TableCell key={i} sx={{ ...th, textAlign: i === head.length - 1 ? "right" : "left" }}>{h}</TableCell>
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
                <TableCell key={j} sx={{ ...td, textAlign: j === head.length - 1 ? "right" : "left" }}>{c}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ── 字段编辑 ──────────────────────────────────────────── */
