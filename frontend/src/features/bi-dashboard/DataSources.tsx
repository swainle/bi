import { formatChinaTime } from "../../utils/time";
/** 数据源 —— Superset 的 Database 层：连接配置 / 源库选表 / 同步接入 / 文件导入 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, InputAdornment,
  LinearProgress, Menu, MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add, DeleteOutline, ExpandLess, ExpandMore, FileUpload, Link as LinkIcon, Refresh,
  MoreHoriz, Rule, Search, Storage, TableChart, UploadFile,
} from "@mui/icons-material";
import client from "../../api/client";
import { CreateDatasetDialog, type PhysTable } from "./DatasetPanel";

interface Source {
  id: number; name: string; ds_type: string; host: string; port: number | null;
  db_name: string; username: string; uri: boolean; table_count: number;
  updated_at: string;
}
interface ColumnDrift { name: string; type?: string; from?: string; to?: string }
interface Drift {
  added?: ColumnDrift[];
  removed?: ColumnDrift[];
  changed?: ColumnDrift[];
  has_changes?: boolean;
}
interface SyncedTable {
  id: number; source_id: number | null; source_table: string; local_table: string;
  row_count: number; kind: string; synced_at: string; source_name: string;
  ds_type: string; dataset_count: number;
  freshness?: "fresh" | "aging" | "stale" | "unknown";
  age_hours?: number | null;
  column_count?: number;
  checked_at?: string;
  drift?: Drift | null;
  sync_interval_minutes?: number;
  next_sync_at?: string;
  last_sync_status?: string;
  last_sync_error?: string;
}
interface RemoteTable {
  table: string;
  columns: string[];
  schema?: string;
  kind?: "table" | "view";
}
type ImportState = "queued" | "reading" | "writing" | "done" | "failed";
interface ImportTable {
  source_table: string; state: ImportState; rows_read: number; rows_written: number; error: string;
}
interface ImportJob {
  id: string; source_id: number; source_name: string; created_at: string; tables: ImportTable[];
}
interface ImportLock { source_id: number; source_table: string; state: ImportState }
const IMPORT_LABEL: Record<ImportState, string> = {
  queued: "等待导入", reading: "正在读取", writing: "正在写入", done: "已接入", failed: "导入失败",
};
const isImportActive = (state: ImportState) => state === "queued" || state === "reading" || state === "writing";
interface SourceType {
  id: string; label: string; desc: string; category: string;
  default_port: number; available: boolean; reason: string; install: string;
}

const th = {
  fontSize: 11.5, fontWeight: 600, color: "#64748B", py: 0.85, bgcolor: "#F8F9FC",
  borderColor: "#EEF3FB", whiteSpace: "nowrap",
} as const;
const td = { fontSize: 12, py: 0.7, borderColor: "#F1F5F9", whiteSpace: "nowrap" } as const;

function addr(s: Source) {
  if (s.uri) return "URI";
  const port = s.port ? `:${s.port}` : "";
  return `${s.host || "—"}${port}${s.db_name ? `/${s.db_name}` : ""}`;
}

const FRESH_META: Record<string, { label: string; color: string; bg: string }> = {
  fresh: { label: "新鲜", color: "#0E7490", bg: "rgba(8,145,178,0.10)" },
  aging: { label: "待更新", color: "#B45309", bg: "rgba(217,119,6,0.10)" },
  stale: { label: "过期", color: "#B91C1C", bg: "rgba(220,38,38,0.10)" },
  unknown: { label: "未知", color: "#64748B", bg: "rgba(100,116,139,0.10)" },
};

function driftCount(d: Drift | null | undefined) {
  if (!d) return 0;
  return (d.added?.length || 0) + (d.removed?.length || 0) + (d.changed?.length || 0);
}

function driftText(d: Drift | null | undefined) {
  if (!d) return "";
  const lines: string[] = [];
  if (d.added?.length) lines.push(`新增 ${d.added.length} 列：${d.added.map((c) => c.name).join("、")}`);
  if (d.removed?.length) lines.push(`删除 ${d.removed.length} 列：${d.removed.map((c) => c.name).join("、")}`);
  if (d.changed?.length) {
    lines.push(`类型变更 ${d.changed.length} 列：${d.changed.map((c) => `${c.name}（${c.from} → ${c.to}）`).join("、")}`);
  }
  return lines.join("\n");
}

const SYNC_OPTIONS = [
  { value: 0, label: "关闭" },
  { value: 60, label: "每小时" },
  { value: 360, label: "每 6 小时" },
  { value: 1440, label: "每天" },
] as const;

function ageText(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return "";
  if (hours < 1) return "刚刚";
  if (hours < 24) return `${Math.round(hours)} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

export default function DataSources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [synced, setSynced] = useState<SyncedTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [pickFor, setPickFor] = useState<Source | null>(null);
  const [datasetFor, setDatasetFor] = useState<{ source: SyncedTable; table: PhysTable } | null>(null);
  const [loadingDataset, setLoadingDataset] = useState<number | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const [resyncing, setResyncing] = useState<number | null>(null);
  const [metadataSyncing, setMetadataSyncing] = useState<number | null>(null);
  const [tableMenu, setTableMenu] = useState<{ anchor: HTMLElement; table: SyncedTable } | null>(null);
  const [confirmTable, setConfirmTable] = useState<{ action: "sync" | "metadata" | "remove"; table: SyncedTable } | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [dsTypes, setDsTypes] = useState<SourceType[]>([]);
  const [typesError, setTypesError] = useState("");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [importLocks, setImportLocks] = useState<ImportLock[]>([]);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [jobsError, setJobsError] = useState("");
  const [jobsReady, setJobsReady] = useState(false);
  const [jobsRevision, setJobsRevision] = useState(0);

  const loadTypes = useCallback(async () => {
    try {
      const res = await client.get("/bi/sources/types");
      setDsTypes(res.data?.types || []);
      setTypesError("");
    } catch {
      setTypesError("数据源类型加载失败");
    }
  }, []);

  useEffect(() => { void loadTypes(); }, [loadTypes]);

  const typeLabel = (id: string) => dsTypes.find((t) => t.id === id)?.label || id;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [s, t] = await Promise.all([
        client.get("/bi/sources"),
        client.get("/bi/sources/files"),
      ]);
      setSources(s.data?.sources || []);
      setSynced(t.data?.tables || []);
      return true;
    } catch (e: any) {
      setError(e?.response?.data?.detail || "数据源加载失败");
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let alive = true, inFlight = false, previous = "";
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      if (!alive || inFlight) return;
      clearTimeout(timer);
      if (document.hidden) { timer = setTimeout(poll, 2000); return; }
      inFlight = true;
      let delay = 2000;
      try {
        const res = await client.get("/bi/sources/import-jobs", { signal: controller.signal });
        if (!alive) return;
        const nextJobs: ImportJob[] = res.data?.jobs || [];
        const nextLocks: ImportLock[] = res.data?.active_tables || [];
        const signature = JSON.stringify([nextLocks, nextJobs.map((job) => job.tables.map((t) => t.state))]);
        if (signature !== previous) {
          if (!await load(true)) throw new Error("已接入表刷新失败");
          previous = signature;
        }
        if (!alive) return;
        setJobs(nextJobs); setImportLocks(nextLocks); setJobsReady(true); setJobsError("");
      } catch (e: any) {
        if (alive) { setJobsError(e?.response?.data?.detail || "后台任务状态读取失败，稍后重试"); setJobsReady(false); }
        delay = 6000;
      } finally {
        inFlight = false;
        if (alive) timer = setTimeout(poll, delay);
      }
    };
    const visible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [load, jobsRevision]);

  const createDataset = async (source: SyncedTable) => {
    setLoadingDataset(source.id);
    try {
      const res = await client.get("/bi/semantic/tables");
      const table = (res.data?.tables as PhysTable[] || []).find((t) => t.table === source.local_table);
      if (!table) {
        setError("本地表不可用，请刷新列表或重新同步后重试");
        return;
      }
      setDatasetFor({ source, table });
    } catch (e: any) {
      setError(e?.response?.data?.detail || "读取本地表信息失败");
    } finally {
      setLoadingDataset(null);
    }
  };

  const testSource = async (s: Source) => {
    setTesting(s.id);
    try {
      const res = await client.post(`/bi/sources/${s.id}/test`);
      setOk(res.data?.message || "连接成功");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "连接失败");
    } finally {
      setTesting(null);
    }
  };

  const removeSource = async (s: Source) => {
    if (!window.confirm(`删除数据源「${s.name}」及其已同步的表？`)) return;
    try {
      await client.delete(`/bi/sources/${s.id}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "删除失败");
    }
  };

  const removeTable = async (t: SyncedTable) => {
    try {
      await client.delete(`/bi/sources/files/${t.id}`);
      await load();
      setOk(`已移除 ${t.local_table}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "移除失败");
    }
  };

  const checkSchema = async (s: Source) => {
    setChecking(s.id);
    try {
      const res = await client.post(`/bi/sources/${s.id}/schema-check`);
      const checked = res.data?.checked ?? 0;
      const changed = res.data?.changed ?? 0;
      await load();
      setOk(changed ? `检查 ${checked} 张表 · ${changed} 张有变更` : `检查 ${checked} 张表 · 结构一致`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "结构检查失败");
    } finally {
      setChecking(null);
    }
  };

  const resyncTable = async (t: SyncedTable) => {
    setResyncing(t.id);
    try {
      const res = await client.post(`/bi/sources/files/${t.id}/resync`);
      const rows = res.data?.synced?.rows ?? 0;
      await load();
      setOk(`已重新同步 ${t.source_table} · ${rows} 行`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "重新同步失败");
    } finally {
      setResyncing(null);
    }
  };

  const syncMetadata = async (t: SyncedTable) => {
    setMetadataSyncing(t.id);
    try {
      const res = await client.post(`/bi/sources/files/${t.id}/sync-metadata`);
      const missing = res.data?.missing_columns?.length || 0;
      setOk(`已同步表注释及 ${res.data?.columns_synced ?? 0} 个字段注释${missing ? `；${missing} 个源字段尚未接入，请先同步本地表` : ""}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "元数据同步失败");
    } finally { setMetadataSyncing(null); }
  };

  const setSchedule = async (t: SyncedTable, minutes: number) => {
    try {
      await client.patch(`/bi/sources/files/${t.id}/schedule`, { interval_minutes: minutes });
      await load();
      const label = SYNC_OPTIONS.find((o) => o.value === minutes)?.label || `${minutes} 分钟`;
      setOk(`${t.source_table} 自动同步：${label}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "设置自动同步失败");
    }
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await client.post("/bi/sources/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      await load();
      setOk(`已导入 ${res.data?.rows ?? 0} 行 → ${res.data?.local_table ?? ""}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "导入失败");
    } finally {
      setUploading(false);
    }
  };

  const filteredSynced = useMemo(() => {
    const kw = keyword.trim();
    return kw
      ? synced.filter((t) => t.local_table.includes(kw) || t.source_table.includes(kw))
      : synced;
  }, [synced, keyword]);

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2.5 }}>
        <Typography sx={{ flex: 1, fontSize: 20, fontWeight: 800, color: "text.primary", letterSpacing: -0.2 }}>
          数据源
        </Typography>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.json,.tsv" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }} />
        <Button size="small" variant="outlined"
          startIcon={uploading ? <CircularProgress size={14} /> : <UploadFile sx={{ fontSize: 16 }} />}
          onClick={() => fileRef.current?.click()} disabled={uploading}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, height: 36 }}>
          导入表格
        </Button>
        <Button size="small" variant="contained" startIcon={<Add sx={{ fontSize: 16 }} />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: "#6366F1", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2, height: 36 }}>
          新建数据源
        </Button>
      </Box>

      {loading ? (
        <Box sx={{ textAlign: "center", py: 8 }}><CircularProgress size={26} /></Box>
      ) : (
        <>
          <TableContainer component={Paper} elevation={0}
            sx={{ borderRadius: 2.5, border: "1px solid", borderColor: "#EEF3FB" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...th, pl: 2 }}>数据源</TableCell>
                  <TableCell sx={th}>类型</TableCell>
                  <TableCell sx={th}>地址</TableCell>
                  <TableCell sx={th} align="right">已接入表</TableCell>
                  <TableCell sx={th}>更新时间</TableCell>
                  <TableCell sx={{ ...th, pr: 2 }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sources.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ py: 7, textAlign: "center", borderBottom: 0 }}>
                      <Storage sx={{ fontSize: 36, color: "text.disabled", mb: 1 }} />
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: "text.secondary" }}>
                        还没有数据源
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : sources.map((s) => (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ ...td, pl: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{
                          width: 26, height: 26, borderRadius: 1.5, flexShrink: 0,
                          bgcolor: "rgba(99,102,241,0.08)", color: "#6366F1", display: "grid", placeItems: "center",
                        }}>
                          <Storage sx={{ fontSize: 15 }} />
                        </Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{s.name}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={td}>
                      <Chip label={typeLabel(s.ds_type)} size="small"
                        sx={{ fontSize: 10.5, height: 20, bgcolor: "#F1F5F9", color: "#475569" }} />
                    </TableCell>
                    <TableCell sx={{ ...td, color: "#475569", fontFamily: "ui-monospace", fontSize: 11.5 }}>
                      {addr(s)}
                    </TableCell>
                    <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{s.table_count}</TableCell>
                    <TableCell sx={{ ...td, color: "text.secondary" }}>{formatChinaTime(s.updated_at).slice(0, 16)}</TableCell>
                    <TableCell sx={{ ...td, pr: 2, textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button size="small" onClick={() => { setJobsReady(false); setJobsRevision((r) => r + 1); setPickFor(s); }}
                        sx={{ textTransform: "none", fontSize: 11.5, borderRadius: 1.5, minWidth: "auto", px: 1 }}>
                        选表接入
                      </Button>
                      <Tooltip title="检查结构变更">
                        <IconButton size="small" aria-label="检查结构变更" onClick={() => checkSchema(s)}
                          disabled={checking === s.id} sx={{ p: 0.6 }}>
                          {checking === s.id ? <CircularProgress size={14} /> : <Rule sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="测连通">
                        <IconButton size="small" onClick={() => testSource(s)} disabled={testing === s.id} sx={{ p: 0.6 }}>
                          {testing === s.id ? <CircularProgress size={14} /> : <LinkIcon sx={{ fontSize: 16 }} />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton size="small" onClick={() => removeSource(s)} sx={{ p: 0.6, color: "error.main" }}>
                          <DeleteOutline sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 3.5, mb: 1.5 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: "text.primary" }}>
              已接入表
            </Typography>
            <Tooltip title={jobsError || "后台任务"}>
              <IconButton size="small" aria-label="后台任务" onClick={() => { setJobsOpen(true); setJobsRevision((r) => r + 1); }}>
                <Refresh sx={{ fontSize: 18, color: jobsError ? "error.main" : "primary.main",
                  animation: jobs.some((j) => j.tables.some((t) => isImportActive(t.state))) ? "importSpin 1.2s linear infinite" : "none",
                  "@keyframes importSpin": { to: { transform: "rotate(360deg)" } },
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }} />
              </IconButton>
            </Tooltip>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
              {synced.length} 张
            </Typography>
            <Box sx={{ flex: 1 }} />
            <TextField size="small" placeholder="搜索表..." value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search sx={{ fontSize: 16, color: "text.secondary" }} />
                  </InputAdornment>
                ),
                sx: { borderRadius: 2, fontSize: 12.5 },
              }}
              sx={{ width: 220 }} />
          </Box>
          <TableContainer component={Paper} elevation={0}
            sx={{ borderRadius: 2.5, border: "1px solid", borderColor: "#EEF3FB" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...th, pl: 2 }}>本地表</TableCell>
                  <TableCell sx={th}>来源</TableCell>
                  <TableCell sx={th} align="right">行数</TableCell>
                  <TableCell sx={th} align="right">数据集</TableCell>
                  <TableCell sx={th}>新鲜度</TableCell>
                  <TableCell sx={th}>自动同步</TableCell>
                  <TableCell sx={th}>同步时间</TableCell>
                  <TableCell sx={{ ...th, pr: 2 }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredSynced.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} sx={{ py: 6, textAlign: "center", borderBottom: 0 }}>
                      <TableChart sx={{ fontSize: 32, color: "text.disabled", mb: 1 }} />
                      <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                        {keyword ? "没有匹配的表" : "还没有接入表"}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : filteredSynced.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell sx={{ ...td, pl: 2, maxWidth: 260 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, minWidth: 0 }}>
                        <code title={t.local_table}
                          style={{ fontSize: 11.5, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {t.local_table}
                        </code>
                        {driftCount(t.drift) > 0 && (
                          <Tooltip title={<span style={{ whiteSpace: "pre-line" }}>{driftText(t.drift)}</span>}>
                            <Chip label={`结构已变 · ${driftCount(t.drift)}`} size="small"
                              sx={{
                                height: 18, fontSize: 10, fontWeight: 600,
                                color: "#B45309", bgcolor: "rgba(217,119,6,0.12)",
                              }} />
                          </Tooltip>
                        )}
                        {t.last_sync_status === "failed" && (
                          <Tooltip title={t.last_sync_error || "最近一次同步失败"}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.3 }}>
                              <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "#DC2626" }} />
                              <Typography sx={{ fontSize: 10.5, color: "#B91C1C" }}>同步失败</Typography>
                            </Box>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ ...td, color: "#475569", maxWidth: 230 }}>
                      {t.kind === "file" ? (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}>
                          <FileUpload sx={{ fontSize: 14, color: "#94A3B8", flexShrink: 0 }} />
                          <Box component="span" title={t.source_table}
                            sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.source_table}</Box>
                        </Box>
                      ) : (
                        <Box component="span" title={`${t.source_name} · ${t.source_table}`}
                          sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {t.source_name} · {t.source_table}
                        </Box>
                      )}
                    </TableCell>
                    <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{t.row_count}</TableCell>
                    <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{t.dataset_count}</TableCell>
                    <TableCell sx={td}>
                      <Tooltip title={t.checked_at ? `结构检查：${t.checked_at.slice(0, 16)}` : "还没有检查过结构"}>
                        <Chip
                          label={`${(FRESH_META[t.freshness || "unknown"] || FRESH_META.unknown).label}${
                            ageText(t.age_hours) ? ` · ${ageText(t.age_hours)}` : ""
                          }`}
                          size="small"
                          sx={{
                            height: 20, fontSize: 10.5,
                            color: (FRESH_META[t.freshness || "unknown"] || FRESH_META.unknown).color,
                            bgcolor: (FRESH_META[t.freshness || "unknown"] || FRESH_META.unknown).bg,
                          }} />
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={td}>
                      {t.kind === "db" ? (
                        <Tooltip title={t.next_sync_at ? `下次同步：${t.next_sync_at.slice(0, 16)}` : "不自动同步"}>
                          <Select
                            size="small"
                            variant="outlined"
                            value={t.sync_interval_minutes || 0}
                            onChange={(e) => setSchedule(t, Number(e.target.value))}
                            aria-label="自动同步间隔"
                            sx={{
                              height: 26, fontSize: 11.5, borderRadius: "8px", minWidth: 88,
                              "& .MuiSelect-select": { py: 0.25, px: 1 },
                            }}>
                            {SYNC_OPTIONS.map((o) => (
                              <MenuItem key={o.value} value={o.value} sx={{ fontSize: 12 }}>
                                {o.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </Tooltip>
                      ) : (
                        <Typography sx={{ fontSize: 11, color: "text.disabled" }}>—</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ ...td, color: "text.secondary" }}>{t.synced_at?.slice(0, 16)}</TableCell>
                    <TableCell sx={{ ...td, pr: 2, textAlign: "right" }}>
                      <Button size="small" startIcon={loadingDataset === t.id
                        ? <CircularProgress size={13} /> : <Add sx={{ fontSize: 16 }} />}
                        disabled={loadingDataset !== null} onClick={() => createDataset(t)}
                        sx={{ fontSize: 11.5, whiteSpace: "nowrap" }}>
                        创建数据集
                      </Button>
                      <Tooltip title="更多操作">
                        <span><IconButton size="small" aria-label={`${t.local_table} 更多操作`}
                          aria-haspopup="menu" disabled={resyncing === t.id || metadataSyncing === t.id}
                          onClick={(e) => setTableMenu({ anchor: e.currentTarget, table: t })} sx={{ p: 0.6 }}>
                          {resyncing === t.id || metadataSyncing === t.id ? <CircularProgress size={14} /> : <MoreHoriz sx={{ fontSize: 18 }} />}
                        </IconButton></span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      <Menu anchorEl={tableMenu?.anchor} open={!!tableMenu} onClose={() => setTableMenu(null)}
        MenuListProps={{ sx: { color: "#475569", "& .MuiMenuItem-root": { fontSize: td.fontSize, fontWeight: 400, py: td.py } } }}>
        <MenuItem disabled={tableMenu?.table.kind !== "db"} onClick={() => {
          setConfirmTable({ action: "sync", table: tableMenu!.table }); setTableMenu(null);
        }}>同步本地表</MenuItem>
        <MenuItem disabled={tableMenu?.table.kind !== "db"} onClick={() => {
          setConfirmTable({ action: "metadata", table: tableMenu!.table }); setTableMenu(null);
        }}>同步本地表元数据</MenuItem>
        {tableMenu?.table.kind === "file" && <Typography sx={{ px: 2, py: 0.5, fontSize: 11, color: "text.secondary" }}>文件表需重新上传，无法从源库同步</Typography>}
        <MenuItem sx={{ color: "error.main" }} onClick={() => {
          setConfirmTable({ action: "remove", table: tableMenu!.table }); setTableMenu(null);
        }}>移除本地表</MenuItem>
      </Menu>

      <Dialog open={!!confirmTable} onClose={() => setConfirmTable(null)} maxWidth="xs" fullWidth
        aria-labelledby="table-action-title" aria-describedby="table-action-description">
        <DialogTitle id="table-action-title" sx={{ fontSize: 16, fontWeight: 700 }}>
          {confirmTable?.action === "remove" ? "移除本地表" : confirmTable?.action === "metadata" ? "同步本地表元数据" : "同步本地表"}
        </DialogTitle>
        <DialogContent>
          <Typography id="table-action-description" sx={{ fontSize: 13, color: "text.secondary" }}>
            {confirmTable?.action === "remove"
              ? `确定移除本地表「${confirmTable.table.local_table}」？将删除本地副本，不影响源库。`
              : confirmTable?.action === "metadata"
                ? `以源库注释覆盖「${confirmTable.table.local_table}」的表和字段注释？不会修改字段结构或业务数据。`
                : confirmTable ? `同步「${confirmTable.table.source_table}」到本地？会完整读取源表，按现有日期替换或整表覆盖策略更新本地数据。` : ""}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button autoFocus onClick={() => setConfirmTable(null)}>取消</Button>
          <Button variant="contained" color={confirmTable?.action === "remove" ? "error" : "primary"}
            onClick={() => {
              if (!confirmTable) return;
              const { action, table } = confirmTable;
              setConfirmTable(null);
              if (action === "remove") void removeTable(table);
              else if (action === "metadata") void syncMetadata(table);
              else void resyncTable(table);
            }}>确认</Button>
        </DialogActions>
      </Dialog>

      {datasetFor && (
        <CreateDatasetDialog tables={[datasetFor.table]}
          initialTable={datasetFor.table.table} initialName={datasetFor.source.source_table}
          onClose={() => setDatasetFor(null)}
          onCreated={async () => { setDatasetFor(null); setOk("数据集已创建"); await load(); }}
          onError={setError} />
      )}
      {createOpen && (
        <CreateSourceDialog types={dsTypes} typesError={typesError} onRetry={loadTypes}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await load(); }}
          onError={setError} onOk={setOk} />
      )}
      {pickFor && (
        <PickTablesDialog source={pickFor} synced={synced} importLocks={importLocks} statusReady={jobsReady}
          onClose={() => setPickFor(null)}
          onDone={(msg) => { setPickFor(null); setJobsReady(false); setJobsOpen(true); setJobsRevision((r) => r + 1); setOk(msg); }}
          onError={setError} />
      )}
      {jobsOpen && <ImportJobsDialog jobs={jobs} error={jobsError} ready={jobsReady} onClose={() => setJobsOpen(false)} />}

      <Snackbar open={!!ok} autoHideDuration={3000} onClose={() => setOk("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="success" onClose={() => setOk("")} sx={{ borderRadius: 2, fontSize: 12.5 }}>{ok}</Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" onClose={() => setError("")} sx={{ borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>
      </Snackbar>
    </Box>
  );
}

/* ── 新建数据源 ─────────────────────────────────────────── */
function CreateSourceDialog({
  types, typesError, onRetry, onClose, onCreated, onError, onOk,
}: {
  types: SourceType[];
  typesError: string;
  onRetry: () => Promise<void>;
  onClose: () => void;
  onCreated: () => void;
  onError: (m: string) => void;
  onOk: (m: string) => void;
}) {
  const [dsType, setDsType] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [dbName, setDbName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = types.find((t) => t.id === dsType);
  const blocked = !dsType || selected?.available === false;
  const unavailable = types.filter((t) => !t.available);
  const notReady = !!typesError || types.length === 0;

  // 类型是后端下发的，异步到达：默认选中第一个可用项
  useEffect(() => {
    if (dsType) return;
    const first = types.find((t) => t.available);
    if (first) {
      setDsType(first.id);
      setPort(String(first.default_port || ""));
    }
  }, [types, dsType]);

  const pickType = (id: string) => {
    setDsType(id);
    const t = types.find((x) => x.id === id);
    setPort(String(t?.default_port || ""));
  };

  const payload = () => ({
    name: name.trim(), ds_type: dsType, host: host.trim(),
    port: port ? Number(port) : null, db_name: dbName.trim(),
    username: username.trim(), password, uri: uri.trim(),
  });

  const test = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const t = await client.post("/bi/sources/test", payload());
      onOk(t.data?.message || "连接成功");
    } catch (e: any) {
      onError(e?.response?.data?.detail || "连接失败");
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!name.trim() || blocked) return;
    setBusy(true);
    try {
      await client.post("/bi/sources", payload());
      onCreated();
    } catch (e: any) {
      onError(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>新建数据源</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {typesError ? (
          <Alert severity="error" sx={{ mt: 1, borderRadius: 1.5, fontSize: 12.5 }}
            action={<Button color="inherit" size="small" onClick={() => void onRetry()}>重试</Button>}>
            {typesError}
          </Alert>
        ) : types.length === 0 ? (
          <Box sx={{ py: 5, textAlign: "center" }}><CircularProgress size={22} /></Box>
        ) : (
          <>
            <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
              <TextField select size="small" label="类型" value={dsType}
                onChange={(e) => pickType(e.target.value)}
                sx={{ width: 220, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
                {types.map((t) => (
                  <MenuItem key={t.id} value={t.id} disabled={!t.available} sx={{ fontSize: 13 }}>
                    {t.label}{t.available ? "" : " · 未装驱动"}
                  </MenuItem>
                ))}
              </TextField>
              <TextField size="small" label="名称" value={name} onChange={(e) => setName(e.target.value)}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            </Box>
            {unavailable.length > 0 && (
              <Typography sx={{ mt: 0.75, fontSize: 11.5, color: "#94A3B8" }}>
                置灰类型需先在服务器安装驱动，重启后端后自动可用。
              </Typography>
            )}
            <TextField fullWidth size="small" label="连接串 URI（可选，填了优先用）" value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="postgresql://user:password@host:5432/dbname"
              InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
              sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            <Box sx={{ display: "flex", gap: 1.5, mt: 2 }}>
              <TextField size="small" label="主机" value={host} onChange={(e) => setHost(e.target.value)}
                sx={{ flex: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              <TextField size="small" label="端口" value={port} onChange={(e) => setPort(e.target.value)}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            </Box>
            <TextField fullWidth size="small" label="数据库" value={dbName} onChange={(e) => setDbName(e.target.value)}
              sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            <Box sx={{ display: "flex", gap: 1.5, mt: 2 }}>
              <TextField size="small" label="用户名" value={username} onChange={(e) => setUsername(e.target.value)}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              <TextField size="small" label="密码" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={test} disabled={busy || blocked || notReady}
          sx={{ textTransform: "none", mr: "auto", color: "#475569" }}>测试连接</Button>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || notReady || blocked || !name.trim()}
          startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>保存</Button>
      </DialogActions>
    </Dialog>
  );
}

export function groupRemoteTables(tables: RemoteTable[], keyword: string) {
  const search = keyword.trim().toLowerCase();
  const groups = new Map<string, RemoteTable[]>();
  for (const table of tables) {
    const fullName = table.schema && !table.table.startsWith(`${table.schema}.`)
      ? `${table.schema}.${table.table}` : table.table;
    if (!fullName.toLowerCase().includes(search)) continue;
    const schema = table.schema || "";
    const group = groups.get(schema) || [];
    group.push(table);
    groups.set(schema, group);
  }
  return [...groups.entries()];
}

export function toggleTableSelection(picked: Record<string, boolean>, tables: RemoteTable[]) {
  const checked = !tables.every((table) => picked[table.table]);
  const next = { ...picked };
  for (const table of tables) next[table.table] = checked;
  return next;
}

/* ── 选表接入 ───────────────────────────────────────────── */
function PickTablesDialog({
  source, synced, importLocks, statusReady, onClose, onDone, onError,
}: {
  source: Source;
  synced: SyncedTable[];
  importLocks: ImportLock[];
  statusReady: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const [tables, setTables] = useState<RemoteTable[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    client.get(`/bi/sources/${source.id}/tables`, { timeout: 60000 })
      .then((res) => setTables(res.data?.tables || []))
      .catch((e) => onError(e?.response?.data?.detail || "读取表清单失败"))
      .finally(() => setLoading(false));
  }, [source.id]);

  const groups = groupRemoteTables(tables, keyword);
  const shown = groups.flatMap(([, group]) => group);
  const locked = new Map<string, ImportState>([
    ...synced.filter((t) => t.source_id === source.id).map((t) => [t.source_table, "done"] as [string, ImportState]),
    ...importLocks.filter((t) => t.source_id === source.id).map((t) => [t.source_table, t.state] as [string, ImportState]),
  ]);
  const available = shown.filter((t) => !locked.has(t.table));
  const names = Object.keys(picked).filter((name) => picked[name] && !locked.has(name));
  const count = names.length;
  const shownPickedCount = shown.filter((t) => locked.has(t.table) || picked[t.table]).length;
  const allShownPicked = shown.length > 0 && shownPickedCount === shown.length;

  const toggleShown = () => {
    setPicked((prev) => toggleTableSelection(prev, available));
  };

  const sync = async () => {
    if (!names.length) return;
    setSyncing(true);
    try {
      await client.post(`/bi/sources/${source.id}/import-jobs`, { tables: names });
      onDone(`已创建 ${names.length} 张表的导入任务`);
    } catch (e: any) {
      onError(e?.response?.data?.detail || "创建导入任务失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open onClose={syncing ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
        选表接入 · {source.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {!statusReady && <Alert severity="warning" sx={{ mb: 1 }}>正在确认表的接入状态，暂不可提交</Alert>}
        <TextField fullWidth size="small" placeholder="搜索源库表..." value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setCollapsed({});
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16, color: "text.secondary" }} />
              </InputAdornment>
            ),
            sx: { borderRadius: 2, fontSize: 12.5 },
          }}
          sx={{ mt: 1 }} />
        <FormControlLabel
          sx={{ mt: 1, ml: 0 }}
          control={
            <Checkbox size="small" checked={allShownPicked}
              indeterminate={shownPickedCount > 0 && !allShownPicked}
              disabled={loading || syncing || !statusReady || available.length === 0}
              onChange={toggleShown} sx={{ p: 0.5, mr: 0.5 }} />
          }
          label={<Typography sx={{ fontSize: 12.5 }}>当前全选（{shown.length} 张）</Typography>}
        />
        <Box sx={{
          mt: 1.5, maxHeight: 380, overflow: "auto", border: "1px solid #EEF3FB", borderRadius: 2,
        }}>
          {loading ? (
            <Box sx={{ textAlign: "center", py: 6 }}><CircularProgress size={22} /></Box>
          ) : shown.length === 0 ? (
            <Box sx={{ textAlign: "center", py: 6 }}>
              <Typography sx={{ fontSize: 12.5, color: "text.secondary" }}>
                {keyword ? "没有匹配的表" : "源库里没有表"}
              </Typography>
            </Box>
          ) : groups.map(([schema, group]) => {
            const selectedCount = group.filter((t) => locked.has(t.table) || picked[t.table]).length;
            const availableGroup = group.filter((t) => !locked.has(t.table));
            const expanded = !collapsed[schema];
            return <Box key={schema}>
              {schema && <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, bgcolor: "#F8FAFC" }}>
                <IconButton size="small" aria-label={`${expanded ? "折叠" : "展开"} ${schema}`}
                  aria-expanded={expanded}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [schema]: expanded }))}>
                  {expanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                </IconButton>
                <FormControlLabel sx={{ m: 0 }} control={
                  <Checkbox size="small" checked={selectedCount === group.length}
                    indeterminate={selectedCount > 0 && selectedCount < group.length}
                    disabled={syncing || !statusReady || availableGroup.length === 0}
                    onChange={() => setPicked((prev) => toggleTableSelection(prev, availableGroup))} />
                } label={<Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{schema}（{group.length} 张）</Typography>} />
              </Box>}
              {(!schema || expanded) && group.map((t) => (
            <Box key={t.table}
              sx={{
                display: "flex", alignItems: "center", gap: 1, pl: schema ? 5 : 1, pr: 1, py: 0.35,
                "&:hover": { bgcolor: "rgba(99,102,241,0.05)" },
              }}>
              <FormControlLabel sx={{ m: 0 }} control={
                <Checkbox size="small" checked={locked.has(t.table) || !!picked[t.table]}
                  disabled={syncing || !statusReady || locked.has(t.table)}
                  onChange={() => setPicked((p) => ({ ...p, [t.table]: !p[t.table] }))}
                  sx={{ p: 0.5, mr: 1 }} />
              } label={<Typography title={t.table} sx={{ fontSize: 12.5, fontFamily: "ui-monospace" }}>
                {schema && t.table.startsWith(`${schema}.`) ? t.table.slice(schema.length + 1) : t.table}
              </Typography>} />
              {t.kind === "view" && (
                <Box sx={{
                  px: 0.6, py: 0.05, borderRadius: 0.75, fontSize: 10,
                  color: "#0E7490", bgcolor: "rgba(8,145,178,0.1)",
                }}>
                  视图
                </Box>
              )}
              <Box sx={{ flex: 1 }} />
              {locked.has(t.table) && <Chip size="small" label={IMPORT_LABEL[locked.get(t.table)!]}
                sx={{ fontSize: 10.5, height: 20 }} />}
              <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{t.columns.length} 列</Typography>
            </Box>
              ))}
            </Box>;
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={syncing} sx={{ textTransform: "none", mr: "auto" }}>取消</Button>
        <Button variant="contained" onClick={sync} disabled={syncing || !count || !statusReady || loading}
          startIcon={syncing ? <CircularProgress size={13} color="inherit" /> : <Refresh sx={{ fontSize: 15 }} />}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>
          创建导入任务{count ? `（${count} 张）` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ImportJobsDialog({ jobs, error, ready, onClose }: {
  jobs: ImportJob[]; error: string; ready: boolean; onClose: () => void;
}) {
  const ordered = [...jobs].sort((a, b) => Number(b.tables.some((t) => isImportActive(t.state)))
    - Number(a.tables.some((t) => isImportActive(t.state))));
  return <Dialog open onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: "background.paper" } }}>
    <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>后台任务</DialogTitle>
    <DialogContent>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {!ready && !error && <CircularProgress size={22} />}
      {ready && !jobs.length && <Typography sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>暂无导入任务</Typography>}
      {ordered.map((job) => {
        const done = job.tables.filter((t) => t.state === "done").length;
        const failed = job.tables.filter((t) => t.state === "failed").length;
        return <Paper key={job.id} variant="outlined" sx={{ p: 2, mb: 2, borderColor: "#EEF3FB", borderRadius: "12px" }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{job.source_name} · 导入 {job.tables.length} 张表</Typography>
          <Typography sx={{ fontSize: 12, my: 1, color: failed ? "error.main" : "text.secondary" }}>
            已接入 {done} / {job.tables.length}{failed ? ` · 失败 ${failed}` : ""}
          </Typography>
          <LinearProgress variant="determinate" value={(done + failed) / job.tables.length * 100}
            color={failed ? "error" : "primary"} aria-label="导入任务进度" sx={{ mb: 2 }} />
          {job.tables.map((item) => <Box key={item.source_table} sx={{ my: 1.5 }}>
            <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
              {(item.state === "reading" || item.state === "writing") && <CircularProgress size={13} />}
              <Typography sx={{ fontSize: 12.5, fontFamily: "ui-monospace", overflowWrap: "anywhere" }}>{item.source_table}</Typography>
              <Chip size="small" label={IMPORT_LABEL[item.state]} color={item.state === "failed" ? "error" : item.state === "done" ? "success" : "default"}
                sx={{ height: 20, fontSize: 10.5 }} />
              <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
                {item.state === "reading" ? `已读取 ${item.rows_read.toLocaleString()} 行`
                  : item.state === "writing" ? `已写入 ${item.rows_written.toLocaleString()} / ${item.rows_read.toLocaleString()} 行`
                  : item.state === "done" ? `${item.rows_written.toLocaleString()} 行` : ""}
              </Typography>
            </Box>
            {item.state === "writing" && <LinearProgress variant={item.rows_read ? "determinate" : "indeterminate"}
              value={item.rows_read ? Math.min(100, item.rows_written / item.rows_read * 100) : undefined}
              aria-label={`${item.source_table} 写入进度`} sx={{ mt: 1 }} />}
            {item.error && <Typography sx={{ mt: 0.5, fontSize: 12, color: "error.main", overflowWrap: "anywhere" }}>{item.error}</Typography>}
          </Box>)}
        </Paper>;
      })}
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={onClose}>关闭</Button></DialogActions>
  </Dialog>;
}
