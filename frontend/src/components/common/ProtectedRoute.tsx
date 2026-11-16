/** 路由守卫 —— 未登录跳转登录页，无权限显示提示 */

import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import Loading from "./Loading";
import { Box, Typography, Button } from "@mui/material";
import { LockOutlined } from "@mui/icons-material";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  permKey?: string;  // 精确权限key，如 "ai", "office"
}

function PermissionDenied() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", gap: 2 }}>
      <LockOutlined sx={{ fontSize: 64, color: "text.disabled" }} />
      <Typography variant="h5" fontWeight={600} color="text.secondary">无权访问</Typography>
      <Typography variant="body2" color="text.disabled">你没有权限访问此页面，请联系管理员</Typography>
      <Button variant="outlined" onClick={() => window.history.back()} sx={{ mt: 1, borderRadius: 3 }}>返回上一页</Button>
    </Box>
  );
}

export default function ProtectedRoute({ children, adminOnly, permKey }: Props) {
  const { user, loading, hasPerm } = useAuth();
  const location = useLocation();

  // 乐观渲染：只要有 token 就立即渲染页面，不等 auth 初始化
  const hasToken = !!localStorage.getItem("access_token");
  if (hasToken) {
    // 权限判断用当前 user 状态（可能还在加载中）
    if (adminOnly && user && !hasPerm("admin_panel")) return <PermissionDenied />;
    if (permKey && user && !hasPerm(permKey)) return <PermissionDenied />;
    return <>{children}</>;
  }

  // 无 token → 等待确认
  if (loading) return <Loading fullPage />;
  if (!user) return <Navigate to={`/login?redirect=${encodeURIComponent(location.pathname)}`} replace />;

  return <>{children}</>;
}
