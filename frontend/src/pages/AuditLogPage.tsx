// 审计日志管理页
import { useState, useEffect } from "react";
import { Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, Chip } from "@mui/material";
import client from "../api/client";

interface AuditLog {
  id: number; user_id: number; action: string;
  resource_type: string; resource_id: number;
  detail: any; ip: string; created_at: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get("/bi/engine/audit-logs?limit=100").then(r => {
      setLogs(r.data?.logs || []);
    }).catch(() => {}).finally(() => setLoading(false));
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
                <TableCell sx={{ fontSize: 12, color: '#6B7280' }}>{log.created_at?.slice(0, 19)}</TableCell>
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
    </Box>
  );
}
