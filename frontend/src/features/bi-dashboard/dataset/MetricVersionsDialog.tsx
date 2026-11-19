
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

export function MetricVersionsDialog({
  datasetId, metric, onClose,
}: { datasetId: number; metric: Metric; onClose: () => void }) {
  const [rows, setRows] = useState<MetricVersion[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    client.get(`/bi/semantic/datasets/${datasetId}/metrics/${metric.id}/versions`)
      .then((res) => setRows(res.data?.versions || []))
      .catch((e) => setErr(e?.response?.data?.detail || "版本历史加载失败"));
  }, [datasetId, metric.id]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>
        版本历史 · {metric.name}
        <Typography component="span" sx={{ ml: 1, fontSize: 11.5, color: "text.secondary" }}>
          当前 v{metric.version || 1}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        {err && <Alert severity="error" sx={{ mb: 1, fontSize: 12 }}>{err}</Alert>}
        {rows === null ? (
          <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={22} /></Box>
        ) : rows.length === 0 ? (
          <Typography sx={{ py: 3, fontSize: 12.5, color: "text.secondary" }}>
            还没有历史版本
          </Typography>
        ) : (
          <Box sx={{ border: "1px solid #EEF3FB", borderRadius: 2, overflow: "hidden" }}>
            {rows.map((v) => (
              <Box key={v.version}
                sx={{ px: 1.5, py: 1, borderBottom: "1px solid #EEF3FB", "&:last-child": { borderBottom: 0 } }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Chip label={`v${v.version}`} size="small"
                    sx={{ height: 18, fontSize: 10.5, bgcolor: "rgba(99,102,241,0.10)", color: "#4F46E5" }} />
                  <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{v.name}</Typography>
                  <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                    {v.changed_by_name || "—"} · {v.changed_at.slice(0, 16)}
                  </Typography>
                </Box>
                <Typography sx={{ mt: 0.4, fontSize: 11.5, fontFamily: "ui-monospace", color: "#475569" }}>
                  {v.expression}
                </Typography>
                {v.note && (
                  <Typography sx={{ mt: 0.2, fontSize: 10.5, color: "text.disabled" }}>{v.note}</Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 指标影响分析 ──────────────────────────────────────── */
