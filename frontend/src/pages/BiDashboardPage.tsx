/** 明策BI — ECharts 自研引擎，模板卡片 + 数据从 PostgreSQL 实时查询 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Box, Typography, Button, CircularProgress,
  Card, CardContent, IconButton, TextField, Avatar, Chip,
  Snackbar, Alert, Dialog, DialogTitle, DialogContent,
  DialogActions, List, ListItem, ListItemAvatar, ListItemText,
  Divider, Menu, MenuItem, Radio, RadioGroup, FormControlLabel,
} from "@mui/material";
import {
  Search, Dashboard, Share, MoreHoriz, Visibility, OpenInNew, TrendingUp,
  DriveFileRenameOutline, DeleteOutline, Groups, NotificationsActive, Schedule,
} from "@mui/icons-material";
import { useNavigate, useSearchParams } from "react-router-dom";
import client from "../api/client";
import { useAuth } from "../hooks/useAuth";
import DataSources from "../features/bi-dashboard/DataSources";
import SqlQueryPanel from "../features/bi-dashboard/SqlQueryPanel";
import DatasetPanel from "../features/bi-dashboard/DatasetPanel";
import TestDataPanel from "../features/bi-dashboard/TestDataPanel";
import TeamBoardsPanel from "../features/bi-dashboard/TeamBoardsPanel";
import TeamShareDialog from "../features/bi-dashboard/TeamShareDialog";
import AlertRulesDialog from "../features/bi-dashboard/AlertRulesDialog";
import ReportSubscriptionsDialog from "../features/bi-dashboard/ReportSubscriptionsDialog";
import BiSideNav, { BI_NAV_ITEMS, type SideNavItem } from "../features/bi-dashboard/BiSideNav";
import BoardThumb from "../features/bi-dashboard/BoardThumb";
import type { DashboardDoc } from "../features/components/types";

/** 与「项目」页同一套视觉令牌，保证两页看起来是一家人 */
const CARD_BORDER = "#E8E8ED";
const INK = "#1D1D1F";
const MUTED = "#86868B";

interface DashboardMeta {
  id: number; name: string; panels: any[];
  table_map?: Record<string, string>;
  created_at: string; updated_at: string;
  owner_id?: number | null;
}

/** 组件库拼装出来的成品页（存 bi_canvas.doc） */
interface PageBoardMeta {
  id: number; name: string; code?: string | null;
  views: number; items: number; charts: number;
  updated_at: string; owner_id?: number | null; can_manage?: boolean;
  /** 已分享到我的团队（协同看板） */
  team_shared?: boolean; team_editors?: number;
}

/** 「我的看板」里的一张卡片 —— 两种来源统一成同一种形状 */
interface BoardCardMeta {
  key: string;
  id: number;
  kind: "engine" | "page";
  name: string;
  charts: number;
  updatedAt: string;
  canManage: boolean;
  teamShared?: boolean;
}


