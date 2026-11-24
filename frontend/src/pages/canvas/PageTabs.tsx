/** 画布编辑器 · 页面页签（双击重命名 / 右键菜单 / ＋新建） */

import { Box, IconButton, TextField } from "@mui/material";
import { Add } from "@mui/icons-material";

import type { DashboardDoc } from "../../features/components/types";

export type PageMenuState = { x: number; y: number; key: string } | null;
export type EditingPage = { key: string; draft: string } | null;

export default function PageTabs({
  doc, view, editingPage, setEditingPage, commitPageRename, switchView, setPageMenu, addPage,
}: {
  doc: DashboardDoc;
  view: string;
  editingPage: EditingPage;
  setEditingPage: (v: EditingPage) => void;
  commitPageRename: () => void;
  switchView: (key: string) => void;
  setPageMenu: (v: PageMenuState) => void;
  addPage: () => void;
}) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 0.25, mr: 1,
      maxWidth: 380, overflowX: "auto", flexShrink: 0,
      "&::-webkit-scrollbar": { display: "none" },
    }}>
      {doc.views.map((v) => {
        if (editingPage?.key === v.key) {
          return (
            <TextField
              key={v.key}
              size="small"
              autoFocus
              value={editingPage.draft}
              onChange={(e) => setEditingPage({ key: v.key, draft: e.target.value })}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitPageRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageRename();
                if (e.key === "Escape") setEditingPage(null);
              }}
              inputProps={{ maxLength: 16 }}
              sx={{
                width: 108, flexShrink: 0,
                "& .MuiOutlinedInput-root": { height: 26, borderRadius: 999, fontSize: 12 },
                "& input": { py: 0, px: 1.25 },
              }}
            />
          );
        }
        const active = v.key === view;
        return (
          <Box
            key={v.key}
            onClick={() => { if (!active) switchView(v.key); }}
            onDoubleClick={() => setEditingPage({ key: v.key, draft: v.title || v.key })}
            onContextMenu={(e) => { e.preventDefault(); setPageMenu({ x: e.clientX, y: e.clientY, key: v.key }); }}
            title={`${v.title || v.key} · 页面 ID ${v.key}`}
            sx={{
              px: 1.25, height: 26, borderRadius: 999, flexShrink: 0,
              display: "flex", alignItems: "center", cursor: "pointer",
              fontSize: 12, whiteSpace: "nowrap",
              color: active ? "#4F46E5" : "#64748B",
              fontWeight: active ? 600 : 400,
              bgcolor: active ? "rgba(79,70,229,0.10)" : "transparent",
              border: "1px solid", borderColor: active ? "rgba(79,70,229,0.30)" : "transparent",
              transition: "background-color .14s, color .14s",
              "&:hover": { bgcolor: active ? "rgba(79,70,229,0.10)" : "rgba(15,23,42,0.04)" },
            }}
          >
            {v.title || v.key}
          </Box>
        );
      })}
      <IconButton size="small" onClick={addPage} title="新建页面"
        sx={{ width: 26, height: 26, flexShrink: 0, "&:hover": { bgcolor: "rgba(15,23,42,0.04)" } }}>
        <Add sx={{ fontSize: 16, color: "#64748B" }} />
      </IconButton>
    </Box>
  );
}
