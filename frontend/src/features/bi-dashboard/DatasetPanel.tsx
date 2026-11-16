/** 数据集 —— 语义层建模（物理表 → 字段 / 指标，参考 Superset 的 Datasets） */

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
import client from "../../api/client";
import { useNavigate } from "react-router-dom";
import ModelImportDialog from "./ModelImportDialog";

const ROLES = [
  { v: "dimension", l: "维度" },
  { v: "time", l: "时间" },
  { v: "measure", l: "度量" },
  { v: "id", l: "标识" },
];
const TYPES = ["text", "integer", "numeric", "date", "datetime", "bool"];
const FORMATS = [
  { v: "number", l: "数值" },
  { v: "percent", l: "百分比" },
  { v: "currency", l: "金额" },
];

interface Field {
  id: number; name: string; source_column: string; role: string;
  data_type: string; is_filterable: boolean; is_groupable: boolean;
  default_grain: string | null; description: string;
}
interface Metric {
  id: number; name: string; expression: string; format: string; description: string;
  certified?: boolean; certified_at?: string; version?: number;
}
interface MetricVersion {
  version: number; name: string; expression: string; format: string;
  changed_by_name: string; changed_at: string; note: string;
}
interface MetricUsage {
  dashboard_id: number; dashboard_name: string; view_key: string;
  item_key: string; item_kind: string; item_type: string; role: string;
}
interface Dataset {
  id: number; name: string; physical_table: string; description: string;
  updated_at: string; field_count: number; metric_count: number;
  owner_id?: number | null;
  sql_text?: string;
  is_virtual?: boolean;
  conn_mode?: string;
  source_id?: number | null;
  /** 模板库复制出来的数据集：只出现在「测试数据集」页 */
  template_id?: number;
  template_name?: string;
  /** 「测试数据集」页自建的公共测试数据集：同样不进「数据集」页 */
  is_sandbox?: boolean;
}
interface PhysTable {
  table: string; rows: number; columns: { name: string; type: string }[];
  origin?: string;
}
interface RemoteTable {
  table: string; kind?: string; columns: string[];
  column_types?: Record<string, string>;
}
interface SourceBrief {
  id: number; name: string; ds_type: string;
}

/* 源库列类型 → 字段角色 / 类型 */
function remoteField(name: string, rawType?: string) {
  const t = (rawType || "").toLowerCase();
  if (/date|timestamp|time/.test(t)) return { name, source_column: name, role: "time", data_type: "date" };
  if (/int|numeric|decimal|double|float|real|money|serial/.test(t)) {
    return { name, source_column: name, role: "measure", data_type: "numeric" };
  }
  return { name, source_column: name, role: "dimension", data_type: "text" };
}

const td = { fontSize: 12, py: 0.7, borderColor: "#F1F5F9" } as const;
const th = { fontSize: 11.5, fontWeight: 600, color: "#64748B", py: 0.85, bgcolor: "#F8F9FC", borderColor: "#EEF3FB" } as const;
/** 测试数据集只属于「测试数据集」页面：按物理表判定，改过名也不会漏进这张列表 */
const DEMO_TABLE = "bi_demo_sku";

function Toast({ msg, onClose, severity = "error" }: { msg: string; onClose: () => void; severity?: "error" | "success" }) {
  return (
    <Snackbar open={!!msg} autoHideDuration={3200} onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
      <Alert severity={severity} onClose={onClose} sx={{ borderRadius: 2, fontSize: 12.5 }}>{msg}</Alert>
    </Snackbar>
  );
}

/** 改名只走 /datasets/{id}/name：后端这条路径只写 name 一列，物理表 / 取数方式 / 数据源不可能被带动 */
async function renameDatasetName(id: number, next: string): Promise<{ name: string; updated_at?: string }> {
  const res = await client.patch(`/bi/semantic/datasets/${id}/name`, { name: next.trim() });
  return { name: String(res.data?.name ?? next), updated_at: res.data?.updated_at };
}

