/** 顶部导航栏 —— 明策BI（Apple 风极简：白底、细分隔线、胶囊导航） */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Toolbar,
  Box,
  Typography,
  Button,
  IconButton,
  Avatar,
  Menu,
  MenuItem,
  Divider,
  Tooltip,
  Stack,
  Badge,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import {
  AdminPanelSettings as AdminPanelSettingsIcon,
  Dashboard as DashboardIcon,
  History as HistoryIcon,
  SmartToy as SmartToyIcon,
  LogoDev as LogoIcon,
  Logout as LogoutIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  NotificationsNone as BellIcon,
  DoneAll as DoneAllIcon,
  HowToReg as HowToRegIcon,
} from "@mui/icons-material";
import { useAuth } from "../../features/auth/useAuth";
import { useThemeMode } from "./ThemeContext";
import client from "../../api/client";

interface AlertEvent {
  id: number;
  rule_name: string;
  dashboard_name: string;
  message: string;
  status: "unread" | "read";
  link?: string;
  created_at: string;
}

interface PendingRegistration {
  id: number;
  username: string;
  email: string;
  department_name: string;
  created_at: string;
}

const NAV: { label: string; path: string; icon: ReactNode; perm?: string }[] = [
  { label: "我的看板", path: "/bi", icon: <DashboardIcon sx={{ fontSize: 16 }} /> },
  { label: "操作审计", path: "/bi/audit", icon: <HistoryIcon sx={{ fontSize: 16 }} /> },
  { label: "MCP 授权", path: "/bi/mcp", icon: <SmartToyIcon sx={{ fontSize: 16 }} />, perm: "bi:mcp:use" },
];

