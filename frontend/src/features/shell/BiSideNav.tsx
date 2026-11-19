/** 「我的看板 / 项目」等页共用的左侧菜单 —— 白底毛玻璃、胶囊选中、底部计数 */

import type { ReactNode } from "react";
import { Avatar, Box, Typography, alpha, useTheme } from "@mui/material";
import {
  BarChart, Code, Dashboard, DesignServices, Group, Storage, TableChart, Widgets,
} from "@mui/icons-material";

export interface SideNavItem {
  key: string;
  label: string;
  icon: ReactNode;
  color: string;
  /** 需要跳路由的项（组件库 / 编辑设计 …）；不填则由调用方切换视图 */
  path?: string;
  /** 访问该入口需要的权限码（在「角色权限 → 业务入口」里勾选） */
  perm?: string;
}

/** 全局菜单 —— 两个页面共用同一份，避免两边菜单走样 */
export const BI_NAV_ITEMS: SideNavItem[] = [
  { key: "dashboards", label: "我的看板", icon: <Dashboard />, color: "#6366F1" },
  { key: "templates", label: "模板库", icon: <BarChart />, color: "#F59E0B" },
  { key: "team", label: "我的团队", icon: <Group />, color: "#10B981" },
  { key: "datasets", label: "数据集", icon: <TableChart />, color: "#0891B2", perm: "bi:nav:datasets" },
  { key: "datasource", label: "数据源", icon: <Storage />, color: "#EC4899", perm: "bi:nav:datasources" },
  { key: "sql", label: "SQL Lab", icon: <Code />, color: "#8B5CF6", perm: "bi:nav:sql" },
  { key: "components", label: "组件库", icon: <Widgets />, color: "#0EA5E9", path: "/bi/components", perm: "bi:nav:components" },
  { key: "editor", label: "编辑设计", icon: <DesignServices />, color: "#EC4899", path: "/bi/projects", perm: "bi:nav:editor" },
];

interface Props {
  items: SideNavItem[];
  activeKey: string;
  onSelect: (item: SideNavItem) => void;
  count: number | string;
  countLabel: string;
  /** 品牌副标题（默认 ECharts · 自研引擎；管理后台用「管理后台」） */
  subtitle?: string;
  /** 底部按钮区（管理后台放「返回看板」；不填则不渲染） */
  footerExtra?: ReactNode;
}

export default function BiSideNav({
  items, activeKey, onSelect, count, countLabel, subtitle = "ECharts · 自研引擎", footerExtra,
}: Props) {
  const theme = useTheme();

  return (
    <Box sx={{
      width: 250, flexShrink: 0, display: "flex", flexDirection: "column",
      borderRight: "1px solid", borderColor: "divider",
      bgcolor: alpha(theme.palette.background.paper, 0.7),
      backdropFilter: "blur(12px)",
    }}>
      <Box sx={{ px: 2.5, height: 56, boxSizing: "border-box", flexShrink: 0,
        display: "flex", alignItems: "center", borderBottom: "1px solid", borderColor: "divider",
        background: theme.palette.background.paper, boxShadow: "0 2px 4px rgba(0,0,0,0.06)",
        clipPath: "inset(0 0 -8px 0)", zIndex: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
          <Avatar sx={{ width: 32, height: 32, flexShrink: 0, borderRadius: 2.5,
            background: "linear-gradient(135deg, #6366F1, #8B5CF6)",
            fontSize: 18, fontWeight: 800,
            boxShadow: "0 4px 12px rgba(99,102,241,0.35)", }}>BI</Avatar>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
            <Typography variant="h6" fontWeight={800} fontSize={18} letterSpacing={-0.5}
              noWrap sx={{ lineHeight: "22px", background: "linear-gradient(135deg, #6366F1, #8B5CF6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              明策BI
            </Typography>
            <Typography variant="caption" color="text.secondary" fontSize={11}
              noWrap sx={{ lineHeight: "14px" }}>{subtitle}</Typography>
          </Box>
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, px: 1.5, pt: 2, overflow: "auto" }}>
        <Typography variant="overline" sx={{ px: 1, fontWeight: 600, color: "text.secondary", fontSize: 11, letterSpacing: 1 }}>菜单</Typography>
        {items.map((item) => (
          <Box key={item.key}
            onClick={() => onSelect(item)}
            sx={{
              display: "flex", alignItems: "center", gap: 1.5,
              px: 1.5, py: 1.2, borderRadius: 2, mt: 0.5, cursor: "pointer",
              color: activeKey === item.key ? item.color : "text.secondary",
              bgcolor: activeKey === item.key ? alpha(item.color, 0.08) : "transparent",
              fontWeight: activeKey === item.key ? 600 : 400,
              transition: "all 0.15s",
              "&:hover": { bgcolor: alpha(item.color, 0.06) },
            }}>
            <Box sx={{ fontSize: 20, display: "flex" }}>{item.icon}</Box>
            <Typography variant="body2" fontSize={13} fontWeight="inherit">{item.label}</Typography>
          </Box>
        ))}
      </Box>

      {footerExtra && (
        <Box sx={{ px: 1.5, pb: 0.5 }}>{footerExtra}</Box>
      )}

      <Box sx={{ px: 1.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", px: 1.5 }}>
          <Typography variant="caption" color="text.secondary">{countLabel}</Typography>
          <Typography variant="caption" fontWeight={700} color="#6366F1">{count}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
