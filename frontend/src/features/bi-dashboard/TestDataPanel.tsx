/** 测试数据集（数据集页的子页面，跟「数据集」同一个大页面布局）
 *  列表只有「测试数据集」一条；点「查看」进明细：字段信息可改 + 数据
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, MenuItem, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import { ArrowBack, ChevronRight, Refresh, TableChart } from "@mui/icons-material";
import client from "../../api/client";

interface Field { id: number; name: string; source_column?: string; data_type: string; role: string; description?: string }
interface DatasetRow {
  id: number; name: string; physical_table: string; conn_mode?: string;
  field_count: number; metric_count: number; updated_at?: string;
  /** 模板库复制出来的数据集：属于哪个模板 */
  template_id?: number; template_name?: string;
}
interface DatasetInfo extends DatasetRow { description?: string; fields: Field[] }
interface QueryResult { columns: string[]; rows: Record<string, unknown>[]; elapsed_ms?: number }

const ROLES = [{ v: "dimension", l: "维度" }, { v: "time", l: "时间" }, { v: "measure", l: "度量" }, { v: "id", l: "标识" }];
const TYPES = ["text", "integer", "numeric", "date", "datetime", "bool"];
const NUMERIC = new Set(["numeric", "integer", "number", "float", "double", "decimal"]);
const td = { fontSize: 12, py: 0.7, borderColor: "#F1F5F9" } as const;
const th = { fontSize: 11.5, fontWeight: 600, color: "#64748B", py: 0.85, bgcolor: "#F8F9FC", borderColor: "#EEF3FB" } as const;

