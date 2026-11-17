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

export function MetricDialog({
  datasetId, source, onClose, onSaved,
}: {
  datasetId: number;
  source: Metric | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = source === "new";
  const base = isNew ? null : source;
  const [name, setName] = useState(base?.name || "");
  const [expression, setExpression] = useState(base?.expression || "");
  const [format, setFormat] = useState(base?.format || "number");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async () => {
    if (!name.trim() || !expression.trim()) return;
    setBusy(true);
    try {
      const payload = { name: name.trim(), expression: expression.trim(), format };
      if (isNew) await client.post(`/bi/semantic/datasets/${datasetId}/metrics`, payload);
      else await client.patch(`/bi/semantic/datasets/${datasetId}/metrics/${base!.id}`, payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>{isNew ? "添加指标" : "编辑指标"}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <TextField fullWidth size="small" label="指标名" value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        <TextField fullWidth size="small" label="聚合表达式" value={expression}
          onChange={(e) => setExpression(e.target.value)}
          placeholder="SUM(sales) / COUNT(*) / SUM(net)/SUM(gmv)"
          helperText="需含聚合函数"
          FormHelperTextProps={{ sx: { fontSize: 10.5 } }}
          InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12.5 } }}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        <TextField fullWidth select size="small" label="格式" value={format}
          onChange={(e) => setFormat(e.target.value)}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {FORMATS.map((f) => <MenuItem key={f.v} value={f.v} sx={{ fontSize: 13 }}>{f.l}</MenuItem>)}
        </TextField>
        {err && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !name.trim() || !expression.trim()}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>保存</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 指标版本历史 ──────────────────────────────────────── */
