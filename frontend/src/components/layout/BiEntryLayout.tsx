import type { ReactNode } from "react";
import { Box } from "@mui/material";
import { useNavigate } from "react-router-dom";
import BiSideNav, { BI_NAV_ITEMS } from "../../features/bi-dashboard/BiSideNav";
import { useAuth } from "../../hooks/useAuth";
import TopBar from "./TopBar";

export default function BiEntryLayout({ activeKey, children }: {
  activeKey: string;
  children: ReactNode;
}) {
  const nav = useNavigate();
  const { hasPerm } = useAuth();
  const items = BI_NAV_ITEMS.filter((item) => !item.perm || hasPerm(item.perm));

  return (
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", overflow: "hidden" }}>
      <BiSideNav
        items={items}
        activeKey={activeKey}
        onSelect={(item) => nav(item.path || `/bi?view=${item.key}`)}
        count={items.length}
        countLabel="菜单入口"
      />
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <TopBar hideLogo />
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>{children}</Box>
      </Box>
    </Box>
  );
}
