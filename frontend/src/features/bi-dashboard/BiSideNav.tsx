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
}

/** 全局菜单 —— 两个页面共用同一份，避免两边菜单走样 */
export const BI_NAV_ITEMS: SideNavItem[] = [
  { key: "dashboards", label: "我的看板", icon: <Dashboard />, color: "#6366F1" },
  { key: "templates", label: "模板库", icon: <BarChart />, color: "#F59E0B" },
  { key: "team", label: "我的团队", icon: <Group />, color: "#10B981" },
  { key: "datasets", label: "数据集", icon: <TableChart />, color: "#0891B2" },
  { key: "datasource", label: "数据源", icon: <Storage />, color: "#EC4899" },
  { key: "sql", label: "SQL 查询", icon: <Code />, color: "#8B5CF6" },
  { key: "components", label: "组件库", icon: <Widgets />, color: "#0EA5E9", path: "/bi/components" },
  { key: "editor", label: "编辑设计", icon: <DesignServices />, color: "#EC4899", path: "/bi/projects" },
];

interface Props {
  items: SideNavItem[];
  activeKey: string;
  onSelect: (item: SideNavItem) => void;
  count: number;
  countLabel: string;
}

export default function BiSideNav({ items, activeKey, onSelect, count, countLabel }: Props) {
  const theme = useTheme();

  return (
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

      <Box sx={{ px: 1.5, py: 2, borderTop: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", px: 1.5 }}>
          <Typography variant="caption" color="text.secondary">{countLabel}</Typography>
          <Typography variant="caption" fontWeight={700} color="#6366F1">{count}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
