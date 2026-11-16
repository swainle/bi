/** 管理后台共用视觉令牌与小件 —— 与「我的看板 / 项目」页同一套，保证是一家人 */

import { useCallback, useState, type ReactNode } from "react";
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Snackbar, Typography,
} from "@mui/material";
import { InboxOutlined } from "@mui/icons-material";
import { extractErrorMessage } from "../../api/client";

export const BORDER = "#E8E8ED";
export const INK = "#1D1D1F";
export const MUTED = "#86868B";
export const LINE = "#EEF3FB";
export const BRAND = "#6366F1";

export const TH = {
  fontSize: 11.5, fontWeight: 600, color: "#64748B",
  py: 0.85, bgcolor: "#F8F9FC", borderColor: LINE,
  whiteSpace: "nowrap",
} as const;

export const TD = { fontSize: 12.5, py: 0.9, borderColor: "#F1F5F9", color: INK } as const;

/** 分区标题：标题 + 一句说明 + 右侧主操作 */
export function SectionHead({
  title, desc, action,
}: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2, mb: 2.5 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 800, color: "text.primary", letterSpacing: -0.2 }}>
          {title}
        </Typography>
        {desc && (
          <Typography sx={{ mt: 0.5, fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{desc}</Typography>
        )}
      </Box>
      <Box sx={{ flex: 1 }} />
      {action}
    </Box>
  );
}

export function PrimaryButton(props: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="contained"
      size="small"
      {...props}
      sx={{
        bgcolor: BRAND, textTransform: "none", fontSize: 12.5, borderRadius: 2,
        height: 36, px: 2, boxShadow: "none", "&:hover": { bgcolor: "#4F46E5", boxShadow: "none" },
        "&.Mui-disabled": { bgcolor: "#C7C9F5", color: "#fff" },
        ...(props.sx as object),
      }}
    />
  );
}

/** 白底卡片（表头浅蓝底、细线用 #EEF3FB） */
export function PanelCard({ children, sx }: { children: ReactNode; sx?: object }) {
  return (
    <Box sx={{
      bgcolor: "#fff", border: `1px solid ${BORDER}`, borderRadius: "12px",
      p: 2.5, minWidth: 0, ...sx,
    }}>
      {children}
    </Box>
  );
}

export function StatCard({
  label, value, hint, icon, tone = BRAND,
}: { label: string; value: ReactNode; hint?: string; icon?: ReactNode; tone?: string }) {
  return (
    <Box sx={{
      bgcolor: "#fff", border: `1px solid ${BORDER}`, borderRadius: "12px",
      p: 2, display: "flex", alignItems: "flex-start", gap: 1.5, minWidth: 0,
    }}>
      {icon && (
        <Box sx={{
          width: 32, height: 32, borderRadius: "9px", flexShrink: 0,
          bgcolor: `${tone}14`, color: tone, display: "grid", placeItems: "center",
          "& .MuiSvgIcon-root": { fontSize: 18 },
        }}>
          {icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 11.5, color: MUTED, letterSpacing: 0.2 }}>{label}</Typography>
        <Typography sx={{ fontSize: 22, fontWeight: 700, color: INK, lineHeight: 1.35, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        {hint && <Typography sx={{ fontSize: 11, color: "#A1A1A6", mt: 0.25 }}>{hint}</Typography>}
      </Box>
    </Box>
  );
}

export function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <Box sx={{ py: 6, textAlign: "center" }}>
      <InboxOutlined sx={{ fontSize: 30, color: "#DCDCE1" }} />
      <Typography sx={{ mt: 1, fontSize: 13, fontWeight: 500, color: INK }}>{text}</Typography>
      {hint && <Typography sx={{ mt: 0.5, fontSize: 12, color: MUTED }}>{hint}</Typography>}
    </Box>
  );
}

export function Loading({ py = 6 }: { py?: number }) {
  return (
    <Box sx={{ py, display: "flex", justifyContent: "center" }}>
      <CircularProgress size={22} />
    </Box>
  );
}

/** 弹窗统一样式 */
export const dialogTitleSx = { fontSize: 16, fontWeight: 700 } as const;
export const dialogPaperSx = { borderRadius: "12px", border: `1px solid ${BORDER}` } as const;

export function ConfirmDialog({
  open, title, desc, confirmText = "确定", danger, busy, onClose, onConfirm, children,
}: {
  open: boolean; title: string; desc?: string; confirmText?: string; danger?: boolean;
  busy?: boolean; onClose: () => void; onConfirm: () => void; children?: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth
      PaperProps={{ sx: dialogPaperSx }}>
      <DialogTitle sx={dialogTitleSx}>{title}</DialogTitle>
      <DialogContent>
        {desc && <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.7 }}>{desc}</Typography>}
        {children}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} disabled={busy} sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>
          取消
        </Button>
        <Button
          onClick={onConfirm} disabled={busy} variant="contained"
          sx={{
            textTransform: "none", fontSize: 13, borderRadius: 2, boxShadow: "none",
            bgcolor: danger ? "#EF4444" : BRAND, "&:hover": { bgcolor: danger ? "#DC2626" : "#4F46E5" },
          }}>
          {busy ? <CircularProgress size={14} color="inherit" /> : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** 轻提示（成功 / 失败两种） */
export function useToast() {
  const [toast, setToast] = useState<{ msg: string; severity: "success" | "error" } | null>(null);
  const show = useCallback((msg: string, severity: "success" | "error" = "success") => {
    setToast({ msg, severity });
  }, []);
  const node = (
    <Snackbar
      open={!!toast}
      autoHideDuration={2600}
      onClose={() => setToast(null)}
      anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
    >
      <Alert
        severity={toast?.severity || "success"}
        onClose={() => setToast(null)}
        sx={{ borderRadius: 2, fontSize: 12.5 }}
      >
        {toast?.msg}
      </Alert>
    </Snackbar>
  );
  return { show, node };
}

/** 后端校验错误的友好文案（pydantic 的英文提示翻成人话，未知错误原样返回） */
export function friendlyError(err: any, fallback = "操作失败"): string {
  const raw = extractErrorMessage(err, fallback);
  if (/not a valid email address/i.test(raw)) {
    return "邮箱格式不正确：不要用 .local 这类保留域名，请填真实邮箱";
  }
  if (/String should have at least/i.test(raw)) return "填写内容太短";
  if (/must be a valid integer/i.test(raw)) return "请输入整数";
  return raw;
}

export function fmtTime(value?: string | null) {
  if (!value) return "—";
  const text = String(value).replace("T", " ");
  return text.slice(0, 19);
}

export function fmtUptime(seconds?: number) {
  const total = Math.max(0, Math.floor(Number(seconds || 0)));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分 ${total % 60} 秒`;
}

export function fmtNumber(value?: number | null) {
  const n = Number(value || 0);
  return n.toLocaleString("zh-CN");
}
