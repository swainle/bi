/** 数据源 —— Superset 的 Database 层：连接配置 / 源库选表 / 同步接入 / 文件导入 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog,
  DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment,
  MenuItem, Paper, Select, Snackbar, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add, DeleteOutline, EditOutlined, FileUpload, Link as LinkIcon, Refresh,
  Rule, Search, Storage, TableChart, UploadFile,
} from "@mui/icons-material";
import client from "../../api/client";

interface Source {
  id: number; name: string; ds_type: string; host: string; port: number | null;
  db_name: string; username: string; uri: boolean; table_count: number;
  updated_at: string;
  /** 归属部门；null = 全局 */
  dept_id?: number | null;
  dept_name?: string;
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
  const [editFor, setEditFor] = useState<Source | null>(null);
  const [pickFor, setPickFor] = useState<Source | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const [resyncing, setResyncing] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState("");
  const [dsTypes, setDsTypes] = useState<SourceType[]>([]);
  const [typesError, setTypesError] = useState("");

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        client.get("/bi/sources"),
        client.get("/bi/sources/files"),
      ]);
      setSources(s.data?.sources || []);
      setSynced(t.data?.tables || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "数据源加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** 数据源连通性：{数据源 id: {ok, message, checked_at}}（后端 30 秒缓存，点圆点重测） */
  const [status, setStatus] = useState<Record<string, { ok: boolean; message: string; checked_at?: number }>>({});
  const [statusBusy, setStatusBusy] = useState(false);

  const loadStatus = useCallback(async (refresh = false) => {
    setStatusBusy(true);
    try {
      const res = await client.get(`/bi/sources/status${refresh ? "?refresh=1" : ""}`);
      setStatus(res.data?.status || {});
    } catch {
      /* 探测接口失败不影响列表本身 */
    } finally {
      setStatusBusy(false);
    }
  }, []);

  // 进页面探一次（30 秒内复用后端结果，不每次进来都连一遍源库）
  useEffect(() => { void loadStatus(false); }, [loadStatus]);

  const testSource = async (s: Source) => {
    setTesting(s.id);
    try {
      const res = await client.post(`/bi/sources/${s.id}/test`);
      setOk(res.data?.message || "连接成功");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "连接失败");
    } finally {
      setTesting(null);
      void loadStatus(false); // 刚测过，圆点跟着更新（后端已写缓存）
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
    if (!window.confirm(`重新同步「${t.source_table}」？会重拉整张表数据并覆盖本地表。`)) return;
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
                        {/* 连通性小圆点（绿=连得上 / 红=连不上 / 灰=正在检测），点一下重测 */}
                        {(() => {
                          const st = status[String(s.id)];
                          const color = !st ? "#CBD5E1" : st.ok ? "#22C55E" : "#EF4444";
                          const ring = !st ? "transparent" : st.ok ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)";
                          const at = st?.checked_at
                            ? new Date(st.checked_at * 1000).toLocaleTimeString("zh-CN", { hour12: false })
                            : "";
                          const retest = () => { if (!statusBusy) void loadStatus(true); };
                          return (
                            <Tooltip
                              placement="top"
                              title={<span style={{ whiteSpace: "pre-line", fontSize: 11.5, display: "block", maxWidth: 300 }}>
                                {st
                                  ? `${st.ok ? "连接正常" : "连接失败"}\n${st.message || ""}${at ? `\n${at} 检测 · 点击重测` : ""}`
                                  : "正在检测连接…"}
                              </span>}
                            >
                              <Box
                                role="button"
                                tabIndex={0}
                                aria-label="检测连接"
                                onClick={(e) => { e.stopPropagation(); retest(); }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); retest(); }
                                }}
                                sx={{
                                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                                  bgcolor: color, boxShadow: `0 0 0 3px ${ring}`, flexShrink: 0,
                                  cursor: statusBusy ? "default" : "pointer",
                                  transition: "background-color .15s, box-shadow .15s",
                                }}
                              />
                            </Tooltip>
                          );
                        })()}
                        {s.dept_name && (
                          <Chip label={s.dept_name} size="small"
                            sx={{ fontSize: 10, height: 18, bgcolor: "rgba(16,185,129,0.10)", color: "#047857" }} />
                        )}
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
                    <TableCell sx={{ ...td, color: "text.secondary" }}>{s.updated_at?.slice(0, 16)}</TableCell>
                    <TableCell sx={{ ...td, pr: 2, textAlign: "right", whiteSpace: "nowrap" }}>
                      <Button size="small" onClick={() => setPickFor(s)}
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
                      <Tooltip title="编辑">
                        <IconButton size="small" aria-label="编辑数据源" onClick={() => setEditFor(s)} sx={{ p: 0.6 }}>
                          <EditOutlined sx={{ fontSize: 16 }} />
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
                      {t.kind === "db" && (
                        <Tooltip title="重新同步（重拉数据）">
                          <IconButton size="small" aria-label="重新同步" onClick={() => resyncTable(t)}
                            disabled={resyncing === t.id} sx={{ p: 0.6 }}>
                            {resyncing === t.id
                              ? <CircularProgress size={14} />
                              : <Refresh sx={{ fontSize: 16 }} />}
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="移除（会删本地表）">
                        <IconButton size="small" onClick={() => removeTable(t)} sx={{ p: 0.6, color: "error.main" }}>
                          <DeleteOutline sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {createOpen && (
        <SourceFormDialog types={dsTypes} typesError={typesError} onRetry={loadTypes}
          onClose={() => setCreateOpen(false)}
          onSaved={async () => { setCreateOpen(false); await load(); void loadStatus(false); }}
          onError={setError} onOk={setOk} />
      )}
      {editFor && (
        <SourceFormDialog types={dsTypes} typesError={typesError} onRetry={loadTypes} source={editFor}
          onClose={() => setEditFor(null)}
          onSaved={async (msg) => { setEditFor(null); await load(); void loadStatus(false); if (msg) setOk(msg); }}
          onError={setError} onOk={setOk} />
      )}
      {pickFor && (
        <PickTablesDialog source={pickFor} onClose={() => setPickFor(null)}
          onDone={async (msg) => { setPickFor(null); await load(); setOk(msg); }}
          onError={setError} />
      )}

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

/* ── 新建 / 编辑数据源 ───────────────────────────────────── */
function SourceFormDialog({
  types, typesError, onRetry, source, onClose, onSaved, onError, onOk,
}: {
  types: SourceType[];
  typesError: string;
  onRetry: () => Promise<void>;
  /** 传了就是编辑模式：预填已存配置，只提交用户改过的字段 */
  source?: Source;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (m: string) => void;
  onOk: (m: string) => void;
}) {
  const editing = !!source;
  const [dsType, setDsType] = useState(source?.ds_type || "");
  const [name, setName] = useState(source?.name || "");
  const [host, setHost] = useState(source?.host || "127.0.0.1");
  const [port, setPort] = useState(source?.port ? String(source.port) : "");
  const [dbName, setDbName] = useState(source?.db_name || "");
  const [username, setUsername] = useState(source?.username || "");
  const [password, setPassword] = useState("");
  const [uri, setUri] = useState("");
  // 连接串模式：编辑时沿用原数据源的连接方式；点「改用主机连接」才切回主机 + 端口
  const [uriMode, setUriMode] = useState(!!source?.uri);
  const [deptId, setDeptId] = useState<number | "">(source?.dept_id ?? "");
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    client.get("/auth/departments")
      .then((r) => setDepartments(r.data?.items || []))
      .catch(() => setDepartments([]));
  }, []);

  const selected = types.find((t) => t.id === dsType);
  // 编辑模式不靠类型目录兜底：驱动缺失 / 目录没加载也要能改地址
  const blocked = !editing && (!dsType || selected?.available === false);
  const unavailable = types.filter((t) => !t.available);
  const notReady = !editing && (!!typesError || types.length === 0);
  const showAddress = !editing || !uriMode;
  const showUri = !editing || uriMode;

  // 类型是后端下发的，异步到达：默认选中第一个可用项（编辑模式的类型不可改）
  useEffect(() => {
    if (editing || dsType) return;
    const first = types.find((t) => t.available);
    if (first) {
      setDsType(first.id);
      setPort(String(first.default_port || ""));
    }
  }, [types, dsType, editing]);

  const pickType = (id: string) => {
    setDsType(id);
    const t = types.find((x) => x.id === id);
    setPort(String(t?.default_port || ""));
  };

  const payload = () => {
    const body: Record<string, unknown> = {
      name: name.trim(),
      dept_id: deptId === "" ? null : Number(deptId),
    };
    // 连接串模式不改主机 / 端口 / 库名 / 账号：别把表单默认值写进库
    if (showAddress) {
      body.host = host.trim();
      body.port = port ? Number(port) : null;
      body.db_name = dbName.trim();
      body.username = username.trim();
      body.password = password;
    }
    if (editing) {
      // 连接串模式留空 = 保持原连接串；主机模式显式清空连接串
      if (uriMode) {
        if (uri.trim()) body.uri = uri.trim();
      } else {
        body.uri = "";
      }
    } else {
      body.ds_type = dsType;
      body.uri = uri.trim();
    }
    return body;
  };

  const test = async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const t = editing
        ? await client.post(`/bi/sources/${source!.id}/test`, payload())
        : await client.post("/bi/sources/test", payload());
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
      if (editing) {
        await client.patch(`/bi/sources/${source!.id}`, payload());
        onSaved(`已更新「${name.trim()}」`);
      } else {
        await client.post("/bi/sources", payload());
        onSaved("");
      }
    } catch (e: any) {
      onError(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
        {editing ? "编辑数据源" : "新建数据源"}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {notReady ? (
          typesError ? (
            <Alert severity="error" sx={{ mt: 1, borderRadius: 1.5, fontSize: 12.5 }}
              action={<Button color="inherit" size="small" onClick={() => void onRetry()}>重试</Button>}>
              {typesError}
            </Alert>
          ) : (
            <Box sx={{ py: 5, textAlign: "center" }}><CircularProgress size={22} /></Box>
          )
        ) : (
          <>
            <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
              {editing ? (
                <TextField size="small" label="类型" value={typeLabelOf(types, dsType)} disabled
                  sx={{ width: 220, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              ) : (
                <TextField select size="small" label="类型" value={dsType}
                  onChange={(e) => pickType(e.target.value)}
                  sx={{ width: 220, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
                  {types.map((t) => (
                    <MenuItem key={t.id} value={t.id} disabled={!t.available} sx={{ fontSize: 13 }}>
                      {t.label}{t.available ? "" : " · 未装驱动"}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField size="small" label="名称" value={name} onChange={(e) => setName(e.target.value)}
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
            </Box>
            {!editing && unavailable.length > 0 && (
              <Typography sx={{ mt: 0.75, fontSize: 11.5, color: "#94A3B8" }}>
                置灰类型需先在服务器安装驱动，重启后端后自动可用。
              </Typography>
            )}
            {showUri && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 2 }}>
                <TextField fullWidth size="small" label={editing ? "新连接串" : "连接串 URI（可选，填了优先用）"}
                  value={uri} onChange={(e) => setUri(e.target.value)}
                  autoFocus={!!(editing && uriMode)}
                  placeholder={editing ? "" : "postgresql://user:password@host:5432/dbname"}
                  InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
                  sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                {editing && source?.uri && (
                  <Button size="small" onClick={() => { setUriMode(false); setUri(""); }}
                    sx={{ textTransform: "none", fontSize: 11.5, whiteSpace: "nowrap", flexShrink: 0 }}>
                    改用主机连接
                  </Button>
                )}
              </Box>
            )}
            {showAddress && (
              <>
                <Box sx={{ display: "flex", gap: 1.5, mt: 2 }}>
                  <TextField size="small" label="主机" value={host}
                    onChange={(e) => setHost(e.target.value)}
                    autoFocus={!!editing && !source?.uri}
                    sx={{ flex: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                  <TextField size="small" label="端口" value={port} onChange={(e) => setPort(e.target.value)}
                    sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                </Box>
                <TextField fullWidth size="small" label="数据库" value={dbName}
                  onChange={(e) => setDbName(e.target.value)}
                  sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                <Box sx={{ display: "flex", gap: 1.5, mt: 2 }}>
                  <TextField size="small" label="用户名" value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                  <TextField size="small" label={editing ? "新密码" : "密码"} type="password" value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
                </Box>
              </>
            )}
            <TextField fullWidth select size="small" label="归属部门（可选）" value={deptId}
              onChange={(e) => setDeptId(e.target.value === "" ? "" : Number(e.target.value))}
              sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
              <MenuItem value="" sx={{ fontSize: 13 }}>不归属部门</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d.id} value={d.id} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
              ))}
            </TextField>
            <Typography sx={{ mt: 0.5, fontSize: 11, color: "#94A3B8" }}>
              标记归属部门后，数据管理列表与 AI 取数会按部门判断权限
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={test} disabled={busy || blocked || notReady}
          sx={{ textTransform: "none", mr: "auto", color: "#475569" }}>测试连接</Button>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        <Button variant="contained" onClick={submit} disabled={busy || notReady || blocked || !name.trim()}
          startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function typeLabelOf(types: SourceType[], id: string) {
  return types.find((t) => t.id === id)?.label || id || "—";
}

/* ── 选表接入 ───────────────────────────────────────────── */
function PickTablesDialog({
  source, onClose, onDone, onError,
}: {
  source: Source;
  onClose: () => void;
  onDone: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const [tables, setTables] = useState<RemoteTable[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    client.get(`/bi/sources/${source.id}/tables`)
      .then((res) => setTables(res.data?.tables || []))
      .catch((e) => onError(e?.response?.data?.detail || "读取表清单失败"))
      .finally(() => setLoading(false));
  }, [source.id]);

  const shown = keyword.trim()
    ? tables.filter((t) => t.table.toLowerCase().includes(keyword.trim().toLowerCase()))
    : tables;
  const count = Object.values(picked).filter(Boolean).length;

  const sync = async () => {
    const names = Object.entries(picked).filter(([, v]) => v).map(([k]) => k);
    if (!names.length) return;
    setSyncing(true);
    try {
      const res = await client.post(`/bi/sources/${source.id}/sync`, { tables: names });
      const syncedCount = res.data?.synced?.length || 0;
      const rows = (res.data?.synced || []).reduce((a: number, s: any) => a + (s.rows || 0), 0);
      onDone(`已接入 ${syncedCount} 张表 · 共 ${rows} 行`);
    } catch (e: any) {
      onError(e?.response?.data?.detail || "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>
        选表接入 · {source.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <TextField fullWidth size="small" placeholder="搜索源库表..." value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 16, color: "text.secondary" }} />
              </InputAdornment>
            ),
            sx: { borderRadius: 2, fontSize: 12.5 },
          }}
          sx={{ mt: 1 }} />
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
          ) : shown.map((t) => (
            <Box key={t.table}
              onClick={() => setPicked((p) => ({ ...p, [t.table]: !p[t.table] }))}
              sx={{
                display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.35,
                cursor: "pointer", "&:hover": { bgcolor: "rgba(99,102,241,0.05)" },
              }}>
              <Checkbox size="small" checked={!!picked[t.table]} sx={{ p: 0.5 }} />
              <Typography sx={{ fontSize: 12.5, fontFamily: "ui-monospace" }}>{t.table}</Typography>
              {t.kind === "view" && (
                <Box sx={{
                  px: 0.6, py: 0.05, borderRadius: 0.75, fontSize: 10,
                  color: "#0E7490", bgcolor: "rgba(8,145,178,0.1)",
                }}>
                  视图
                </Box>
              )}
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 11, color: "text.disabled" }}>{t.columns.length} 列</Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", mr: "auto" }}>取消</Button>
        <Button variant="contained" onClick={sync} disabled={syncing || !count}
          startIcon={syncing ? <CircularProgress size={13} color="inherit" /> : <Refresh sx={{ fontSize: 15 }} />}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>
          接入{count ? ` ${count} 张` : ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
