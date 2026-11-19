
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
import { InlineRename } from "./Editable";
import { MiniTable } from "./MiniTable";
import { Toast, renameDatasetName } from "./Toast";
import { PreviewPane } from "./PreviewPane";
import { DatasetSecurityPanel } from "./DatasetSecurityPanel";
import { FieldDialog } from "./FieldDialog";
import { MetricDialog } from "./MetricDialog";
import { MetricVersionsDialog } from "./MetricVersionsDialog";
import { MetricUsagesDialog } from "./MetricUsagesDialog";
import { FieldUsagesDialog } from "./FieldUsagesDialog";


export function DatasetEditor({
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
  const [physColumns, setPhysColumns] = useState<{ name: string; type: string; comment?: string }[]>([]);
  const [columnsError, setColumnsError] = useState("");
  const [syncingNames, setSyncingNames] = useState(false);
  const [nameSyncResult, setNameSyncResult] = useState<{
    renamed: number; unchanged: number; skipped: { name: string; reason: string }[];
  } | null>(null);
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
    let active = true;
    setColumnsError("");
    setPhysColumns([]);
    if (data.is_virtual) {
      setPhysColumns(data.fields.filter((f) => !f.expression)
        .map((f) => ({ name: f.source_column, type: f.data_type })));
      return;
    }
    client.get(`/bi/semantic/datasets/${datasetId}/columns`)
      .then((res) => { if (active) setPhysColumns(res.data?.columns || []); })
      .catch((e) => { if (active) setColumnsError(e?.response?.data?.detail || "数据库字段和注释读取失败"); });
    return () => { active = false; };
  }, [datasetId, data?.physical_table, data?.conn_mode, data?.source_id, data?.fields, data?.is_virtual]);

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

  const syncCommentNames = async () => {
    setSyncingNames(true);
    try {
      const res = await client.post(`/bi/semantic/datasets/${datasetId}/sync-comment-names`);
      await load(); onChanged();
      setNameSyncResult(res.data);
    } catch (e: any) {
      toast(e?.response?.data?.detail || "同步注释名称失败");
    } finally { setSyncingNames(false); }
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
    <Drawer anchor="right" open onClose={onClose} PaperProps={{ sx: { width: 1128, maxWidth: "96vw" } }}>
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
                <Button size="small" startIcon={syncingNames ? <CircularProgress size={14} /> : <Refresh sx={{ fontSize: 15 }} />}
                  onClick={syncCommentNames} disabled={syncingNames || busy || !!data.is_virtual || !!columnsError}
                  sx={{ textTransform: "none", fontSize: 12, color: "#475569" }}>同步注释名称</Button>
                <Button size="small" startIcon={<Refresh sx={{ fontSize: 15 }} />} onClick={syncColumns}
                  sx={{ textTransform: "none", fontSize: 12, color: "#475569" }}>同步物理列</Button>
                <Button size="small" variant="outlined" startIcon={<Add sx={{ fontSize: 15 }} />}
                  onClick={() => setFieldDialog("new")}
                  sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>添加公式字段</Button>
              </Box>
              <MiniTable
                resizable
                head={["字段名", "注释", "来源列 / 公式", "角色", "类型", "筛选", "分组", "使用", ""]}
                rows={data.fields.map((f) => {
                  const count = fieldUsage?.counts?.[f.name] || 0;
                  const comment = !f.expression && !data.is_virtual
                    ? physColumns.find((column) => column.name === f.source_column)?.comment : "";
                  return [
                    <span key="n" style={{ fontWeight: 600 }}>{f.name}</span>,
                    comment?.trim()
                      ? <span key="comment" title={comment}>{comment}</span>
                      : <span key="comment" style={{ color: "#94A3B8", fontStyle: "italic" }}>(空)</span>,
                    <code key="c" style={{ fontSize: 11.5, color: "#64748B" }}>{f.expression || f.source_column}</code>,
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
              {columnsError && <Alert severity="warning" sx={{ mt: 1 }}>{columnsError}</Alert>}
            </>
          ) : tab === 1 ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
                <Box sx={{ flex: 1 }} />
                <Button size="small" variant="outlined" startIcon={<UploadFileOutlined sx={{ fontSize: 15 }} />}
                  onClick={() => setModelImportOpen(true)}
                  sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5 }}>导入 / 导出配置</Button>
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

      <Dialog open={!!nameSyncResult} onClose={() => setNameSyncResult(null)} maxWidth="sm" fullWidth aria-labelledby="comment-name-sync-title">
        <DialogTitle id="comment-name-sync-title" sx={{ fontSize: 16, fontWeight: 700 }}>同步注释名称结果</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2, fontSize: 13 }}>已更新 {nameSyncResult?.renamed || 0} 个字段名，{nameSyncResult?.unchanged || 0} 个无需修改，跳过 {nameSyncResult?.skipped.length || 0} 个。</Typography>
          <MiniTable head={["字段", "跳过原因"]}
            rows={(nameSyncResult?.skipped || []).map((item) => [item.name, item.reason])} empty="没有跳过的字段" />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}><Button onClick={() => setNameSyncResult(null)}>关闭</Button></DialogActions>
      </Dialog>
      <Toast msg={error} onClose={() => setError("")} />
      <Snackbar open={!!ok} autoHideDuration={2600} onClose={() => setOk("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="success" onClose={() => setOk("")} sx={{ borderRadius: 2, fontSize: 12.5 }}>{ok}</Alert>
      </Snackbar>
    </Drawer>
  );
}
