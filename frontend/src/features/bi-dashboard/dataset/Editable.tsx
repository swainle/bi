
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

export function InlineRename({
  value, submit, variant = "row", doubleClick = false,
}: {
  value: string;
  submit: (next: string) => Promise<void>;
  variant?: "row" | "title";
  doubleClick?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  /** 一次编辑只结算一次（回车会紧接着触发 blur） */
  const settled = useRef(false);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const begin = () => { settled.current = false; setDraft(value); setEditing(true); };
  const cancel = () => { settled.current = true; setDraft(value); setEditing(false); };

  const commit = async () => {
    if (settled.current) return;
    settled.current = true;
    const next = draft.trim();
    if (!next || next === value) { setEditing(false); return; }
    setBusy(true);
    try {
      await submit(next);
      setEditing(false);
    } catch {
      /* 错误提示由调用方给；这里退回原名，避免输入框停在一个存不下来的名字上 */
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <Box onClick={(e) => e.stopPropagation()} sx={{ display: "inline-flex", alignItems: "center" }}>
        <TextField
          value={draft} size="small" autoFocus disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); void commit(); }
            else if (e.key === "Escape") { e.preventDefault(); cancel(); }
          }}
          onBlur={() => void commit()}
          inputProps={{ maxLength: 120, "aria-label": "数据集名称", "data-dataset-name-input": "1" }}
          sx={{
            width: variant === "title" ? 260 : 200,
            "& .MuiOutlinedInput-root": {
              borderRadius: "8px", height: variant === "title" ? 34 : 28,
              fontSize: variant === "title" ? 15 : 12.5, fontWeight: variant === "title" ? 700 : 600,
            },
            "& .MuiOutlinedInput-input": { px: 1, py: 0 },
          }}
        />
      </Box>
    );
  }

  /** 标题上不挂 MUI Tooltip：抽屉贴着视口顶边，气泡会被翻到下方压住页签，改用原生 title */
  const pencil = (
    <IconButton
      className="ds-inline-rename" aria-label="重命名数据集" size="small" data-rename-btn={value}
      {...(variant === "title" ? { title: "重命名" } : {})}
      onClick={(e) => { e.stopPropagation(); begin(); }}
      sx={{ p: 0.25, opacity: 0, transition: "opacity .14s", "&:focus-visible": { opacity: 1 } }}>
      <Edit sx={{ fontSize: variant === "title" ? 14 : 13, color: "#94A3B8" }} />
    </IconButton>
  );

  return (
    <Box
      onDoubleClick={doubleClick ? (e) => { e.stopPropagation(); begin(); } : undefined}
      sx={{
        display: "inline-flex", alignItems: "center", gap: 0.25, minWidth: 0,
        "&:hover .ds-inline-rename, &:focus-within .ds-inline-rename": { opacity: 1 },
      }}
    >
      <Typography noWrap data-dataset-name={value} sx={{
        maxWidth: variant === "title" ? 420 : 260,
        fontSize: variant === "title" ? 17 : 13,
        fontWeight: variant === "title" ? 800 : 600,
        color: "text.primary",
        letterSpacing: variant === "title" ? -0.2 : undefined,
      }}>
        {value}
      </Typography>
      {variant === "title" ? pencil : <Tooltip title="重命名" placement="bottom">{pencil}</Tooltip>}
    </Box>
  );
}
