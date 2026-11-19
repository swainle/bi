/** MCP 客户端 —— 客户端管理、工具开关、授权记录、调用审计（S2） */

import { useCallback, useEffect, useState } from "react";
import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, InputLabel, MenuItem, Select, Switch, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from "@mui/material";
import { ContentCopyOutlined, DashboardOutlined, DeleteOutlineOutlined, EditOutlined, Refresh as RefreshIcon, SettingsSuggestOutlined, SmartToyOutlined, VpnKeyOutlined } from "@mui/icons-material";
import client from "../../api/client";
import { getDepartments } from "../../api/auth";
import { buildConnectorText } from "../mcp/connector";
import {
  BORDER, ConfirmDialog, EmptyState, INK, LINE, Loading, MUTED, PanelCard, PrimaryButton,
  SectionHead, TD, TH, dialogPaperSx, dialogTitleSx, fmtTime, friendlyError, useToast,
} from "./shared";

interface McpClient {
  id: number; name: string; description: string; client_id: string;
  enabled: boolean; owner_id: number | null; created_at: string; last_used_at: string;
  dept_id: number | null; dept_name: string; dashboard_count: number;
}
interface McpTool {
  code: string; name: string; description: string;
  risk: "low" | "medium" | "high"; required_permissions: string[]; default_enabled: boolean;
}
interface ClientTool {
  code: string; name: string; risk: "low" | "medium" | "high";
  default_enabled: boolean; enabled: boolean;
}
interface GrantRow {
  id: number; username: string; client_name: string; client_id: string;
  expires_at: string; revoked_at: string; created_at: string; active: boolean;
  frozen: boolean; frozen_at: string; frozen_reason: string;
}
interface DatasetGuard {
  id: number; name: string; data_class: "normal" | "confidential" | "financial";
  daily_rows: number | null; dept_name: string; rows_today: number;
}
interface AuditRow {
  id: number; username: string; client_name: string; tool: string; risk: string;
  status: string; error: string; row_count: number | null; duration_ms: number; created_at: string;
}

const RISK: Record<McpTool["risk"], { label: string; color: string; bg: string }> = {
  low: { label: "低", color: "#047857", bg: "#ECFDF5" },
  medium: { label: "中", color: "#B45309", bg: "#FFFBEB" },
  high: { label: "高", color: "#B91C1C", bg: "#FEF2F2" },
};

const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  ok: { label: "成功", color: "#047857", bg: "#ECFDF5" },
  denied: { label: "拒绝", color: "#B91C1C", bg: "#FEF2F2" },
  error: { label: "报错", color: "#B45309", bg: "#FFFBEB" },
};

