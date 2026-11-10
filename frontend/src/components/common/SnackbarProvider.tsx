/** 全局通知上下文 — 替代 alert() 实现统一的消息提示 */

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import { Snackbar, Alert, type AlertColor } from "@mui/material";

interface Snack {
  open: boolean;
  msg: string;
  severity: AlertColor;
}

interface SnackbarCtx {
  notify: (msg: string, severity?: AlertColor) => void;
  success: (msg: string) => void;
  error: (msg: string) => void;
  warn: (msg: string) => void;
  info: (msg: string) => void;
}

const Ctx = createContext<SnackbarCtx | null>(null);

export function useSnackbar(): SnackbarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSnackbar must be inside <SnackbarProvider>");
  return ctx;
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [snack, setSnack] = useState<Snack>({ open: false, msg: "", severity: "info" });

  const notify = useCallback((msg: string, severity: AlertColor = "info") => {
    setSnack({ open: true, msg, severity });
  }, []);

  const success = useCallback((msg: string) => notify(msg, "success"), [notify]);
  const error = useCallback((msg: string) => notify(msg, "error"), [notify]);
  const warn = useCallback((msg: string) => notify(msg, "warning"), [notify]);
  const info = useCallback((msg: string) => notify(msg, "info"), [notify]);

  return (
    <Ctx.Provider value={{ notify, success, error, warn, info }}>
      {children}
      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          variant="filled"
          sx={{ width: "100%", maxWidth: 480 }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  );
}
