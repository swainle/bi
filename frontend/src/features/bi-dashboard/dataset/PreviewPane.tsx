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
import { MiniTable } from "./MiniTable";

export function PreviewPane({ dataset }: { dataset: Dataset & { fields: Field[]; metrics: Metric[] } }) {
  const dims = dataset.fields.filter((f) => f.role !== "measure" && f.role !== "id");
  const measures = dataset.fields.filter((f) => f.role === "measure");
  const [dimension, setDimension] = useState(dims[0]?.name || "");
  const [metric, setMetric] = useState(dataset.metrics[0]?.name || measures[0]?.name || "");
  const [result, setResult] = useState<{ sql: string; columns: string[]; rows: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const run = async () => {
    setBusy(true); setErr("");
    try {
      const res = await client.post(`/bi/semantic/datasets/${dataset.id}/query`, {
        dimensions: dimension ? [dimension] : [],
        metrics: metric ? [metric] : [],
        limit: 20,
      });
      setResult({ sql: res.data?.sql || "", columns: res.data?.columns || [], rows: res.data?.rows || [] });
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "查询失败");
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
        <TextField select size="small" label="维度" value={dimension} onChange={(e) => setDimension(e.target.value)}
          sx={{ width: 200, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          <MenuItem value="" sx={{ fontSize: 13 }}>（不分组）</MenuItem>
          {dims.map((f) => <MenuItem key={f.id} value={f.name} sx={{ fontSize: 13 }}>{f.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="指标" value={metric} onChange={(e) => setMetric(e.target.value)}
          sx={{ width: 200, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          <MenuItem value="" sx={{ fontSize: 13 }}>（不取指标）</MenuItem>
          {dataset.metrics.map((m) => <MenuItem key={`m${m.id}`} value={m.name} sx={{ fontSize: 13 }}>{m.name}</MenuItem>)}
          {measures.map((f) => <MenuItem key={`f${f.id}`} value={f.name} sx={{ fontSize: 13 }}>{f.name}（SUM）</MenuItem>)}
        </TextField>
        <Button size="small" variant="outlined" startIcon={<PlayArrow sx={{ fontSize: 15 }} />}
          onClick={run} disabled={busy || (!dimension && !metric)}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>
          {busy ? "查询中…" : "运行"}
        </Button>
        <Box sx={{ flex: 1 }} />
        {result && <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{result.rows.length} 行</Typography>}
      </Box>

      {err && <Alert severity="error" sx={{ mb: 1.5, fontSize: 12 }}>{err}</Alert>}

      {result && (
        <>
          <TableContainer component={Paper} elevation={0}
            sx={{ borderRadius: 2, border: "1px solid", borderColor: "#EEF3FB", maxHeight: 380 }}>
            <Table size="small" stickyHeader sx={{ minWidth: "100%" }}>
              <TableHead>
                <TableRow>
                  {result.columns.map((c) => <TableCell key={c} sx={th}>{c}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.map((row, i) => (
                  <TableRow key={i} hover>
                    {result.columns.map((c) => (
                      <TableCell key={c} sx={td}>{String(row[c] ?? "—")}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Box sx={{ mt: 1.5 }}>
            <Typography sx={{ fontSize: 10.5, color: "text.disabled", mb: 0.5 }}>SQL</Typography>
            <Box component="pre" sx={{
              m: 0, p: 1.5, borderRadius: 1.5, bgcolor: "#F8FAFC",
              fontSize: 11, lineHeight: 1.6, color: "#475569", overflow: "auto",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              border: "1px solid #EEF3FB",
            }}>{result.sql}</Box>
          </Box>
        </>
      )}
    </Box>
  );
}
