
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

export function MetricUsagesDialog({
  datasetId, metric, onClose,
}: { datasetId: number; metric: Metric; onClose: () => void }) {
  const [data, setData] = useState<{ count: number; dashboard_count: number; usages: MetricUsage[] } | null>(null);
  const [err, setErr] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    client.get(`/bi/semantic/datasets/${datasetId}/metrics/${metric.id}/usages`)
      .then((res) => setData(res.data))
      .catch((e) => setErr(e?.response?.data?.detail || "影响分析加载失败"));
  }, [datasetId, metric.id]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>
        影响分析 · {metric.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        {err && <Alert severity="error" sx={{ mb: 1, fontSize: 12 }}>{err}</Alert>}
        {data === null ? (
          <Box sx={{ py: 4, textAlign: "center" }}><CircularProgress size={22} /></Box>
        ) : data.count === 0 ? (
          <Typography sx={{ py: 3, fontSize: 12.5, color: "text.secondary" }}>
            还没有卡片引用这个指标
          </Typography>
        ) : (
          <>
            <Typography sx={{ mb: 1, fontSize: 12, color: "text.secondary" }}>
              {data.dashboard_count} 个看板 · {data.count} 个元素
            </Typography>
            <Box sx={{ border: "1px solid #EEF3FB", borderRadius: 2, overflow: "hidden" }}>
              {data.usages.map((u) => (
                <Box key={`${u.dashboard_id}-${u.view_key}-${u.item_key}`}
                  sx={{
                    px: 1.5, py: 0.9, borderBottom: "1px solid #EEF3FB", cursor: "pointer",
                    "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
                    "&:last-child": { borderBottom: 0 },
                  }}
                  onClick={() => navigate(`/bi/dashboards/${u.dashboard_id}`)}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>
                      {u.dashboard_name || `看板 #${u.dashboard_id}`}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>
                      {u.item_kind || u.item_type || "元素"}
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: 11, color: "text.secondary", fontFamily: "ui-monospace" }}>
                    {u.view_key} / {u.item_key}
                  </Typography>
                </Box>
              ))}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 数据集行列权限 ────────────────────────────────────── */
