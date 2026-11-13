/** 顶部导航栏 —— 明策BI（Apple 风极简：白底、细分隔线、胶囊导航） */

import { useCallback, useEffect, useState } from "react";
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
  CircularProgress,
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  History as HistoryIcon,
  LogoDev as LogoIcon,
  Logout as LogoutIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  NotificationsNone as BellIcon,
  DoneAll as DoneAllIcon,
} from "@mui/icons-material";
import { useAuth } from "../../hooks/useAuth";
import { useThemeMode } from "../../contexts/ThemeContext";
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

const NAV = [
  { label: "我的看板", path: "/bi", icon: <DashboardIcon sx={{ fontSize: 16 }} /> },
  { label: "操作审计", path: "/bi/audit", icon: <HistoryIcon sx={{ fontSize: 16 }} /> },
];

export default function TopBar() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { mode, toggle } = useThemeMode();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [alertAnchor, setAlertAnchor] = useState<null | HTMLElement>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [alertLoading, setAlertLoading] = useState(false);

  const loadAlerts = useCallback(async () => {
    if (!user) return;
    setAlertLoading(true);
    try {
      const res = await client.get("/bi/alerts/events", { params: { limit: 20 } });
      setAlerts(res.data?.events || []);
      setUnread(Number(res.data?.unread || 0));
    } catch {
      // 未登录 / 接口暂不可用时静默：顶栏不因此报错
    } finally {
      setAlertLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadAlerts();
    const timer = window.setInterval(() => void loadAlerts(), 60000);
    const onFocus = () => void loadAlerts();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [user, loadAlerts]);

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
          {NAV.map((item) => {
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
        <Tooltip title="告警通知">
          <IconButton
            size="small"
            onClick={(e) => {
              setAlertAnchor(e.currentTarget);
              void loadAlerts();
            }}
          >
            <Badge badgeContent={unread} color="error" max={99} overlap="circular">
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

        {/* 告警通知：未读徽标 + 事件列表（点一条标记已读） */}
        <Menu
          anchorEl={alertAnchor}
          open={Boolean(alertAnchor)}
          onClose={() => setAlertAnchor(null)}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{ paper: { sx: { mt: 1, width: 380, borderRadius: "12px", border: "1px solid #EEF3FB" } } }}
        >
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
            <Box sx={{ py: 4, textAlign: "center" }}>
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
