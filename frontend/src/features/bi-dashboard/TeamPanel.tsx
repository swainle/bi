import { useState, useCallback, useEffect } from "react";
import {
  Box, Typography, Paper, Button, TextField, Chip, CircularProgress, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Checkbox, List, ListItem, ListItemAvatar, Avatar, ListItemText,
} from "@mui/material";
import {
  Share, Person, Upload, DeleteOutline, Close,
} from "@mui/icons-material";
import client from "../../api/client";
import { TeamDashboard, UserBrief, DataRow, ChartPanel } from "./constants";

interface TeamPanelProps {
  rows: DataRow[];
  panels: ChartPanel[];
  myDashboards: TeamDashboard[];
  setMyDashboards: React.Dispatch<React.SetStateAction<TeamDashboard[]>>;
  sharedWithMe: TeamDashboard[];
  setSharedWithMe: React.Dispatch<React.SetStateAction<TeamDashboard[]>>;
  teamLoading: boolean;
  loadTeamData: () => Promise<[TeamDashboard[], TeamDashboard[]]>;
  setDashboardName: React.Dispatch<React.SetStateAction<string>>;
  setOriginalName: React.Dispatch<React.SetStateAction<string>>;
  setCurrentDashboardId: React.Dispatch<React.SetStateAction<string | null>>;
  hasAutoLoaded: boolean;
  applyTeamDashboard: (d: TeamDashboard) => void;
}