export default function TopBar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user, logout, hasPerm } = useAuth();
  const { mode, toggle } = useThemeMode();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [alertAnchor, setAlertAnchor] = useState<null | HTMLElement>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [alertLoading, setAlertLoading] = useState(false);
  const alertInFlight = useRef(false);
  const alertFailures = useRef(0);
  const alertNextAllowed = useRef(0);
  const [registrations, setRegistrations] = useState<PendingRegistration[]>([]);
  const [regPending, setRegPending] = useState(0);
  const [regActing, setRegActing] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PendingRegistration | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const regInFlight = useRef(false);

  /** 管理后台入口：管理员、被授予任一后台分区权限、或部门负责人（审批走后台「注册审批」）.
   *  业务入口权限（bi:nav:*）不算后台权限，避免只有 SQL/数据集入口的人看到一个进不去的后台。 */
  const CONSOLE_PERMS = [
    "bi:overview", "bi:user:manage", "bi:user:approve", "bi:role:manage",
    "bi:model:manage", "bi:error:view", "bi:ops:manage",
  ];
  const canAdmin =
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    (user?.effective_permissions || []).some((code) => CONSOLE_PERMS.includes(code)) ||
    (user?.led_department_ids?.length || 0) > 0;

  /** 注册审批：管理员 / 被授予「注册审批」权限 / 部门负责人（在通知里直接处理） */
  const canApprove =
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    (user?.effective_permissions || []).includes("bi:user:approve") ||
    (user?.led_department_ids?.length || 0) > 0;

  const loadAlerts = useCallback(async () => {
    if (!user) return;
    // 后台标签页不轮询；focus 与定时器不叠加；失败后退避，避免后端紧张时继续加压
    if (document.hidden || alertInFlight.current) return;
    if (Date.now() < alertNextAllowed.current) return;
    alertInFlight.current = true;
    setAlertLoading(true);
    try {
      const res = await client.get("/bi/alerts/events", {
        params: { limit: 20 },
        timeout: 12000,
      });
      setAlerts(res.data?.events || []);
      setUnread(Number(res.data?.unread || 0));
      alertFailures.current = 0;
      alertNextAllowed.current = 0;
    } catch {
      // 未登录 / 接口暂不可用时静默：顶栏不因此报错
      alertFailures.current += 1;
      const backoff = Math.min(60000 * 2 ** (alertFailures.current - 1), 600000);
      alertNextAllowed.current = Date.now() + backoff;
    } finally {
      alertInFlight.current = false;
      setAlertLoading(false);
    }
  }, [user]);

  const loadRegistrations = useCallback(async () => {
    if (!canApprove || regInFlight.current) return;
    regInFlight.current = true;
    try {
      const res = await client.get("/admin/registrations", {
        params: { status: "pending", limit: 20 },
        timeout: 12000,
      });
      setRegistrations(res.data?.items || []);
      setRegPending(Number(res.data?.pending || 0));
    } catch {
      // 没有审批权限 / 接口暂不可用：通知里就不展示这一块
    } finally {
      regInFlight.current = false;
    }
  }, [canApprove]);

  const approveRegistration = async (item: PendingRegistration) => {
    if (regActing) return;
    setRegActing(item.id);
    try {
      await client.post(`/admin/registrations/${item.id}/approve`, {});
      setRegistrations((prev) => prev.filter((r) => r.id !== item.id));
      setRegPending((n) => Math.max(0, n - 1));
    } catch {
      // 失败保留在列表里，点「全部」去管理后台处理
    } finally {
      setRegActing(null);
    }
  };

  const rejectRegistration = async () => {
    if (!rejectTarget || regActing) return;
    setRegActing(rejectTarget.id);
    try {
      await client.post(`/admin/registrations/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      setRegistrations((prev) => prev.filter((r) => r.id !== rejectTarget.id));
      setRegPending((n) => Math.max(0, n - 1));
      setRejectTarget(null);
      setRejectReason("");
    } catch {
      // 保持弹窗，用户可重试
    } finally {
      setRegActing(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    void loadAlerts();
    const refreshAll = () => {
      void loadAlerts();
      void loadRegistrations();
    };
    refreshAll();
    const timer = window.setInterval(refreshAll, 60000);
    const onFocus = () => refreshAll();
    const onVisible = () => { if (!document.hidden) refreshAll(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, loadAlerts, loadRegistrations]);

  const readOne = async (event: AlertEvent) => {
    if (event.status === "read") return;
    try {
      await client.post(`/bi/alerts/events/${event.id}/read`);
      setAlerts((prev) => prev.map((item) => (item.id === event.id ? { ...item, status: "read" } : item)));
      setUnread((n) => Math.max(0, n - 1));
    } catch {
      // 忽略：下次轮询会纠正
    }
  };

  const readAll = async () => {
    try {
      await client.post("/bi/alerts/events/read-all");
      setAlerts((prev) => prev.map((item) => ({ ...item, status: "read" })));
      setUnread(0);
    } catch {
      // 忽略
    }
  };

  return (
    <AppBar
      position="sticky"
      elevation={0}
      sx={{
        bgcolor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
        backdropFilter: "blur(12px)",
        color: "text.primary",
      }}
    >
      <Toolbar sx={{ minHeight: 56, gap: 2 }}>
        {/* Logo */}
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={{ cursor: "pointer", mr: 2 }}
          onClick={() => nav("/bi")}
        >
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: "8px",
              background: "linear-gradient(135deg,#2563EB,#7C3AED)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LogoIcon sx={{ fontSize: 18, color: "#fff" }} />
          </Box>
          <Typography sx={{ fontSize: 15, fontWeight: 650, letterSpacing: 0.2 }}>
            明策BI
          </Typography>
        </Stack>

        {/* 导航 */}
        <Stack direction="row" spacing={0.5}>
          {NAV.filter((item) => !item.perm || hasPerm(item.perm)).map((item) => {
            const active =
              item.path === "/bi"
                ? pathname === "/bi" ||
                  pathname.startsWith("/bi/view") ||
                  pathname.startsWith("/bi/dashboards") ||
                  pathname.startsWith("/bi/canvas")
                : pathname.startsWith(item.path);
            return (
              <Button
                key={item.path}
                onClick={() => nav(item.path)}
                startIcon={item.icon}
                size="small"
                sx={{
                  px: 1.5,
                  py: 0.5,
                  borderRadius: "999px",
                  fontSize: 13,
                  fontWeight: active ? 600 : 500,
                  color: active ? "primary.main" : "text.secondary",
                  bgcolor: active ? "primary.50" : "transparent",
                  "&:hover": { bgcolor: active ? "primary.50" : "action.hover" },
                }}
              >
                {item.label}
              </Button>
            );
          })}
        </Stack>

        <Box sx={{ flexGrow: 1 }} />

        {/* 右侧操作 */}
        <Tooltip title="通知">
          <IconButton
            size="small"
            onClick={(e) => {
              setAlertAnchor(e.currentTarget);
              void loadAlerts();
              void loadRegistrations();
            }}
          >
            <Badge badgeContent={unread + (canApprove ? regPending : 0)} color="error" max={99} overlap="circular">
              <BellIcon sx={{ fontSize: 18 }} />
            </Badge>
          </IconButton>
        </Tooltip>

        <Tooltip title={mode === "dark" ? "浅色模式" : "深色模式"}>
          <IconButton size="small" onClick={toggle}>
            {mode === "dark" ? (
              <LightModeIcon sx={{ fontSize: 18 }} />
            ) : (
              <DarkModeIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>

        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
          <Avatar
            sx={{
              width: 30,
              height: 30,
              fontSize: 13,
              fontWeight: 600,
              bgcolor: "primary.main",
            }}
            src={user?.avatar_url || undefined}
          >
            {user?.username?.[0]?.toUpperCase() || "U"}
          </Avatar>
        </IconButton>

        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { mt: 1, minWidth: 180, borderRadius: 2 } } }}
        >
          <Box sx={{ px: 2, py: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{user?.username}</Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
              {user?.email}
            </Typography>
          </Box>
          <Divider />
          {canAdmin && (
            <MenuItem
              onClick={() => {
                setAnchor(null);
                nav("/bi/admin");
              }}
              sx={{ fontSize: 13, gap: 1, py: 1 }}
            >
              <AdminPanelSettingsIcon sx={{ fontSize: 16 }} /> 管理后台
            </MenuItem>
          )}
          <MenuItem
            onClick={() => {
              setAnchor(null);
              logout();
            }}
            sx={{ fontSize: 13, gap: 1, py: 1 }}
          >
            <LogoutIcon sx={{ fontSize: 16 }} /> 退出登录
          </MenuItem>
        </Menu>

        {/* 在通知里驳回注册：填原因 */}
        <Dialog
          open={!!rejectTarget}
          onClose={regActing ? undefined : () => setRejectTarget(null)}
          maxWidth="xs" fullWidth
          PaperProps={{ sx: { borderRadius: "12px", border: "1px solid #EEF3FB" } }}
        >
          <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>驳回注册申请</DialogTitle>
          <DialogContent>
            <Typography sx={{ fontSize: 12.5, color: "#86868B", mb: 1.5 }}>
              驳回「{rejectTarget?.username}」的申请，账号无法登录。
            </Typography>
            <TextField
              label="原因（可选，申请人登录时会看到）" size="small" fullWidth
              multiline minRows={2} value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              inputProps={{ maxLength: 200 }}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2.5 }}>
            <Button onClick={() => setRejectTarget(null)} disabled={!!regActing}
              sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>取消</Button>
            <Button
              onClick={() => void rejectRegistration()} disabled={!!regActing}
              variant="contained"
              sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, bgcolor: "#EF4444", boxShadow: "none", "&:hover": { bgcolor: "#DC2626" } }}
            >
              {regActing ? <CircularProgress size={14} color="inherit" /> : "驳回"}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 告警通知：未读徽标 + 事件列表（点一条标记已读） */}
        <Menu
          anchorEl={alertAnchor}
          open={Boolean(alertAnchor)}
          onClose={() => setAlertAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { mt: 1, width: 380, borderRadius: "12px", border: "1px solid #EEF3FB" } } }}
        >
          {/* 注册审批：审批人可以直接在通知里通过 / 驳回 */}
          {canApprove && (
            <Box>
              <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <HowToRegIcon sx={{ fontSize: 15, color: "#0891B2" }} />
                <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, color: "#1D1D1F" }}>
                  注册审批
                </Typography>
                {regPending > 0 && (
                  <Chip
                    label={regPending} size="small"
                    sx={{ height: 18, fontSize: 10, bgcolor: "rgba(239,68,68,0.10)", color: "#B91C1C", fontWeight: 700 }}
                  />
                )}
                {canAdmin && (
                  <Button
                    size="small"
                    onClick={() => { setAlertAnchor(null); nav("/bi/admin?tab=registrations"); }}
                    sx={{ textTransform: "none", fontSize: 11.5, color: "#4F46E5", minWidth: 0 }}
                  >
                    全部
                  </Button>
                )}
              </Box>
              {registrations.length === 0 ? (
                <Typography sx={{ px: 2, pb: 1.25, fontSize: 11.5, color: "#A1A1A6" }}>
                  没有待审批的注册申请
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 260, overflow: "auto", pb: 0.5 }}>
                  {registrations.map((item) => (
                    <Box
                      key={item.id}
                      sx={{
                        px: 2, py: 1, display: "flex", alignItems: "center", gap: 1,
                        "&:hover": { bgcolor: "rgba(15,23,42,0.03)" },
                      }}
                    >
                      <Avatar sx={{ width: 26, height: 26, fontSize: 11.5, bgcolor: "rgba(8,145,178,0.14)", color: "#0E7490" }}>
                        {item.username?.[0]?.toUpperCase() || "U"}
                      </Avatar>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, color: "#1D1D1F" }}>
                          {item.username}
                        </Typography>
                        <Typography noWrap sx={{ fontSize: 10.5, color: "#94A3B8" }}>
                          {item.department_name} · {(item.created_at || "").slice(5, 16)}
                        </Typography>
                      </Box>
                      <Button
                        size="small" disabled={regActing === item.id}
                        onClick={() => void approveRegistration(item)}
                        sx={{ textTransform: "none", fontSize: 11.5, color: "#059669", minWidth: 0, px: 0.6 }}
                      >
                        通过
                      </Button>
                      <Button
                        size="small" disabled={regActing === item.id}
                        onClick={() => { setRejectTarget(item); setRejectReason(""); }}
                        sx={{ textTransform: "none", fontSize: 11.5, color: "#EF4444", minWidth: 0, px: 0.6 }}
                      >
                        驳回
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
              <Divider sx={{ borderColor: "#EEF3FB" }} />
            </Box>
          )}

          <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1, color: "#1D1D1F" }}>
              告警通知
            </Typography>
            {unread > 0 && (
              <Button
                size="small"
                onClick={() => void readAll()}
                startIcon={<DoneAllIcon sx={{ fontSize: 15 }} />}
                sx={{ textTransform: "none", fontSize: 11.5, color: "#4F46E5", minWidth: 0 }}
              >
                全部已读
              </Button>
            )}
          </Box>
          <Divider sx={{ borderColor: "#EEF3FB" }} />
          {alertLoading && alerts.length === 0 ? (
            <Box sx={{ py: 4, display: "grid", placeItems: "center" }}>
              <CircularProgress size={18} />
            </Box>
          ) : alerts.length === 0 ? (
            <Box sx={{ py: 3, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12.5, color: "#94A3B8" }}>暂无告警</Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: 380, overflow: "auto" }}>
              {alerts.map((event) => (
                <Box
                  key={event.id}
                  onClick={() => {
                    if (event.link) window.open(event.link, "_blank", "noopener,noreferrer");
                    void readOne(event);
                  }}
                  sx={{
                    px: 2, py: 1.25, display: "flex", gap: 1,
                    cursor: event.status === "unread" ? "pointer" : "default",
                    "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
                  }}
                >
                  <Box
                    sx={{
                      width: 6, height: 6, borderRadius: "50%", mt: "7px", flexShrink: 0,
                      bgcolor: event.status === "unread" ? "#EF4444" : "transparent",
                    }}
                  />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      noWrap
                      sx={{ fontSize: 12.5, fontWeight: event.status === "unread" ? 600 : 500, color: "#1D1D1F" }}
                    >
                      {event.rule_name || "指标告警"}
                      {event.dashboard_name ? ` · ${event.dashboard_name}` : ""}
                    </Typography>
                    <Typography noWrap sx={{ fontSize: 11.5, color: "#94A3B8", mt: 0.25 }}>
                      {event.message}
                    </Typography>
                    <Typography sx={{ fontSize: 10.5, color: "#B0B8C4", mt: 0.25 }}>
                      {(event.created_at || "").slice(5, 16)}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
