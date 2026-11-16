/** 分享到我的团队 —— 协同看板：看板本体不变、数据集不复制，成员按「查看 / 编辑」授权 */

import { useCallback, useEffect, useState } from "react";
import {
  Alert, Avatar, Box, Button, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, List, ListItem, ListItemAvatar, ListItemText,
  MenuItem, TextField, Typography,
} from "@mui/material";
import { Groups } from "@mui/icons-material";
import client from "../../api/client";

interface Member { id: number; username: string; permission: "view" | "edit" }

interface Props {
  board: { id: number; name: string } | null;
  onClose: () => void;
  /** 权限 / 分享状态变化后，刷新「我的看板」的协同标与团队页 */
  onChanged: () => void;
}

export default function TeamShareDialog({ board, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [shared, setShared] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);

  const load = useCallback(async () => {
    if (!board) return;
    setLoading(true);
    setError("");
    try {
      const res = await client.get(`/bi/dashboards/${board.id}/team-permissions`);
      setShared(!!res.data?.team_shared);
      setMembers(res.data?.members || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "读取协同权限失败");
    } finally {
      setLoading(false);
    }
  }, [board]);

  useEffect(() => { void load(); }, [load]);

  const share = async () => {
    if (!board) return;
    setBusy(true);
    setError("");
    try {
      await client.post(`/bi/dashboards/${board.id}/team-share`);
      setShared(true);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "分享失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!board) return;
    setBusy(true);
    setError("");
    try {
      await client.put(`/bi/dashboards/${board.id}/team-permissions`, {
        permissions: members.map((m) => ({ user_id: m.id, permission: m.permission })),
      });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "保存失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const unshare = async () => {
    if (!board) return;
    setBusy(true);
    setError("");
    try {
      await client.delete(`/bi/dashboards/${board.id}/team-share`);
      setShared(false);
      await load();
      onChanged();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "取消协同失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!board} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <Groups sx={{ fontSize: 20, color: "#10B981" }} />
        分享到我的团队
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12.5, color: "text.secondary", mb: 1.5 }}>
          分享的是这一块看板本身，数据集调用不变、不复制；团队成员在「我的团队」里打开，默认只能查看。
        </Typography>
        {loading ? (
          <Box sx={{ py: 6, display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>
        ) : !shared ? (
          <Box sx={{ py: 3, textAlign: "center" }}>
            <Typography sx={{ fontSize: 14, fontWeight: 600, color: "#1D1D1F", mb: 0.75 }}>
              把「{board?.name}」变成协同看板？
            </Typography>
            <Typography sx={{ fontSize: 12, color: "#86868B", mb: 2.5 }}>
              分享后全团队都能在「我的团队」看到；需要谁一起改，再把他设为「可编辑」。
            </Typography>
            <Button variant="contained" disabled={busy} onClick={share}
              startIcon={busy ? <CircularProgress size={13} color="inherit" /> : <Groups sx={{ fontSize: 16 }} />}
              sx={{ textTransform: "none", borderRadius: 2, bgcolor: "#10B981", px: 2.5 }}>
              {busy ? "分享中…" : "分享到我的团队"}
            </Button>
          </Box>
        ) : (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: "#475569", flex: 1 }}>
                成员权限 · 默认「可查看」，改成「可编辑」后能保存看板内容
              </Typography>
              <Button size="small" onClick={unshare} disabled={busy}
                sx={{ textTransform: "none", fontSize: 12, color: "#94A3B8", minWidth: 0 }}>
                取消协同
              </Button>
            </Box>
            <List dense sx={{ maxHeight: 300, overflow: "auto", border: "1px solid #EEF3FB", borderRadius: 2 }}>
              {members.length === 0 ? (
                <ListItem><ListItemText primary="团队里还没有其他成员" primaryTypographyProps={{ fontSize: 12.5 }} /></ListItem>
              ) : members.map((m) => (
                <ListItem key={m.id} dense
                  secondaryAction={
                    <TextField select size="small" value={m.permission}
                      onChange={(e) => setMembers((prev) => prev.map((x) =>
                        x.id === m.id ? { ...x, permission: e.target.value as "view" | "edit" } : x))}
                      sx={{ width: 104, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                      <MenuItem value="view" sx={{ fontSize: 12 }}>可查看</MenuItem>
                      <MenuItem value="edit" sx={{ fontSize: 12 }}>可编辑</MenuItem>
                    </TextField>
                  }>
                  <ListItemAvatar>
                    <Avatar sx={{ width: 28, height: 28, fontSize: 12, bgcolor: m.permission === "edit" ? "#4F46E5" : "#CBD5E1" }}>
                      {m.username?.[0]?.toUpperCase()}
                    </Avatar>
                  </ListItemAvatar>
                  <ListItemText primary={m.username} primaryTypographyProps={{ fontSize: 13, fontWeight: 500 }} />
                </ListItem>
              ))}
            </List>
          </>
        )}
        {error && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
        {shared && (
          <Button variant="contained" onClick={save} disabled={busy}
            startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
            sx={{ textTransform: "none", borderRadius: 2, bgcolor: "#10B981" }}>
            {busy ? "保存中…" : "保存权限"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
