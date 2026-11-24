/** 把当前页复制到另一个项目（跨项目复制页面）.
 *
 * 服务端一次性复制：只往目标项目追加一页，目标已有的页一行不动；数据集绑定保持不变。
 */

import { useEffect, useState } from "react";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, Typography } from "@mui/material";
import client from "../../api/client";
import type { DashboardBrief } from "../canvas/spec";

interface Props {
  open: boolean;
  onClose: () => void;
  /** 当前项目（不会出现在目标列表里） */
  sourceDocId: number;
  viewKey: string;
  viewTitle: string;
  onCopied: (targetId: number, targetName: string, newViewKey: string) => void;
}

export default function CopyPageToBoardDialog({ open, onClose, sourceDocId, viewKey, viewTitle, onCopied }: Props) {
  const [targets, setTargets] = useState<DashboardBrief[]>([]);
  const [targetId, setTargetId] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setTargetId("");
    client.get("/bi/dashboards")
      .then((res) => {
        const list = (res.data?.dashboards ?? []) as DashboardBrief[];
        setTargets(list.filter((item) => item.id !== sourceDocId));
      })
      .catch(() => setError("项目列表没取到，稍后再试"));
  }, [open, sourceDocId]);

  const copy = async () => {
    if (targetId === "") return;
    setBusy(true);
    setError("");
    try {
      const res = await client.post(`/bi/dashboards/${targetId}/views/copy-from`, {
        source_dashboard_id: sourceDocId,
        source_view_key: viewKey,
      });
      const name = targets.find((item) => item.id === targetId)?.name ?? "目标项目";
      onCopied(Number(targetId), name, String(res.data?.view_key ?? ""));
      onClose();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || "复制失败，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>复制页面到其他项目</DialogTitle>
      <DialogContent sx={{ pt: "6px !important" }}>
        <Typography sx={{ fontSize: 13, color: "#4B5563", marginBottom: 1.5 }}>
          把「{viewTitle || viewKey}」整页（含卡片与版面）复制过去，目标项目已有的页不受影响。
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={{ fontSize: 12.5, color: "#64748B", width: 56, flexShrink: 0 }}>目标</Typography>
          <Select
            size="small" displayEmpty value={targetId} sx={{ flex: 1, fontSize: 12.5 }}
            onChange={(event) => setTargetId(Number(event.target.value))}
            data-slot="copy-target"
          >
            <MenuItem value="" disabled sx={{ fontSize: 12.5 }}>选择项目</MenuItem>
            {targets.map((item) => (
              <MenuItem key={item.id} value={item.id} sx={{ fontSize: 12.5 }}>{item.name}</MenuItem>
            ))}
          </Select>
        </Box>
        {targets.length === 0 && !error ? (
          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", marginTop: 1 }}>没有其他可编辑的项目</Typography>
        ) : null}
        {error ? <Alert severity="error" sx={{ marginTop: 1.5, borderRadius: 2, fontSize: 12 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>取消</Button>
        <Button
          variant="contained" disabled={targetId === "" || busy} onClick={copy}
          sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, bgcolor: "#4F46E5", boxShadow: "none" }}
        >
          {busy ? "复制中…" : "复制"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