export default function BiDashboardPage() {
  const nav = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  /** 视图可深链（/bi?view=templates），从「项目」页点菜单也能落回同一个视图 */
  const [activeNav, setActiveNav] = useState(() => searchParams.get("view") || "dashboards");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [myDashboards, setMyDashboards] = useState<DashboardMeta[]>([]);
  const [pageBoards, setPageBoards] = useState<PageBoardMeta[]>([]);
  /** page 类型看板的 doc —— 只为缩略图，取不到就显示空图 */
  const [boardDocs, setBoardDocs] = useState<Record<number, DashboardDoc>>({});
  /** 卡片右上角 ⋯ 菜单 */
  const [boardMenu, setBoardMenu] = useState<{ el: HTMLElement; board: BoardCardMeta } | null>(null);
  /** 分享到我的团队（协同看板）弹窗 + 团队页刷新令牌 */
  const [teamShareBoard, setTeamShareBoard] = useState<{ id: number; name: string } | null>(null);
  /** 指标告警规则（按看板配置） */
  const [alertBoard, setAlertBoard] = useState<{ id: number; name: string } | null>(null);
  /** 定时报表订阅（按看板配置） */
  const [reportBoard, setReportBoard] = useState<{ id: number; name: string } | null>(null);
  const [teamReload, setTeamReload] = useState(0);
  const [marketTemplates, setMarketTemplates] = useState<any[]>([]);
  const [templateCategory, setTemplateCategory] = useState("");
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; msg: string; severity: "success" | "error" }>({
    open: false, msg: "", severity: "success",
  });

  // ====== 看板操作状态（两种来源共用同一套弹窗） ======
  const [renameDialog, setRenameDialog] = useState<BoardCardMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<BoardCardMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [shareDialog, setShareDialog] = useState<DashboardMeta | null>(null);
  /** 分享到模板库（看板模板）：名称 / 说明 / 分类 / 可见范围 */
  const [tplDialog, setTplDialog] = useState<BoardCardMeta | null>(null);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplCategory, setTplCategory] = useState("通用");
  const [tplPublic, setTplPublic] = useState(true);
  const [tplMembers, setTplMembers] = useState<number[]>([]);
  const [tplUsers, setTplUsers] = useState<{ id: number; username: string }[]>([]);
  const [tplBusy, setTplBusy] = useState(false);

  const [allUsers, setAllUsers] = useState<{ id: number; username: string }[]>([]);
  const [sharePerms, setSharePerms] = useState<Record<number, string>>({}); // userId -> "view"|"edit"|"manage"
  const [shareLoading, setShareLoading] = useState(false);

  const refreshDashboards = useCallback(async () => {
    const my = await client.get("/bi/engine/dashboards");
    setMyDashboards(my.data?.dashboards || []);
  }, []);

  const refreshPageBoards = useCallback(async () => {
    const res = await client.get("/bi/dashboards?published_only=1");
    setPageBoards(res.data?.dashboards || []);
  }, []);

  /** 缩略图要每块看板的版面：分批取（每批 8 个，看板多也不瞬发一串请求），失败留空图、不阻塞列表 */
  const loadBoardDocs = useCallback(async (list: PageBoardMeta[]) => {
    const BATCH = 8;
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      const pairs = await Promise.all(batch.map(async (p) => {
        try {
          const detail = await client.get(`/bi/dashboards/${p.id}`);
          return [p.id, detail.data?.doc as DashboardDoc | undefined] as const;
        } catch {
          return [p.id, undefined] as const;
        }
      }));
      const filled: Record<number, DashboardDoc> = {};
      pairs.forEach(([id, doc]) => { if (doc) filled[id] = doc; });
      // 逐批填充，缩略图边加载边出现
      setBoardDocs((prev) => ({ ...prev, ...filled }));
    }
  }, []);

  /** 两种看板合成一张列表 —— 不再按来源分组，都是「我的看板」 */
  const boards = useMemo<BoardCardMeta[]>(() => {
    const isAdmin = user?.role === "admin";
    const engine: BoardCardMeta[] = myDashboards.map(d => ({
      key: `engine-${d.id}`,
      id: d.id,
      kind: "engine",
      name: d.name,
      charts: d.panels?.length || 0,
      updatedAt: d.updated_at || "",
      canManage: d.owner_id === user?.id,
    }));
    const pages: BoardCardMeta[] = pageBoards.map(p => ({
      key: `page-${p.id}`,
      id: p.id,
      kind: "page",
      name: p.name,
      charts: p.charts || 0,
      updatedAt: p.updated_at || "",
      canManage: p.can_manage ?? isAdmin,
      teamShared: !!p.team_shared,
    }));
    return [...engine, ...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [myDashboards, pageBoards, user]);

  const openBoard = (b: BoardCardMeta) =>
    nav(b.kind === "page" ? `/bi/dashboards/${b.id}` : `/bi/view/${b.id}`);

  const editBoard = (b: BoardCardMeta) => nav(`/bi/canvas?doc=${b.id}`);

  /** 业务入口权限：管理员直通，其余看角色/部门下发的权限码 */
  const navCan = useCallback(
    (perm?: string) => {
      if (!perm) return true;
      if (user?.role === "admin" || user?.role === "super_admin") return true;
      return (user?.effective_permissions || []).includes(perm);
    },
    [user],
  );
  const navItems = useMemo(() => BI_NAV_ITEMS.filter((item) => navCan(item.perm)), [navCan]);

  /** 视图切换：同时把视图写进 ?view=，刷新 / 回退都还在这一屏 */
  const selectView = useCallback((key: string) => {
    setActiveNav(key);
    const next = new URLSearchParams(searchParams);
    next.set("view", key);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleNav = (item: SideNavItem) => {
    if (item.perm && !navCan(item.perm)) return;
    if (item.path) { nav(item.path); return; }
    selectView(item.key);
  };

  /** 从「项目」页点菜单回来时，URL 变了要跟上；没权限的入口回落到「我的看板」 */
  useEffect(() => {
    const next = searchParams.get("view");
    if (!next) return;
    const item = BI_NAV_ITEMS.find((i) => i.key === next);
    if (item?.perm && !navCan(item.perm)) {
      // 权限还没拉回来时不能裁 URL：冷启动直链（/bi?view=datasource）会先被写成「我的看板」，
      // 刷新也回不到原来的入口
      if (authLoading || !user) return;
      setActiveNav("dashboards");
      const fixed = new URLSearchParams(searchParams);
      fixed.delete("view");
      setSearchParams(fixed, { replace: true });
      return;
    }
    setActiveNav((prev) => (prev === next ? prev : next));
  }, [searchParams, navCan, authLoading, user]);

  // 重命名
  const handleRename = async () => {
    if (!renameDialog || !renameValue.trim()) return;
    setRenaming(true);
    try {
      if (renameDialog.kind === "engine") {
        const src = myDashboards.find(d => d.id === renameDialog.id);
        await client.put(`/bi/engine/dashboards/${renameDialog.id}`, {
          name: renameValue.trim(),
          panels: src?.panels || [],
        });
        await refreshDashboards();
      } else {
        await client.patch(`/bi/dashboards/${renameDialog.id}`, { name: renameValue.trim() });
        await refreshPageBoards();
      }
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
      if (deleteDialog.kind === "engine") {
        await client.delete(`/bi/engine/dashboards/${deleteDialog.id}`);
        await refreshDashboards();
      } else {
        await client.delete(`/bi/dashboards/${deleteDialog.id}`);
        await refreshPageBoards();
      }
      setSnackbar({ open: true, msg: `已删除「${deleteDialog.name}」`, severity: "success" });
      setDeleteDialog(null);
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "删除失败", severity: "error" });
    } finally {
      setDeleting(false);
    }
  };

  // 打开共享弹窗
  const openShareDialog = async (board: BoardCardMeta) => {
    const dash = myDashboards.find(d => d.id === board.id);
    if (!dash) return;
    setShareDialog(dash);
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

  /** 打开「分享到模板库」：默认所有人可见，也可只给指定成员 */
  const openTemplateShare = async (board: BoardCardMeta) => {
    setTplDialog(board);
    setTplName(board.name);
    setTplDesc("");
    setTplCategory("通用");
    setTplPublic(true);
    setTplMembers([]);
    try {
      const res = await client.get("/bi/team/users");
      setTplUsers(res.data || []);
    } catch {
      setTplUsers([]);
    }
  };

  const submitTemplateShare = async () => {
    if (!tplDialog) return;
    setTplBusy(true);
    try {
      const res = await client.post("/bi/engine/market/share", {
        board_id: tplDialog.id,
        name: tplName.trim() || tplDialog.name,
        description: tplDesc.trim(),
        category: tplCategory,
        is_public: tplPublic,
        user_ids: tplPublic ? [] : tplMembers,
      });
      const market = await client.get("/bi/engine/market");
      setMarketTemplates(market.data?.templates || []);
      setSnackbar({ open: true, msg: res.data?.message || "已分享到模板库", severity: "success" });
      setTplDialog(null);
    } catch (e: any) {
      setSnackbar({
        open: true,
        msg: e?.response?.data?.detail || "分享失败，请重试",
        severity: "error",
      });
    } finally {
      setTplBusy(false);
    }
  };

  // 克隆模板到"我的看板"
  const cloneTemplate = async (tpl: any) => {
    if (cloningId !== null) return; // 防重复点击
    setCloningId(tpl.id);
    try {
      const res = await client.post(`/bi/engine/market/${tpl.id}/clone`);
      const newId = res.data?.id;
      const kind = res.data?.kind;
      // 刷新"我的看板"列表
      if (kind === "page") await refreshPageBoards();
      else {
        const my = await client.get("/bi/engine/dashboards");
        setMyDashboards(my.data?.dashboards || []);
      }
      // 刷新模板列表（downloads +1）
      const market = await client.get("/bi/engine/market");
      setMarketTemplates(market.data?.templates || []);
      setSnackbar({ open: true, msg: res.data?.message || "模板克隆成功", severity: "success" });
      // 跳转到新看板
      if (newId) {
        nav(kind === "page" ? `/bi/dashboards/${newId}` : `/bi/view/${newId}`);
      }
    } catch (e: any) {
      setSnackbar({ open: true, msg: e?.response?.data?.detail || "克隆失败，请重试", severity: "error" });
    } finally {
      setCloningId(null);
    }
  };


  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [my, pages, market] = await Promise.all([
          client.get("/bi/engine/dashboards"),
          client.get("/bi/dashboards?published_only=1"),
          client.get("/bi/engine/market"),
        ]);
        const pageList = (pages.data?.dashboards || []) as PageBoardMeta[];
        setMyDashboards(my.data?.dashboards || []);
        setPageBoards(pageList);
        setMarketTemplates(market.data?.templates || []);
        setLoading(false);
        // 先出卡片、后填缩略图，列表不等 doc
        void loadBoardDocs(pageList);
      } catch (e: any) {
        console.error("加载BI数据失败:", e);
        setLoading(false);
      }
    };
    load();
  }, [loadBoardDocs]);

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return kw ? boards.filter(b => b.name.toLowerCase().includes(kw)) : boards;
  }, [boards, search]);

  const renderContent = () => {
    switch (activeNav) {
      case "team":
        return (
          <TeamBoardsPanel
            refreshKey={teamReload}
            onOpenShare={(board) => setTeamShareBoard(board)}
          />
        );
      case "datasets":
        return <DatasetPanel />;
      case "test-data":
      case "dataset-preview":
        return <TestDataPanel />;
      case "datasource":
        return <DataSources />;
      case "sql":
        return <SqlQueryPanel />;
      case "templates":
        return (
          <Box sx={{ p: 4 }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>模板库</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              预置电商行业数据模板 · 内置完整实战数据 · 点击一键生成明策BI看板
            </Typography>

            {/* FineBI风格分类过滤 */}
            <Box sx={{ display: "flex", gap: 1, mb: 3, flexWrap: "wrap" }}>
              {["全部","拼多多","天猫","财务","产品部","通用"].map(cat => (
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
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1, gap: 1 }}>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" fontWeight={700} fontSize={15} noWrap title={tpl.name}>
                            {tpl.name}
                          </Typography>
                          <Box sx={{ display: "flex", gap: 0.5, mt: 0.5 }}>
                            {tpl.kind === "page" && (
                              <Chip label="看板模板" size="small"
                                sx={{ fontSize: 9.5, height: 18, bgcolor: "rgba(79,70,229,0.10)", color: "#4F46E5", fontWeight: 600 }} />
                            )}
                            {tpl.dataset_count > 0 && (
                              <Chip label={`${tpl.dataset_count} 个数据集`} size="small"
                                sx={{ fontSize: 9.5, height: 18, bgcolor: "rgba(37,99,235,0.08)", color: "#2563EB" }} />
                            )}
                          </Box>
                        </Box>
                        <Chip label={tpl.category} size="small" sx={{ fontSize: 10, height: 20, bgcolor: "#F3F4F6", flexShrink: 0 }} />
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12, lineHeight: 1.5, minHeight: 36 }}>
                        {tpl.description || " "}
                      </Typography>
                      {/* 面板 / 卡片预览 */}
                      <Box sx={{ display: "flex", gap: 0.5, mb: 2, flexWrap: "wrap" }}>
                        {(tpl.panel_titles || (tpl.panels || []).map((p: any) => p.title) || []).slice(0, 5).map((title: string, i: number) => (
                          <Chip key={i} label={title} size="small" variant="outlined"
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
          <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", bgcolor: "#F5F5F7" }}>
            <Box sx={{ p: 3, minHeight: "100%", display: "flex", flexDirection: "column" }}>
              {/* 头标卡：保留在内容区最上方 */}
              <Box sx={{
                flexShrink: 0, mb: 2, p: 4, borderRadius: "20px",
                background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 40%, #A855F7 100%)",
                color: "white", position: "relative", overflow: "hidden",
              }}>
                <Box sx={{ position: "absolute", top: -40, right: -20, opacity: 0.1, fontSize: 180, pointerEvents: "none" }}>📊</Box>
                <Typography variant="h4" fontWeight={800} gutterBottom sx={{ position: "relative", zIndex: 1 }}>明策BI</Typography>
                <Typography variant="body1" sx={{ opacity: 0.9, maxWidth: 600, position: "relative", zIndex: 1 }}>
                  自研先进的BI引擎 · 垂直电商行业 · AI 驱动分析。从数据入库到智能洞察，一站式自研 BI。
                </Typography>
                <Box sx={{ display: "flex", gap: 1.5, mt: 3, position: "relative", zIndex: 1 }}>
                  <Button variant="contained" startIcon={<TrendingUp />} onClick={() => selectView("templates")}
                    sx={{ bgcolor: "rgba(255,255,255,0.2)", "&:hover": { bgcolor: "rgba(255,255,255,0.35)" }, textTransform: "none", fontWeight: 600, borderRadius: 2 }}>
                    浏览模板
                  </Button>
                </Box>
              </Box>

              <Box sx={{
                flex: "1 0 auto", display: "flex", flexDirection: "column",
                bgcolor: "#fff", borderRadius: "20px", px: 4, py: 3.5,
                boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
              }}>
                {/* 标题栏：与「项目」页同构 —— 大标题 + 右侧搜索 */}
                <Box sx={{ display: "flex", alignItems: "center", minHeight: 44, mb: 3.5, gap: 1 }}>
                  <Typography sx={{ fontSize: 27, fontWeight: 600, letterSpacing: "-0.02em", color: INK }}>
                    我的看板
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  {searchOpen ? (
                    <TextField
                      autoFocus size="small" placeholder="搜索看板" value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") { setSearch(""); setSearchOpen(false); } }}
                      onBlur={() => { if (!search) setSearchOpen(false); }}
                      sx={{
                        width: 220,
                        "& .MuiOutlinedInput-root": {
                          borderRadius: 2, fontSize: 13,
                          "& fieldset": { borderColor: CARD_BORDER },
                        },
                      }}
                    />
                  ) : (
                    <IconButton onClick={() => setSearchOpen(true)} sx={{ color: MUTED, "&:hover": { color: INK } }}>
                      <Search sx={{ fontSize: 21 }} />
                    </IconButton>
                  )}
                </Box>

                {loading ? (
                  <Box sx={{ py: 10, display: "flex", justifyContent: "center" }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : filtered.length === 0 ? (
                  <Box sx={{ py: 10, textAlign: "center" }}>
                    <Dashboard sx={{ fontSize: 34, color: "#DCDCE1" }} />
                    <Typography sx={{ mt: 1, fontSize: 14, fontWeight: 500, color: INK }}>
                      {search ? "没有匹配的看板" : "暂无看板"}
                    </Typography>
                    {!search && (
                      <Typography sx={{ mt: 0.5, fontSize: 12.5, color: MUTED }}>
                        在左侧「模板库」挑一个模板开始
                      </Typography>
                    )}
                  </Box>
                ) : (
                  <Box sx={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fill, 208px)",
                    columnGap: "40px", rowGap: "32px",
                  }}>
                    {filtered.map((b) => (
                      <Box key={b.key} sx={{ "&:hover .more-btn": { opacity: 1 } }}>
                        <Box
                          onClick={() => openBoard(b)}
                          sx={{
                            borderRadius: "12px", border: `1px solid ${CARD_BORDER}`, bgcolor: "#fff",
                            aspectRatio: "16 / 10", position: "relative", overflow: "hidden",
                            cursor: "pointer", transition: "border-color .16s ease, box-shadow .16s ease",
                            "&:hover": { borderColor: "#C9C9D2", boxShadow: "0 4px 16px rgba(15,23,42,0.07)" },
                          }}>
                          <BoardThumb doc={b.kind === "page" ? boardDocs[b.id] : undefined} />
                          {b.teamShared && (
                            <Chip label="协同" size="small"
                              sx={{
                                position: "absolute", top: 6, left: 6, height: 18, fontSize: 10,
                                fontWeight: 700, color: "#fff", bgcolor: "rgba(16,185,129,0.92)",
                                "& .MuiChip-label": { px: 0.75 },
                              }} />
                          )}
                          <IconButton
                            className="more-btn" size="small"
                            onClick={(e) => { e.stopPropagation(); setBoardMenu({ el: e.currentTarget, board: b }); }}
                            sx={{
                              position: "absolute", top: 6, right: 6, width: 24, height: 24,
                              bgcolor: "rgba(255,255,255,0.92)", color: MUTED, opacity: 0,
                              transition: "opacity .15s ease",
                              "&:hover": { bgcolor: "#fff", color: INK },
                              "& .MuiSvgIcon-root": { fontSize: 16 },
                            }}>
                            <MoreHoriz />
                          </IconButton>
                        </Box>
                        <Typography
                          noWrap title={b.name}
                          onClick={() => openBoard(b)}
                          sx={{
                            mt: 1.5, textAlign: "center", fontSize: 14, color: INK, fontWeight: 500,
                            cursor: "pointer", px: 0.5,
                          }}>
                          {b.name}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          </Box>
        );
    }
  };

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", overflow: "hidden" }}>
      {/* 左侧边栏 */}
      <BiSideNav
        items={navItems}
        activeKey={activeNav}
        onSelect={handleNav}
        count={boards.length}
        countLabel="我的看板"
      />

      {/* 主内容区 */}
      <Box sx={{ flex: 1, overflow: "auto" }}>{renderContent()}</Box>

      {/* 卡片 ⋯ 操作菜单 */}
      <Menu
        anchorEl={boardMenu?.el ?? null} open={!!boardMenu} onClose={() => setBoardMenu(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 148, border: `1px solid ${CARD_BORDER}` } } }}
      >
        <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
          onClick={() => { const b = boardMenu?.board; setBoardMenu(null); if (b) openBoard(b); }}>
          <Visibility sx={{ fontSize: 16, color: MUTED }} />预览
        </MenuItem>
        {boardMenu?.board.kind === "page" && navCan("bi:nav:editor") && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => { const b = boardMenu?.board; setBoardMenu(null); if (b) editBoard(b); }}>
            <OpenInNew sx={{ fontSize: 16, color: MUTED }} />编辑
          </MenuItem>
        )}
        {boardMenu?.board.kind === "engine" && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => { const b = boardMenu?.board; setBoardMenu(null); if (b) void openShareDialog(b); }}>
            <Share sx={{ fontSize: 16, color: MUTED }} />共享
          </MenuItem>
        )}
        {boardMenu?.board.kind === "page" && boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => { const b = boardMenu?.board; setBoardMenu(null); if (b) void openTemplateShare(b); }}>
            <Share sx={{ fontSize: 16, color: MUTED }} />分享到模板库
          </MenuItem>
        )}
        {boardMenu?.board.kind === "page" && boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => {
              const b = boardMenu?.board;
              setBoardMenu(null);
              if (b) setTeamShareBoard({ id: b.id, name: b.name });
            }}>
            <Groups sx={{ fontSize: 16, color: MUTED }} />分享到我的团队
          </MenuItem>
        )}
        {boardMenu?.board.kind === "page" && boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => {
              const b = boardMenu?.board;
              setBoardMenu(null);
              if (b) setAlertBoard({ id: b.id, name: b.name });
            }}>
            <NotificationsActive sx={{ fontSize: 16, color: MUTED }} />指标告警
          </MenuItem>
        )}
        {boardMenu?.board.kind === "page" && boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => {
              const b = boardMenu?.board;
              setBoardMenu(null);
              if (b) setReportBoard({ id: b.id, name: b.name });
            }}>
            <Schedule sx={{ fontSize: 16, color: MUTED }} />定时报表
          </MenuItem>
        )}
        {boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
            onClick={() => {
              const b = boardMenu?.board; if (!b) return;
              setRenameDialog(b); setRenameValue(b.name); setBoardMenu(null);
            }}>
            <DriveFileRenameOutline sx={{ fontSize: 16, color: MUTED }} />重命名
          </MenuItem>
        )}
        {boardMenu?.board.canManage && (
          <MenuItem dense sx={{ fontSize: 13, gap: 1.25, color: "error.main" }}
            onClick={() => { const b = boardMenu?.board; setBoardMenu(null); if (b) setDeleteDialog(b); }}>
            <DeleteOutline sx={{ fontSize: 16 }} />删除
          </MenuItem>
        )}
      </Menu>

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
            startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteOutline />}
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

      {/* ====== 分享到模板库（看板模板 + 数据副本） ====== */}
      <Dialog open={!!tplDialog} onClose={() => setTplDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 1 }}>
          <Share sx={{ fontSize: 20, color: "#6366F1" }} />
          分享到模板库
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: "text.secondary", mb: 2 }}>
            看板会复制一份到模板库，它用到的数据集也会复制到「测试数据集」页；别人用这个模板生成的看板直接用这份数据。
          </Typography>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <TextField size="small" fullWidth label="模板名称" value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }} />
            <TextField size="small" fullWidth label="模板说明" value={tplDesc}
              onChange={(e) => setTplDesc(e.target.value)}
              multiline minRows={2}
              placeholder="这个看板解决什么问题、适合谁用"
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }} />
            <TextField select size="small" fullWidth label="分类" value={tplCategory}
              onChange={(e) => setTplCategory(e.target.value)}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}>
              {["通用", "拼多多", "天猫", "财务", "产品部"].map((cat) => (
                <MenuItem key={cat} value={cat} sx={{ fontSize: 13 }}>{cat}</MenuItem>
              ))}
            </TextField>
            <Box>
              <Typography sx={{ fontSize: 12, color: "#64748B", mb: 0.5 }}>谁可以看</Typography>
              <RadioGroup row value={tplPublic ? "all" : "members"}
                onChange={(e) => setTplPublic(e.target.value === "all")}>
                <FormControlLabel value="all" control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>所有人可见</Typography>} />
                <FormControlLabel value="members" control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: 12.5 }}>指定成员</Typography>} />
              </RadioGroup>
            </Box>
            {!tplPublic && (
              <TextField select size="small" fullWidth label="选择成员" value={tplMembers}
                onChange={(e) => {
                  const value = e.target.value;
                  setTplMembers(typeof value === "string" ? value.split(",").map(Number) : value as number[]);
                }}
                SelectProps={{
                  multiple: true,
                  renderValue: (selected) => (selected as number[])
                    .map((id) => tplUsers.find((u) => u.id === id)?.username || `#${id}`)
                    .join("、"),
                }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}>
                {tplUsers.filter((u) => u.id !== user?.id).map((u) => (
                  <MenuItem key={u.id} value={u.id} sx={{ fontSize: 13 }}>{u.username}</MenuItem>
                ))}
              </TextField>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setTplDialog(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button
            onClick={submitTemplateShare}
            variant="contained"
            disabled={tplBusy || !tplName.trim() || (!tplPublic && tplMembers.length === 0)}
            startIcon={tplBusy ? <CircularProgress size={14} color="inherit" /> : null}
            sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}
          >
            {tplBusy ? "分享中..." : "分享"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ====== 分享到我的团队（协同看板，不复制） ====== */}
      <TeamShareDialog
        board={teamShareBoard}
        onClose={() => setTeamShareBoard(null)}
        onChanged={() => { setTeamReload((n) => n + 1); void refreshPageBoards(); }}
      />

      {/* ====== 指标告警（阈值 / 波动 → 站内 + Webhook） ====== */}
      <AlertRulesDialog board={alertBoard} onClose={() => setAlertBoard(null)} />

      {/* ====== 定时报表（HTML / Excel → 站内 + Webhook） ====== */}
      <ReportSubscriptionsDialog board={reportBoard} onClose={() => setReportBoard(null)} />
    </Box>
  );
}