export default function TestDataPanel() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  /** 从「数据集」页的「预览」进来：带数据集 id，只读（不改字段、不改数据） */
  const previewId = Number(searchParams.get("id") || 0);
  const readOnly = searchParams.get("ro") === "1";
  const [datasets, setDatasets] = useState<DatasetRow[]>([]);
  const [loading, setLoading] = useState(!previewId);
  const [error, setError] = useState("");

  const [activeId, setActiveId] = useState<number | null>(null);
  /** 当前打开的是模板库的数据副本（只读：改字段会影响模板） */
  const [activeTemplate, setActiveTemplate] = useState<{ id: number; name: string } | null>(null);
  const [info, setInfo] = useState<DatasetInfo | null>(null);
  const [data, setData] = useState<QueryResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [fieldId, setFieldId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ name: "", data_type: "text", role: "dimension", description: "" });

  /** 列表：测试数据集 + 模板库复制出来的数据集（缺了会自动重建测试数据集） */
  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ensured, templateRes] = await Promise.all([
        client.post("/bi/semantic/datasets/test", {}),
        client.get("/bi/semantic/datasets/templates"),
      ]);
      const detail = await client.get(`/bi/semantic/datasets/${ensured.data?.id}`);
      const templateRows = (templateRes.data?.datasets || []) as DatasetRow[];
      setDatasets([...(detail.data ? [detail.data as DatasetRow] : []), ...templateRows]);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "测试数据集加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (!previewId) void loadList(); }, [loadList, previewId]);

  const openDataset = useCallback(async (id: number, template: { id: number; name: string } | null) => {
    setActiveId(id);
    setActiveTemplate(template);
    setDetailLoading(true);
    setError("");
    setEditOpen(false);
    setData(null);
    setInfo(null);
    try {
      const detail = await client.get(`/bi/semantic/datasets/${id}`);
      const ds: DatasetInfo = detail.data;
      setInfo(ds);
      const first = (ds.fields || [])[0];
      if (first) {
        setFieldId(first.id);
        setDraft({ name: first.name, data_type: first.data_type || "text", role: first.role, description: first.description || "" });
      }
      try {
        const res = await client.post(`/bi/semantic/datasets/${id}/query`, {
          dimensions: (ds.fields || []).map((f) => f.name),
          limit: 100,
        });
        setData(res.data);
      } catch (e: any) {
        setError(e?.response?.data?.detail || "数据读取失败（源库可能连不上）");
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || "数据集读取失败");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /* 从「数据集」页的「预览」进来：直接打开那个数据集（只读） */
  useEffect(() => {
    if (previewId) void openDataset(previewId, null);
  }, [previewId, openDataset]);

  const pickField = (id: string) => {
    const field = (info?.fields || []).find((f) => String(f.id) === id);
    if (!field) return;
    setFieldId(field.id);
    setDraft({ name: field.name, data_type: field.data_type || "text", role: field.role, description: field.description || "" });
    setSaved("");
  };

  const saveField = async () => {
    if (!info || fieldId === null) return;
    setBusy(true);
    setError("");
    try {
      await client.patch(`/bi/semantic/datasets/${info.id}/fields/${fieldId}`, {
        name: draft.name.trim(),
        data_type: draft.data_type,
        role: draft.role,
        description: draft.description,
      });
      await openDataset(info.id, activeTemplate);
      setFieldId(fieldId);
      setSaved("已保存");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    setBusy(true);
    if (activeId === null) await loadList();
    else await openDataset(activeId, activeTemplate);
    setBusy(false);
  };

  const rows = data?.rows || [];
  const columns = data?.columns || [];
  const activeField = (info?.fields || []).find((f) => f.id === fieldId) || null;
  /** 模板库的数据副本：只读（字段定义模板在用，改了会影响模板） */
  const isTemplate = !!activeTemplate;
  const canEdit = !readOnly && !isTemplate;

  return (
    <Box sx={{ p: 4 }}>
      {/* 页头：和「数据集」页同一套标题 / 按钮风格 */}
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, mb: 2.5 }}>
        {activeId !== null && (
          <Tooltip title="返回测试数据集">
            <IconButton size="small" onClick={() => {
              if (previewId) { nav("/bi?view=datasets"); return; }
              setActiveId(null); setActiveTemplate(null); setError("");
            }} sx={{ color: "#64748B", mb: 0.4 }}>
              <ArrowBack sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
        <Typography sx={{ fontSize: 20, fontWeight: 800, color: "text.primary", letterSpacing: -0.2 }}>
          {activeId !== null ? info?.name || (readOnly ? "数据预览" : "测试数据集") : "测试数据集"}
        </Typography>
        {activeId !== null && activeTemplate && (
          <Chip label={`模板 · ${activeTemplate.name}`} size="small"
            sx={{ mb: 0.6, fontSize: 10.5, height: 20, bgcolor: "rgba(79,70,229,0.10)", color: "#4F46E5", fontWeight: 600 }} />
        )}
        {activeId === null && (
          <>
            <Chip label="组件预览 / 模板库专用" size="small"
              sx={{ mb: 0.6, fontSize: 10.5, height: 20, bgcolor: "rgba(37,99,235,0.10)", color: "#2563EB", fontWeight: 600 }} />
            <Typography sx={{ mb: 0.7, fontSize: 11.5, color: "#94A3B8" }}>
              组件库缩略图 + 模板库数据副本 · 公共、跟随项目 · 仅管理员可删
            </Typography>
          </>
        )}
        <Box sx={{ flex: 1 }} />
        {activeId === null && (
          <Button size="small" variant="text" onClick={() => nav("/bi?view=datasets")}
            sx={{ textTransform: "none", fontSize: 12.5, color: "#475569" }}>
            返回数据集
          </Button>
        )}
        <Button size="small" variant="outlined" startIcon={<Refresh sx={{ fontSize: 15 }} />}
          disabled={busy || loading || detailLoading} onClick={reload}
          sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, color: "#475569", borderColor: "#D8E2F5", height: 36 }}>
          {busy ? "处理中…" : activeId === null ? "刷新" : "刷新数据"}
        </Button>
      </Box>

      {loading && activeId === null ? (
        <Box sx={{ py: 10, display: "grid", placeItems: "center" }}><CircularProgress size={26} /></Box>
      ) : activeId === null ? (
        /* ── 列表：一条数据集（和数据集页同一行样式）── */
        <Stack spacing={2}>
          {error && <Alert severity="error" sx={{ borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}
          <TableContainer component={Paper} elevation={0}
            sx={{ borderRadius: 2.5, border: "1px solid #EEF3FB" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...th, pl: 2 }}>数据集</TableCell>
                  <TableCell sx={th}>来源</TableCell>
                  <TableCell sx={th}>物理表</TableCell>
                  <TableCell sx={th} align="right">字段</TableCell>
                  <TableCell sx={th} align="right">指标</TableCell>
                  <TableCell sx={th}>更新时间</TableCell>
                  <TableCell sx={{ ...th, pr: 2 }} align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {datasets.map((d) => (
                  <TableRow key={d.id} hover sx={{ cursor: "pointer" }}
                    onClick={() => void openDataset(d.id, d.template_id ? { id: d.template_id, name: d.template_name || "" } : null)}>
                    <TableCell sx={{ ...td, pl: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{
                          width: 26, height: 26, borderRadius: 1.5, flexShrink: 0,
                          bgcolor: "rgba(99,102,241,0.08)", color: "#6366F1", display: "grid", placeItems: "center",
                        }}>
                          <TableChart sx={{ fontSize: 15 }} />
                        </Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 600, color: "text.primary" }}>{d.name}</Typography>
                        {d.conn_mode === "live" && (
                          <Chip label="直连" size="small"
                            sx={{ fontSize: 10, height: 18, bgcolor: "rgba(37,99,235,0.10)", color: "#2563EB", fontWeight: 600 }} />
                        )}
                      </Box>
                    </TableCell>
                    <TableCell sx={td}>
                      {d.template_id ? (
                        <Chip label={`模板 · ${d.template_name || d.template_id}`} size="small"
                          sx={{ fontSize: 10.5, height: 20, bgcolor: "rgba(79,70,229,0.08)", color: "#4F46E5", maxWidth: 180 }} />
                      ) : (
                        <Chip label="组件预览" size="small"
                          sx={{ fontSize: 10.5, height: 20, bgcolor: "#F1F5F9", color: "#475569" }} />
                      )}
                    </TableCell>
                    <TableCell sx={td}>
                      <Chip label={d.physical_table} size="small"
                        sx={{ fontSize: 10.5, height: 20, bgcolor: "#F1F5F9", color: "#475569", fontFamily: "ui-monospace" }} />
                    </TableCell>
                    <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{d.field_count}</TableCell>
                    <TableCell sx={{ ...td, textAlign: "right", color: "#475569" }}>{d.metric_count}</TableCell>
                    <TableCell sx={{ ...td, color: "text.secondary" }}>{d.updated_at?.slice(0, 16) || ""}</TableCell>
                    <TableCell sx={{ ...td, pr: 2, textAlign: "right" }}>
                      <Button size="small" endIcon={<ChevronRight sx={{ fontSize: 16 }} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDataset(d.id, d.template_id ? { id: d.template_id, name: d.template_name || "" } : null);
                        }}
                        sx={{ textTransform: "none", fontSize: 12, color: "#4F46E5", minWidth: 0 }}>
                        查看
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography sx={{ fontSize: 11.5, color: "#94A3B8" }}>
            组件预览那份只给缩略图看效果；模板那份是看板分享到模板库时复制的数据，克隆模板生成的看板直接用它。
          </Typography>
        </Stack>
      ) : (
        /* ── 明细：字段信息（可改）+ 数据 ── */
        <Stack spacing={2}>
          {detailLoading ? (
            <Box sx={{ py: 8, display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>
          ) : (
            <>
              {canEdit && (<Paper elevation={0} sx={{ p: 2, borderRadius: 2.5, border: "1px solid #EEF3FB" }}>
                <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, flexWrap: "wrap" }}>
                  <Box sx={{ width: 150 }}>
                    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>字段</Typography>
                    <TextField select size="small" fullWidth value={fieldId === null ? "" : String(fieldId)}
                      onChange={(e) => pickField(e.target.value)}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                      {(info?.fields || []).map((f) => (
                        <MenuItem key={f.id} value={String(f.id)} sx={{ fontSize: 12 }}>{f.name}</MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <Box sx={{ width: 170 }}>
                    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>名称</Typography>
                    <TextField size="small" fullWidth value={draft.name}
                      onChange={(e) => { setDraft((d) => ({ ...d, name: e.target.value })); setSaved(""); }}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
                  </Box>
                  <Box sx={{ width: 120 }}>
                    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>类型</Typography>
                    <TextField select size="small" fullWidth value={draft.data_type}
                      onChange={(e) => { setDraft((d) => ({ ...d, data_type: e.target.value })); setSaved(""); }}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                      {TYPES.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 12 }}>{t}</MenuItem>)}
                    </TextField>
                  </Box>
                  <Box sx={{ width: 110 }}>
                    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>角色</Typography>
                    <TextField select size="small" fullWidth value={draft.role}
                      onChange={(e) => { setDraft((d) => ({ ...d, role: e.target.value })); setSaved(""); }}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                      {ROLES.map((r) => <MenuItem key={r.v} value={r.v} sx={{ fontSize: 12 }}>{r.l}</MenuItem>)}
                    </TextField>
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>说明</Typography>
                    <TextField size="small" fullWidth value={draft.description} placeholder="可选"
                      onChange={(e) => { setDraft((d) => ({ ...d, description: e.target.value })); setSaved(""); }}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
                  </Box>
                  <Button size="small" variant="text" onClick={() => setEditOpen(false)}
                    sx={{ textTransform: "none", fontSize: 12.5, color: "#64748B", height: 36 }}>
                    取消
                  </Button>
                  <Button variant="contained" size="small" disabled={busy || fieldId === null}
                    onClick={saveField}
                    sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12.5, borderRadius: 2, px: 2, height: 36 }}>
                    {busy ? "保存中…" : "保存"}
                  </Button>
                  {saved && <Typography sx={{ fontSize: 11.5, color: "#16A34A", pb: 1 }}>{saved}</Typography>}
                </Box>
                <Typography sx={{ mt: 1, fontSize: 11.5, color: "#94A3B8" }}>
                  {info?.physical_table} · {info?.field_count ?? 0} 字段 · 改完保存即生效（组件取数用的就是这个字段名 / 类型 / 角色）
                </Typography>
              </Paper>)}

              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Typography sx={{ fontSize: 11.5, color: "#94A3B8" }}>
                  {readOnly
                    ? "只读预览：字段就是原数据库的列，这里不做修改"
                    : isTemplate
                      ? "模板数据副本：模板和克隆出来的看板都在用，这里只读（字段 / 数据都不改）"
                      : "双击列头可以改字段信息（名称 / 类型 / 角色 / 说明）—— 只改字段定义，不动表里的数据"}
                </Typography>
              </Box>

              {error && <Alert severity="error" sx={{ borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}

              <TableContainer component={Paper} elevation={0}
                sx={{ borderRadius: 2.5, border: "1px solid #EEF3FB", maxHeight: "calc(100vh - 420px)" }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ ...th, pl: 2, width: 48 }}>#</TableCell>
                      {columns.map((column) => {
                        const meta = (info?.fields || []).find((f) => f.name === column);
                        const numeric = NUMERIC.has(String(meta?.data_type));
                        return (
                          <TableCell key={column}
                            onDoubleClick={() => { if (!canEdit || !meta) return; pickField(String(meta.id)); setEditOpen(true); }}
                            title={canEdit ? "双击编辑字段" : "只读预览"}
                            sx={{ ...th, cursor: canEdit ? "pointer" : "default", "&:hover": canEdit ? { color: "#4F46E5" } : {} }}
                            align={numeric ? "right" : "left"}
                            style={{ whiteSpace: "nowrap" }}>
                            <Box sx={{
                              display: "flex", flexDirection: "column", lineHeight: 1.25,
                              alignItems: numeric ? "flex-end" : "flex-start",
                            }}>
                              <span>{column}</span>
                              <span style={{ fontSize: 10, fontWeight: 500, color: "#A8B7CC" }}>
                                {meta?.data_type || "text"}
                              </span>
                            </Box>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={columns.length + 1}
                          sx={{ py: 8, textAlign: "center", borderBottom: 0, color: "#94A3B8", fontSize: 12.5 }}>
                          {error ? "取不到数据，见上方错误" : "没有数据"}
                        </TableCell>
                      </TableRow>
                    ) : rows.map((row, index) => (
                      <TableRow key={index} hover>
                        <TableCell sx={{ ...td, pl: 2, color: "#A8B7CC" }}>{index + 1}</TableCell>
                        {columns.map((column) => {
                          const numeric = NUMERIC.has(String((info?.fields || []).find((f) => f.name === column)?.data_type));
                          return (
                            <TableCell key={column} sx={{
                              ...td, whiteSpace: "nowrap",
                              ...(numeric ? { textAlign: "right", fontVariantNumeric: "tabular-nums" } : {}),
                              ...(column === activeField?.name ? { color: "#4F46E5", fontWeight: 600, bgcolor: "rgba(79,70,229,0.03)" } : {}),
                            }}>
                              {row[column] === null || row[column] === undefined ? "—" : String(row[column])}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              <Box sx={{ display: "flex", alignItems: "center", gap: 2, fontSize: 11.5, color: "#94A3B8" }}>
                <span>共 {rows.length} 行 · {columns.length} 列</span>
                {data?.elapsed_ms !== undefined && <span>{Math.round(data.elapsed_ms)} ms</span>}
                <Box sx={{ flex: 1 }} />
                <span>前 100 行</span>
              </Box>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
}
