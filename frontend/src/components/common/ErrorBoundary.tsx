/** React 错误边界 — 捕获组件树中的未处理异常，上报到后端错误日志（bi_error_log）
 *  增强版：高级 fallback UI + 路由级隔离 + 自动重试 + 暗色适配 */
import { Component, type ReactNode, type ErrorInfo } from "react";
import { Box, Typography, Button, Collapse, IconButton, Stack } from "@mui/material";
import {
  ErrorOutline,
  Home as HomeIcon,
  Refresh as RefreshIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from "@mui/icons-material";

// ── 上报错误到后端（同一页面 10s 内同样报错只发一次，避免雪崩）──
const reported = new Map<string, number>();

function shouldReport(key: string): boolean {
  const now = Date.now();
  if (now - (reported.get(key) || 0) < 10_000) return false;
  reported.set(key, now);
  if (reported.size > 50) {
    reported.forEach((at, k) => {
      if (now - at > 60_000) reported.delete(k);
    });
  }
  return true;
}

export async function reportError(message: string, stack?: string) {
  const url = window.location.href;
  if (!shouldReport(`${message}|${window.location.pathname}`)) return;
  try {
    const token = localStorage.getItem("access_token") || "";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    await fetch("/api/report", {
      method: "POST",
      headers,
      body: JSON.stringify({
        source: "frontend",
        level: "error",
        message,
        stack: (stack || "").slice(0, 5000),
        url,
        user_agent: navigator.userAgent,
        extra: { path: window.location.pathname, referrer: document.referrer || "" },
      }),
    });
  } catch {
    // 上报失败静默忽略，避免雪崩
  }
}

// ── 类型 ──
interface Props {
  children: ReactNode;
  /** 自定义 fallback 覆盖默认 UI */
  fallback?: ReactNode;
  /** 发生错误时调用（可选） */
  onError?: (error: Error, info: ErrorInfo) => void;
  /** 显示"返回首页"按钮（默认 true，内嵌区域可设 false） */
  showHomeButton?: boolean;
  /** 标题自定义（默认 "页面加载异常"） */
  title?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  showDetails: boolean;
}

// ── 默认 ErrorBoundary（全局级） ──
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, showDetails: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, showDetails: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error.message, info.componentStack);
    reportError(error.message, error.stack || info.componentStack || undefined);
    this.props.onError?.(error, info);
  }

  /** 重置错误状态（允许重试渲染） */
  handleRetry = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
  };

  goHome = () => {
    this.setState({ hasError: false, error: null, showDetails: false });
    window.location.hash = "#/";
    window.location.reload();
  };

  toggleDetails = () => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      const showHome = this.props.showHomeButton !== false;
      const title = this.props.title || "页面加载异常";
      const err = this.state.error;
      const stack = err?.stack || "";

      return <ErrorFallback
        title={title}
        message={err?.message || "发生了未知错误"}
        stack={stack}
        showDetails={this.state.showDetails}
        showHomeButton={showHome}
        onRetry={this.handleRetry}
        onGoHome={this.goHome}
        onToggleDetails={this.toggleDetails}
      />;
    }
    return this.props.children;
  }
}

// ── 共享 Fallback UI 组件 ──
function ErrorFallback({
  title, message, stack, showDetails, showHomeButton,
  onRetry, onGoHome, onToggleDetails,
}: {
  title: string;
  message: string;
  stack: string;
  showDetails: boolean;
  showHomeButton: boolean;
  onRetry: () => void;
  onGoHome: () => void;
  onToggleDetails: () => void;
}) {
  return (
    <Box sx={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: 320, gap: 2.5, p: 4,
      bgcolor: "background.paper",
    }}>
      <ErrorOutline sx={{ fontSize: 56, color: "error.main", opacity: 0.85 }} />
      <Typography variant="h6" sx={{ fontWeight: 600 }}>{title}</Typography>
      <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ maxWidth: 480 }}>
        {message}
      </Typography>

      {/* 操作按钮 */}
      <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
        <Button
          variant="contained"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
        >
          重试
        </Button>
        {showHomeButton && (
          <Button
            variant="outlined"
            startIcon={<HomeIcon />}
            onClick={onGoHome}
          >
            返回首页
          </Button>
        )}
      </Stack>

      {/* 错误详情折叠 */}
      {stack && (
        <Box sx={{ width: "100%", maxWidth: 560, mt: 1 }}>
          <IconButton
            size="small"
            onClick={onToggleDetails}
            sx={{ color: "text.disabled" }}
          >
            {showDetails ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
          <Typography variant="caption" color="text.disabled" sx={{ ml: 0.5 }}>
            {showDetails ? "收起错误详情" : "查看错误详情"}
          </Typography>
          <Collapse in={showDetails}>
            <Box sx={{
              mt: 1, p: 1.5, borderRadius: 1,
              bgcolor: "action.hover",
              maxHeight: 200, overflow: "auto",
              fontFamily: "monospace", fontSize: 12,
              color: "text.secondary",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}>
              {stack}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}

// ── 全局 JS 错误监听（在模块加载时自动安装）──
if (typeof window !== "undefined") {
  window.addEventListener("error", (e: ErrorEvent) => {
    if (e.error && e.error.message) {
      reportError(e.error.message, e.error.stack);
    }
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const msg = e.reason?.message || String(e.reason);
    reportError(msg, e.reason?.stack);
  });
}
