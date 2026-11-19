/** 操作监控（S7）—— 登录 / 看板 / 数据集 / AI / MCP 的统一流水 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Switch,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import {
  AutoAwesome, History, HubOutlined, People, Refresh, WarningAmber,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import {
  BORDER, EmptyState, INK, LINE, Loading, MUTED, SectionHead, StatCard,
  TD, TH, dialogPaperSx, dialogTitleSx, fmtNumber, fmtTime, useToast,
} from "./shared";

interface ActivityItem {
  id: number; source: "op" | "ai" | "mcp" | "security"; created_at: string;
  user_id: number | null; username: string; department: string;
  action: string; label: string; target_type: string; target_id: number | null;
  detail: Record<string, unknown>; ip: string; status: string;
  duration_ms: number; sensitive: boolean; risk: string;
  fingerprint: string; user_agent: string;
}

interface GuardBlock {
  id: number; dimension: "ip" | "fingerprint" | "user"; value: string;
  reason: string; hits: number; expires_at: string; created_at: string;
}

interface GuardInfo {
  config: { enabled: boolean; window_seconds: number; max_hits: number;
    ban_seconds: number; whitelist_ips: string[] };
  blocks: GuardBlock[];
}

interface Summary {
  range_days: number;
  totals: { all: number; op: number; ai: number; mcp: number; security: number; sensitive: number; failed: number; users: number };
  daily: { date: string; count: number }[];
  top_actions: { action: string; label: string; count: number }[];
}

const SOURCE_COLOR: Record<string, string> = {
  op: "#2563EB", ai: "#7C3AED", mcp: "#0F766E", security: "#DC2626",
};
const SOURCE_LABEL: Record<string, string> = {
  op: "操作", ai: "AI", mcp: "MCP", security: "安全",
};
const STATUS_LABEL: Record<string, string> = {
  ok: "成功", denied: "拒绝", error: "失败",
};

const PAGE_SIZE = 50;

export default function MonitorPanel() {
  const [days, setDays] = useState(7);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState("");
  const [keyword, setKeyword] = useState("");
  const [applied, setApplied] = useState("");
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [guardInfo, setGuardInfo] = useState<GuardInfo | null>(null);
  const [guardBusy, setGuardBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [auto, setAuto] = useState(false);
  const [detail, setDetail] = useState<ActivityItem | null>(null);
  const timer = useRef<number>(0);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const [sum, act, guardRes] = await Promise.all([
        client.get("/admin/monitor/summary", { params: { days } }),
        client.get("/admin/monitor/activity", {
          params: {
            days, source: source || undefined, status: status || undefined,
            keyword: applied || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE,
          },
        }),
        client.get("/admin/monitor/guard"),
      ]);
      setSummary(sum.data);
      setItems(act.data?.items || []);
      setTotal(Number(act.data?.total || 0));
      setGuardInfo(guardRes.data || null);
    } catch (err) {
      show(extractErrorMessage(err, "读取操作监控失败"), "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [days, source, status, applied, page, show]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    window.clearInterval(timer.current);
    if (!auto) return undefined;
    timer.current = window.setInterval(() => { void load(); }, 30000);
    return () => window.clearInterval(timer.current);
  }, [auto, load]);

  // 后端只返回有数据的日期；这里补齐连续 N 天（最多 30 根柱子）
  const daily = useMemo(() => {
    const counts = new Map((summary?.daily || []).map((d) => [d.date, d.count]));
    const span = Math.min(days, 30);
    return Array.from({ length: span }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (span - 1 - index));
      const key = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      return { date: key, count: counts.get(key) || 0 };
    });
  }, [summary, days]);

  const maxDaily = useMemo(
    () => Math.max(1, ...daily.map((d) => d.count)),
    [daily],
  );

  const releaseBlock = async (id: number) => {
    try {
      await client.delete(`/admin/monitor/guard/blocks/${id}`);
      show("已解封");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "解封失败"), "error");
    }
  };

  const toggleGuard = async (next: boolean) => {
    setGuardBusy(true);
    try {
      const res = await client.put("/admin/monitor/guard/config", { enabled: next });
      setGuardInfo(res.data || null);
      show(next ? "安全卫士已启用" : "安全卫士已关闭");
      setConfirmOff(false);
    } catch (err) {
      show(extractErrorMessage(err, "切换失败"), "error");
    } finally {
      setGuardBusy(false);
    }
  };

  return (
    <Box>
      <SectionHead
        title="操作监控"
        desc={`登录、看板、数据集、AI、MCP 全链路留痕 · 近 ${days} 天 ${fmtNumber(summary?.totals.all)} 条`}
        action={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: MUTED }}>自动刷新</Typography>
            <Switch size="small" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            <Button size="small" onClick={() => void load(true)} disabled={refreshing}
              startIcon={<Refresh sx={{ fontSize: 15 }} />}
              sx={{ textTransform: "none", fontSize: 12.5, color: "#4F46E5" }}>
              {refreshing ? "刷新中…" : "刷新"}
            </Button>
          </Box>
        }
      />

      <Box sx={{
        display: "grid", gap: 1.25, mb: 2,
        gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)", xl: "repeat(7, 1fr)" },
      }}>
        <StatCard label="总操作" value={fmtNumber(summary?.totals.all)} icon={<History />} />
        <StatCard label="敏感操作" value={fmtNumber(summary?.totals.sensitive)} icon={<WarningAmber />} tone="#DC2626" />
        <StatCard label="安全事件" value={fmtNumber(summary?.totals.security)} icon={<WarningAmber />} tone="#B91C1C" />
        <StatCard label="AI 调用" value={fmtNumber(summary?.totals.ai)} icon={<AutoAwesome />} tone="#7C3AED" />
        <StatCard label="MCP 调用" value={fmtNumber(summary?.totals.mcp)} icon={<HubOutlined />} tone="#0F766E" />
        <StatCard label="拒绝 / 失败" value={fmtNumber(summary?.totals.failed)} icon={<WarningAmber />} tone="#F59E0B" />
        <StatCard label="活跃用户" value={fmtNumber(summary?.totals.users)} icon={<People />} tone="#2563EB" />
      </Box>

      <Box sx={{ bgcolor: "#fff", border: `1px solid ${BORDER}`, borderRadius: "12px", p: 2, mb: 2 }}>
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.25, flexWrap: "wrap" }}>
          <TextField select size="small" label="时间范围" value={days}
            onChange={(e) => { setDays(Number(e.target.value)); setPage(0); }}
            sx={{ width: 120 }}>
            {[1, 7, 30, 90].map((n) => (
              <MenuItem key={n} value={n} sx={{ fontSize: 13 }}>近 {n} 天</MenuItem>
            ))}
          </TextField>
          <TextField select size="small" label="来源" value={source}
            onChange={(e) => { setSource(e.target.value); setPage(0); }}
            sx={{ width: 130 }}>
            <MenuItem value="" sx={{ fontSize: 13 }}>全部</MenuItem>
            <MenuItem value="op" sx={{ fontSize: 13 }}>操作</MenuItem>
            <MenuItem value="ai" sx={{ fontSize: 13 }}>AI 调用</MenuItem>
            <MenuItem value="mcp" sx={{ fontSize: 13 }}>MCP 调用</MenuItem>
            <MenuItem value="security" sx={{ fontSize: 13 }}>安全事件</MenuItem>
          </TextField>
          <TextField select size="small" label="状态" value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(0); }}
            sx={{ width: 120 }}>
            <MenuItem value="" sx={{ fontSize: 13 }}>全部</MenuItem>
            <MenuItem value="ok" sx={{ fontSize: 13 }}>成功</MenuItem>
            <MenuItem value="denied" sx={{ fontSize: 13 }}>拒绝</MenuItem>
            <MenuItem value="error" sx={{ fontSize: 13 }}>失败</MenuItem>
          </TextField>
          <TextField size="small" label="搜索用户 / 动作 / 详情" value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { setApplied(keyword.trim()); setPage(0); } }}
            sx={{ flex: 1, minWidth: 200 }} />
          <Button variant="contained" onClick={() => { setApplied(keyword.trim()); setPage(0); }}
            sx={{ textTransform: "none", fontSize: 13, borderRadius: 2, bgcolor: "#4F46E5", boxShadow: "none" }}>
            查询
          </Button>
        </Box>

        {/* 每日趋势：纯 CSS 柱状，不引图表库 */}
        <Box sx={{ mt: 2, display: "flex", alignItems: "flex-end", gap: 0.75, height: 60 }}>
          {daily.map((d) => (
            <Box key={d.date} sx={{ flex: 1, minWidth: 8, textAlign: "center" }}>
              <Box title={`${d.date}：${d.count}`} sx={{
                height: Math.max(3, Math.round((d.count / maxDaily) * 44)),
                bgcolor: d.count ? "rgba(79,70,229,0.35)" : "#EEF2F7",
                borderRadius: "3px 3px 0 0",
              }} />
              <Typography sx={{ fontSize: 9.5, color: "#A1A1A6", mt: 0.4 }}>{d.date}</Typography>
            </Box>
          ))}
          {!daily.length && (
            <Typography sx={{ fontSize: 12, color: MUTED }}>暂无数据</Typography>
          )}
        </Box>
      </Box>

      {/* 安全卫士：累计风险 → 自动封禁，支持人工解封 */}
      {guardInfo && (
        <Box sx={{ bgcolor: "#fff", border: `1px solid ${BORDER}`, borderRadius: "12px", p: 2, mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 600, color: INK }}>安全卫士</Typography>
            <Chip size="small" label={guardInfo.config.enabled ? "已启用" : "已关闭"}
              sx={{
                height: 20, fontSize: 10.5,
                color: guardInfo.config.enabled ? "#047857" : "#B91C1C",
                bgcolor: guardInfo.config.enabled ? "#ECFDF5" : "#FEF2F2",
              }} />
            <Typography sx={{ fontSize: 11.5, color: MUTED }}>
              {Math.round(guardInfo.config.window_seconds / 60)} 分钟内 ≥{guardInfo.config.max_hits} 次攻击
              → 封禁 {Math.round(guardInfo.config.ban_seconds / 60)} 分钟（IP / 指纹 / 账号）
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Chip size="small"
              label={`封禁中 ${guardInfo.blocks.length}`}
              sx={{
                height: 20, fontSize: 10.5,
                color: guardInfo.blocks.length ? "#B91C1C" : "#475569",
                bgcolor: guardInfo.blocks.length ? "#FEE2E2" : "#F1F5F9",
              }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, ml: 0.5 }}>
              <Typography sx={{ fontSize: 11.5, color: MUTED }}>启用</Typography>
              <Switch size="small" checked={guardInfo.config.enabled} disabled={guardBusy}
                onChange={(event) => {
                  if (event.target.checked) void toggleGuard(true);
                  else setConfirmOff(true);
                }}
                inputProps={{ "aria-label": "安全卫士开关" }} />
            </Box>
          </Box>
          {guardInfo.blocks.length > 0 ? (
            <Box sx={{ mt: 1.25, display: "flex", flexDirection: "column", gap: 0.75 }}>
              {guardInfo.blocks.map((block) => (
                <Box key={block.id} sx={{
                  display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap",
                  px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "#FEF2F2",
                }}>
                  <Chip size="small"
                    label={{ ip: "IP", fingerprint: "指纹", user: "账号" }[block.dimension] || block.dimension}
                    sx={{ height: 19, fontSize: 10.5, color: "#B91C1C", bgcolor: "#FEE2E2" }} />
                  <Typography sx={{ fontSize: 11.5, color: INK, fontFamily: "ui-monospace" }}>
                    {block.value}
                  </Typography>
                  <Typography sx={{ fontSize: 11.5, color: MUTED }}>
                    命中 {block.hits} 次 · {block.reason} · 到期 {fmtTime(block.expires_at)}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Button size="small" onClick={() => void releaseBlock(block.id)}
                    sx={{ textTransform: "none", fontSize: 12, color: "#B91C1C", minWidth: 0, px: 1 }}>
                    解封
                  </Button>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography sx={{ mt: 1, fontSize: 12, color: MUTED }}>
              当前没有生效中的封禁。
            </Typography>
          )}
        </Box>
      )}

      <Box sx={{ bgcolor: "#fff", border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden" }}>
        {loading ? <Loading /> : items.length === 0 ? (
          <EmptyState text="没有匹配的记录" hint="换个时间范围或关键词试试" />
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={TH}>时间</TableCell>
                    <TableCell sx={TH}>用户</TableCell>
                    <TableCell sx={TH}>来源</TableCell>
                    <TableCell sx={TH}>动作</TableCell>
                    <TableCell sx={TH}>对象</TableCell>
                    <TableCell sx={TH}>状态</TableCell>
                    <TableCell sx={TH}>IP</TableCell>
                    <TableCell sx={TH}>指纹</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.source}-${item.id}`} hover
                      onClick={() => setDetail(item)}
                      sx={{ cursor: "pointer", bgcolor: item.sensitive ? "rgba(254,242,242,0.45)" : undefined }}>
                      <TableCell sx={{ ...TD, whiteSpace: "nowrap", color: MUTED }}>
                        {fmtTime(item.created_at)}
                      </TableCell>
                      <TableCell sx={TD}>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.2 }}>
                          <Typography sx={{ fontSize: 12.5, color: INK, fontWeight: 500 }}>
                            {item.username || "系统"}
                          </Typography>
                          {item.department && (
                            <Typography sx={{ fontSize: 10.5, color: MUTED }}>{item.department}</Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={TD}>
                        <Chip size="small" label={SOURCE_LABEL[item.source] || item.source}
                          sx={{
                            height: 20, fontSize: 10.5, fontWeight: 600,
                            color: SOURCE_COLOR[item.source] || INK,
                            bgcolor: `${SOURCE_COLOR[item.source] || "#64748B"}14`,
                          }} />
                      </TableCell>
                      <TableCell sx={TD}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                          <Typography sx={{ fontSize: 12.5, color: INK }}>{item.label}</Typography>
                          {item.sensitive && (
                            <Chip size="small" label="敏感"
                              sx={{ height: 18, fontSize: 10, color: "#B91C1C", bgcolor: "#FEE2E2" }} />
                          )}
                          {item.risk === "high" && (
                            <Chip size="small" label="高危"
                              sx={{ height: 18, fontSize: 10, color: "#B91C1C", bgcolor: "#FEE2E2" }} />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell sx={{ ...TD, color: MUTED }}>
                        {item.target_type || "-"}{item.target_id ? ` #${item.target_id}` : ""}
                      </TableCell>
                      <TableCell sx={TD}>
                        <Typography sx={{
                          fontSize: 12,
                          color: item.status === "ok" ? "#059669" : item.status === "denied" ? "#B91C1C" : "#D97706",
                        }}>
                          {STATUS_LABEL[item.status] || item.status || "成功"}
                          {item.duration_ms ? ` · ${item.duration_ms}ms` : ""}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ ...TD, color: MUTED, whiteSpace: "nowrap" }}>
                        {item.ip || "-"}
                      </TableCell>
                      <TableCell sx={{ ...TD, color: MUTED, fontFamily: "ui-monospace", fontSize: 11 }}>
                        {item.fingerprint || "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, borderTop: `1px solid ${LINE}` }}>
              <Typography sx={{ fontSize: 12, color: MUTED }}>
                共 {fmtNumber(total)} 条 · 第 {page + 1} / {Math.max(1, Math.ceil(total / PAGE_SIZE))} 页
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}
                sx={{ textTransform: "none", fontSize: 12.5 }}>上一页</Button>
              <Button size="small" disabled={(page + 1) * PAGE_SIZE >= total}
                onClick={() => setPage((p) => p + 1)}
                sx={{ textTransform: "none", fontSize: 12.5 }}>下一页</Button>
            </Box>
          </>
        )}
      </Box>

      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>操作详情</DialogTitle>
        <DialogContent>
          {detail && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Chip size="small" label={SOURCE_LABEL[detail.source]} sx={{ fontSize: 11 }} />
                <Chip size="small" label={detail.label} sx={{ fontSize: 11 }} />
                {detail.sensitive && <Chip size="small" label="敏感操作" sx={{ fontSize: 11, color: "#B91C1C", bgcolor: "#FEE2E2" }} />}
              </Box>
              <Typography sx={{ fontSize: 12.5, color: "#4B5563" }}>
                {detail.username || "系统"} · {detail.department || "无部门"} · {fmtTime(detail.created_at)}
              </Typography>
              <Typography sx={{ fontSize: 11.5, color: MUTED, fontFamily: "ui-monospace" }}>
                {detail.action} · {detail.target_type || "-"}{detail.target_id ? ` #${detail.target_id}` : ""}
                {detail.ip ? ` · ${detail.ip}` : ""}
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                <Typography sx={{ fontSize: 11, color: MUTED }}>
                  指纹：{detail.fingerprint || "-"}
                </Typography>
                <Typography sx={{ fontSize: 11, color: MUTED, wordBreak: "break-all" }}>
                  UA：{detail.user_agent || "-"}
                </Typography>
              </Box>
              <Box component="pre" sx={{
                m: 0, p: 1.5, borderRadius: 2, bgcolor: "#F8FAFC", border: `1px solid ${BORDER}`,
                fontSize: 11.5, lineHeight: 1.7, color: INK, overflow: "auto", maxHeight: 320,
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}>
                {JSON.stringify(detail.detail || {}, null, 2)}
              </Box>
            </Box>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOff} onClose={() => setConfirmOff(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>关闭安全卫士？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "#4B5563", lineHeight: 1.8 }}>
            关闭后攻击型请求不再自动拦截，已有封禁也会暂停生效；重新开启后，
            仍在有效期内的封禁会恢复。所有启停都会写入审计。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setConfirmOff(false)}
            sx={{ textTransform: "none" }}>取消</Button>
          <Button size="small" color="error" disabled={guardBusy}
            onClick={() => void toggleGuard(false)} sx={{ textTransform: "none" }}>
            确认关闭
          </Button>
        </DialogActions>
      </Dialog>

      {toastNode}
    </Box>
  );
}
