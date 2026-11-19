
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

export function CreateDatasetDialog({
  tables, initialTable = "", initialName = "", onClose, onCreated, onError,
}: {
  tables: PhysTable[];
  initialTable?: string;
  initialName?: string;
  onClose: () => void;
  onCreated: (id: number) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"extract" | "live" | "sql">("extract");
  const [name, setName] = useState(initialName);
  const [table, setTable] = useState(initialTable);
  const [sqlText, setSqlText] = useState("");
  const [description, setDescription] = useState("");
  const [importColumns, setImportColumns] = useState(true);
  const [deptId, setDeptId] = useState<number | "">("");
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get("/auth/departments")
      .then((r) => setDepartments(r.data?.items || []))
      .catch(() => setDepartments([]));
  }, []);

  // 直连：数据源 → 源库表
  const [sources, setSources] = useState<SourceBrief[]>([]);
  const [sourceId, setSourceId] = useState<number | "">("");
  const [remoteTables, setRemoteTables] = useState<RemoteTable[]>([]);
  const [remoteTable, setRemoteTable] = useState("");
  const [loadingTables, setLoadingTables] = useState(false);

  useEffect(() => {
    if (initialTable) return;
    client.get("/bi/sources").then((r) => {
      const list: SourceBrief[] = r.data?.sources || [];
      setSources(list);
      setSourceId(list.length ? list[0].id : "");
    }).catch(() => setSources([]));
  }, [initialTable]);

  useEffect(() => {
    if (mode !== "live" || sourceId === "") { setRemoteTables([]); return; }
    setLoadingTables(true);
    setRemoteTable("");
    /* 直连：默认跟随数据源的归属部门（数据源本身就是部门资产） */
    const src = sources.find((s) => s.id === sourceId);
    if (src?.dept_id) setDeptId(src.dept_id);
    client.get(`/bi/sources/${sourceId}/tables`)
      .then((r) => setRemoteTables(r.data?.tables || []))
      .catch((e: any) => {
        setRemoteTables([]);
        onError(e?.response?.data?.detail || "读取源库表清单失败");
      })
      .finally(() => setLoadingTables(false));
  }, [mode, sourceId, sources]);

  const picked = tables.find((t) => t.table === table);
  const pickedRemote = remoteTables.find((t) => t.table === remoteTable);
  const liveFields = () => (pickedRemote?.columns || []).map((col) => {
    const colName = typeof col === "string" ? col : String(col);
    return remoteField(colName, pickedRemote?.column_types?.[colName]);
  });
  const canSubmit = !!name.trim() && (
    mode === "extract" ? !!table : mode === "live" ? !!remoteTable : !!sqlText.trim()
  );

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const res = mode === "live"
        ? await client.post("/bi/semantic/datasets", {
            name: name.trim(), physical_table: remoteTable, description: description.trim(),
            conn_mode: "live", source_id: sourceId,
            fields: importColumns ? liveFields() : [],
            dept_id: deptId === "" ? null : Number(deptId),
          })
        : mode === "sql"
          ? await client.post("/bi/semantic/datasets", {
              name: name.trim(), sql: sqlText.trim(), description: description.trim(),
              dept_id: deptId === "" ? null : Number(deptId),
            })
          : await client.post("/bi/semantic/datasets", {
              name: name.trim(), physical_table: table, description: description.trim(),
              dept_id: deptId === "" ? null : Number(deptId),
            });
      const id = res.data?.id;
      if (mode === "extract" && importColumns && id) {
        await client.post(`/bi/semantic/datasets/${id}/sync`);
      }
      onCreated(id);
    } catch (e: any) {
      onError(e?.response?.data?.detail || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>新建数据集</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {!initialTable && <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mt: 1, minHeight: 32 }}
          TabIndicatorProps={{ sx: { height: 2, borderRadius: 1 } }}>
          <Tab value="extract" label="抽取 · 物理表" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
          <Tab value="live" label="直连 · 源库" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
          <Tab value="sql" label="自定义 SQL" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
        </Tabs>}
        <TextField fullWidth size="small" label="数据集名称" value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />

        {mode === "extract" && (
          <>
            <TextField fullWidth select size="small" label="物理表" value={table}
              disabled={!!initialTable}
              onChange={(e) => setTable(e.target.value)}
              sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
              {tables.map((t) => (
                <MenuItem key={t.table} value={t.table} sx={{ fontSize: 13 }}>
                  {t.table} · {t.rows} 行{t.origin ? ` · ${t.origin}` : ""}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              sx={{ mt: 1 }}
              control={<Switch size="small" checked={importColumns}
                onChange={(e) => setImportColumns(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                导入 {picked ? `${picked.columns.length} 个物理列` : "物理列"} 作为字段
              </Typography>} />
          </>
        )}

        {mode === "live" && (
          <>
            <Box sx={{ display: "flex", gap: 1.5, mt: 2 }}>
              <TextField select size="small" label="数据源" value={sourceId}
                onChange={(e) => setSourceId(Number(e.target.value))}
                sx={{ width: 220, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
                {sources.map((s) => (
                  <MenuItem key={s.id} value={s.id} sx={{ fontSize: 13 }}>{s.name}</MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="源库表 / 视图" value={remoteTable}
                onChange={(e) => setRemoteTable(e.target.value)}
                disabled={loadingTables}
                InputProps={{
                  endAdornment: loadingTables ? (
                    <InputAdornment position="end"><CircularProgress size={14} /></InputAdornment>
                  ) : undefined,
                }}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
                {remoteTables.map((t) => (
                  <MenuItem key={t.table} value={t.table} sx={{ fontSize: 13, fontFamily: "ui-monospace" }}>
                    {t.table} · {t.columns.length} 列
                  </MenuItem>
                ))}
              </TextField>
            </Box>
            <FormControlLabel
              sx={{ mt: 1 }}
              control={<Switch size="small" checked={importColumns}
                onChange={(e) => setImportColumns(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                导入 {pickedRemote ? `${pickedRemote.columns.length} 个源库列` : "源库列"} 作为字段
              </Typography>} />
          </>
        )}

        {mode === "sql" && (
          <TextField fullWidth size="small" value={sqlText} multiline minRows={6}
            onChange={(e) => setSqlText(e.target.value)}
            placeholder={'SELECT ... FROM bi_xxx WHERE ...'}
            InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12.5 } }}
            sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        )}

        <TextField fullWidth size="small" label="描述（可选）" value={description}
          onChange={(e) => setDescription(e.target.value)} multiline minRows={2}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />

        <TextField fullWidth select size="small" label="归属部门（可选）" value={deptId}
          onChange={(e) => setDeptId(e.target.value === "" ? "" : Number(e.target.value))}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          <MenuItem value="" sx={{ fontSize: 13 }}>不归属部门（个人可见）</MenuItem>
          {departments.map((d) => (
            <MenuItem key={d.id} value={d.id} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
          ))}
        </TextField>
        <Typography sx={{ mt: 0.5, fontSize: 11, color: "#94A3B8" }}>
          标记归属部门后，本部门（含下级）可见并可取数；不选则只有自己（和管理员）可见
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !canSubmit}
          startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>
          创建
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 数据集编辑（抽屉：基本信息 / 字段 / 指标 / 预览）───────── */
