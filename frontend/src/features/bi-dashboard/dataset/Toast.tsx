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

export function Toast({ msg, onClose, severity = "error" }: { msg: string; onClose: () => void; severity?: "error" | "success" }) {
  return (
    <Snackbar open={!!msg} autoHideDuration={3200} onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert severity={severity} onClose={onClose} sx={{ borderRadius: 2, fontSize: 12.5 }}>{msg}</Alert>
    </Snackbar>
  );
}

/** 改名只走 /datasets/{id}/name：后端这条路径只写 name 一列，物理表 / 取数方式 / 数据源不可能被带动 */
export async function renameDatasetName(id: number, next: string): Promise<{ name: string; updated_at?: string }> {
  const res = await client.patch(`/bi/semantic/datasets/${id}/name`, { name: next.trim() });
  return { name: String(res.data?.name ?? next), updated_at: res.data?.updated_at };
}

/** 就地改名：点铅笔（抽屉标题支持双击）变输入框，回车 / 失焦保存，Esc 取消，失败回退原名 */
