import { formatChinaTime } from "../../utils/time";
import { useSearchParams } from "react-router-dom";
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
import { Toast, renameDatasetName } from "./dataset/Toast";
import { InlineRename } from "./dataset/Editable";
import { CreateDatasetDialog } from "./dataset/CreateDatasetDialog";
import { DatasetEditor } from "./dataset/DatasetEditor";
import { FieldDialog } from "./dataset/FieldDialog";
import { MetricDialog } from "./dataset/MetricDialog";
import { MetricVersionsDialog } from "./dataset/MetricVersionsDialog";
import { MetricUsagesDialog } from "./dataset/MetricUsagesDialog";
import { DatasetSecurityPanel } from "./dataset/DatasetSecurityPanel";
import { FieldUsagesDialog } from "./dataset/FieldUsagesDialog";
import { PreviewPane } from "./dataset/PreviewPane";
import { ROLES, TYPES, FORMATS, DEMO_TABLE, td, th, type Field, type Metric, type Dataset, type PhysTable, type RemoteTable, type SourceBrief, type MetricVersion, type MetricUsage } from "./dataset/types";
import { useNavigate } from "react-router-dom";
import ModelImportDialog from "./ModelImportDialog";

export default function DatasetPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<Dataset[]>([]);
  const [tables, setTables] = useState<PhysTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<number | null>(() => {
    const id = Number(searchParams.get("edit"));
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dataset | null>(null);
  /** 直连数据集的源库连通性：{数据集 id: {ok, message, checked_at}} */
  const [status, setStatus] = useState<Record<string, { ok: boolean; message: string; checked_at?: number }>>({});
  const [statusBusy, setStatusBusy] = useState(false);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const deptName = (id?: number | null) => departments.find((d) => d.id === id)?.name || "";
  /** 进页面只强制重探一次 */
  const probed = useRef(false);
  const nav = useNavigate();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, tableRes, deptRes] = await Promise.all([
        client.get("/bi/semantic/datasets"),
        client.get("/bi/semantic/tables"),
        client.get("/auth/departments"),
      ]);
      setItems(listRes.data?.datasets || []);
      setTables(tableRes.data?.tables || []);
      setDepartments(deptRes.data?.items || []);
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
        <Button variant="outlined" size="small"
          onClick={() => nav("/bi/projects")}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 1.75, height: 36,
            borderColor: "#D8E2F5", color: "#475569" }}>
          进入项目
        </Button>
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
                      {deptName(d.dept_id) && (
                        <Chip label={deptName(d.dept_id)} size="small"
                          sx={{ fontSize: 10, height: 18, bgcolor: "rgba(16,185,129,0.10)", color: "#047857", fontWeight: 600 }} />
                      )}
                      {/* 直连数据集：源库连通性小圆点（绿=连得上 / 红=连不上），点一下重测 */}
                      {d.conn_mode === "live" && (() => {
                        const st = status[String(d.id)];
                        const color = !st ? "#CBD5E1" : st.ok ? "#22C55E" : "#EF4444";
                        const ring = !st ? "transparent" : st.ok ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)";
                        const at = st?.checked_at
                          ? formatChinaTime(st.checked_at * 1000).slice(11)
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
                    {formatChinaTime(d.updated_at).slice(0, 16) || ""}
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
          onClose={() => {
            setEditing(null);
            const next = new URLSearchParams(searchParams);
            next.delete("edit");
            setSearchParams(next, { replace: true });
          }}
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