/** 就地改名：点铅笔（抽屉标题支持双击）变输入框，回车 / 失焦保存，Esc 取消，失败回退原名 */
function InlineRename({
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

export default function DatasetPanel() {
  const [items, setItems] = useState<Dataset[]>([]);
  const [tables, setTables] = useState<PhysTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  /** 直连数据集的源库连通性：{数据集 id: {ok, message, checked_at}} */
  const [status, setStatus] = useState<Record<string, { ok: boolean; message: string; checked_at?: number }>>({});
  const [statusBusy, setStatusBusy] = useState(false);
  /** 进页面只强制重探一次 */
  const probed = useRef(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, tableRes] = await Promise.all([
        client.get("/bi/semantic/datasets"),
        client.get("/bi/semantic/tables"),
      ]);
      setItems(listRes.data?.datasets || []);
      setTables(tableRes.data?.tables || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "数据集加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  /** 探直连数据集的源库连通性（后端 30 秒缓存；refresh = 手动点圆点重测） */
  const loadStatus = useCallback(async (refresh = false) => {
    setStatusBusy(true);
    try {
      const res = await client.get(`/bi/semantic/datasets/status${refresh ? "?refresh=1" : ""}`);
      setStatus(res.data?.status || {});
    } catch {
      /* 探测接口失败不影响列表本身 */
    } finally {
      setStatusBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!items.some((d) => d.conn_mode === "live")) return;
    /* 进页面这一次强制重探（圆点必须反映此刻的真实连通性）；
       之后的刷新（新建/删除数据集）走 30 秒缓存，不重复连库 */
    const first = !probed.current;
    probed.current = true;
    void loadStatus(first);
  }, [items, loadStatus]);

  /** 测试数据集：组件库 / 卡片预览用的模拟数据，点进去看数据（缺了会在那边一键重建） */
  const openTestDataset = () => nav("/bi?view=test-data");

  const rows = useMemo(
    () => items
      .filter((d) => d.physical_table !== DEMO_TABLE)
      .filter((d) => !d.template_id)
      .filter((d) => !d.is_sandbox)
      .filter((d) => (keyword.trim() ? d.name.includes(keyword.trim()) : true)),
    [items, keyword],
  );

  /** 列表里就地改名：服务端返回即真相，只替换这一行的名称与更新时间（不整表重载，避免闪一下） */
  const renameRow = useCallback(async (id: number, next: string) => {
    try {
      const saved = await renameDatasetName(id, next);
      setItems((list) => list.map((d) => (d.id === id
        ? { ...d, name: saved.name, updated_at: saved.updated_at || d.updated_at }
        : d)));
    } catch (e: any) {
      setError(e?.response?.data?.detail || "改名失败");
      throw e;
    }
  }, []);

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await client.delete(`/bi/semantic/datasets/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "删除失败");
      setDeleteTarget(null);
    }
  };

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, mb: 2.5 }}>
        <Typography sx={{ flex: 1, fontSize: 20, fontWeight: 800, color: "text.primary", letterSpacing: -0.2 }}>
          数据集
        </Typography>
        <TextField size="small" placeholder="搜索数据集..." value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search sx={{ fontSize: 17, color: "text.secondary" }} />
              </InputAdornment>
            ),
            sx: { borderRadius: 2, fontSize: 13 },
          }}
          sx={{ width: 240 }} />
        <Button variant="contained" size="small" startIcon={<Add sx={{ fontSize: 16 }} />}
          onClick={() => setCreateOpen(true)}
          sx={{ bgcolor: "#6366F1", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2, height: 36 }}>
          新建数据集
        </Button>
        {/* 组件库 / 卡片预览用的模拟数据：点进去看数据，缺了在那边一键重建（仅管理员能删） */}
        <Tooltip title="进入「测试数据集」：组件库 / 卡片预览用的模拟数据（公共、跟随项目、仅管理员可删）">
          <Button variant="outlined" size="small"
            onClick={openTestDataset}
            sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 1.75, height: 36,
              borderColor: "#D8E2F5", color: "#475569" }}>
            测试数据集
          </Button>
        </Tooltip>
      </Box>

      {loading ? (
        <Box sx={{ textAlign: "center", py: 10 }}><CircularProgress size={26} /></Box>
      ) : (
        <TableContainer component={Paper} elevation={0}
          sx={{ borderRadius: 2.5, border: "1px solid", borderColor: "#EEF3FB" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ ...th, pl: 2 }}>数据集</TableCell>
                <TableCell sx={th}>物理表</TableCell>
                <TableCell sx={th} align="right">字段</TableCell>
                <TableCell sx={th} align="right">指标</TableCell>
                <TableCell sx={th}>更新时间</TableCell>
                <TableCell sx={{ ...th, pr: 2 }} align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 10, textAlign: "center", borderBottom: 0 }}>
                    <TableChart sx={{ fontSize: 40, color: "text.disabled", mb: 1 }} />
                    <Typography sx={{ fontSize: 13, fontWeight: 600, color: "text.secondary" }}>
                      {keyword ? "没有匹配的数据集" : "还没有数据集"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : rows.map((d) => (
                <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setEditing(d.id)}>
                  <TableCell sx={{ ...td, pl: 2 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{
                        width: 26, height: 26, borderRadius: 1.5, flexShrink: 0,
                        bgcolor: "rgba(99,102,241,0.08)", color: "#6366F1",
                        display: "grid", placeItems: "center",
                      }}>
                        <TableChart sx={{ fontSize: 15 }} />
                      </Box>
                      <InlineRename value={d.name} submit={(next) => renameRow(d.id, next)} />
                      {d.conn_mode === "live" && (
                        <Chip label="直连" size="small"
                          sx={{ fontSize: 10, height: 18, bgcolor: "rgba(37,99,235,0.10)", color: "#2563EB", fontWeight: 600 }} />
                      )}
                      {/* 直连数据集：源库连通性小圆点（绿=连得上 / 红=连不上），点一下重测 */}
                      {d.conn_mode === "live" && (() => {
                        const st = status[String(d.id)];
                        const color = !st ? "#CBD5E1" : st.ok ? "#22C55E" : "#EF4444";
                        const ring = !st ? "transparent" : st.ok ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)";
                        const at = st?.checked_at
                          ? new Date(st.checked_at * 1000).toLocaleTimeString("zh-CN", { hour12: false })
                          : "";
                        return (
                          <Tooltip
                            placement="top"
                            title={<span style={{ whiteSpace: "pre-line", fontSize: 11.5 }}>
                              {st ? `${st.ok ? "连接正常" : "连接失败"}\n${st.message || ""}${at ? `\n${at} 检测 · 点击重测` : ""}` : "正在检测连接…"}
                            </span>}
                          >
                            <Box
                              onClick={(e) => { e.stopPropagation(); if (!statusBusy) void loadStatus(true); }}
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
                    </Box>
                  </TableCell>
                  <TableCell sx={td}>
                    <Chip label={d.physical_table} size="small"
                      sx={{ fontSize: 10.5, height: 20, bgcolor: "#F1F5F9", color: "#475569", fontFamily: "ui-monospace" }} />
                  </TableCell>
                  <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{d.field_count}</TableCell>
                  <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{d.metric_count}</TableCell>
                  <TableCell sx={{ ...td, color: "text.secondary" }}>
                    {d.updated_at?.slice(0, 16) || ""}
                  </TableCell>
                  <TableCell sx={{ ...td, pr: 2, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="只读预览这个数据集的数据">
                      <Button size="small" startIcon={<VisibilityOutlined sx={{ fontSize: 15 }} />}
                        onClick={() => nav(`/bi?view=dataset-preview&id=${d.id}&ro=1`)}
                        sx={{ textTransform: "none", fontSize: 12, color: "#4F46E5", minWidth: 0, mr: 0.5 }}>
                        预览
                      </Button>
                    </Tooltip>
                    <Tooltip title="编辑">
                      <IconButton size="small" onClick={() => setEditing(d.id)} sx={{ p: 0.6 }}>
                        <Edit sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除">
                      <IconButton size="small" onClick={() => setDeleteTarget(d)}
                        sx={{ p: 0.6, color: "error.main" }}>
                        <DeleteOutline sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {createOpen && (
        <CreateDatasetDialog tables={tables}
          onClose={() => setCreateOpen(false)}
          onCreated={async (id) => { setCreateOpen(false); await load(); setEditing(id); }}
          onError={setError} />
      )}

      {editing !== null && (
        <DatasetEditor datasetId={editing}
          onClose={() => setEditing(null)}
          onChanged={load}
          onRenamed={(id, saved) => setItems((list) => list.map((d) => (d.id === id
            ? { ...d, name: saved.name, updated_at: saved.updated_at || d.updated_at }
            : d)))} />
      )}

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700 }}>删除数据集</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "text.secondary" }}>
            确定删除「{deleteTarget?.name}」？字段与指标定义一并移除，引用它的图表将无法取数。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button color="error" variant="contained" onClick={remove}
            sx={{ textTransform: "none", borderRadius: 2 }}>删除</Button>
        </DialogActions>
      </Dialog>

      <Toast msg={error} onClose={() => setError("")} />
    </Box>
  );
}

/* ── 新建数据集 ─────────────────────────────────────────── */
function CreateDatasetDialog({
  tables, onClose, onCreated, onError,
}: {
  tables: PhysTable[];
  onClose: () => void;
  onCreated: (id: number) => void;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<"extract" | "live" | "sql">("extract");
  const [name, setName] = useState("");
  const [table, setTable] = useState("");
  const [sqlText, setSqlText] = useState("");
  const [description, setDescription] = useState("");
  const [importColumns, setImportColumns] = useState(true);
  const [busy, setBusy] = useState(false);

  // 直连：数据源 → 源库表
  const [sources, setSources] = useState<SourceBrief[]>([]);
  const [sourceId, setSourceId] = useState<number | "">("");
  const [remoteTables, setRemoteTables] = useState<RemoteTable[]>([]);
  const [remoteTable, setRemoteTable] = useState("");
  const [loadingTables, setLoadingTables] = useState(false);

  useEffect(() => {
    client.get("/bi/sources").then((r) => {
      const list: SourceBrief[] = r.data?.sources || [];
      setSources(list);
      setSourceId(list.length ? list[0].id : "");
    }).catch(() => setSources([]));
  }, []);

  useEffect(() => {
    if (mode !== "live" || sourceId === "") { setRemoteTables([]); return; }
    setLoadingTables(true);
    setRemoteTable("");
    client.get(`/bi/sources/${sourceId}/tables`)
      .then((r) => setRemoteTables(r.data?.tables || []))
      .catch((e: any) => {
        setRemoteTables([]);
        onError(e?.response?.data?.detail || "读取源库表清单失败");
      })
      .finally(() => setLoadingTables(false));
  }, [mode, sourceId]);

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
          })
        : mode === "sql"
          ? await client.post("/bi/semantic/datasets", {
              name: name.trim(), sql: sqlText.trim(), description: description.trim(),
            })
          : await client.post("/bi/semantic/datasets", {
              name: name.trim(), physical_table: table, description: description.trim(),
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
        <Tabs value={mode} onChange={(_, v) => setMode(v)} sx={{ mt: 1, minHeight: 32 }}
          TabIndicatorProps={{ sx: { height: 2, borderRadius: 1 } }}>
          <Tab value="extract" label="抽取 · 物理表" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
          <Tab value="live" label="直连 · 源库" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
          <Tab value="sql" label="自定义 SQL" sx={{ textTransform: "none", fontSize: 12.5, minHeight: 32, fontWeight: 600 }} />
        </Tabs>
        <TextField fullWidth size="small" label="数据集名称" value={name} autoFocus
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />

        {mode === "extract" && (
          <>
            <TextField fullWidth select size="small" label="物理表" value={table}
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
function DatasetEditor({
  datasetId, onClose, onChanged, onRenamed,
}: {
  datasetId: number; onClose: () => void; onChanged: () => void;
  onRenamed: (id: number, saved: { name: string; updated_at?: string }) => void;
}) {
  const [data, setData] = useState<(Dataset & { fields: Field[]; metrics: Metric[] }) | null>(null);
  const [tab, setTab] = useState(0);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [description, setDescription] = useState("");
  const [sqlDraft, setSqlDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldDialog, setFieldDialog] = useState<Field | "new" | null>(null);
  const [metricDialog, setMetricDialog] = useState<Metric | "new" | null>(null);
  const [versionsFor, setVersionsFor] = useState<Metric | null>(null);
  const [usagesFor, setUsagesFor] = useState<Metric | null>(null);
  const [physColumns, setPhysColumns] = useState<{ name: string; type: string }[]>([]);
  const [fieldUsage, setFieldUsage] = useState<{
    counts: Record<string, number>; usages: Record<string, MetricUsage[]>;
  } | null>(null);
  const [usageField, setUsageField] = useState<{ name: string; items: MetricUsage[] } | null>(null);
  const [modelImportOpen, setModelImportOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await client.get(`/bi/semantic/datasets/${datasetId}`);
    setData(res.data);
    setDescription(res.data.description || "");
    setSqlDraft(res.data.sql_text || "");
  }, [datasetId]);

  useEffect(() => { load().catch(() => setError("数据集加载失败")); }, [load]);

  // 字段血缘：进「字段」页签时拉一次（看板数不多，直接整表算）
  useEffect(() => {
    if (tab !== 0) return;
    client.get(`/bi/semantic/datasets/${datasetId}/fields/usages`)
      .then((res) => setFieldUsage(res.data || null))
      .catch(() => setFieldUsage(null));
  }, [tab, datasetId]);

  // 物理表的列（添加字段时直接挑，不用手打列名）
  useEffect(() => {
    if (!data?.physical_table) return;
    if (data.conn_mode === "live" && data.source_id) {
      // 直连：物理列来自源库，不是本地 information_schema
      client.get(`/bi/sources/${data.source_id}/tables`).then((res) => {
        const hit = (res.data?.tables || []).find((t: RemoteTable) => t.table === data.physical_table);
        setPhysColumns(((hit?.columns || []) as string[]).map((col: string) => {
          const n = String(col);
          return { name: n, type: hit?.column_types?.[n] || "" };
        }));
      }).catch(() => setPhysColumns([]));
      return;
    }
    client.get("/bi/semantic/tables").then((res) => {
      const hit = (res.data?.tables || []).find((t: PhysTable) => t.table === data.physical_table);
      setPhysColumns(hit?.columns || []);
    }).catch(() => setPhysColumns([]));
  }, [data?.physical_table, data?.conn_mode, data?.source_id]);

  const toast = (msg: string, good = false) => { if (good) setOk(msg); else setError(msg); };

  const saveInfo = async () => {
    setBusy(true);
    try {
      await client.patch(`/bi/semantic/datasets/${datasetId}`, {
        description,
        ...(data?.is_virtual ? { sql: sqlDraft } : {}),
      });
      await load();
      onChanged();
      toast("基本信息已保存", true);
    } catch (e: any) {
      toast(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const syncColumns = async () => {
    try {
      if (data?.conn_mode === "live" && data.source_id) {
        // 直连：按源库列补齐字段（本地没有物理表可同步）
        const registered = new Set((data.fields || []).map((f) => f.source_column));
        const missing = physColumns.filter((c) => !registered.has(c.name));
        if (!missing.length) { toast("源库列已全部登记", true); return; }
        for (const col of missing) {
          const spec = remoteField(col.name, col.type);
          await client.post(`/bi/semantic/datasets/${datasetId}/fields`, spec);
        }
        await load(); onChanged();
        toast(`已补入 ${missing.length} 个源库列`, true);
        return;
      }
      const res = await client.post(`/bi/semantic/datasets/${datasetId}/sync`);
      await load(); onChanged();
      const added = res.data?.added ?? 0;
      toast(added ? `已补入 ${added} 个物理列` : "物理列已全部登记", true);
    } catch (e: any) {
      toast(e?.response?.data?.detail || "同步失败");
    }
  };

  const removeField = async (f: Field) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/fields/${f.id}`);
      await load(); onChanged();
    } catch (e: any) {
      toast(e?.response?.data?.detail || "删除字段失败");
    }
  };

  const removeMetric = async (m: Metric) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/metrics/${m.id}`);
      await load(); onChanged();
    } catch (e: any) {
      toast(e?.response?.data?.detail || "删除指标失败");
    }
  };

  const toggleCertify = async (m: Metric) => {
    try {
      const res = await client.post(
        `/bi/semantic/datasets/${datasetId}/metrics/${m.id}/certify`,
        { certified: !m.certified },
      );
      await load();
      toast(res.data?.certified ? `「${m.name}」已认证` : `「${m.name}」已取消认证`, true);
    } catch (e: any) {
      toast(e?.response?.data?.detail || "认证失败");
    }
  };

  const changed = !!data && (description !== (data.description || "")
    || (!!data.is_virtual && sqlDraft !== (data.sql_text || "")));

  /** 抽屉标题就地改名：只改 name（不碰物理表 / 取数方式 / 数据源），列表与基本信息同步刷新 */
  const renameTitle = async (next: string) => {
    try {
      const saved = await renameDatasetName(datasetId, next);
      setData((d) => (d ? { ...d, name: saved.name, updated_at: saved.updated_at || d.updated_at } : d));
      onRenamed(datasetId, saved);
      toast("已重命名", true);
    } catch (e: any) {
      toast(e?.response?.data?.detail || "改名失败");
      throw e;
    }
  };

  return (
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: 940, maxWidth: "96vw" } }}>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* 头 */}
        <Box sx={{ px: 3, pt: 2.5, pb: 1.5, borderBottom: "1px solid #EEF3FB" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
            {data ? (
              <InlineRename value={data.name} variant="title" doubleClick submit={renameTitle} />
            ) : (
              <Typography sx={{ fontSize: 17, fontWeight: 800, color: "text.primary" }}>数据集</Typography>
            )}
            {data && (
              <Chip label={data.physical_table} size="small"
                sx={{ fontSize: 10.5, height: 20, bgcolor: "#F1F5F9", color: "#475569", fontFamily: "ui-monospace" }} />
            )}
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={onClose} sx={{ p: 0.6 }}>
              <Close sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 1.5, minHeight: 34 }}
            TabIndicatorProps={{ sx: { height: 2, borderRadius: 1 } }}>
            {[
              `字段 ${data?.fields.length ?? 0}`,
              `指标 ${data?.metrics.length ?? 0}`,
              "数据预览",
              "权限",
              "基本信息",
            ].map((label) => (
              <Tab key={label} label={label}
                sx={{ textTransform: "none", fontSize: 12.5, minHeight: 34, py: 0.5, fontWeight: 600 }} />
            ))}
          </Tabs>
        </Box>

        <Box sx={{ flex: 1, overflow: "auto", px: 3, py: 2, minHeight: 0 }}>
          {!data ? (
            <Box sx={{ textAlign: "center", py: 8 }}><CircularProgress size={24} /></Box>
          ) : tab === 0 ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
                <Box sx={{ flex: 1 }} />
                <Button size="small" startIcon={<Refresh sx={{ fontSize: 15 }} />} onClick={syncColumns}
                  sx={{ textTransform: "none", fontSize: 12, color: "#475569" }}>同步物理列</Button>
                <Button size="small" variant="outlined" startIcon={<Add sx={{ fontSize: 15 }} />}
                  onClick={() => setFieldDialog("new")}
                  sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>添加字段</Button>
              </Box>
              <MiniTable
                head={["字段名", "来源列", "角色", "类型", "筛选", "分组", "使用", ""]}
                rows={data.fields.map((f) => {
                  const count = fieldUsage?.counts?.[f.name] || 0;
                  return [
                    <span key="n" style={{ fontWeight: 600 }}>{f.name}</span>,
                    <code key="c" style={{ fontSize: 11.5, color: "#64748B" }}>{f.source_column}</code>,
                    ROLES.find((r) => r.v === f.role)?.l || f.role,
                    f.data_type,
                    f.is_filterable ? "✓" : "—",
                    f.is_groupable ? "✓" : "—",
                    <Box key="u">
                      {count > 0 ? (
                        <Chip
                          label={`使用 ${count}`} size="small"
                          aria-label={`${f.name} 的使用位置`}
                          onClick={() => setUsageField({
                            name: f.name, items: fieldUsage?.usages?.[f.name] || [],
                          })}
                          sx={{
                            height: 19, fontSize: 10.5, cursor: "pointer",
                            color: "#4F46E5", bgcolor: "rgba(99,102,241,0.10)",
                          }} />
                      ) : (
                        <span style={{ color: "#CBD5E1" }}>—</span>
                      )}
                    </Box>,
                    <Box key="a" sx={{ textAlign: "right" }}>
                      <IconButton size="small" onClick={() => setFieldDialog(f)} sx={{ p: 0.5 }}>
                        <Edit sx={{ fontSize: 15 }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => removeField(f)} sx={{ p: 0.5, color: "error.main" }}>
                        <DeleteOutline sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Box>,
                  ];
                })}
                empty="还没有字段，点「同步物理列」从表里导入"
              />
            </>
          ) : tab === 1 ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant="outlined" startIcon={<UploadFileOutlined sx={{ fontSize: 15 }} />}
                  onClick={() => setModelImportOpen(true)}
                  sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>导入模型</Button>
                <Button size="small" variant="outlined" startIcon={<Add sx={{ fontSize: 15 }} />}
                  onClick={() => setMetricDialog("new")}
                  sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>添加指标</Button>
              </Box>
              <MiniTable
                head={["指标名", "表达式", "格式", "状态", ""]}
                rows={data.metrics.map((m) => [
                  <span key="n" style={{ fontWeight: 600 }}>{m.name}</span>,
                  <code key="e" style={{ fontSize: 11.5, color: "#475569" }}>{m.expression}</code>,
                  FORMATS.find((f) => f.v === m.format)?.l || m.format,
                  <Box key="s" sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                    <Chip
                      label={m.certified ? "已认证" : "未认证"}
                      size="small"
                      onClick={() => toggleCertify(m)}
                      sx={{
                        height: 19, fontSize: 10.5, cursor: "pointer",
                        color: m.certified ? "#0E7490" : "#64748B",
                        bgcolor: m.certified ? "rgba(8,145,178,0.10)" : "rgba(100,116,139,0.10)",
                      }} />
                    <Typography sx={{ fontSize: 10.5, color: "text.disabled" }}>v{m.version || 1}</Typography>
                  </Box>,
                  <Box key="a" sx={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <Tooltip title={m.certified ? "取消认证" : "认证（确认口径）"}>
                      <IconButton size="small" aria-label={m.certified ? "取消认证" : "认证指标"}
                        onClick={() => toggleCertify(m)} sx={{ p: 0.5 }}>
                        {m.certified
                          ? <VerifiedUser sx={{ fontSize: 15, color: "#0E7490" }} />
                          : <VerifiedUserOutlined sx={{ fontSize: 15, color: "#94A3B8" }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="版本历史">
                      <IconButton size="small" aria-label="版本历史"
                        onClick={() => setVersionsFor(m)} sx={{ p: 0.5 }}>
                        <History sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="影响分析（哪些看板在用）">
                      <IconButton size="small" aria-label="影响分析"
                        onClick={() => setUsagesFor(m)} sx={{ p: 0.5 }}>
                        <Hub sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => setMetricDialog(m)} sx={{ p: 0.5 }}>
                      <Edit sx={{ fontSize: 15 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => removeMetric(m)} sx={{ p: 0.5, color: "error.main" }}>
                      <DeleteOutline sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Box>,
                ])}
                empty="还没有指标，添加一个 SUM(...) 之类的聚合表达式"
              />
            </>
          ) : tab === 2 ? (
            <PreviewPane dataset={data} />
          ) : tab === 3 ? (
            <DatasetSecurityPanel datasetId={datasetId} fields={data.fields} />
          ) : (
            <Box sx={{ maxWidth: 460 }}>
              <TextField fullWidth size="small" label={data.is_virtual ? "类型" : "物理表"}
                value={data.is_virtual ? "自定义 SQL" : data.physical_table} disabled
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              <TextField fullWidth size="small" label="取数方式"
                value={data.conn_mode === "live"
                  ? `直连 · ${data.source_id ? `数据源 #${data.source_id}` : "未绑定数据源"}`
                  : data.is_virtual ? "自定义 SQL（本地）" : "抽取（本地副本）"}
                disabled
                sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              {data.is_virtual && (
                <TextField fullWidth size="small" label="SQL" value={sqlDraft}
                  onChange={(e) => setSqlDraft(e.target.value)} multiline minRows={5}
                  InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
                  sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              )}
              <TextField fullWidth size="small" label="描述" value={description} multiline minRows={3}
                onChange={(e) => setDescription(e.target.value)}
                sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
              <Button variant="contained" size="small" onClick={saveInfo} disabled={busy || !changed}
                startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
                sx={{ mt: 2, bgcolor: "#6366F1", textTransform: "none", borderRadius: 2, px: 2.5 }}>
                保存
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {fieldDialog && (
        <FieldDialog datasetId={datasetId} columns={physColumns} source={fieldDialog}
          onClose={() => setFieldDialog(null)}
          onSaved={async () => { setFieldDialog(null); await load(); onChanged(); }} />
      )}
      {metricDialog && (
        <MetricDialog datasetId={datasetId} source={metricDialog}
          onClose={() => setMetricDialog(null)}
          onSaved={async () => { setMetricDialog(null); await load(); onChanged(); }} />
      )}
      {versionsFor && (
        <MetricVersionsDialog datasetId={datasetId} metric={versionsFor}
          onClose={() => setVersionsFor(null)} />
      )}
      {usagesFor && (
        <MetricUsagesDialog datasetId={datasetId} metric={usagesFor}
          onClose={() => setUsagesFor(null)} />
      )}
      {usageField && (
        <FieldUsagesDialog field={usageField} onClose={() => setUsageField(null)} />
      )}
      {modelImportOpen && (
        <ModelImportDialog datasetId={datasetId}
          onClose={() => setModelImportOpen(false)}
          onImported={async () => { await load(); onChanged(); }} />
      )}

      <Toast msg={error} onClose={() => setError("")} />
      <Snackbar open={!!ok} autoHideDuration={2600} onClose={() => setOk("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="success" onClose={() => setOk("")} sx={{ borderRadius: 2, fontSize: 12.5 }}>{ok}</Alert>
      </Snackbar>
    </Drawer>
  );
}

function MiniTable({
  head, rows, empty,
}: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <TableContainer component={Paper} elevation={0}
      sx={{ borderRadius: 2, border: "1px solid", borderColor: "#EEF3FB" }}>
      <Table size="small" sx={{ minWidth: "100%" }}>
        <TableHead>
          <TableRow>
            {head.map((h, i) => (
              <TableCell key={i} sx={{ ...th, textAlign: i === head.length - 1 ? "right" : "left" }}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={head.length} sx={{ py: 5, textAlign: "center", borderBottom: 0 }}>
                <Typography sx={{ fontSize: 12, color: "text.disabled" }}>{empty}</Typography>
              </TableCell>
            </TableRow>
          ) : rows.map((cells, i) => (
            <TableRow key={i} hover>
              {cells.map((c, j) => (
                <TableCell key={j} sx={{ ...td, textAlign: j === head.length - 1 ? "right" : "left" }}>{c}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/* ── 字段编辑 ──────────────────────────────────────────── */
const _NUM = ["integer", "bigint", "smallint", "numeric", "double precision", "real", "decimal", "money"];

function inferType(pgType: string): string {
  const t = (pgType || "").toLowerCase();
  if (t.startsWith("timestamp")) return "datetime";
  if (t === "date") return "date";
  if (["integer", "bigint", "smallint"].includes(t)) return "integer";
  if (_NUM.includes(t)) return "numeric";
  if (t === "boolean") return "bool";
  return "text";
}

function inferRole(dataType: string): string {
  if (dataType === "date" || dataType === "datetime") return "time";
  if (dataType === "integer" || dataType === "numeric") return "measure";
  return "dimension";
}

function FieldDialog({
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
function MetricDialog({
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
function MetricVersionsDialog({
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
function MetricUsagesDialog({
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
interface RowRule {
  id: number; user_id: number | null; username: string;
  role_name: string; filter_rule: string; note: string;
}
interface ColumnMask {
  id: number; column_name: string; mask_type: string; mask_pattern: string;
}

const RULE_ROLES = [
  { v: "", l: "所有人" },
  { v: "member", l: "成员" },
  { v: "admin", l: "管理员" },
];
const MASK_OPTIONS = [
  { v: "phone", l: "手机号" },
  { v: "id_card", l: "身份证" },
  { v: "email", l: "邮箱" },
  { v: "custom", l: "自定义" },
];

function DatasetSecurityPanel({ datasetId, fields }: { datasetId: number; fields: Field[] }) {
  const [rules, setRules] = useState<RowRule[]>([]);
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [role, setRole] = useState("");
  const [condition, setCondition] = useState("");
  const [maskField, setMaskField] = useState(fields[0]?.name || "");
  const [maskType, setMaskType] = useState("phone");
  const [maskPattern, setMaskPattern] = useState("{val}");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get(`/bi/semantic/datasets/${datasetId}/security`);
      setRules(res.data?.row_rules || []);
      setMasks(res.data?.masks || []);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "权限配置加载失败");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => { load(); }, [load]);

  const addRule = async () => {
    if (!condition.trim()) return;
    try {
      await client.post(`/bi/semantic/datasets/${datasetId}/security/row-rules`, {
        role_name: role, filter_rule: condition.trim(),
      });
      setCondition("");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "添加行级规则失败");
    }
  };

  const removeRule = async (rule: RowRule) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/security/row-rules/${rule.id}`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "删除规则失败");
    }
  };

  const addMask = async () => {
    if (!maskField) return;
    try {
      await client.post(`/bi/semantic/datasets/${datasetId}/security/masks`, {
        column_name: maskField, mask_type: maskType,
        mask_pattern: maskType === "custom" ? maskPattern : "",
      });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "添加脱敏失败");
    }
  };

  const removeMask = async (mask: ColumnMask) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/security/masks/${encodeURIComponent(mask.column_name)}`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "删除脱敏失败");
    }
  };

  if (loading) {
    return <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={22} /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 880 }}>
      {err && <Alert severity="error" onClose={() => setErr("")} sx={{ mb: 1.5, fontSize: 12 }}>{err}</Alert>}

      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.4 }}>行级规则</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
        按角色或所有人限制可见行，和表级规则同时生效；模板复制时一并带走
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
        <TextField select size="small" label="范围" value={role}
          onChange={(e) => setRole(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {RULE_ROLES.map((r) => <MenuItem key={r.v} value={r.v} sx={{ fontSize: 13 }}>{r.l}</MenuItem>)}
        </TextField>
        <TextField size="small" label="条件" value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="platform = '拼多多'"
          InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
          sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        <Button size="small" variant="outlined" onClick={addRule} disabled={!condition.trim()}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5, height: 38 }}>添加</Button>
      </Box>
      <MiniTable
        head={["范围", "条件", "备注", ""]}
        rows={rules.map((r) => [
          <span key="s" style={{ fontWeight: 600 }}>
            {r.user_id ? `用户 ${r.username || r.user_id}` : (RULE_ROLES.find((x) => x.v === r.role_name)?.l || r.role_name)}
          </span>,
          <code key="c" style={{ fontSize: 11.5, color: "#475569" }}>{r.filter_rule}</code>,
          <span key="n" style={{ color: "#94A3B8" }}>{r.note || "—"}</span>,
          <Box key="a" sx={{ textAlign: "right" }}>
            <IconButton size="small" aria-label="删除行级规则" onClick={() => removeRule(r)} sx={{ p: 0.5, color: "error.main" }}>
              <DeleteOutline sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>,
        ])}
        empty="还没有行级规则（默认全量可见）"
      />

      <Typography sx={{ fontSize: 13, fontWeight: 700, mt: 2.5, mb: 0.4 }}>列级脱敏</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
        查询结果落到前端之前按列替换；自定义模板用 {"{val}"} 占位
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
        <TextField select size="small" label="字段" value={maskField}
          onChange={(e) => setMaskField(e.target.value)}
          sx={{ width: 170, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {fields.map((f) => <MenuItem key={f.id} value={f.name} sx={{ fontSize: 13 }}>{f.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="方式" value={maskType}
          onChange={(e) => setMaskType(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {MASK_OPTIONS.map((o) => <MenuItem key={o.v} value={o.v} sx={{ fontSize: 13 }}>{o.l}</MenuItem>)}
        </TextField>
        {maskType === "custom" && (
          <TextField size="small" label="模板" value={maskPattern}
            onChange={(e) => setMaskPattern(e.target.value)}
            sx={{ width: 160, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={addMask} disabled={!maskField}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5, height: 38 }}>添加</Button>
      </Box>
      <MiniTable
        head={["字段", "方式", "模板", ""]}
        rows={masks.map((m) => [
          <span key="c" style={{ fontWeight: 600 }}>{m.column_name}</span>,
          MASK_OPTIONS.find((o) => o.v === m.mask_type)?.l || m.mask_type,
          <code key="p" style={{ fontSize: 11.5, color: "#64748B" }}>{m.mask_pattern || "—"}</code>,
          <Box key="a" sx={{ textAlign: "right" }}>
            <IconButton size="small" aria-label="删除脱敏" onClick={() => removeMask(m)} sx={{ p: 0.5, color: "error.main" }}>
              <DeleteOutline sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>,
        ])}
        empty="还没有脱敏规则"
      />
    </Box>
  );
}

/* ── 字段血缘（哪些看板用了这个字段）──────────────────── */
const FIELD_ROLE_LABEL: Record<string, string> = {
  dimension: "维度",
  metric: "指标",
};

function FieldUsagesDialog({
  field, onClose,
}: { field: { name: string; items: MetricUsage[] }; onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>
        字段使用 · {field.name}
      </DialogTitle>
      <DialogContent sx={{ pt: 0.5 }}>
        {field.items.length === 0 ? (
          <Typography sx={{ py: 3, fontSize: 12.5, color: "text.secondary" }}>
            还没有卡片用到这个字段
          </Typography>
        ) : (
          <>
            <Typography sx={{ mb: 1, fontSize: 12, color: "text.secondary" }}>
              {new Set(field.items.map((u) => u.dashboard_id)).size} 个看板 · {field.items.length} 处
            </Typography>
            <Box sx={{ border: "1px solid #EEF3FB", borderRadius: 2, overflow: "hidden" }}>
              {field.items.map((u, idx) => (
                <Box key={`${u.dashboard_id}-${u.view_key}-${u.item_key}-${idx}`}
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
                      {u.role?.startsWith("filter:")
                        ? `筛选 · ${u.role.slice(7)}`
                        : (FIELD_ROLE_LABEL[u.role] || u.item_kind || "元素")}
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

/* ── 数据预览 ──────────────────────────────────────────── */
function PreviewPane({ dataset }: { dataset: Dataset & { fields: Field[]; metrics: Metric[] } }) {
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