export default function TeamPanel({
  rows, panels, myDashboards, setMyDashboards, sharedWithMe, setSharedWithMe,
  teamLoading, loadTeamData,
  setDashboardName, setOriginalName, setCurrentDashboardId,
  hasAutoLoaded, applyTeamDashboard,
}: TeamPanelProps) {
  const [shareName, setShareName] = useState("");
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<TeamDashboard | null>(null);
  const [allUsers, setAllUsers] = useState<UserBrief[]>([]);
  const [tempAllowedUsers, setTempAllowedUsers] = useState<number[]>([]);

  // 上传当前看板到团队
  const uploadToTeam = async () => {
    const name = shareName.trim() || "我的看板";
    try {
      const r = await client.post("/bi/team/", { name, data: rows, panels });
      setMyDashboards(prev => [r.data, ...prev]);
      setShareName("");
      setDashboardName(name);
      setOriginalName(name);
    } catch {}
  };

  // 打开共享设置
  const openShareDialog = async (d: TeamDashboard) => {
    setShareTarget(d);
    setTempAllowedUsers([...d.allowed_users]);
    try {
      const r = await client.get("/bi/team/users");
      setAllUsers(r.data || []);
    } catch {}
    setShareDialogOpen(true);
  };

  // 切换共享（共享=全团队可见，取消共享=仅自己）
  const toggleShare = async (d: TeamDashboard) => {
    const newShared = !d.shared;
    try {
      await client.post(`/bi/team/${d.id}/share`, null, { params: { shared: newShared } });
      await client.put(`/bi/team/${d.id}`, { allowed_users: [] });
      setMyDashboards(prev => prev.map(p => p.id === d.id ? { ...p, shared: newShared, allowed_users: [] } : p));
    } catch {}
  };

  // 保存权限（仅指定用户可见模式）
  const savePermissions = async () => {
    if (!shareTarget) return;
    try {
      if (tempAllowedUsers.length > 0) {
        if (!shareTarget.shared) {
          await client.post(`/bi/team/${shareTarget.id}/share`, null, { params: { shared: true } });
        }
        await client.put(`/bi/team/${shareTarget.id}`, { allowed_users: tempAllowedUsers });
      } else {
        await client.put(`/bi/team/${shareTarget.id}`, { allowed_users: [] });
      }
      setMyDashboards(prev => prev.map(p => p.id === shareTarget.id
        ? { ...p, allowed_users: tempAllowedUsers, shared: tempAllowedUsers.length > 0 || shareTarget.shared }
        : p));
      setShareDialogOpen(false);
    } catch (e: any) { alert("保存失败: " + (e?.response?.data?.detail || e?.message)); }
  };

  // 删除团队看板
  const deleteTeamDashboard = async (id: string) => {
    try { await client.delete(`/bi/team/${id}`); setMyDashboards(prev => prev.filter(d => d.id !== id)); } catch {}
  };

  if (teamLoading) {
    return (
      <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
        <Box sx={{ textAlign: "center", py: 6 }}><CircularProgress size={24} /></Box>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
      {/* 上传当前看板 */}
      <Paper elevation={0} sx={{ p: 2.5, borderRadius: 3, border: "1px solid", borderColor: "#EBEDF0", mb: 3, bgcolor: "#F5F3FF" }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>📤 上传当前看板到团队</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: "block" }}>
          将当前编辑的看板数据和面板保存为团队可共享的看板
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField size="small" placeholder="看板名称" value={shareName}
            onChange={e => setShareName(e.target.value)}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
          <Button variant="contained" startIcon={<Upload />} onClick={uploadToTeam}
            sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1", whiteSpace: "nowrap" }}>
            上传
          </Button>
        </Box>
      </Paper>

      {/* 我的看板 */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        📋 我的看板 · {myDashboards.length}
      </Typography>
      {myDashboards.length === 0 && (
        <Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", py: 3 }}>
          暂无看板，上传当前看板即可创建
        </Typography>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mb: 3 }}>
        {myDashboards.map(d => (
          <Paper key={d.id} elevation={0} sx={{
            p: 2, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0",
            "&:hover": { borderColor: "#6366F1" }, transition: "all 0.15s",
          }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box>
                <Typography fontWeight={600} sx={{ fontSize: 14 }}>{d.name}</Typography>
                <Typography variant="caption" color="text.disabled">
                  {d.data.length} 行数据 · {d.panels.length} 面板 · {d.owner}
                </Typography>
              </Box>
              <Box sx={{ display: "flex", gap: 0.25 }}>
                <Chip label={d.shared ? "全团队" : "私有"} size="small"
                  color={d.shared ? "success" : "default"} variant="outlined"
                  sx={{ height: 20, fontSize: 10 }} />
              </Box>
            </Box>
            <Box sx={{ display: "flex", gap: 0.5, mt: 1.5 }}>
              <Button size="small" variant="outlined" onClick={() => applyTeamDashboard(d)}
                sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
                打开
              </Button>
              <Button size="small" variant="outlined"
                color={d.shared ? "warning" : "success"}
                onClick={() => toggleShare(d)}
                startIcon={<Share sx={{ fontSize: 14 }} />}
                sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
                {d.shared ? "取消共享" : "共享"}
              </Button>
              <Button size="small" variant="outlined" onClick={() => openShareDialog(d)}
                startIcon={<Person sx={{ fontSize: 14 }} />}
                sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
                权限
              </Button>
              <IconButton size="small" onClick={() => deleteTeamDashboard(d.id)} sx={{ ml: "auto" }}>
                <DeleteOutline sx={{ fontSize: 16, color: "error.main" }} />
              </IconButton>
            </Box>
          </Paper>
        ))}
      </Box>

      {/* ====== 共享权限弹窗 ====== */}
      <Dialog open={shareDialogOpen} onClose={() => setShareDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          🔐 指定可见成员 — {shareTarget?.name}
          <IconButton size="small" onClick={() => setShareDialogOpen(false)}><Close /></IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            默认「共享」后全团队可见。如需限制范围，在此勾选指定成员。
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ mb: 2, display: "block" }}>
            勾选的用户可在「我的团队」中看到此看板；不勾选任何人则全团队可见
          </Typography>
          <List dense sx={{ maxHeight: 260, overflow: "auto", border: "1px solid", borderColor: "#EBEDF0", borderRadius: 2 }}>
            {allUsers.map(u => (
              <ListItem key={u.id} dense
                secondaryAction={
                  <Checkbox size="small" checked={tempAllowedUsers.includes(u.id)}
                    onChange={() => {
                      setTempAllowedUsers(prev =>
                        prev.includes(u.id) ? prev.filter(id => id !== u.id) : [...prev, u.id]
                      );
                    }} />
                }>
                <ListItemAvatar><Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: "#6366F1" }}>{u.username[0]?.toUpperCase()}</Avatar></ListItemAvatar>
                <ListItemText
                  primary={u.username}
                  primaryTypographyProps={{ fontSize: 13 }}
                  secondary={shareTarget?.owner_id === u.id ? "看板所有者" : ""}
                />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShareDialogOpen(false)} sx={{ textTransform: "none" }}>取消</Button>
          <Button onClick={savePermissions} variant="contained" sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}>
            保存权限
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// SharedWithMePanel - "我的团队" tab content
interface SharedWithMePanelProps {
  sharedWithMe: TeamDashboard[];
  applyTeamDashboard: (d: TeamDashboard) => void;
}

export function SharedWithMePanel({ sharedWithMe, applyTeamDashboard }: SharedWithMePanelProps) {
  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        👥 共享给我 · {sharedWithMe.length}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: "block" }}>
        团队成员共享给你的数据看板
      </Typography>
      {sharedWithMe.length === 0 && (
        <Typography variant="body2" color="text.disabled" sx={{ textAlign: "center", py: 6 }}>
          暂无团队看板，等待团队成员共享
        </Typography>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
        {sharedWithMe.map(d => (
          <Paper key={d.id} elevation={0} sx={{
            p: 2, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0",
            "&:hover": { borderColor: "#10B981" }, transition: "all 0.15s",
          }}>
            <Box sx={{ display: "flex", justifyContent: "space-between" }}>
              <Box>
                <Typography fontWeight={600} sx={{ fontSize: 14 }}>{d.name}</Typography>
                <Typography variant="caption" color="text.disabled">
                  {d.data.length} 行 · {d.panels.length} 面板 · 来自 {d.owner}
                </Typography>
              </Box>
              <Chip label="团队" size="small" color="primary" variant="outlined"
                sx={{ height: 20, fontSize: 10 }} />
            </Box>
            <Button size="small" variant="contained" fullWidth
              onClick={() => applyTeamDashboard(d)}
              sx={{ mt: 1.5, borderRadius: 2, textTransform: "none", fontSize: 11, bgcolor: "#10B981" }}>
              查看看板
            </Button>
          </Paper>
        ))}
      </Box>
    </Box>
  );
}
