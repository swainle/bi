/** 错误日志 —— 前端 / 后端异常查询（管理员或已授权账号） */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Drawer, IconButton, MenuItem, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import {
  Close as CloseIcon, DeleteSweepOutlined as CleanIcon, Refresh as RefreshIcon,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import {
  BORDER, EmptyState, INK, LINE, Loading, MUTED, PrimaryButton, SectionHead,
  TD, TH, dialogPaperSx, dialogTitleSx, fmtTime, fmtNumber, useToast,
} from "./shared";

interface ErrorLog {
  id: number; source: string; level: string; message: string; stack: string;
  url: string; username: string; user_agent: string; extra: any; created_at: string;
}

export default function ErrorsPanel({ canClean }: { canClean: boolean }) {
  const [items, setItems] = useState<ErrorLog[]>([]);
  const [stats, setStats] = useState<{ total: number; last24h: number; by_source: Record<string, number> } | null>(null);
  const [retainDays, setRetainDays] = useState(30);
  const [source, setSource] = useState("all");
  const [level, setLevel] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<ErrorLog | null>(null);
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanDays, setCleanDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await client.get("/bi/errors", {
        params: {
          source: source === "all" ? undefined : source,
          level: level === "all" ? undefined : level,
          limit: 100,
        },
      });
      setItems(res.data?.items || []);
      setStats(res.data?.stats || null);
      setRetainDays(Number(res.data?.retain_days || 30));
    } catch (err) {
      show(extractErrorMessage(err, "读取错误日志失败"), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [source, level, show]);

  useEffect(() => { void load(); }, [load]);

  const clean = async () => {
    if (busy) return;
    const days = Number(cleanDays);
    if (!Number.isFinite(days) || days < 1 || days > 3650) { show("保留天数需要在 1-3650 之间", "error"); return; }
    setBusy(true);
    try {
      const res = await client.post("/admin/ops/prune-errors", { days });
      setCleanOpen(false);
      show(`已清理 ${res.data?.deleted ?? 0} 条`);
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "清理失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const sourceChips = useMemo(() => {
    const by = stats?.by_source || {};
    return { frontend: by.frontend || 0, backend: by.backend || 0 };
  }, [stats]);

  return (
    <Box>
      <SectionHead
        title="错误日志"
        desc={`前端异常与后端未处理异常 · 保留 ${retainDays} 天 · 近 24 小时 ${fmtNumber(stats?.last24h)} 条 / 共 ${fmtNumber(stats?.total)} 条`}
        action={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {canClean && (
              <Button
                size="small" onClick={() => { setCleanDays(String(retainDays)); setCleanOpen(true); }}
                startIcon={<CleanIcon sx={{ fontSize: 16 }} />}
                sx={{ textTransform: "none", fontSize: 12.5, color: MUTED, height: 34, borderRadius: 2, px: 1.5 }}
              >
                清理
              </Button>
            )}
            <Button
              size="small" onClick={() => void load(true)} disabled={refreshing}
              startIcon={<RefreshIcon sx={{ fontSize: 16 }} />}
              sx={{ textTransform: "none", fontSize: 12.5, color: MUTED, height: 34, borderRadius: 2, px: 1.5 }}
            >
              刷新
            </Button>
          </Box>
        }
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2, flexWrap: "wrap" }}>
        <TextField
          select size="small" value={source} onChange={(e) => setSource(e.target.value)}
          sx={{ width: 140, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
        >
          <MenuItem value="all" sx={{ fontSize: 13 }}>全部来源</MenuItem>
          <MenuItem value="frontend" sx={{ fontSize: 13 }}>前端（{sourceChips.frontend}）</MenuItem>
          <MenuItem value="backend" sx={{ fontSize: 13 }}>后端（{sourceChips.backend}）</MenuItem>
        </TextField>
        <TextField
          select size="small" value={level} onChange={(e) => setLevel(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
        >
          <MenuItem value="all" sx={{ fontSize: 13 }}>全部级别</MenuItem>
          <MenuItem value="error" sx={{ fontSize: 13 }}>error</MenuItem>
          <MenuItem value="warning" sx={{ fontSize: 13 }}>warning</MenuItem>
        </TextField>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, color: MUTED }}>最多显示最近 100 条</Typography>
      </Box>

      <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden", bgcolor: "#fff" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={TH}>时间</TableCell>
                <TableCell sx={TH}>来源</TableCell>
                <TableCell sx={TH}>级别</TableCell>
                <TableCell sx={TH}>用户</TableCell>
                <TableCell sx={TH}>信息</TableCell>
                <TableCell sx={TH}>页面</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={6}><Loading py={4} /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState text="没有错误记录" hint={source !== "all" || level !== "all" ? "换个筛选条件试试" : "当前没有前端 / 后端异常"} />
                  </TableCell>
                </TableRow>
              ) : items.map((item) => (
                <TableRow
                  key={item.id} hover onClick={() => setDetail(item)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell sx={{ ...TD, color: "#94A3B8", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                    {fmtTime(item.created_at)}
                  </TableCell>
                  <TableCell sx={TD}>
                    <Chip
                      label={item.source === "backend" ? "后端" : "前端"} size="small"
                      sx={{
                        height: 19, fontSize: 10,
                        bgcolor: item.source === "backend" ? "rgba(239,68,68,0.10)" : "rgba(245,158,11,0.12)",
                        color: item.source === "backend" ? "#B91C1C" : "#B45309",
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ ...TD, color: item.level === "warning" ? "#B45309" : "#DC2626", fontFamily: "ui-monospace", fontSize: 11.5 }}>
                    {item.level}
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#475569" }}>{item.username || "—"}</TableCell>
                  <TableCell sx={{ ...TD, maxWidth: 380 }}>
                    <Typography noWrap sx={{ fontSize: 12.5, color: INK }} title={item.message}>
                      {item.message}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#94A3B8", maxWidth: 240 }}>
                    <Typography noWrap sx={{ fontSize: 11.5 }} title={item.url}>
                      {item.url || "—"}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      {/* 详情抽屉 */}
      <Drawer
        anchor="right" open={!!detail} onClose={() => setDetail(null)}
        PaperProps={{ sx: { width: { xs: "92vw", sm: 560 }, borderLeft: `1px solid ${BORDER}` } }}
      >
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <Box sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${LINE}`, display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 14, fontWeight: 700, color: INK }}>错误详情</Typography>
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={() => setDetail(null)}>
              <CloseIcon sx={{ fontSize: 18, color: MUTED }} />
            </IconButton>
          </Box>
          <Box sx={{ p: 2.5, overflow: "auto", flex: 1 }}>
            <Typography sx={{ fontSize: 12.5, color: INK, lineHeight: 1.7, wordBreak: "break-word" }}>
              {detail?.message}
            </Typography>
            <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: "80px 1fr", rowGap: 0.75, columnGap: 1 }}>
              {[
                ["来源", detail?.source === "backend" ? "后端" : "前端"],
                ["级别", detail?.level || "—"],
                ["时间", fmtTime(detail?.created_at)],
                ["用户", detail?.username || "—"],
                ["页面", detail?.url || "—"],
                ["UA", detail?.user_agent || "—"],
              ].map(([label, value]) => (
                <Box key={String(label)} sx={{ display: "contents" }}>
                  <Typography sx={{ fontSize: 11.5, color: "#A1A1A6" }}>{label}</Typography>
                  <Typography sx={{ fontSize: 12, color: "#475569", wordBreak: "break-all" }}>{value}</Typography>
                </Box>
              ))}
            </Box>
            {detail?.stack && (
              <>
                <Typography sx={{ mt: 2, mb: 0.75, fontSize: 11.5, fontWeight: 600, color: "#64748B" }}>
                  堆栈
                </Typography>
                <Box component="pre" sx={{
                  m: 0, p: 1.5, bgcolor: "#F8FAFC", border: `1px solid ${LINE}`, borderRadius: 1.5,
                  fontSize: 11, lineHeight: 1.6, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-all",
                  maxHeight: 460, overflow: "auto",
                }}>
                  {detail.stack}
                </Box>
              </>
            )}
            {detail?.extra && Object.keys(detail.extra).length > 0 && (
              <>
                <Typography sx={{ mt: 2, mb: 0.75, fontSize: 11.5, fontWeight: 600, color: "#64748B" }}>
                  附加信息
                </Typography>
                <Box component="pre" sx={{
                  m: 0, p: 1.5, bgcolor: "#F8FAFC", border: `1px solid ${LINE}`, borderRadius: 1.5,
                  fontSize: 11, lineHeight: 1.6, color: "#334155", whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {JSON.stringify(detail.extra, null, 2)}
                </Box>
              </>
            )}
          </Box>
        </Box>
      </Drawer>

      {/* 清理 */}
      <Dialog open={cleanOpen} onClose={busy ? undefined : () => setCleanOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>清理错误日志</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "text.secondary", mb: 2, lineHeight: 1.7 }}>
            删除早于指定天数的记录，删除后不可恢复。
          </Typography>
          <TextField
            label="保留最近 N 天" size="small" type="number" value={cleanDays}
            onChange={(e) => setCleanDays(e.target.value)} fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setCleanOpen(false)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void clean()} disabled={busy}
            sx={{ bgcolor: "#EF4444", "&:hover": { bgcolor: "#DC2626" } }}>
            {busy ? "清理中…" : "清理"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>
      {toastNode}
    </Box>
  );
}
