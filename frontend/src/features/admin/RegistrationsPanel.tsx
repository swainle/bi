/** 注册审批 —— 管理员或部门负责人审批注册申请（通过后才能登录） */

import { useCallback, useEffect, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, TextField, Typography,
} from "@mui/material";
import {
  CheckCircleOutline as ApproveIcon, Refresh as RefreshIcon, BlockOutlined as RejectIcon,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import {
  BORDER, ConfirmDialog, EmptyState, INK, Loading, MUTED, PrimaryButton,
  SectionHead, TD, TH, dialogPaperSx, dialogTitleSx, fmtTime, useToast,
} from "./shared";

interface Registration {
  id: number;
  username: string;
  email: string;
  role: string;
  department_id: number | null;
  department_name: string;
  created_at: string;
  approval_status: "pending" | "approved" | "rejected";
  reject_reason: string;
  approved_at: string;
}

const STATUS_TABS = [
  { key: "pending", label: "待审批" },
  { key: "approved", label: "已通过" },
  { key: "rejected", label: "已驳回" },
] as const;

export default function RegistrationsPanel({
  isAdmin, scopeHint, scope,
}: { isAdmin: boolean; scopeHint?: string; scope?: string }) {
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [items, setItems] = useState<Registration[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approveTarget, setApproveTarget] = useState<Registration | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Registration | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await client.get("/admin/registrations", { params: { status } });
      setItems(res.data?.items || []);
      setPending(Number(res.data?.pending || 0));
    } catch (err) {
      show(extractErrorMessage(err, "读取注册申请失败"), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [status, show]);

  useEffect(() => { void load(); }, [load]);

  const approve = async () => {
    if (!approveTarget || busy) return;
    setBusy(true);
    try {
      const res = await client.post(`/admin/registrations/${approveTarget.id}/approve`, {});
      setApproveTarget(null);
      show(res.data?.message || "已通过");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "审批失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!rejectTarget || busy) return;
    setBusy(true);
    try {
      const res = await client.post(`/admin/registrations/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      setRejectTarget(null);
      setRejectReason("");
      show(res.data?.message || "已驳回");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "驳回失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <SectionHead
        title="注册审批"
        desc={
          scopeHint
            || (scope === "department"
              ? "部门管理员：这里只显示本部门的注册申请，通过后才能登录"
              : "新注册的账号默认不可登录；通过审批后才生效，避免有人选「股东高层」直接看核心数据")
        }
        action={
          <Button
            size="small" onClick={() => void load(true)} disabled={refreshing}
            startIcon={refreshing ? <CircularProgress size={13} color="inherit" /> : <RefreshIcon sx={{ fontSize: 16 }} />}
            sx={{ textTransform: "none", fontSize: 12.5, color: MUTED, borderRadius: 2, height: 34, px: 1.5 }}
          >
            刷新
          </Button>
        }
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        {STATUS_TABS.map((tab) => {
          const active = status === tab.key;
          return (
            <Box
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              sx={{
                px: 1.5, py: 0.6, borderRadius: 2, cursor: "pointer",
                bgcolor: active ? "rgba(99,102,241,0.08)" : "transparent",
                color: active ? "#4F46E5" : MUTED,
                fontSize: 12.5, fontWeight: active ? 600 : 400,
                transition: "all .15s",
                "&:hover": { bgcolor: active ? "rgba(99,102,241,0.10)" : "rgba(15,23,42,0.04)" },
              }}
            >
              {tab.label}
              {tab.key === "pending" && pending > 0 ? ` · ${pending}` : ""}
            </Box>
          );
        })}
        <Box sx={{ flex: 1 }} />
        {!isAdmin && (
          <Typography sx={{ fontSize: 11.5, color: "#A1A1A6" }}>只能审批你负责部门的申请</Typography>
        )}
      </Box>

      <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden", bgcolor: "#fff" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={TH}>申请人</TableCell>
                <TableCell sx={TH}>邮箱</TableCell>
                <TableCell sx={TH}>申请部门</TableCell>
                <TableCell sx={TH}>申请时间</TableCell>
                <TableCell sx={TH}>
                  {status === "pending" ? "操作" : status === "rejected" ? "驳回原因" : "通过时间"}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={5}><Loading py={4} /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <EmptyState
                      text={status === "pending" ? "没有待审批的注册申请" : status === "approved" ? "暂无已通过的申请" : "暂无被驳回的申请"}
                      hint={status === "pending" ? "有人注册后会出现在这里" : undefined}
                    />
                  </TableCell>
                </TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={TD}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        bgcolor: "rgba(99,102,241,0.12)", color: "#4F46E5",
                        display: "grid", placeItems: "center", fontSize: 11.5, fontWeight: 700,
                      }}>
                        {item.username?.[0]?.toUpperCase() || "U"}
                      </Box>
                      <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: INK }}>
                        {item.username}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#475569" }}>{item.email}</TableCell>
                  <TableCell sx={TD}>
                    <Chip
                      label={item.department_name} size="small"
                      sx={{ height: 20, fontSize: 10.5, bgcolor: "#F1F5F9", color: "#475569" }}
                    />
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>
                    {fmtTime(item.created_at)}
                  </TableCell>
                  <TableCell sx={TD}>
                    {status === "pending" ? (
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        <Button
                          size="small" startIcon={<ApproveIcon sx={{ fontSize: 15 }} />}
                          onClick={() => setApproveTarget(item)}
                          sx={{ textTransform: "none", fontSize: 12, color: "#059669", minWidth: 0, px: 0.75 }}
                        >
                          通过
                        </Button>
                        <Button
                          size="small" startIcon={<RejectIcon sx={{ fontSize: 15 }} />}
                          onClick={() => { setRejectTarget(item); setRejectReason(""); }}
                          sx={{ textTransform: "none", fontSize: 12, color: "#EF4444", minWidth: 0, px: 0.75 }}
                        >
                          驳回
                        </Button>
                      </Box>
                    ) : status === "rejected" ? (
                      <Typography noWrap title={item.reject_reason} sx={{ fontSize: 12, color: "#B45309", maxWidth: 260 }}>
                        {item.reject_reason || "—"}
                      </Typography>
                    ) : (
                      <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>{fmtTime(item.approved_at)}</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <ConfirmDialog
        open={!!approveTarget}
        title="通过注册申请"
        desc={`通过后「${approveTarget?.username}」即可登录，并按「${approveTarget?.department_name}」的数据权限使用系统。确认这个人是对的再通过。`}
        confirmText="通过"
        busy={busy}
        onClose={() => setApproveTarget(null)}
        onConfirm={() => void approve()}
      />

      <Dialog
        open={!!rejectTarget} onClose={busy ? undefined : () => setRejectTarget(null)}
        maxWidth="xs" fullWidth PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle sx={dialogTitleSx}>驳回注册申请</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 1.5 }}>
            驳回「{rejectTarget?.username}」的申请，账号无法登录。
          </Typography>
          <TextField
            label="原因（可选，申请人登录时会看到）" size="small" fullWidth
            multiline minRows={2} value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            inputProps={{ maxLength: 200 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRejectTarget(null)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void reject()} disabled={busy}
            sx={{ bgcolor: "#EF4444", "&:hover": { bgcolor: "#DC2626" } }}>
            {busy ? <CircularProgress size={14} color="inherit" /> : "驳回"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
      {toastNode}
    </Box>
  );
}
