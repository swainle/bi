/** 管理后台 —— 概览 / 用户 / 角色权限 / 模型配置 / 错误日志 / 运维
 *
 * 与「我的看板」同一套外壳：左侧菜单 + 头标卡 + 白色圆角内容卡，
 * 不另造一套视觉语言；分区按权限码显隐（后端同样按权限码鉴权）。
 */

import { useMemo } from "react";
import { Box, Button, Chip, CircularProgress, Typography } from "@mui/material";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AdminPanelSettings, ArrowBack, BugReport, HowToReg, HubOutlined, MonitorHeart, People,
  SmartToy, SpaceDashboard, Timeline,
} from "@mui/icons-material";
import { useAuth } from "../hooks/useAuth";
import BiSideNav, { type SideNavItem } from "../features/bi-dashboard/BiSideNav";
import OverviewPanel from "../features/admin/OverviewPanel";
import UsersPanel from "../features/admin/UsersPanel";
import RegistrationsPanel from "../features/admin/RegistrationsPanel";
import RolesPanel from "../features/admin/RolesPanel";
import ModelsPanel from "../features/admin/ModelsPanel";
import ErrorsPanel from "../features/admin/ErrorsPanel";
import MonitorPanel from "../features/admin/MonitorPanel";
import OpsPanel from "../features/admin/OpsPanel";
import McpPanel from "../features/admin/McpPanel";
import { MUTED } from "../features/admin/shared";

interface AdminSection extends SideNavItem {
  perm: string;
  desc: string;
}

const SECTIONS: AdminSection[] = [
  {
    key: "overview", label: "概览", icon: <SpaceDashboard />, color: "#6366F1",
    perm: "bi:overview", desc: "账号、看板与运行状态",
  },
  {
    key: "users", label: "用户管理", icon: <People />, color: "#0EA5E9",
    perm: "bi:user:manage", desc: "账号、角色与启停",
  },
  {
    key: "registrations", label: "注册审批", icon: <HowToReg />, color: "#0891B2",
    perm: "bi:user:approve", desc: "注册申请审批",
  },
  {
    key: "roles", label: "角色权限", icon: <AdminPanelSettings />, color: "#8B5CF6",
    perm: "bi:role:manage", desc: "角色与权限分配",
  },
  {
    key: "models", label: "模型配置", icon: <SmartToy />, color: "#10B981",
    perm: "bi:model:manage", desc: "AI 模型与连通性",
  },
  {
    key: "errors", label: "错误日志", icon: <BugReport />, color: "#EF4444",
    perm: "bi:error:view", desc: "前端 / 后端异常",
  },
  {
    key: "monitor", label: "操作监控", icon: <Timeline />, color: "#DC2626",
    perm: "bi:audit:view", desc: "敏感操作 / AI / MCP 调用",
  },
  {
    key: "ops", label: "运维", icon: <MonitorHeart />, color: "#F59E0B",
    perm: "bi:ops:manage", desc: "运行指标与维护",
  },
  {
    key: "mcp", label: "MCP 客户端", icon: <HubOutlined />, color: "#0F766E",
    perm: "bi:mcp:manage", desc: "Agent 客户端与工具目录",
  },
];

