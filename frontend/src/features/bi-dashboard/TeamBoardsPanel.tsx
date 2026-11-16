/** 我的团队 —— 协同看板（看板本体 + 数据集都是同一份，不复制） */

import { useCallback, useEffect, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Paper, Typography,
} from "@mui/material";
import { Groups, OpenInNew, PeopleOutline, Settings } from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import client from "../../api/client";

interface TeamBoard {
  id: number;
  name: string;
  owner_id: number | null;
  owner_name: string;
  charts: number;
  views: number;
  updated_at: string;
  team_editors: number;
  my_permission: "owner" | "view" | "edit";
}

interface Props {
  refreshKey: number;
  onOpenShare: (board: { id: number; name: string }) => void;
}

const CARD_BORDER = "#E8E8ED";
const INK = "#1D1D1F";
const MUTED = "#86868B";

function BoardCard({ board, mode, onOpen, onEdit, onShare }: {
  board: TeamBoard;
  mode: "mine" | "shared";
  onOpen: () => void;
  onEdit: () => void;
  onShare?: () => void;
}) {
  const canEdit = mode === "mine" || board.my_permission === "edit";
  return (
    <Paper elevation={0} sx={{
      p: 2, borderRadius: 2.5, border: `1px solid ${CARD_BORDER}`, bgcolor: "#fff",
      transition: "border-color .16s ease, box-shadow .16s ease",
      "&:hover": { borderColor: "#C9C9D2", boxShadow: "0 4px 16px rgba(15,23,42,0.07)" },
    }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap title={board.name} sx={{ fontSize: 14, fontWeight: 600, color: INK }}>
            {board.name}
          </Typography>
          <Typography sx={{ mt: 0.5, fontSize: 11.5, color: MUTED }}>
            {board.charts} 个图表 · {board.views} 页
            {mode === "mine" ? ` · ${board.team_editors} 位可编辑` : ` · 来自 ${board.owner_name || "团队成员"}`}
          </Typography>
        </Box>
        {mode === "mine" ? (
          <Chip label="协同" size="small"
            sx={{ height: 20, fontSize: 10, fontWeight: 600, bgcolor: "rgba(16,185,129,0.10)", color: "#059669" }} />
        ) : (
          <Chip label={board.my_permission === "edit" ? "可编辑" : "可查看"} size="small"
            sx={{
              height: 20, fontSize: 10, fontWeight: 600,
              bgcolor: board.my_permission === "edit" ? "rgba(79,70,229,0.10)" : "#F1F5F9",
              color: board.my_permission === "edit" ? "#4F46E5" : "#475569",
            }} />
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mt: 1.5 }}>
        <Button size="small" variant="outlined" onClick={onOpen}
          sx={{ textTransform: "none", fontSize: 11.5, borderRadius: 2, borderColor: "#D8E2F5", color: "#475569", py: 0.2 }}>
          打开
        </Button>
        {canEdit && (
          <Button size="small" variant="outlined" startIcon={<OpenInNew sx={{ fontSize: 13 }} />} onClick={onEdit}
            sx={{ textTransform: "none", fontSize: 11.5, borderRadius: 2, borderColor: "#D8E2F5", color: "#475569", py: 0.2 }}>
            编辑
          </Button>
        )}
        {mode === "mine" && onShare && (
          <Button size="small" variant="text" startIcon={<Settings sx={{ fontSize: 13 }} />} onClick={onShare}
            sx={{ textTransform: "none", fontSize: 11.5, color: "#4F46E5", py: 0.2 }}>
            权限
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 10.5, color: "#A8B7CC" }}>{board.updated_at.slice(0, 16)}</Typography>
      </Box>
    </Paper>
  );
}

export default function TeamBoardsPanel({ refreshKey, onOpenShare }: Props) {
  const nav = useNavigate();
  const [myShared, setMyShared] = useState<TeamBoard[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<TeamBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await client.get("/bi/dashboards/team");
      setMyShared(res.data?.my_shared || []);
      setSharedWithMe(res.data?.shared_with_me || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "团队看板加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const groupGrid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
    gap: 1.5,
  } as const;

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.75 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 800, color: "text.primary", letterSpacing: -0.2 }}>
          我的团队
        </Typography>
        <Chip label="协同看板" size="small"
          sx={{ height: 20, fontSize: 10.5, fontWeight: 600, bgcolor: "rgba(16,185,129,0.10)", color: "#059669" }} />
      </Box>
      <Typography sx={{ fontSize: 12, color: "#94A3B8", mb: 3 }}>
        分享到团队的是看板本身，数据集调用不变；成员按「查看 / 编辑」权限协作。
      </Typography>

      {loading ? (
        <Box sx={{ py: 10, display: "grid", placeItems: "center" }}><CircularProgress size={26} /></Box>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {error && <Alert severity="error" sx={{ borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}

          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <Groups sx={{ fontSize: 17, color: "#10B981" }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }}>我分享的</Typography>
              <Typography sx={{ fontSize: 11.5, color: "#A8B7CC" }}>{myShared.length}</Typography>
            </Box>
            {myShared.length === 0 ? (
              <Box sx={{ py: 5, textAlign: "center", border: `1px dashed ${CARD_BORDER}`, borderRadius: 2.5 }}>
                <PeopleOutline sx={{ fontSize: 30, color: "#DCDCE1" }} />
                <Typography sx={{ mt: 0.75, fontSize: 12.5, color: MUTED }}>
                  还没有把看板分享到团队 —— 在「我的看板」卡片 ⋯ 菜单点「分享到我的团队」
                </Typography>
              </Box>
            ) : (
              <Box sx={groupGrid}>
                {myShared.map((board) => (
                  <BoardCard key={board.id} board={board} mode="mine"
                    onOpen={() => nav(`/bi/dashboards/${board.id}`)}
                    onEdit={() => nav(`/bi/canvas?doc=${board.id}`)}
                    onShare={() => onOpenShare({ id: board.id, name: board.name })} />
                ))}
              </Box>
            )}
          </Box>

          <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
              <PeopleOutline sx={{ fontSize: 17, color: "#4F46E5" }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: INK }}>共享给我的</Typography>
              <Typography sx={{ fontSize: 11.5, color: "#A8B7CC" }}>{sharedWithMe.length}</Typography>
            </Box>
            {sharedWithMe.length === 0 ? (
              <Box sx={{ py: 5, textAlign: "center", border: `1px dashed ${CARD_BORDER}`, borderRadius: 2.5 }}>
                <PeopleOutline sx={{ fontSize: 30, color: "#DCDCE1" }} />
                <Typography sx={{ mt: 0.75, fontSize: 12.5, color: MUTED }}>
                  暂无团队看板，等团队成员分享
                </Typography>
              </Box>
            ) : (
              <Box sx={groupGrid}>
                {sharedWithMe.map((board) => (
                  <BoardCard key={board.id} board={board} mode="shared"
                    onOpen={() => nav(`/bi/dashboards/${board.id}`)}
                    onEdit={() => nav(`/bi/canvas?doc=${board.id}`)} />
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
