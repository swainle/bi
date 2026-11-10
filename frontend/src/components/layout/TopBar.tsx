/** 顶部导航栏 —— 明策BI（Apple 风极简：白底、细分隔线、胶囊导航） */

import { useState } from "react";
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
} from "@mui/material";
import {
  Dashboard as DashboardIcon,
  History as HistoryIcon,
  LogoDev as LogoIcon,
  Logout as LogoutIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
} from "@mui/icons-material";
import { useAuth } from "../../hooks/useAuth";
import { useThemeMode } from "../../contexts/ThemeContext";

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
                ? pathname === "/bi" || pathname.startsWith("/bi/view")
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
      </Toolbar>
    </AppBar>
  );
}