export default function McpPanel() {
  const [tab, setTab] = useState<"clients" | "grants" | "audit" | "tools" | "datasets">("clients");
  const [clients, setClients] = useState<McpClient[] | null>(null);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [datasetGuards, setDatasetGuards] = useState<DatasetGuard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", dept_id: "all" });
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [created, setCreated] = useState<{ id: number; client_id: string; secret: string; name: string } | null>(null);
  const [connector, setConnector] = useState("");
  const [connectorTarget, setConnectorTarget] = useState<McpClient | null>(null);
  const [connectorOut, setConnectorOut] = useState<{ name: string; text: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<McpClient | null>(null);
  const [deptTarget, setDeptTarget] = useState<McpClient | null>(null);
  const [deptValue, setDeptValue] = useState("all");
  const [scopeTarget, setScopeTarget] = useState<McpClient | null>(null);
  const [scopeIds, setScopeIds] = useState<number[]>([]);
  const [scopeQuery, setScopeQuery] = useState("");
  const [dashOptions, setDashOptions] = useState<{ id: number; name: string; owner: string }[]>([]);
  const [toolClient, setToolClient] = useState<McpClient | null>(null);
  const [clientTools, setClientTools] = useState<ClientTool[]>([]);
  const [confirmHigh, setConfirmHigh] = useState<{ tool: ClientTool; next: boolean } | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [tokenClientId, setTokenClientId] = useState("");
  const [myToken, setMyToken] = useState<{ refresh_token: string; client_id: string } | null>(null);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, catalog, grantRes, auditRes, depts, dashes, guards] = await Promise.all([
        client.get("/admin/mcp/clients"),
        client.get("/admin/mcp/tools"),
        client.get("/admin/mcp/grants"),
        client.get("/admin/mcp/audit?limit=50"),
        getDepartments().catch(() => []),
        client.get("/admin/mcp/dashboards").then((r) => r.data?.dashboards || []).catch(() => []),
        client.get("/admin/mcp/datasets").then((r) => r.data?.datasets || []).catch(() => []),
      ]);
      setClients(list.data?.clients || []);
      setTools(catalog.data?.tools || []);
      setGrants(grantRes.data?.grants || []);
      setAudit(auditRes.data?.items || []);
      setDepartments(depts || []);
      setDashOptions(dashes || []);
      setDatasetGuards(guards || []);
    } catch (e: any) {
      setError(friendlyError(e, "加载 MCP 数据失败"));
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) { show("请填写客户端名称", "error"); return; }
    setBusy(true);
    try {
      const res = await client.post("/admin/mcp/clients", {
        name: form.name.trim(), description: form.description.trim(),
        dept_id: form.dept_id === "all" ? null : Number(form.dept_id),
      });
      setCreateOpen(false);
      setForm({ name: "", description: "", dept_id: "all" });
      setCreated(res.data);
      setConnector("");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "创建失败"), "error");
    } finally { setBusy(false); }
  };

  const toggleClient = async (row: McpClient) => {
    setBusy(true);
    try {
      await client.patch(`/admin/mcp/clients/${row.id}`, { enabled: !row.enabled });
      show(row.enabled ? "已停用，该客户端的 token 立即失效" : "已启用");
      await load();
    } catch (e: any) { show(friendlyError(e, "操作失败"), "error"); }
    finally { setBusy(false); }
  };

  const openTools = async (row: McpClient) => {
    setToolClient(row);
    setClientTools([]);
    try {
      const res = await client.get(`/admin/mcp/clients/${row.id}/tools`);
      setClientTools(res.data?.tools || []);
    } catch (e: any) { show(friendlyError(e, "加载工具开关失败"), "error"); }
  };

  const applyTool = async (row: ClientTool, next: boolean) => {
    if (!toolClient) return;
    setBusy(true);
    try {
      await client.put(`/admin/mcp/clients/${toolClient.id}/tools`, { tool_code: row.code, enabled: next });
      setClientTools((prev) => prev.map((t) => (t.code === row.code ? { ...t, enabled: next } : t)));
      show(next ? "工具已开启" : "工具已关闭");
    } catch (e: any) { show(friendlyError(e, "操作失败"), "error"); }
    finally { setBusy(false); }
  };

  const toggleTool = (row: ClientTool, next: boolean) => {
    if (next && row.risk === "high") { setConfirmHigh({ tool: row, next }); return; }
    void applyTool(row, next);
  };

  const revoke = async (row: GrantRow) => {
    setBusy(true);
    try {
      await client.delete(`/mcp/grants/${row.id}`);
      show("授权已撤销，已签发的 token 立即失效");
      await load();
    } catch (e: any) { show(friendlyError(e, "撤销失败"), "error"); }
    finally { setBusy(false); }
  };

  const makeToken = async () => {
    if (!tokenClientId) { show("请先选择客户端", "error"); return; }
    setBusy(true);
    try {
      const res = await client.post("/mcp/grants", { client_id: tokenClientId });
      setMyToken({ refresh_token: res.data.refresh_token, client_id: res.data.client_id });
      setTokenOpen(false);
      await load();
    } catch (e: any) { show(friendlyError(e, "生成失败"), "error"); }
    finally { setBusy(false); }
  };

  const copy = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); show(`${label}已复制`); }
    catch { show("复制失败，请手动选中复制", "error"); }
  };

  /** 新建客户端后：生成本人授权 + 读取工具策略 → 拼完整接入串并复制 */
  const makeConnector = async () => {
    if (!created) return;
    setBusy(true);
    try {
      const grant = await client.post("/mcp/grants", { client_id: created.client_id });
      const toolRes = await client.get(`/admin/mcp/clients/${created.id}/tools`);
      const text = buildConnectorText({
        clientId: created.client_id,
        secret: created.secret,
        refreshToken: grant.data?.refresh_token || "",
        toolCodes: (toolRes.data?.tools || []).filter((t: ClientTool) => t.enabled).map((t: ClientTool) => t.code),
      });
      setConnector(text);
      await copy(text, "接入指令");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "生成接入指令失败"), "error");
    } finally { setBusy(false); }
  };

  /** 列表行：重置 secret + 授权 → 生成完整接入串（旧 secret / 旧授权作废） */
  const makeConnectorFor = async (row: McpClient) => {
    setBusy(true);
    try {
      const res = await client.post(`/admin/mcp/clients/${row.id}/connector`);
      const text = buildConnectorText({
        clientId: res.data?.client_id || row.client_id,
        secret: res.data?.secret || "",
        refreshToken: res.data?.refresh_token || "",
        toolCodes: res.data?.tools || [],
      });
      setConnectorOut({ name: row.name, text });
      await copy(text, "接入指令");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "生成接入指令失败"), "error");
    } finally { setBusy(false); }
  };

  const saveDept = async () => {
    if (!deptTarget) return;
    setBusy(true);
    try {
      await client.patch(`/admin/mcp/clients/${deptTarget.id}`,
        { dept_id: deptValue === "all" ? null : Number(deptValue) });
      show("开放部门已更新");
      setDeptTarget(null);
      await load();
    } catch (e: any) {
      show(friendlyError(e, "更新部门失败"), "error");
    } finally { setBusy(false); }
  };

  const openScope = async (row: McpClient) => {
    setScopeTarget(row);
    setScopeIds([]);
    setScopeQuery("");
    try {
      const res = await client.get(`/admin/mcp/clients/${row.id}/dashboards`);
      setScopeIds(res.data?.dashboard_ids || []);
    } catch (e: any) {
      show(friendlyError(e, "加载看板范围失败"), "error");
    }
  };

  const saveScope = async () => {
    if (!scopeTarget) return;
    setBusy(true);
    try {
      await client.put(`/admin/mcp/clients/${scopeTarget.id}/dashboards`, { dashboard_ids: scopeIds });
      show(scopeIds.length ? `已限定 ${scopeIds.length} 个看板` : "已改为不限看板");
      setScopeTarget(null);
      await load();
    } catch (e: any) {
      show(friendlyError(e, "保存看板范围失败"), "error");
    } finally { setBusy(false); }
  };

  const unfreezeGrant = async (row: GrantRow) => {
    setBusy(true);
    try {
      const res = await client.post(`/admin/mcp/grants/${row.id}/unfreeze`);
      show(`已解冻，观察期 ${res.data?.grace_minutes || 30} 分钟内不再重复冻结`);
      await load();
    } catch (e: any) {
      show(friendlyError(e, "解冻失败"), "error");
    } finally { setBusy(false); }
  };

  const updateDatasetGuard = async (row: DatasetGuard, patch: Partial<DatasetGuard>) => {
    setBusy(true);
    try {
      await client.patch(`/admin/mcp/datasets/${row.id}`, {
        ...(patch.data_class ? { data_class: patch.data_class } : {}),
        ...("daily_rows" in patch ? { daily_rows: patch.daily_rows } : {}),
      });
      show("已保存");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "保存失败"), "error");
    } finally { setBusy(false); }
  };

  const removeClient = async (row: McpClient) => {
    setBusy(true);
    try {
      await client.delete(`/admin/mcp/clients/${row.id}`);
      show("客户端已删除，已签发的 token 立即失效");
      await load();
    } catch (e: any) {
      show(friendlyError(e, "删除失败"), "error");
    } finally { setBusy(false); }
  };

  const filteredDashboards = dashOptions.filter((d) => {
    const q = scopeQuery.trim().toLowerCase();
    return !q || d.name.toLowerCase().includes(q) || (d.owner || "").toLowerCase().includes(q);
  });

  return (
    <Box>
      <SectionHead
        title="MCP 客户端"
        desc="Agent 通过客户端接入：管理员创建与开关工具，用户授权后才生效"
        action={
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" onClick={() => void load()} startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
              sx={{ textTransform: "none", fontSize: 12.5, color: MUTED, minWidth: 0 }}>
              刷新
            </Button>
            <Button size="small" onClick={() => setTokenOpen(true)}
              sx={{ textTransform: "none", fontSize: 12.5, color: "#4F46E5" }}>
              生成我的连接令牌
            </Button>
            <PrimaryButton onClick={() => setCreateOpen(true)}>新建客户端</PrimaryButton>
          </Box>
        }
      />

      <Tabs value={tab} onChange={(_e, value) => setTab(value)} sx={{ mb: 2, minHeight: 34 }}>
        <Tab value="clients" label="客户端" sx={{ minHeight: 34, fontSize: 12.5, textTransform: "none" }} />
        <Tab value="grants" label="授权记录" sx={{ minHeight: 34, fontSize: 12.5, textTransform: "none" }} />
        <Tab value="audit" label="调用审计" sx={{ minHeight: 34, fontSize: 12.5, textTransform: "none" }} />
        <Tab value="tools" label="工具目录" sx={{ minHeight: 34, fontSize: 12.5, textTransform: "none" }} />
        <Tab value="datasets" label="数据分级" sx={{ minHeight: 34, fontSize: 12.5, textTransform: "none" }} />
      </Tabs>

      {loading ? <Loading /> : error ? <EmptyState text={error} hint="检查后端是否在运行，或刷新重试" /> : (
        <>
          {tab === "clients" && (
            <PanelCard sx={{ p: 0, overflow: "hidden" }}>
              {(clients || []).length === 0 ? (
                <EmptyState text="还没有 MCP 客户端" hint="创建后把 client_id 与 secret 配到 Agent 里" />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={TH}>名称</TableCell>
                        <TableCell sx={TH}>部门</TableCell>
                        <TableCell sx={TH}>项目范围</TableCell>
                        <TableCell sx={TH}>client_id</TableCell>
                        <TableCell sx={TH}>状态</TableCell>
                        <TableCell sx={TH}>创建时间</TableCell>
                        <TableCell sx={TH}>最近调用</TableCell>
                        <TableCell sx={{ ...TH, textAlign: "right" }}>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {(clients || []).map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell sx={TD}>
                            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{row.name}</Typography>
                            {row.description && (
                              <Typography sx={{ fontSize: 11, color: MUTED, mt: 0.25 }}>{row.description}</Typography>
                            )}
                          </TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <span>{row.dept_name || "全员"}</span>
                              <Tooltip title="修改开放部门">
                                <EditOutlined aria-label="修改开放部门"
                                  onClick={() => { setDeptTarget(row); setDeptValue(row.dept_id ? String(row.dept_id) : "all"); }}
                                  sx={{ fontSize: 13, color: "#94A3B8", cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <span>{row.dashboard_count ? `${row.dashboard_count} 个看板` : "不限"}</span>
                              <Tooltip title="设置看板范围">
                                <DashboardOutlined aria-label="设置看板范围" onClick={() => void openScope(row)}
                                  sx={{ fontSize: 13, color: "#94A3B8", cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ ...TD, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                              <span>{row.client_id.slice(0, 10)}…</span>
                              <Tooltip title="复制 client_id">
                                <ContentCopyOutlined onClick={() => void copy(row.client_id, "client_id")}
                                  sx={{ fontSize: 13, color: "#94A3B8", cursor: "pointer" }} />
                              </Tooltip>
                            </Box>
                          </TableCell>
                          <TableCell sx={TD}>
                            <Chip size="small" label={row.enabled ? "启用" : "已停用"} sx={{
                              height: 20, fontSize: 11, borderRadius: "999px",
                              bgcolor: row.enabled ? "#ECFDF5" : "#F3F4F6",
                              color: row.enabled ? "#047857" : "#6B7280",
                            }} />
                          </TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>{fmtTime(row.created_at)}</TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>{fmtTime(row.last_used_at)}</TableCell>
                          <TableCell sx={{ ...TD, textAlign: "right", whiteSpace: "nowrap" }}>
                            <Tooltip title="生成接入指令">
                              <VpnKeyOutlined aria-label="生成接入指令" onClick={() => setConnectorTarget(row)}
                                sx={{ fontSize: 17, color: "#94A3B8", cursor: "pointer", mr: 1 }} />
                            </Tooltip>
                            <Tooltip title="工具开关">
                              <SettingsSuggestOutlined aria-label="工具开关" onClick={() => void openTools(row)}
                                sx={{ fontSize: 17, color: "#94A3B8", cursor: "pointer", mr: 1 }} />
                            </Tooltip>
                            <Tooltip title="删除客户端">
                              <DeleteOutlineOutlined aria-label="删除客户端" onClick={() => setDeleteTarget(row)}
                                sx={{ fontSize: 17, color: "#94A3B8", cursor: "pointer", mr: 1 }} />
                            </Tooltip>
                            <Switch size="small" checked={row.enabled} disabled={busy}
                              onChange={() => void toggleClient(row)}
                              inputProps={{ "aria-label": `${row.name} 启用开关` }} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </PanelCard>
          )}

          {tab === "grants" && (
            <PanelCard sx={{ p: 0, overflow: "hidden" }}>
              {grants.length === 0 ? (
                <EmptyState text="还没有授权记录" hint="点右上角「生成我的连接令牌」开始授权" />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={TH}>用户</TableCell>
                        <TableCell sx={TH}>客户端</TableCell>
                        <TableCell sx={TH}>状态</TableCell>
                        <TableCell sx={TH}>授权时间</TableCell>
                        <TableCell sx={TH}>过期时间</TableCell>
                        <TableCell sx={{ ...TH, textAlign: "right" }}>操作</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {grants.map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell sx={TD}>{row.username}</TableCell>
                          <TableCell sx={TD}>{row.client_name}</TableCell>
                          <TableCell sx={TD}>
                            {row.frozen ? (
                              <Tooltip title={row.frozen_reason || "安全策略冻结"}>
                                <Chip size="small" label="已冻结" sx={{
                                  height: 20, fontSize: 11, borderRadius: "999px",
                                  bgcolor: "#FEF2F2", color: "#B91C1C",
                                }} />
                              </Tooltip>
                            ) : (
                              <Chip size="small" label={row.active ? "有效" : "已撤销"} sx={{
                                height: 20, fontSize: 11, borderRadius: "999px",
                                bgcolor: row.active ? "#ECFDF5" : "#F3F4F6",
                                color: row.active ? "#047857" : "#6B7280",
                              }} />
                            )}
                          </TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>{fmtTime(row.created_at)}</TableCell>
                          <TableCell sx={{ ...TD, color: MUTED }}>{fmtTime(row.expires_at)}</TableCell>
                          <TableCell sx={{ ...TD, textAlign: "right" }}>
                            {row.frozen && (
                              <Button size="small" disabled={busy} onClick={() => void unfreezeGrant(row)}
                                sx={{ textTransform: "none", fontSize: 12, color: "#0F766E", minWidth: 0, mr: 1 }}>
                                解冻
                              </Button>
                            )}
                            {row.active && !row.frozen && (
                              <Button size="small" disabled={busy} onClick={() => void revoke(row)}
                                sx={{ textTransform: "none", fontSize: 12, color: "#EF4444", minWidth: 0 }}>
                                撤销
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </PanelCard>
          )}

          {tab === "audit" && (
            <PanelCard sx={{ p: 0, overflow: "hidden" }}>
              {audit.length === 0 ? (
                <EmptyState text="还没有调用记录" hint="Agent 每次调用（含被拒）都会出现在这里" />
              ) : (
                <TableContainer sx={{ maxHeight: 520 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={TH}>时间</TableCell>
                        <TableCell sx={TH}>用户</TableCell>
                        <TableCell sx={TH}>客户端</TableCell>
                        <TableCell sx={TH}>工具</TableCell>
                        <TableCell sx={TH}>结果</TableCell>
                        <TableCell sx={TH}>耗时</TableCell>
                        <TableCell sx={TH}>说明</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {audit.map((row) => {
                        const state = STATUS[row.status] || STATUS.error;
                        return (
                          <TableRow key={row.id} hover>
                            <TableCell sx={{ ...TD, color: MUTED }}>{fmtTime(row.created_at)}</TableCell>
                            <TableCell sx={TD}>{row.username || "—"}</TableCell>
                            <TableCell sx={TD}>{row.client_name || "—"}</TableCell>
                            <TableCell sx={{ ...TD, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>
                              {row.tool}
                            </TableCell>
                            <TableCell sx={TD}>
                              <Chip size="small" label={state.label} sx={{
                                height: 20, fontSize: 11, borderRadius: "999px",
                                bgcolor: state.bg, color: state.color,
                              }} />
                            </TableCell>
                            <TableCell sx={{ ...TD, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                              {row.duration_ms ? `${row.duration_ms} ms` : "—"}
                            </TableCell>
                            <TableCell sx={{ ...TD, color: MUTED, maxWidth: 260 }}>
                              {row.error || (row.row_count != null ? `${row.row_count} 行` : "—")}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </PanelCard>
          )}

          {tab === "tools" && (
            <PanelCard sx={{ p: 0, overflow: "hidden" }}>
              <TableContainer sx={{ maxHeight: 520 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={TH}>工具</TableCell>
                      <TableCell sx={TH}>说明</TableCell>
                      <TableCell sx={TH}>风险</TableCell>
                      <TableCell sx={TH}>默认</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tools.map((tool) => (
                      <TableRow key={tool.code} hover>
                        <TableCell sx={{ ...TD, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11.5 }}>
                          {tool.code}
                        </TableCell>
                        <TableCell sx={{ ...TD, color: MUTED }}>{tool.description || tool.name}</TableCell>
                        <TableCell sx={TD}>
                          <Chip size="small" label={RISK[tool.risk].label} sx={{
                            height: 20, fontSize: 11, borderRadius: "999px",
                            bgcolor: RISK[tool.risk].bg, color: RISK[tool.risk].color,
                          }} />
                        </TableCell>
                        <TableCell sx={{ ...TD, color: tool.default_enabled ? "#047857" : MUTED }}>
                          {tool.default_enabled ? "开" : "关"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </PanelCard>
          )}
          {tab === "datasets" && (
            <PanelCard sx={{ p: 0, overflow: "hidden" }}>
              <Box sx={{ px: 2, pt: 1.75, pb: 1 }}>
                <Typography sx={{ fontSize: 12, color: MUTED, lineHeight: 1.7 }}>
                  分级决定 MCP 取数上限：普通 20 万行/天、机密 5 万、财务 2 万（可按数据集覆盖）。
                  财务 / 机密只允许聚合或带过滤条件的查询，且禁止分页扫描；超额直接 429。
                </Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 520 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={TH}>数据集</TableCell>
                      <TableCell sx={TH}>部门</TableCell>
                      <TableCell sx={TH}>分级</TableCell>
                      <TableCell sx={TH}>每日行数上限</TableCell>
                      <TableCell sx={TH}>今日已用</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {datasetGuards.map((row) => (
                      <TableRow key={row.id} hover>
                        <TableCell sx={TD}>
                          <Typography sx={{ fontSize: 12.5, color: INK }}>{row.name}</Typography>
                          <Typography sx={{ fontSize: 11, color: MUTED }}>#{row.id}</Typography>
                        </TableCell>
                        <TableCell sx={{ ...TD, color: MUTED }}>{row.dept_name || "—"}</TableCell>
                        <TableCell sx={TD}>
                          <Select size="small" value={row.data_class} disabled={busy}
                            onChange={(e) => void updateDatasetGuard(row, {
                              data_class: e.target.value as DatasetGuard["data_class"] })}
                            sx={{ fontSize: 12, height: 30, minWidth: 100 }}>
                            <MenuItem value="normal">普通</MenuItem>
                            <MenuItem value="confidential">机密</MenuItem>
                            <MenuItem value="financial">财务</MenuItem>
                          </Select>
                        </TableCell>
                        <TableCell sx={TD}>
                          <TextField size="small" type="number" disabled={busy}
                            defaultValue={row.daily_rows ?? ""}
                            placeholder="按分级默认"
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              const next = raw ? Number(raw) : null;
                              if (next !== row.daily_rows) void updateDatasetGuard(row, { daily_rows: next });
                            }}
                            sx={{ width: 150, "& input": { fontSize: 12 } }} />
                        </TableCell>
                        <TableCell sx={{ ...TD, color: MUTED }}>
                          {row.rows_today.toLocaleString()} 行
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </PanelCard>
          )}

        </>
      )}

      {/* 新建客户端 */}
      <Dialog open={createOpen} onClose={busy ? undefined : () => setCreateOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>新建 MCP 客户端</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField label="名称" size="small" required value={form.name} sx={{ mt: 1 }}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            placeholder="例如：经营分析 Agent" />
          <FormControl size="small" fullWidth>
            <InputLabel id="mcp-dept-label">开放部门</InputLabel>
            <Select labelId="mcp-dept-label" label="开放部门" value={form.dept_id}
              onChange={(e) => setForm((p) => ({ ...p, dept_id: String(e.target.value) }))}>
              <MenuItem value="all">全员可用（不限部门）</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="说明" size="small" multiline minRows={2} value={form.description}
            onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
            placeholder="这个 Agent 用来做什么（可选）" />
          <Typography sx={{ fontSize: 11.5, color: MUTED, lineHeight: 1.6 }}>
            选部门后，只有该部门及其下级部门的人能在「MCP 授权」页看到并授权；创建后会生成 client_id 与 secret，secret 只显示一次。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCreateOpen(false)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void create()} disabled={busy}>创建</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* secret 一次性展示 + 接入指令 */}
      <Dialog open={!!created} onClose={() => { setCreated(null); setConnector(""); }} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>客户端已创建 · 请立刻保存</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.7 }}>
            secret 只显示这一次，关闭后无法再查看（丢失只能重建客户端）。
          </Typography>
          <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
            <Typography sx={{ fontSize: 11, color: "#64748B", mb: 0.5 }}>client_id</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
                {created?.client_id}
              </Typography>
              <SmartToyOutlined sx={{ fontSize: 15, color: "#C7C9D9", ml: "auto" }} />
            </Box>
          </Box>
          <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
            <Typography sx={{ fontSize: 11, color: "#64748B", mb: 0.5 }}>secret</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
                {created?.secret}
              </Typography>
              <Tooltip title="复制 secret">
                <ContentCopyOutlined onClick={() => created && void copy(created.secret, "secret")}
                  sx={{ fontSize: 15, color: "#94A3B8", cursor: "pointer", flexShrink: 0 }} />
              </Tooltip>
            </Box>
          </Box>

          {connector ? (
            <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: "#64748B" }}>
                  接入指令（已复制，可直接粘给 Agent）
                </Typography>
                <Tooltip title="再复制一次">
                  <ContentCopyOutlined onClick={() => void copy(connector, "接入指令")}
                    sx={{ fontSize: 15, color: "#94A3B8", cursor: "pointer", ml: "auto" }} />
                </Tooltip>
              </Box>
              <Typography component="pre" sx={{
                m: 0, fontSize: 11.5, lineHeight: 1.7, color: INK, whiteSpace: "pre-wrap",
                wordBreak: "break-all", fontFamily: "ui-monospace, Menlo, monospace",
              }}>
                {connector}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ p: 1.5, bgcolor: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: "8px" }}>
              <Typography sx={{ fontSize: 11.5, color: "#B45309", lineHeight: 1.7 }}>
                完整接入串还差 refresh_token。点「生成接入指令并复制」会为当前账号授权该客户端，
                并把地址、client_id、secret、refresh_token、已开工具一次性拼好复制走。
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => { setCreated(null); setConnector(""); }} sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>
            关闭
          </Button>
          {!connector && (
            <PrimaryButton onClick={() => void makeConnector()} disabled={busy}>
              生成接入指令并复制
            </PrimaryButton>
          )}
        </DialogActions>
      </Dialog>

      {/* 客户端工具开关 */}
      <Dialog open={!!toolClient} onClose={busy ? undefined : () => setToolClient(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>工具开关 · {toolClient?.name}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: MUTED, mb: 1.5, lineHeight: 1.6 }}>
            只有「已开启 + 用户有对应权限 + 已授权」三者同时满足，Agent 才能调用。
          </Typography>
          <Box sx={{ maxHeight: 380, overflowY: "auto" }}>
            {clientTools.map((row) => (
              <Box key={row.code} sx={{
                display: "flex", alignItems: "center", gap: 1.5, py: 0.9,
                borderBottom: `1px solid ${LINE}`, "&:last-of-type": { borderBottom: "none" },
              }}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace" }}>
                    {row.code}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: MUTED }}>{row.name}</Typography>
                </Box>
                <Chip size="small" label={RISK[row.risk].label} sx={{
                  height: 20, fontSize: 11, borderRadius: "999px",
                  bgcolor: RISK[row.risk].bg, color: RISK[row.risk].color,
                }} />
                <Switch size="small" checked={row.enabled} disabled={busy}
                  onChange={(e) => toggleTool(row, e.target.checked)}
                  inputProps={{ "aria-label": `${row.code} 开关` }} />
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <PrimaryButton onClick={() => setToolClient(null)}>完成</PrimaryButton>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmHigh}
        title="开启高危工具"
        desc={`${confirmHigh?.tool.code} 属于高危工具，开启后该客户端的用户（有权限且已授权）即可调用。确定开启？`}
        confirmText="开启" danger busy={busy}
        onClose={() => setConfirmHigh(null)}
        onConfirm={() => {
          const target = confirmHigh;
          setConfirmHigh(null);
          if (target) void applyTool(target.tool, true);
        }}
      />

      {/* 生成我的连接令牌 */}
      <Dialog open={tokenOpen} onClose={() => setTokenOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>生成我的连接令牌</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.7 }}>
            同意把自己的权限授予该 Agent；撤销授权或停用客户端后令牌立即失效。
          </Typography>
          <FormControl size="small" fullWidth>
            <InputLabel id="mcp-client-label">客户端</InputLabel>
            <Select labelId="mcp-client-label" label="客户端" value={tokenClientId}
              onChange={(e) => setTokenClientId(String(e.target.value))}>
              {(clients || []).filter((c) => c.enabled).map((c) => (
                <MenuItem key={c.id} value={c.client_id}>{c.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setTokenOpen(false)} sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>
            取消
          </Button>
          <PrimaryButton onClick={() => void makeToken()} disabled={busy}>生成</PrimaryButton>
        </DialogActions>
      </Dialog>

      <Dialog open={!!myToken} onClose={() => setMyToken(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>连接令牌 · 只显示这一次</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.7 }}>
            把 client_id + secret + 下面这串 refresh_token 填进 Agent；
            换令牌接口 <code>POST /api/mcp/token</code>，调用入口 <code>POST /api/mcp/rpc</code>。
          </Typography>
          <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
                {myToken?.refresh_token}
              </Typography>
              <Tooltip title="复制 refresh_token">
                <ContentCopyOutlined onClick={() => myToken && void copy(myToken.refresh_token, "refresh_token")}
                  sx={{ fontSize: 15, color: "#94A3B8", cursor: "pointer", flexShrink: 0 }} />
              </Tooltip>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <PrimaryButton onClick={() => setMyToken(null)}>我保存好了</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* 设置看板范围 */}
      <Dialog open={!!scopeTarget} onClose={busy ? undefined : () => setScopeTarget(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>看板范围 · {scopeTarget?.name}</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Typography sx={{ fontSize: 12, color: MUTED, lineHeight: 1.7, mb: 1.5 }}>
            勾选后，这个客户端只能操作这些看板，数据查询也只能落到这些看板实际引用的数据集；
            一个都不勾 = 不限（仍受用户自身权限限制）。
          </Typography>
          <TextField size="small" fullWidth placeholder="搜索看板名称 / 所有者" value={scopeQuery}
            onChange={(e) => setScopeQuery(e.target.value)} sx={{ mb: 1 }} />
          <Box sx={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
            {filteredDashboards.map((d) => (
              <Box key={d.id} sx={{
                display: "flex", alignItems: "center", gap: 1, px: 1, py: 0.5,
                borderBottom: `1px solid ${LINE}`, "&:last-of-type": { borderBottom: "none" },
              }}>
                <Checkbox size="small" checked={scopeIds.includes(d.id)}
                  onChange={(e) => setScopeIds((prev) => (
                    e.target.checked ? [...prev, d.id] : prev.filter((x) => x !== d.id)
                  ))} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12.5, color: INK }} noWrap>{d.name}</Typography>
                  <Typography sx={{ fontSize: 11, color: MUTED }}>#{d.id} · {d.owner || "公共"}</Typography>
                </Box>
              </Box>
            ))}
            {filteredDashboards.length === 0 && (
              <Typography sx={{ p: 2, fontSize: 12, color: MUTED }}>没有匹配的看板</Typography>
            )}
          </Box>
          <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 1 }}>已选 {scopeIds.length} 个</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setScopeTarget(null)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void saveScope()} disabled={busy}>保存</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* 修改开放部门 */}
      <Dialog open={!!deptTarget} onClose={busy ? undefined : () => setDeptTarget(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>开放部门 · {deptTarget?.name}</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <FormControl size="small" fullWidth sx={{ mt: 1 }}>
            <InputLabel id="mcp-dept-edit-label">开放部门</InputLabel>
            <Select labelId="mcp-dept-edit-label" label="开放部门" value={deptValue}
              onChange={(e) => setDeptValue(String(e.target.value))}>
              <MenuItem value="all">全员可用（不限部门）</MenuItem>
              {departments.map((d) => (
                <MenuItem key={d.id} value={String(d.id)}>{d.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 1.5, lineHeight: 1.7 }}>
            改成某部门后，只有该部门及下级部门的人可见；已经签发的令牌会在下次调用时按新范围重新校验。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeptTarget(null)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void saveDept()} disabled={busy}>保存</PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* 生成接入指令（已有客户端） */}
      <ConfirmDialog
        open={!!connectorTarget}
        title="重新生成接入指令"
        desc={`会为「${connectorTarget?.name || ""}」生成一份属于你账号的新凭据（secret + refresh_token），你此前的接入串将失效；其他成员不受影响。继续？`}
        confirmText="生成" busy={busy}
        onClose={() => setConnectorTarget(null)}
        onConfirm={() => {
          const target = connectorTarget;
          setConnectorTarget(null);
          if (target) void makeConnectorFor(target);
        }}
      />

      {/* 删除客户端 */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="删除客户端"
        desc={`删除「${deleteTarget?.name || ""}」后，它的工具开关与授权一并清除，已签发的 token 立即失效（调用审计保留）。确定删除？`}
        confirmText="删除" danger busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) void removeClient(target);
        }}
      />

      <Dialog open={!!connectorOut} onClose={() => setConnectorOut(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>接入指令 · {connectorOut?.name}</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.7, mb: 1.5 }}>
            已复制到剪贴板。secret 与 refresh_token 只显示这一次，你此前的旧凭据已作废。
          </Typography>
          <Box sx={{ p: 1.5, bgcolor: "#F8F9FC", border: `1px solid ${LINE}`, borderRadius: "8px" }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
              <Typography sx={{ fontSize: 11, color: "#64748B" }}>接入指令</Typography>
              <Tooltip title="再复制一次">
                <ContentCopyOutlined onClick={() => connectorOut && void copy(connectorOut.text, "接入指令")}
                  sx={{ fontSize: 15, color: "#94A3B8", cursor: "pointer", ml: "auto" }} />
              </Tooltip>
            </Box>
            <Typography component="pre" sx={{
              m: 0, fontSize: 11.5, lineHeight: 1.7, color: INK, whiteSpace: "pre-wrap",
              wordBreak: "break-all", fontFamily: "ui-monospace, Menlo, monospace", maxHeight: 320, overflowY: "auto",
            }}>
              {connectorOut?.text}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <PrimaryButton onClick={() => setConnectorOut(null)}>完成</PrimaryButton>
        </DialogActions>
      </Dialog>

      {toastNode}
    </Box>
  );
}
