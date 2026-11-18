import { formatChinaTime } from "../utils/time";
// 审计日志管理页（含错误日志）
import { useState, useEffect } from "react";
import {
  Alert, Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Tooltip, Typography,
} from "@mui/material";
import client from "../api/client";

interface AuditLog {
  id: number; user_id: number; action: string;
  resource_type: string; resource_id: number;
  detail: any; ip: string; created_at: string;
}

interface ErrorLog {
  id: number; source: string; level: string; message: string; stack: string;
  url: string; username: string; user_agent: string; created_at: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [errors, setErrors] = useState<ErrorLog[]>([]);
  const [errorStats, setErrorStats] = useState<{ total: number; last24h: number } | null>(null);
  const [errorHint, setErrorHint] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get("/bi/engine/audit-logs?limit=100").then(r => {
      setLogs(r.data?.logs || []);
    }).catch(() => {}).finally(() => setLoading(false));
    client.get("/bi/errors", { params: { limit: 50 } }).then((r) => {
      setErrors(r.data?.items || []);
      setErrorStats(r.data?.stats || null);
    }).catch((e) => {
      setErrorHint(e?.response?.status === 403 ? "只有管理员可以查看错误日志" : "读取错误日志失败");
    });
  }, []);

  const actionColor: Record<string, "default"|"success"|"primary"|"warning"|"error"> = {
    "dashboard.create": "success",
    "dashboard.update": "primary",
    "permission.update": "warning",
    "card.delete": "error",
  };

  return (
    <Box sx={{ p: 3, maxWidth: 1000, mx: "auto" }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>操作审计日志</Typography>
      <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "#F8F9FC" }}>
              <TableCell sx={{ fontWeight: 600 }}>时间</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>操作</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>资源</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>详情</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>IP</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {logs.map(log => (
              <TableRow key={log.id}>
                <TableCell sx={{ fontSize: 12, color: '#6B7280' }}>{formatChinaTime(log.created_at).slice(0, 19)}</TableCell>
                <TableCell><Chip label={log.action} size="small" color={actionColor[log.action] || "default"} variant="outlined" /></TableCell>
                <TableCell sx={{ fontSize: 12 }}>{log.resource_type}#{log.resource_id}</TableCell>
                <TableCell sx={{ fontSize: 12, color: '#9CA3AF', maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {JSON.stringify(log.detail)?.slice(0, 80)}
                </TableCell>
                <TableCell sx={{ fontSize: 11, color: '#9CA3AF' }}>{log.ip}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 4, mb: 1 }}>
        <Typography variant="h6" fontWeight={700}>错误日志</Typography>
        <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>
          {errorStats ? `近 24 小时 ${errorStats.last24h} 条 · 共 ${errorStats.total} 条` : ""}
        </Typography>
      </Box>
      {errorHint ? (
        <Alert severity="info" sx={{ borderRadius: 2, fontSize: 12.5 }}>{errorHint}</Alert>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 2 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: "#F8F9FC" }}>
                <TableCell sx={{ fontWeight: 600 }}>时间</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>来源</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>用户</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>信息</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>页面</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {errors.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ fontSize: 12, color: "#9CA3AF", py: 3, textAlign: "center" }}>
                    暂无错误记录
                  </TableCell>
                </TableRow>
              ) : errors.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={{ fontSize: 12, color: "#6B7280", whiteSpace: "nowrap" }}>
                    {formatChinaTime(item.created_at).slice(0, 19)}
                  </TableCell>
                  <TableCell>
                    <Chip label={item.source === "backend" ? "后端" : "前端"} size="small"
                      color={item.source === "backend" ? "error" : "warning"} variant="outlined" />
                  </TableCell>
                  <TableCell sx={{ fontSize: 12 }}>{item.username || "—"}</TableCell>
                  <TableCell sx={{ fontSize: 12, maxWidth: 320, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <Tooltip placement="top-start" title={
                      <span style={{ whiteSpace: "pre-wrap" }}>{(item.stack || item.message).slice(0, 1500)}</span>
                    }>
                      <span>{item.message}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell title={item.url}
                    sx={{ fontSize: 11, color: "#94A3B8", maxWidth: 240, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.url}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