export default function AdminPage() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const adminScope = user?.admin_scope || "";
  const permissions = user?.effective_permissions || [];

  const isLeader = (user?.led_department_ids?.length || 0) > 0;

  // 分区按权限展示：管理员 = 全部；被授权的账号 = 对应分区；
  // 部门负责人即使没有权限码，也能进「注册审批」（后端按部门限制范围）
  const allowed = useMemo(
    () =>
      SECTIONS.filter((section) => {
        if (section.key === "registrations") {
          return isAdmin || isLeader || permissions.includes(section.perm);
        }
        return permissions.includes(section.perm);
      }),
    [permissions, isAdmin, isLeader],
  );

  const requested = searchParams.get("tab") || "";
  const activeKey = allowed.some((s) => s.key === requested)
    ? requested
    : (allowed[0]?.key || "");

  const selectSection = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  // 登录态还在加载时先给中性占位，避免闪一下「没有权限」
  if (!user) {
    return (
      <Box sx={{ height: "100%", display: "grid", placeItems: "center", bgcolor: "#F5F5F7" }}>
        <CircularProgress size={22} />
      </Box>
    );
  }

  if (allowed.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "grid", placeItems: "center", bgcolor: "#F5F5F7" }}>
        <Box sx={{ textAlign: "center", px: 3 }}>
          <AdminPanelSettings sx={{ fontSize: 46, color: "#C7C9D9" }} />
          <Typography sx={{ mt: 1.5, fontSize: 16, fontWeight: 600, color: "#1D1D1F" }}>
            没有管理后台权限
          </Typography>
          <Typography sx={{ mt: 0.75, fontSize: 12.5, color: MUTED }}>
            需要管理员在「角色权限」里为你的角色勾选管理后台权限
          </Typography>
          <Button
            onClick={() => nav("/bi")} startIcon={<ArrowBack sx={{ fontSize: 16 }} />}
            sx={{ mt: 2, textTransform: "none", fontSize: 13, color: "#4F46E5" }}
          >
            返回看板
          </Button>
        </Box>
      </Box>
    );
  }

  // 头标卡右上角显示「职位」，不再显示权限范围描述
  const positionLabel =
    user?.position === "director" ? "总监"
      : user?.position === "manager" ? "经理"
        : user?.position === "supervisor" ? "主管"
          : "员工";

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", overflow: "hidden" }}>
      <BiSideNav
        items={allowed}
        activeKey={activeKey}
        onSelect={(item) => selectSection(item.key)}
        count={
          !isAdmin && !permissions.some((code) => code.startsWith("bi:"))
            ? (user?.approval_scope === "all"
                ? "全部部门"
                : user?.approval_scope === "department"
                  ? "本部门"
                  : (user?.led_department_ids?.length || 0))
            : permissions.filter((code) => code.startsWith("bi:")).length
        }
        countLabel={
          !isAdmin && !permissions.some((code) => code.startsWith("bi:"))
            ? "审批范围"
            : "我的权限"
        }
        subtitle="管理后台"
        footerExtra={
          <Box
            onClick={() => nav("/bi")}
            sx={{
              display: "flex", alignItems: "center", gap: 1.25, px: 1.5, py: 1,
              borderRadius: 2, cursor: "pointer", color: "text.secondary",
              transition: "all .15s", "&:hover": { bgcolor: "rgba(15,23,42,0.04)", color: "#1D1D1F" },
            }}
          >
            <ArrowBack sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: 13 }}>返回看板</Typography>
          </Box>
        }
      />

      <Box sx={{ flex: 1, overflow: "auto", bgcolor: "#F5F5F7" }}>
        <Box sx={{ p: 3, minHeight: "100%", display: "flex", flexDirection: "column" }}>
          {/* 头标卡：与「我的看板」同一套渐变与圆角 */}
          <Box sx={{
            flexShrink: 0, mb: 2, px: 4, py: 3, borderRadius: "20px",
            background: "linear-gradient(135deg, #6366F1 0%, #8B5CF6 40%, #A855F7 100%)",
            color: "white", position: "relative", overflow: "hidden",
          }}>
            <Box sx={{ position: "absolute", top: -34, right: -16, opacity: 0.12, fontSize: 150, pointerEvents: "none" }}>⚙️</Box>
            <Box sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "flex-end", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ flex: 1, minWidth: 260 }}>
                <Typography sx={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3 }}>管理后台</Typography>
                <Typography sx={{ mt: 0.75, fontSize: 13, opacity: 0.9 }}>
                  {adminScope === "department"
                    ? "本部门的用户、注册审批与角色"
                    : "用户与权限、注册审批、AI 模型、错误日志与运维，一处集中管理"}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {[
                  user?.username || "",
                  user?.account_type === "admin" ? "管理员" : "",
                  user?.department_name || "",
                  positionLabel,
                ].filter(Boolean).map((label) => (
                  <Chip
                    key={label}
                    size="small" label={label}
                    sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 11.5, height: 22 }}
                  />
                ))}
              </Box>
            </Box>
          </Box>

          {/* 白色内容卡 */}
          <Box sx={{
            flex: "1 0 auto", bgcolor: "#fff", borderRadius: "20px", px: 4, py: 3.5,
            boxShadow: "0 1px 2px rgba(15,23,42,0.04)", minHeight: 420,
          }}>
            {activeKey === "overview" && (
              <OverviewPanel
                scope={adminScope}
                onOpenErrors={allowed.some((s) => s.key === "errors") ? () => selectSection("errors") : undefined}
              />
            )}
            {activeKey === "users" && (
              <UsersPanel scope={user?.data_scope || "self"} ownDepartmentId={user?.department_id ?? null} />
            )}
            {activeKey === "registrations" && (
              <RegistrationsPanel
                scope={adminScope}
                isAdmin={adminScope === "global" || permissions.includes("bi:user:approve")}
              />
            )}
            {activeKey === "roles" && <RolesPanel scope={adminScope} />}
            {activeKey === "models" && <ModelsPanel />}
            {activeKey === "errors" && (
              <ErrorsPanel canClean={isAdmin || permissions.includes("bi:ops:manage")} />
            )}
            {activeKey === "ops" && (
              <OpsPanel canManage={isAdmin || permissions.includes("bi:ops:manage")} />
            )}
            {activeKey === "monitor" && <MonitorPanel />}
            {activeKey === "mcp" && <McpPanel />}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
