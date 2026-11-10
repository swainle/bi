/** 明策BI — ECharts 自研引擎，模板卡片 + 数据从 PostgreSQL 实时查询 */

import { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, Button, CircularProgress, alpha, useTheme,
  Card, CardContent, IconButton, TextField, InputAdornment, Avatar, Chip,
  LinearProgress,
  Snackbar, Alert, Menu, MenuItem, Dialog, DialogTitle, DialogContent,
  DialogActions, List, ListItem, ListItemAvatar, ListItemText, Checkbox,
  Tooltip, Divider, ToggleButton, ToggleButtonGroup,
} from "@mui/material";
import {
  Add, Search, Dashboard, BarChart, Storage, TrendingUp, Group, Code,
  MoreVert, Edit, Delete, Share, Person, Lock, OpenInNew, DesignServices, AutoAwesome, CloudUpload,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import DataSources from "../features/bi-dashboard/DataSources";
import SqlQueryPanel from "../features/bi-dashboard/SqlQueryPanel";
import AnalysisCanvas from "../features/bi-dashboard/AnalysisCanvas";
import TeamPanel, { SharedWithMePanel } from "../features/bi-dashboard/TeamPanel";
import type { TeamDashboard } from "../features/bi-dashboard/constants";

interface DashboardMeta {
  id: number; name: string; panels: any[];
  table_map?: Record<string, string>;
  created_at: string; updated_at: string;
}

const NAV_ITEMS = [
  { label: "我的看板", icon: <Dashboard />, color: "#6366F1", view: "dashboards" },
  { label: "模板库", icon: <BarChart />, color: "#F59E0B", view: "templates" },
  { label: "我的团队", icon: <Group />, color: "#10B981", view: "team" },
  { label: "数据源", icon: <Storage />, color: "#EC4899", view: "datasource" },
  { label: "SQL 查询", icon: <Code />, color: "#8B5CF6", view: "sql" },
  { label: "自助分析", icon: <BarChart />, color: "#10B981", view: "analysis" },
  { label: "AI生成看板", icon: <AutoAwesome />, color: "#8B5CF6", view: "ai-generate", action: "modal" },
  { label: "编辑设计", icon: <DesignServices />, color: "#EC4899", view: "editor", action: "nav" },
];

export default function BiDashboardPage() {
  const nav = useNavigate();
  const theme = useTheme();
  const [activeNav, setActiveNav] = useState("dashboards");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [myDashboards, setMyDashboards] = useState<DashboardMeta[]>([]);
  const [teamDashboards, setTeamDashboards] = useState<TeamDashboard[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<TeamDashboard[]>([]);
  const [marketTemplates, setMarketTemplates] = useState<any[]>([]);
  const [templateCategory, setTemplateCategory] = useState("");
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: "success" | "error" }>({
    open: false, msg: "", severity: "success",
  });

  // ====== 看板操作状态 ======
  const [menuAnchor, setMenuAnchor] = useState<{ el: HTMLElement; dashId: number } | null>(null);
  const [renameDialog, setRenameDialog] = useState<DashboardMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<DashboardMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shareDialog, setShareDialog] = useState<DashboardMeta | null>(null);

  // AI 生成看板
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiMode, setAiMode] = useState<"upload" | "batch">("upload");
  const [aiFile, setAiFile] = useState<File | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResult, setAiResult] = useState<any>(null);
  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [sharePerms, setSharePerms] = useState<Record<number, string>>({}); // userId -> "view"|"edit"|"manage"
  const [shareLoading, setShareLoading] = useState(false);

  const refreshDashboards = useCallback(async () => {
    const my = await client.get("/bi/engine/dashboards");
    setMyDashboards(my.data?.dashboards || []);
  }, []);

  // 重命名
  const handleRename = async () => {
    if (!renameDialog || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await client.put(`/bi/engine/dashboards/${renameDialog.id}`, {
        name: renameValue.trim(),
        panels: renameDialog.panels || [],
      });
      await refreshDashboards();
      setSnackbar({ open: true, msg: "看板名称已更新", severity: "success" });
      setRenameDialog(null);
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "重命名失败", severity: "error" });
    } finally {
      setRenaming(false);
    }
  };

  // 删除
  const handleDelete = async () => {
    if (!deleteDialog) return;
    setDeleting(true);
    try {
      await client.delete(`/bi/engine/dashboards/${deleteDialog.id}`);
      await refreshDashboards();
      setSnackbar({ open: true, msg: `已删除「${deleteDialog.name}」`, severity: "success" });
      setDeleteDialog(null);
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "删除失败", severity: "error" });
    } finally {
      setDeleting(false);
    }
  };

  // 打开共享弹窗
  const openShareDialog = async (dash: DashboardMeta) => {
    setShareDialog(dash);
    setMenuAnchor(null);
    try {
      const [usersRes, permsRes] = await Promise.all([
        client.get("/bi/team/users"),
        client.get(`/bi/engine/permissions/dashboard/${dash.id}`),
      ]);
      setAllUsers(usersRes.data || []);
      const permMap: Record<number, string> = {};
      (permsRes.data?.permissions || []).forEach((p: any) => {
        permMap[p.user_id] = p.permission;
      });
      setSharePerms(permMap);
    } catch (e: any) {
      setSnackbar({ open: true, msg: "加载用户列表失败", severity: "error" });
    }
  };

  // 切换用户权限
  const toggleUserPerm = (userId: number) => {
    setSharePerms(prev => {
      const next = { ...prev };
      if (next[userId]) {
        // 循环：view → edit → manage → 移除
        if (next[userId] === "view") next[userId] = "edit";
        else if (next[userId] === "edit") next[userId] = "manage";
        else delete next[userId];
      } else {
        next[userId] = "view";
      }
      return next;
    });
  };

  // 保存共享权限
  const saveSharePerms = async () => {
    if (!shareDialog) return;
    setShareLoading(true);
    try {
      // 获取当前权限做 diff
      const permsRes = await client.get(`/bi/engine/permissions/dashboard/${shareDialog.id}`);
      const existing = permsRes.data?.permissions || [];
      // 删除所有旧权限
      for (const p of existing) {
        await client.delete("/bi/engine/permissions", {
          data: { resource_type: "dashboard", resource_id: shareDialog.id, user_id: p.user_id, permission: p.permission },
        });
      }
      // 添加新权限
      for (const [uid, perm] of Object.entries(sharePerms)) {
        await client.post("/bi/engine/permissions", {
          resource_type: "dashboard",
          resource_id: shareDialog.id,
          user_id: Number(uid),
          permission: perm,
        });
      }
      setSnackbar({ open: true, msg: "共享权限已保存", severity: "success" });
      setShareDialog(null);
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "保存失败", severity: "error" });
    } finally {
      setShareLoading(false);
    }
  };

  // 克隆模板到"我的看板"
  const cloneTemplate = async (tpl: any) => {
    if (cloningId !== null) return; // 防重复点击
    setCloningId(tpl.id);
    try {
      const res = await client.post(`/bi/engine/market/${tpl.id}/clone`);
      const newId = res.data?.id;
      // 刷新"我的看板"列表
      const my = await client.get("/bi/engine/dashboards");
      setMyDashboards(my.data?.dashboards || []);
      // 刷新模板列表（downloads +1）
      const market = await client.get("/bi/engine/market");
      setMarketTemplates(market.data?.templates || []);
      setSnackbar({ open: true, msg: res.data?.message || "模板克隆成功", severity: "success" });
      // 跳转到新看板编辑页
      if (newId) {
        nav(`/bi/view/${newId}`);
      }
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "克隆失败，请重试", severity: "error" });
    } finally {
      setCloningId(null);
    }
  };

  // AI 生成看板
  const [aiProgress, setAiProgress] = useState(0);
  const [aiMsg, setAiMsg] = useState("");

  const handleAiGenerate = async () => {
    if (!aiFile) { setAiError("请先选择数据文件"); return; }
    setAiGenerating(true); setAiError(""); setAiResult(null);
    setAiProgress(0); setAiMsg("初始化...");
    try {
      const fd = new FormData(); fd.append("file", aiFile);
      const token = localStorage.getItem("access_token");
      // Phase 2: Async pipeline with progress
      const r = await fetch(`/api/bi/engine/ai/agent-pipeline?_t=${Date.now()}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
        const msg = Array.isArray(err.detail) ? err.detail[0]?.msg || JSON.stringify(err.detail) : (err.detail || `HTTP ${r.status}`);
        throw new Error(String(msg));
      }
      const data = await r.json();
      setAiResult(data);
      setAiFile(null);
    } catch (e: any) {
      setAiError(String(e?.message || "AI 生成失败"));
    } finally {
      setAiGenerating(false);
    }
  };

  // 批量生成
  const handleBatchGenerate = async (domain: string) => {
    setAiGenerating(true); setAiError(""); setAiResult(null); setAiProgress(0); setAiMsg("批量生成中...");
    try {
      const token = localStorage.getItem("access_token");
      const r = await fetch("/api/bi/engine/ai/batch/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ domain }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setAiResult({ batch: true, domain, dashboards: data.dashboards, count: data.count });
      setAiProgress(100); setAiMsg("完成！");
    } catch (e: any) {
      setAiError(String(e?.message || "批量生成失败"));
    } finally {
      setAiGenerating(false);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [my, team, shared, market] = await Promise.all([
          client.get("/bi/engine/dashboards"),
          client.get("/bi/team/my"),
          client.get("/bi/team/shared-with-me"),
          client.get("/bi/engine/market"),
        ]);
        setMyDashboards(my.data?.dashboards || []);
        setTeamDashboards(team.data || []);
        setSharedWithMe(shared.data || []);
        setMarketTemplates(market.data?.templates || []);
      } catch (e: any) { console.error("加载BI数据失败:", e); }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = search
    ? myDashboards.filter(d => d.name.includes(search))
    : myDashboards;

  const renderContent = () => {
    switch (activeNav) {
      case "team":
        return (
          <Box sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>我的团队</Typography>
            <TeamPanel
              rows={[]} panels={[]}
              myDashboards={teamDashboards} setMyDashboards={setTeamDashboards}
              sharedWithMe={sharedWithMe} setSharedWithMe={setSharedWithMe}
              teamLoading={false}
              loadTeamData={async () => [teamDashboards, sharedWithMe]}
              setDashboardName={() => {}} setOriginalName={() => {}} setCurrentDashboardId={() => {}}
              hasAutoLoaded applyTeamDashboard={() => {}}
            />
          </Box>
        );
      case "datasource":
        return (
          <DataSources rows={[]} setRows={() => {}} fields={[]}
            setActiveTab={() => {}} setSearchParams={() => {}} handleFileUpload={() => {}} />
        );
      case "sql":
        return <SqlQueryPanel />;
      case "analysis":
        return <Box sx={{ flex: 1, overflow: "hidden" }}><AnalysisCanvas /></Box>;
      case "templates":
        return (
          <Box sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>模板库</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              预置电商行业数据模板 · 内置完整实战数据 · 点击一键生成明策BI看板
            </Typography>

            {/* FineBI风格分类过滤 */}
            <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
              {["全部","拼多多","天猫","财务","产品部"].map(cat => (
                <Chip key={cat} label={cat} size="small"
                  variant={templateCategory === cat || (cat === "全部" && !templateCategory) ? "filled" : "outlined"}
                  color="primary"
                  onClick={() => setTemplateCategory(cat === "全部" ? "" : cat)}
                  sx={{ fontSize: 12, cursor: "pointer" }} />
              ))}
            </Box>

            {loading ? (
              <Box sx={{ textAlign: "center", py: 8 }}><CircularProgress /></Box>
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 2.5 }}>
                {marketTemplates.filter(t => !templateCategory || t.category === templateCategory).map((tpl: any) => (
                  <Card key={tpl.id}
                    sx={{
                      borderRadius: 3, overflow: "hidden",
                      border: "1px solid", borderColor: "divider",
                      transition: "all 0.2s",
                      "&:hover": { borderColor: "#6366F1", boxShadow: "0 4px 20px rgba(99,102,241,0.15)", transform: "translateY(-2px)" },
                    }}>
                    {/* 顶部色条 */}
                    <Box sx={{ height: 4, background: tpl.category === "财务" ? "linear-gradient(90deg,#6366F1,#8B5CF6)" : tpl.category === "拼多多" ? "linear-gradient(90deg,#F59E0B,#EF4444)" : tpl.category === "天猫" ? "linear-gradient(90deg,#10B981,#0EA5E9)" : "linear-gradient(90deg,#EC4899,#8B5CF6)" }} />
                    <CardContent sx={{ p: 2.5 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
                        <Typography variant="subtitle1" fontWeight={700} fontSize={15}>{tpl.name}</Typography>
                        <Chip label={tpl.category} size="small" sx={{ fontSize: 10, height: 20, bgcolor: "#F3F4F6" }} />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12, lineHeight: 1.5, minHeight: 36 }}>
                        {tpl.description}
                      </Typography>
                      {/* 面板预览 */}
                      <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
                        {(tpl.panels || []).slice(0, 5).map((p: any, i: number) => (
                          <Chip key={i} label={p.title} size="small" variant="outlined"
                            sx={{ fontSize: 10, height: 20, borderColor: "#E5E7EB", color: "#6B7280" }} />
                        ))}
                      </Box>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Typography fontSize={11} color="#F59E0B">{"★".repeat(Math.round(tpl.rating || 4))}</Typography>
                          <Typography fontSize={11} color="text.secondary">{tpl.downloads || 0} 次使用</Typography>
                        </Box>
                        <Button size="small" variant="contained"
                          disabled={cloningId === tpl.id}
                          startIcon={cloningId === tpl.id ? <CircularProgress size={12} color="inherit" /> : null}
                          onClick={(e) => { e.stopPropagation(); cloneTemplate(tpl); }}
                          sx={{ borderRadius: 2, textTransform: "none", fontSize: 11, bgcolor: "#6366F1", py: 0.2 }}>
                          {cloningId === tpl.id ? "复制中..." : "使用模板"}
                        </Button>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            )}
          </Box>
        );
      default:
        return (
          <Box sx={{ p: 4 }}>
            {/* 横幅 */}
            <Box sx={{
              p: 4, mb: 4, borderRadius: 3,
              background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 40%, #A855F7 100%)",
              color: "white", position: "relative", overflow: "hidden",
            }}>
              <Box sx={{ position: "absolute", top: -40, right: -20, opacity: 0.1, fontSize: 180, pointerEvents: "none" }}>📊</Box>
              <Typography variant="h4" fontWeight={800} gutterBottom sx={{ position: "relative", zIndex: 1 }}>明策BI</Typography>
              <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 600, position: "relative", zIndex: 1 }}>
                自研先进的BI引擎 · 垂直电商行业 · AI 驱动分析。从数据入库到智能洞察，一站式自研 BI。
              </Typography>
              <Box sx={{ display: "flex", gap: 1.5, mt: 3, position: "relative", zIndex: 1 }}>
                <Button variant="contained" startIcon={<TrendingUp />} onClick={() => setActiveNav("templates")}
                  sx={{ bgcolor: "rgba(255,255,255,0.2)", "&:hover": { bgcolor: "rgba(255,255,255,0.35)" }, textTransform: "none", fontWeight: 600, borderRadius: 2 }}>
                  浏览模板
                </Button>
              </Box>
            </Box>

            {/* 搜索 */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3 }}>
              <TextField size="small" placeholder="搜索看板..." value={search}
                onChange={e => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start"><Search sx={{ color: "text.secondary", fontSize: 18 }} /></InputAdornment>,
                  sx: { borderRadius: 2, fontSize: 13 },
                }} sx={{ width: 300 }} />
            </Box>

            {loading ? (
              <Box sx={{ textAlign: "center", py: 8 }}><CircularProgress /></Box>
            ) : filtered.length === 0 ? (
              <Box sx={{ textAlign: "center", py: 12 }}>
                <Dashboard sx={{ fontSize: 48, color: "text.disabled", mb: 2 }} />
                <Typography variant="h6" fontWeight={600} gutterBottom>暂无看板</Typography>
                <Typography color="text.secondary">前往模板库新建你的第一个数据看板</Typography>
              </Box>
            ) : (
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2 }}>
                {filtered.map(d => (
                  <Card key={d.id}
                    sx={{
                      borderRadius: 2.5,
                      border: "1px solid", borderColor: "divider",
                      transition: "all 0.15s",
                      "&:hover": { borderColor: "#6366F1", boxShadow: `0 0 0 1px ${alpha("#6366F1", 0.25)}` },
                      position: "relative",
                    }}>
                    <CardContent sx={{ pb: 1 }}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
                        <Box
                          onClick={() => nav(`/bi/view/${d.id}`)}
                          sx={{ cursor: "pointer", width: 42, height: 42, borderRadius: 2.5, flexShrink: 0,
                          background: alpha("#6366F1", 0.08), display: "flex", alignItems: "center",
                          justifyContent: "center", color: "#6366F1" }}>
                          <Dashboard fontSize="small" />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0 }} onClick={() => nav(`/bi/view/${d.id}`)} style={{ cursor: "pointer" }}>
                          <Typography variant="subtitle2" fontWeight={700} noWrap fontSize={14}>{d.name}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {d.panels?.length || 0} 个图表 · {d.updated_at?.slice(0, 10) || ""}
                          </Typography>
                        </Box>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuAnchor({ el: e.currentTarget, dashId: d.id });
                          }}
                          sx={{ p: 0.5, opacity: 0.6, "&:hover": { opacity: 1 } }}
                        >
                          <MoreVert fontSize="small" />
                        </IconButton>
                      </Box>

                      {/* 操作按钮行 */}
                      <Box sx={{ display: "flex", gap: 0.5, mt: 1.5, flexWrap: "wrap" }}>
                        <Tooltip title="打开看板">
                          <Button size="small" variant="outlined"
                            onClick={() => nav(`/bi/view/${d.id}`)}
                            startIcon={<OpenInNew sx={{ fontSize: 14 }} />}
                            sx={{ borderRadius: 1.5, textTransform: "none", fontSize: 11, py: 0.25, minWidth: "auto" }}>
                            打开
                          </Button>
                        </Tooltip>
                        <Tooltip title="重命名">
                          <IconButton size="small"
                            onClick={() => { setRenameDialog(d); setRenameValue(d.name); }}
                            sx={{ borderRadius: 1.5, p: 0.5 }}>
                            <Edit sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="共享给团队成员">
                          <IconButton size="small"
                            onClick={() => openShareDialog(d)}
                            sx={{ borderRadius: 1.5, p: 0.5 }}>
                            <Share sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="删除">
                          <IconButton size="small"
                            onClick={() => setDeleteDialog(d)}
                            sx={{ borderRadius: 1.5, p: 0.5, ml: "auto", color: "error.main" }}>
                            <Delete sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </CardContent>

                    {/* 下拉菜单（备用，当前已用 inline 按钮替代） */}
                    <Menu
                      open={!!menuAnchor && menuAnchor.dashId === d.id}
                      anchorEl={menuAnchor?.el}
                      onClose={() => setMenuAnchor(null)}
                      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                      transformOrigin={{ vertical: "top", horizontal: "right" }}
                    >
                      <MenuItem onClick={() => { setMenuAnchor(null); nav(`/bi/view/${d.id}`); }}>
                        <OpenInNew sx={{ fontSize: 16, mr: 1 }} /> 打开看板
                      </MenuItem>
                      <MenuItem onClick={() => { setRenameDialog(d); setRenameValue(d.name); setMenuAnchor(null); }}>
                        <Edit sx={{ fontSize: 16, mr: 1 }} /> 重命名
                      </MenuItem>
                      <MenuItem onClick={() => openShareDialog(d)}>
                        <Share sx={{ fontSize: 16, mr: 1 }} /> 共享设置
                      </MenuItem>
                      <Divider />
                      <MenuItem onClick={() => { setDeleteDialog(d); setMenuAnchor(null); }}
                        sx={{ color: "error.main" }}>
                        <Delete sx={{ fontSize: 16, mr: 1 }} /> 删除看板
                      </MenuItem>
                    </Menu>
                  </Card>
                ))}
              </Box>
            )}
          </Box>
        );
    }
  };

  return (
    <Box sx={{ height: "calc(100vh - 64px)", display: "flex", overflow: "hidden" }}>
      {/* 左侧边栏 */}
      <Box sx={{
        width: 250, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: "1px solid", borderColor: "divider",
        bgcolor: alpha(theme.palette.background.paper, 0.7),
        backdropFilter: "blur(12px)",
      }}>
        <Box sx={{ px: 2.5, py: 2.5, borderBottom: "1px solid", borderColor: "divider" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Avatar sx={{ width: 38, height: 38, borderRadius: 2.5,
              background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
              fontSize: 18, fontWeight: 800,
              boxShadow: "0 4px 12px rgba(99,102,241,0.35)", }}>BI</Avatar>
            <Box>
              <Typography variant="h6" fontWeight={800} fontSize={18} letterSpacing={-0.5}
                sx={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                明策BI
              </Typography>
              <Typography variant="caption" color="text.secondary" fontSize={11}>ECharts · 自研引擎</Typography>
            </Box>
          </Box>
        </Box>

        <Box sx={{ flexGrow: 1, px: 1.5, pt: 2, overflow: "auto" }}>
          <Typography variant="overline" sx={{ px: 1, fontWeight: 600, color: "text.secondary", fontSize: 11, letterSpacing: 1 }}>菜单</Typography>
          {NAV_ITEMS.map((item) => (
            <Box key={item.view}
              onClick={() => (item as any).action === 'nav' ? nav('/bi/editor') : (item as any).action === 'modal' ? setAiDialogOpen(true) : setActiveNav(item.view)}
              sx={{
                display: "flex", alignItems: "center", gap: 1.5,
                px: 1.5, py: 1.2, borderRadius: 2, mt: 0.5, cursor: "pointer",
                color: activeNav === item.view ? item.color : "text.secondary",
                bgcolor: activeNav === item.view ? alpha(item.color, 0.08) : "transparent",
                fontWeight: activeNav === item.view ? 600 : 400,
                transition: "all 0.15s",
                "&:hover": { bgcolor: alpha(item.color, 0.06) },
              }}>
              <Box sx={{ fontSize: 20, display: "flex" }}>{item.icon}</Box>
              <Typography variant="body2" fontSize={13} fontWeight="inherit">{item.label}</Typography>
            </Box>
          ))}
        </Box>

        <Box sx={{ px: 1.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", px: 1.5 }}>
            <Typography variant="caption" color="text.secondary">我的看板</Typography>
            <Typography variant="caption" fontWeight={700} color="#6366F1">{myDashboards.length}</Typography>
          </Box>
        </Box>
      </Box>

      {/* 主内容区 */}
      <Box sx={{ flex: 1, overflow: "auto" }}>{renderContent()}</Box>

      {/* 克隆结果提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snackbar.severity}
          onClose={() => setSnackbar(s => ({ ...s, open: false }))}
          sx={{ borderRadius: 2 }}
        >
          {snackbar.msg}
        </Alert>
      </Snackbar>

      {/* ─── AI 生成看板 对话框 ─── */}
      <Dialog open={aiDialogOpen} onClose={() => { if (!aiGenerating) { setAiDialogOpen(false); setAiResult(null); setAiError(""); }}} maxWidth="sm" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}>
          <AutoAwesome sx={{ color: "#8B5CF6" }} /> AI 生成看板
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          {aiResult ? (
            <Box sx={{ py: 2, textAlign: "center" }}>
              <Box sx={{ width: 56, height: 56, borderRadius: "50%", mx: "auto", mb: 2, bgcolor: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 24 }}>✓</Box>
              {aiResult.batch ? (
                <>
                  <Typography variant="h6" fontWeight={700} gutterBottom>批量生成完成</Typography>
                  <Box sx={{ display: "flex", justifyContent: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
                    {aiResult.dashboards?.map((d: any) => (
                      <Chip key={d.dashboard_id} label={d.name} color="primary" variant="outlined" size="small" />
                    ))}
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                    共 {aiResult.count} 个看板 · 领域: {aiResult.domain}
                  </Typography>
                </>
              ) : (
                <>
                  <Typography variant="h6" fontWeight={700} gutterBottom>{aiResult.dashboard_name || aiResult.result?.dashboard_name}</Typography>
                  <Box sx={{ display: "flex", justifyContent: "center", gap: 3, mb: 1 }}>
                    <Chip label={`${aiResult.panels?.length || aiResult.panels_count || 0} 个图表`} color="primary" variant="outlined" size="small" />
                    {aiResult.panels_count == null && aiResult.rows != null && <Chip label={`${aiResult.rows} 行`} variant="outlined" size="small" />}
                    {aiResult.latency_ms != null && <Chip label={`${(aiResult.latency_ms / 1000).toFixed(1)}s`} variant="outlined" size="small" />}
                  </Box>
                  {aiResult.stages && (
                    <Box sx={{ mb: 2 }}>
                      {aiResult.stages.map((s: any) => (
                        <Typography key={s.stage} variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          {s.stage}: {s.panels ? `${s.panels}图表` : s.actions ? `${s.actions}处修正` : s.checks ? `${s.checks}项通过` : s.error || "完成"}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </>
              )}
              <Button variant="contained" onClick={() => { setAiDialogOpen(false); setAiResult(null); setAiFile(null); nav("/bi"); }}
                startIcon={<Dashboard />} sx={{ bgcolor: "#6366F1", borderRadius: 1.5 }}>
                保存到我的看板
              </Button>
            </Box>
          ) : (
            <Box>
              {/* Mode Tabs */}
              <ToggleButtonGroup size="small" value={aiMode} exclusive onChange={(_, v) => v && setAiMode(v)} sx={{ mb: 2, width: "100%" }}>
                <ToggleButton value="upload" sx={{ flex: 1, fontSize: 12 }}>📁 上传文件生成</ToggleButton>
                <ToggleButton value="batch" sx={{ flex: 1, fontSize: 12 }}>📦 批量行业模板</ToggleButton>
              </ToggleButtonGroup>

              {aiMode === "upload" ? (
                <>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    上传 Excel/CSV 数据文件，AI 自动分析并生成看板布局。
                  </Typography>
                  <label style={{ display: "block", cursor: "pointer" }}>
                    <input type="file" hidden accept=".xlsx,.xls,.xlsm,.csv" onChange={e => { setAiFile(e.target.files?.[0] || null); setAiError(""); }} />
                    <Box sx={{ border: `2px dashed ${aiFile ? "#8B5CF6" : "divider"}`, borderRadius: 2, p: 3, textAlign: "center", bgcolor: aiFile ? "rgba(139,92,246,0.04)" : "transparent", "&:hover": { borderColor: "#8B5CF6", bgcolor: "rgba(139,92,246,0.04)" } }}>
                      <CloudUpload sx={{ fontSize: 32, color: aiFile ? "#8B5CF6" : "text.disabled", mb: 0.5 }} />
                      <Typography variant="body2" fontWeight={600} color={aiFile ? "#8B5CF6" : "text.primary"}>{aiFile ? aiFile.name : "点击选择数据文件"}</Typography>
                      <Typography variant="caption" color="text.disabled">支持 .xlsx .xls .csv</Typography>
                    </Box>
                  </label>
                </>
              ) : (
                <Box>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    选择行业领域，AI 批量生成 3-5 套完整业务看板。
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {["电商", "财务", "生产", "通用"].map(d => (
                      <Button key={d} variant="outlined" size="small"
                        onClick={() => handleBatchGenerate(d)}
                        disabled={aiGenerating}
                        sx={{ borderRadius: 1.5, fontSize: 12, textTransform: "none" }}>
                        📊 {d}
                      </Button>
                    ))}
                  </Box>
                </Box>
              )}

              {aiGenerating && aiMode === "upload" && (
                <Box sx={{ mt: 2 }}>
                  <LinearProgress variant="determinate" value={aiProgress} sx={{ borderRadius: 1, height: 6 }} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, textAlign: "center" }}>
                    {aiMsg || `AI 生成中... ${aiProgress}%`}
                  </Typography>
                </Box>
              )}
              {aiError && <Alert severity="error" sx={{ mt: 1.5, fontSize: 13 }}>{aiError}</Alert>}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
          {aiResult ? (
            <Button onClick={() => { setAiDialogOpen(false); setAiResult(null); setAiFile(null); }}>关闭</Button>
          ) : (
            <>
              <Button onClick={() => { setAiDialogOpen(false); setAiFile(null); }} disabled={aiGenerating}>取消</Button>
              {aiMode === "upload" && (
                <Button onClick={handleAiGenerate} variant="contained" disabled={!aiFile || aiGenerating}
                  startIcon={aiGenerating ? <CircularProgress size={14} /> : <AutoAwesome />}
                  sx={{ bgcolor: "#8B5CF6", borderRadius: 1.5, "&:hover": { bgcolor: "#7C3AED" } }}>
                  {aiGenerating ? "AI 生成中..." : "开始生成"}
                </Button>
              )}
            </>
          )}
        </DialogActions>
      </Dialog>
      {/* ====== 重命名弹窗 ====== */}
      <Dialog open={!!renameDialog} onClose={() => setRenameDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16 }}>重命名看板</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleRename(); }}
            sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            placeholder="输入新的看板名称"
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRenameDialog(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            onClick={handleRename}
            variant="contained"
            disabled={renaming || !renameValue.trim()}
            startIcon={renaming ? <CircularProgress size={14} color="inherit" /> : null}
            sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}
          >
            {renaming ? "保存中..." : "保存"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ====== 删除确认弹窗 ====== */}
      <Dialog open={!!deleteDialog} onClose={() => setDeleteDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16 }}>确认删除</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            确定要删除看板「<strong>{deleteDialog?.name}</strong>」吗？此操作不可撤销，看板数据将被永久移除。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteDialog(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            onClick={handleDelete}
            variant="contained"
            color="error"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <Delete />}
            sx={{ borderRadius: 2, textTransform: "none" }}
          >
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ====== 共享权限弹窗 ====== */}
      <Dialog open={!!shareDialog} onClose={() => setShareDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 1 }}>
          <Share sx={{ fontSize: 20, color: "#6366F1" }} />
          共享设置 — {shareDialog?.name}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            选择需要共享的团队成员，并设置权限级别。不勾选任何成员则仅自己可见。
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ mb: 1, display: "block" }}>
            点击权限标签可循环切换：可查看 → 可编辑 → 可管理 → 移除
          </Typography>
          <Divider sx={{ mb: 1.5 }} />
          <List dense sx={{ maxHeight: 280, overflow: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
            {allUsers.length === 0 ? (
              <ListItem><ListItemText primary="暂无其他用户" /></ListItem>
            ) : allUsers.map(u => {
              const perm = sharePerms[u.id];
              const permLabel = perm === "view" ? "可查看" : perm === "edit" ? "可编辑" : perm === "manage" ? "可管理" : "";
              const permColor = perm === "manage" ? "error" : perm === "edit" ? "warning" : "success";
              return (
                <ListItem key={u.id} dense
                  secondaryAction={
                    perm ? (
                      <Chip
                        label={permLabel}
                        size="small"
                        color={permColor as any}
                        onClick={() => toggleUserPerm(u.id)}
                        sx={{ cursor: "pointer", fontSize: 11, height: 22 }}
                      />
                    ) : (
                      <Chip
                        label="+ 添加"
                        size="small"
                        variant="outlined"
                        onClick={() => toggleUserPerm(u.id)}
                        sx={{ cursor: "pointer", fontSize: 11, height: 22, color: "#6B7280" }}
                      />
                    )
                  }>
                  <ListItemAvatar>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: perm ? "#6366F1" : "grey.400" }}>
                      {u.username[0]?.toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText
                    primary={u.username}
                    primaryTypographyProps={{ fontSize: 13, fontWeight: perm ? 600 : 400 }}
                  />
                </ListItem>
              );
            })}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setShareDialog(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            onClick={saveSharePerms}
            variant="contained"
            disabled={shareLoading}
            startIcon={shareLoading ? <CircularProgress size={14} color="inherit" /> : null}
            sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}
          >
            {shareLoading ? "保存中..." : "保存权限"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
