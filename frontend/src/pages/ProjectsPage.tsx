/** 项目页 —— 「编辑设计」的子页面：先选项目，再进画布（不内联在主看板页里） */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Menu, MenuItem, Snackbar, TextField, Typography,
} from "@mui/material";
import {
  Add, DeleteOutline, DriveFileRenameOutline, MoreHoriz, Search, Visibility,
} from "@mui/icons-material";
import client from "../api/client";
import BoardThumb from "../features/bi-dashboard/BoardThumb";
import type { DashboardDoc } from "../features/components/types";

interface ProjectMeta {
  id: number;
  name: string;
  code?: string | null;
  views: number;
  items: number;
  charts: number;
  published: boolean;
  updated_at: string;
  can_manage?: boolean;
}

const CARD_BORDER = "#E8E8ED";
const INK = "#1D1D1F";
const MUTED = "#86868B";

export default function ProjectsPage() {
  const nav = useNavigate();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [docs, setDocs] = useState<Record<number, DashboardDoc>>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [menu, setMenu] = useState<{ el: HTMLElement; project: ProjectMeta } | null>(null);
  const [renameTarget, setRenameTarget] = useState<ProjectMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ProjectMeta | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ open: boolean; msg: string; severity: "success" | "error" }>({
    open: false, msg: "", severity: "success",
  });

  const load = useCallback(async () => {
    try {
      const res = await client.get("/bi/dashboards");
      const list = (res.data?.dashboards || []) as ProjectMeta[];
      setProjects(list);
      setLoading(false);
      // 缩略图要每块看板的版面 —— 并行取，失败就留空图
      const pairs = await Promise.all(list.map(async (p) => {
        try {
          const detail = await client.get(`/bi/dashboards/${p.id}`);
          return [p.id, detail.data?.doc as DashboardDoc] as const;
        } catch {
          return [p.id, undefined] as const;
        }
      }));
      const next: Record<number, DashboardDoc> = {};
      pairs.forEach(([id, doc]) => { if (doc) next[id] = doc; });
      setDocs(next);
    } catch {
      setLoading(false);
      setToast({ open: true, msg: "项目加载失败", severity: "error" });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => projects.filter((p) => p.name.toLowerCase().includes(keyword.trim().toLowerCase())),
    [projects, keyword],
  );

  const openProject = (p: ProjectMeta) => nav(`/bi/canvas?doc=${p.id}`);

  const createProject = async () => {
    if (creating) return;
    setCreating(true);
    try {
      /* 不传名字：后端按「未命名项目01 / 02 / 03…」自动编号 */
      const res = await client.post("/bi/dashboards", {});
      const id = res.data?.id as number | undefined;
      if (!id) throw new Error("no id");
      nav(`/bi/canvas?doc=${id}`);
    } catch {
      setToast({ open: true, msg: "新建项目失败", severity: "error" });
      setCreating(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    setBusy(true);
    try {
      await client.patch(`/bi/dashboards/${renameTarget.id}`, { name: renameValue.trim() });
      setProjects((prev) => prev.map((p) => (
        p.id === renameTarget.id ? { ...p, name: renameValue.trim() } : p
      )));
      setRenameTarget(null);
    } catch {
      setToast({ open: true, msg: "重命名失败", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await client.delete(`/bi/dashboards/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch {
      setToast({ open: true, msg: "删除失败", severity: "error" });
    } finally {
      setBusy(false);
    }
  };

  const tileSx = {
    borderRadius: "12px", border: `1px solid ${CARD_BORDER}`, bgcolor: "#fff",
    transition: "border-color .16s ease, box-shadow .16s ease",
    "&:hover": { borderColor: "#C9C9D2", boxShadow: "0 4px 16px rgba(15,23,42,0.07)" },
  } as const;

  return (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "auto", bgcolor: "#F5F5F7" }}>
      <Box sx={{ p: 3, minHeight: "100%", display: "flex", flexDirection: "column" }}>
        <Box sx={{
          flex: "1 0 auto", display: "flex", flexDirection: "column",
          bgcolor: "#fff", borderRadius: "20px", px: 4, py: 3.5,
          boxShadow: "0 1px 2px rgba(15,23,42,0.04)",
        }}>
          {/* 标题栏 */}
          <Box sx={{ display: "flex", alignItems: "center", minHeight: 44, mb: 3.5, gap: 1 }}>
            <Typography sx={{ fontSize: 27, fontWeight: 600, letterSpacing: "-0.02em", color: INK }}>
              项目
            </Typography>
            <Box sx={{ flex: 1 }} />
            {searchOpen ? (
              <TextField
                autoFocus size="small" placeholder="搜索项目" value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setKeyword(""); setSearchOpen(false); } }}
                onBlur={() => { if (!keyword) setSearchOpen(false); }}
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
          ) : (
            <Box sx={{
              display: "grid", gridTemplateColumns: "repeat(auto-fill, 208px)",
              columnGap: "40px", rowGap: "32px",
            }}>
              {/* 新建项目 */}
              <Box onClick={createProject} sx={{ cursor: creating ? "default" : "pointer" }}>
                <Box sx={{
                  ...tileSx, aspectRatio: "16 / 10", display: "grid", placeItems: "center",
                }}>
                  {creating
                    ? <CircularProgress size={20} sx={{ color: "#C7C7CC" }} />
                    : <Add sx={{ fontSize: 36, color: "#C7C7CC" }} />}
                </Box>
                <Typography sx={{ mt: 1.5, textAlign: "center", fontSize: 14, color: INK, fontWeight: 500 }}>
                  新建项目
                </Typography>
              </Box>

              {filtered.map((p) => (
                <Box key={p.id} sx={{ "&:hover .more-btn": { opacity: 1 } }}>
                  <Box
                    onClick={() => openProject(p)}
                    sx={{ ...tileSx, aspectRatio: "16 / 10", position: "relative", overflow: "hidden", cursor: "pointer" }}
                  >
                    <BoardThumb doc={docs[p.id]} />
                    <IconButton
                      className="more-btn" size="small"
                      onClick={(e) => { e.stopPropagation(); setMenu({ el: e.currentTarget, project: p }); }}
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
                    onClick={() => openProject(p)}
                    noWrap
                    sx={{
                      mt: 1.5, textAlign: "center", fontSize: 14, color: INK, fontWeight: 500,
                      cursor: "pointer", px: 0.5,
                    }}>
                    {p.name}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {!loading && filtered.length === 0 && keyword && (
            <Typography sx={{ mt: 3, fontSize: 13, color: MUTED }}>没有匹配的项目</Typography>
          )}
        </Box>
      </Box>

      {/* 更多操作 */}
      <Menu
        anchorEl={menu?.el ?? null} open={!!menu} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 148, border: `1px solid ${CARD_BORDER}` } } }}
      >
        <MenuItem dense onClick={() => { if (menu) nav(`/bi/dashboards/${menu.project.id}`); setMenu(null); }}
          sx={{ fontSize: 13, gap: 1.25 }}>
          <Visibility sx={{ fontSize: 16, color: MUTED }} />预览
        </MenuItem>
        <MenuItem dense sx={{ fontSize: 13, gap: 1.25 }}
          onClick={() => {
            if (!menu) return;
            setRenameTarget(menu.project);
            setRenameValue(menu.project.name);
            setMenu(null);
          }}>
          <DriveFileRenameOutline sx={{ fontSize: 16, color: MUTED }} />重命名
        </MenuItem>
        <MenuItem dense sx={{ fontSize: 13, gap: 1.25, color: "error.main" }}
          onClick={() => {
            if (!menu) return;
            setDeleteTarget(menu.project);
            setMenu(null);
          }}>
          <DeleteOutline sx={{ fontSize: 16 }} />删除
        </MenuItem>
      </Menu>

      {/* 重命名 */}
      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>重命名项目</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleRename(); }}
            sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRenameTarget(null)} sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <Button variant="contained" onClick={() => void handleRename()}
            disabled={busy || !renameValue.trim()}
            sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, bgcolor: "#4F46E5", boxShadow: "none" }}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* 删除 */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>删除项目</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "#4B5563" }}>
            确定删除「{deleteTarget?.name}」？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <Button variant="contained" color="error" onClick={() => void handleDelete()} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, boxShadow: "none" }}>
            删除
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open} autoHideDuration={2600} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        onClose={() => setToast((s) => ({ ...s, open: false }))}>
        <Alert severity={toast.severity} onClose={() => setToast((s) => ({ ...s, open: false }))}
          sx={{ borderRadius: 2, fontSize: 13 }}>
          {toast.msg}
        </Alert>
      </Snackbar>
    </Box>
  );
}
