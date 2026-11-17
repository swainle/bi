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

export function FieldDialog({
  datasetId, columns, source, onClose, onSaved,
}: {
  datasetId: number;
  columns: { name: string; type: string }[];
  source: Field | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = source === "new";
  const base = isNew ? null : source;
  const [name, setName] = useState(base?.name || "");
  const [column, setColumn] = useState(base?.source_column || "");
  const [role, setRole] = useState(base?.role || "dimension");
  const [dataType, setDataType] = useState(base?.data_type || "text");
  const [filterable, setFilterable] = useState(base?.is_filterable ?? true);
  const [groupable, setGroupable] = useState(base?.is_groupable ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pickColumn = (col: string) => {
    setColumn(col);
    const phys = columns.find((c) => c.name === col);
    const dt = phys ? inferType(phys.type) : "text";
    if (!name || name === column) setName(col);
    if (isNew || dataType !== dt) {
      setDataType(dt);
      if (isNew) setRole(inferRole(dt));
    }
  };

  const submit = async () => {
    if (!name.trim() || !column.trim()) return;
    setBusy(true);
    try {
      const payload = {
        name: name.trim(), source_column: column.trim(), role,
        data_type: dataType, is_filterable: filterable, is_groupable: groupable,
      };
      if (isNew) await client.post(`/bi/semantic/datasets/${datasetId}/fields`, payload);
      else await client.patch(`/bi/semantic/datasets/${datasetId}/fields/${base!.id}`, payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>{isNew ? "添加字段" : "编辑字段"}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <TextField fullWidth select size="small" label="物理列" value={column}
          onChange={(e) => pickColumn(e.target.value)}
          sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {columns.length === 0 && (
            <MenuItem value={column} sx={{ fontSize: 13 }}>{column || "（无可用物理列）"}</MenuItem>
          )}
          {columns.map((c) => (
            <MenuItem key={c.name} value={c.name} sx={{ fontSize: 13 }}>
              {c.name} · {c.type}
            </MenuItem>
          ))}
        </TextField>
        <TextField fullWidth size="small" label="字段名（图表里显示的名字）" value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5 }}>
          <TextField select size="small" label="角色" value={role} onChange={(e) => setRole(e.target.value)}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
            {ROLES.map((r) => <MenuItem key={r.v} value={r.v} sx={{ fontSize: 13 }}>{r.l}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="类型" value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
            {TYPES.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>{t}</MenuItem>)}
          </TextField>
        </Box>
        <Box sx={{ display: "flex", gap: 2, mt: 0.5 }}>
          <FormControlLabel control={<Switch size="small" checked={filterable}
            onChange={(e) => setFilterable(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12 }}>可筛选</Typography>} />
          <FormControlLabel control={<Switch size="small" checked={groupable}
            onChange={(e) => setGroupable(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12 }}>可分组</Typography>} />
        </Box>
        {err && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !name.trim() || !column.trim()}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>保存</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 指标编辑 ──────────────────────────────────────────── */
