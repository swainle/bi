/** AI 整理版面（S4）—— 只请求布局操作，应用时由父级一次性入撤销栈 */

import { useState } from "react";
import {
  Button, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Snackbar, TextField, Typography,
} from "@mui/material";
import { AutoFixHigh, Undo } from "@mui/icons-material";
import client from "../../../api/client";
import type { CanvasItem } from "../boardTypes";

export interface LayoutOp {
  key: string; x: number; y: number; w: number; h: number;
}

interface Props {
  items: CanvasItem[];
  selectedKeys: string[];
  designWidth: number;
  fullWidthKinds?: string[];
  onApply: (ops: LayoutOp[]) => void;
  onUndo: () => void;
}

const GAP = 16;

export default function AiLayoutBar({
  items, selectedKeys, designWidth, fullWidthKinds = ["filter"], onApply, onUndo,
}: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"input" | "result">("input");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ ops: LayoutOp[]; summary: string; rows: number } | null>(null);
  const [applied, setApplied] = useState(false);

  const scope = selectedKeys.length >= 2 ? "selection" : "all";
  const targets = scope === "selection"
    ? items.filter((i) => selectedKeys.includes(i.key))
    : items;
  const usable = targets.filter((i) => (i.type || "chart") !== "filter").length;
  const disabled = usable < 2 || busy;

  const payloadItems = targets.map((i) => ({
    key: i.key, type: i.type || "chart", kind: i.kind,
    x: i.x, y: i.y, w: i.w, h: i.h,
  }));

  const bounds = (() => {
    if (scope !== "selection" || targets.length === 0) return undefined;
    const x = Math.min(...targets.map((i) => i.x));
    const y = Math.min(...targets.map((i) => i.y));
    const right = Math.max(...targets.map((i) => i.x + i.w));
    const bottom = Math.max(...targets.map((i) => i.y + i.h));
    return { x, y, w: right - x, h: bottom - y };
  })();

  const ask = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await client.post("/bi/ai/layout", {
        scope,
        bounds,
        instruction: instruction.trim() || undefined,
        design: { width: designWidth, gap: GAP, full_width_kinds: fullWidthKinds },
        items: payloadItems,
      }, { timeout: 60000 });
      setResult(res.data);
      setPhase("result");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "AI 整理失败，可手动调整");
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!result?.ops?.length) return;
    onApply(result.ops);
    setOpen(false);
    setPhase("input");
    setApplied(true);
    setResult(null);
    setInstruction("");
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setPhase("input");
    setError("");
    setResult(null);
  };

  return (
    <>
      <Button
        size="small"
        disabled={disabled}
        onClick={() => setOpen(true)}
        startIcon={<AutoFixHigh sx={{ fontSize: 16 }} />}
        title={usable < 2 ? "至少 2 个元素才能整理" : "AI 整理版面"}
        sx={{
          textTransform: "none", fontSize: 11.5, height: 26, minWidth: 0, px: 1,
          borderRadius: 1.25, color: "#4F46E5", bgcolor: "rgba(79,70,229,0.08)",
          "&:hover": { bgcolor: "rgba(79,70,229,0.14)" },
          "&.Mui-disabled": { color: "#B6B6BF", bgcolor: "transparent" },
        }}
      >
        AI 整理{scope === "selection" ? "选区" : ""}
      </Button>

      <Dialog open={open} onClose={close} maxWidth="xs" fullWidth
        PaperProps={{ sx: { borderRadius: "12px" } }}>
        <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>
          {phase === "input" ? "AI 整理版面" : "整理结果"}
        </DialogTitle>

        {phase === "input" ? (
          <DialogContent sx={{ pt: "6px !important" }}>
            <Typography sx={{ fontSize: 12, color: "#86868B", mb: 1.5, lineHeight: 1.7 }}>
              将整理{scope === "selection" ? "选中的元素（不动其它元素）" : "整页元素"}：
              自动归行、等宽、统一 {GAP}px 间距，筛选栏保持整宽。
            </Typography>
            <TextField
              fullWidth size="small" value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="一句话排版（可选）：上面 6 张一行，下面两张各占一半"
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 } }}
            />
            {error && (
              <Typography sx={{ mt: 1, fontSize: 11.5, color: "#EF4444" }}>{error}</Typography>
            )}
          </DialogContent>
        ) : (
          <DialogContent sx={{ pt: "6px !important" }}>
            <Typography sx={{ fontSize: 12.5, color: "#1D1D1F" }}>
              {result?.summary || "已生成整理方案"}
            </Typography>
            <Typography sx={{ mt: 0.75, fontSize: 11.5, color: "#86868B" }}>
              共 {result?.ops?.length || 0} 个元素；应用后可一次撤销（⌘Z）
            </Typography>
          </DialogContent>
        )}

        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          {phase === "input" ? (
            <>
              <Button onClick={close} sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>
                取消
              </Button>
              <Button
                variant="contained" onClick={() => void ask()} disabled={busy}
                startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
                sx={{
                  bgcolor: "#6366F1", textTransform: "none", borderRadius: 2,
                  "&:hover": { bgcolor: "#4F46E5" }, boxShadow: "none",
                }}
              >
                开始整理
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setPhase("input")} disabled={busy}
                sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>
                重试
              </Button>
              <Button onClick={close} sx={{ textTransform: "none", fontSize: 13, color: "#86868B" }}>
                取消
              </Button>
              <Button variant="contained" onClick={apply}
                sx={{
                  bgcolor: "#6366F1", textTransform: "none", borderRadius: 2,
                  "&:hover": { bgcolor: "#4F46E5" }, boxShadow: "none",
                }}>
                应用
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={applied}
        autoHideDuration={4000}
        onClose={() => setApplied(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message="版面已整理"
        action={
          <Button size="small" startIcon={<Undo sx={{ fontSize: 15 }} />}
            onClick={() => { onUndo(); setApplied(false); }}
            sx={{ textTransform: "none", color: "#C7D2FE", fontSize: 12.5 }}>
            撤销
          </Button>
        }
      />
    </>
  );
}
