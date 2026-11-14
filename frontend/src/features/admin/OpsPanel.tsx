/** 运维 —— 运行状态、查询/缓存指标、后台任务与维护操作 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Box, Button, CircularProgress, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Typography,
} from "@mui/material";
import {
  BoltOutlined as BoltIcon, DeleteSweepOutlined as CleanIcon, Refresh as RefreshIcon,
  SpeedOutlined as SpeedIcon, StorageOutlined as DbIcon, CachedOutlined as CacheIcon,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import {
  BORDER, EmptyState, INK, LINE, Loading, MUTED, PanelCard, SectionHead, StatCard,
  TD, TH, fmtNumber, fmtTime, fmtUptime, useToast,
} from "./shared";

interface OpsData {
  app: { name: string; version: string; uptime_seconds: number };
  database: {
    pool_size: number; checked_in: number; checked_out: number; overflow: number;
    utilization_pct: number; pool_timeouts: number; ok: boolean; latency_ms: number; error: string;
  };
  redis: { enabled: boolean };
  query: {
    in_flight: number; total: number; ok: number; failed: number; timeout: number;
    cancelled: number; quota_rejected: number; live_total: number; live_ok: number; live_failed: number;
  };
  render_cache: {
    ttl_seconds: number; lookups: number; hits: number; hit_rate: number | null;
    stores: number; invalidations: number;
  };
  slow_queries: { threshold_ms: number; sampled: number; last_hour: number; last_day: number };
  jobs: {
    executor: string; workers: number; inflight_budget: number; queue_len: number;
    worker_processes: number; total: number; by_state: Record<string, number>;
  };
  errors: { total: number; last24h: number; retain_days: number };
  top_slow: Array<{ table_name: string; elapsed_ms: number; source: string; created_at: string }>;
  settings: Record<string, string | number>;
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 1.5,
      py: 1, borderBottom: `1px solid ${LINE}`, "&:last-of-type": { borderBottom: "none" },
    }}>
      <Typography sx={{ fontSize: 12.5, color: MUTED, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ flex: 1 }} />
      <Typography sx={{ fontSize: 12.5, color: INK, fontVariantNumeric: "tabular-nums" }}>{value}</Typography>
      {hint && <Typography sx={{ fontSize: 10.5, color: "#A1A1A6", width: 84, textAlign: "right", flexShrink: 0 }}>{hint}</Typography>}
    </Box>
  );
}

export default function OpsPanel({ canManage }: { canManage: boolean }) {
  const [data, setData] = useState<OpsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<"" | "cache" | "prune">("");
  const inFlight = useRef(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async (manual = false) => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const res = await client.get("/admin/ops");
      setData(res.data);
    } catch (err) {
      if (manual) show(extractErrorMessage(err, "读取运维状态失败"), "error");
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [show]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const clearCache = async () => {
    if (acting) return;
    setActing("cache");
    try {
      await client.post("/admin/ops/clear-cache", {});
      show("渲染缓存已清空");
      await load(true);
    } catch (err) {
      show(extractErrorMessage(err, "操作失败"), "error");
    } finally {
      setActing("");
    }
  };

  const pruneErrors = async () => {
    if (acting || !data) return;
    setActing("prune");
    try {
      const res = await client.post("/admin/ops/prune-errors", { days: data.errors.retain_days });
      show(`已清理 ${res.data?.deleted ?? 0} 条错误日志`);
      await load(true);
    } catch (err) {
      show(extractErrorMessage(err, "操作失败"), "error");
    } finally {
      setActing("");
    }
  };

  const hitRate = data?.render_cache.hit_rate;
  const poolCapacity = data ? data.database.pool_size + Math.max(0, data.database.overflow) : 0;

  return (
    <Box>
      <SectionHead
        title="运维"
        desc="进程指标、后台任务与维护操作；数字为当前进程口径"
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

      {loading && !data ? (
        <Loading />
      ) : !data ? (
        <EmptyState text="读取运维状态失败" hint="确认后端在运行，或稍后重试" />
      ) : (
        <>
          <Box sx={{ display: "grid", gap: 2, mb: 2.5, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            <StatCard label="运行时长" value={fmtUptime(data.app.uptime_seconds)} icon={<BoltIcon />}
              hint={`v${data.app.version}`} tone="#6366F1" />
            <StatCard label="数据库延迟" value={`${data.database.latency_ms} ms`} icon={<DbIcon />}
              hint={data.database.ok ? "连接正常" : "连接失败"} tone={data.database.ok ? "#10B981" : "#EF4444"} />
            <StatCard label="查询成功 / 总数" value={`${fmtNumber(data.query.ok)} / ${fmtNumber(data.query.total)}`} icon={<SpeedIcon />}
              hint={`失败 ${fmtNumber(data.query.failed)} · 超时 ${fmtNumber(data.query.timeout)}`} tone="#0EA5E9" />
            <StatCard label="渲染缓存命中率" value={hitRate == null ? "—" : `${Math.round(hitRate * 100)}%`} icon={<CacheIcon />}
              hint={`TTL ${data.render_cache.ttl_seconds}s · 命中 ${fmtNumber(data.render_cache.hits)}`} tone="#8B5CF6" />
          </Box>

          <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" } }}>
            <PanelCard>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK, mb: 1 }}>服务与资源</Typography>
              <Row label="服务" value={`${data.app.name} v${data.app.version}`} />
              <Row label="数据库" value={data.database.ok ? "正常" : "异常"} hint={data.database.error || `${data.database.latency_ms} ms`} />
              <Row
                label="连接池"
                value={`${data.database.checked_out} / ${poolCapacity || data.database.pool_size}`}
                hint={`空闲 ${data.database.checked_in} · 超时 ${data.database.pool_timeouts}`}
              />
              <Row label="Redis" value={data.redis.enabled ? "已连接" : "未启用"} hint={data.redis.enabled ? "" : "进程内缓存"} />
              <Row label="异步任务" value={data.jobs.executor === "worker" ? "worker 进程" : "inline"} hint={`队列 ${data.jobs.queue_len}`} />
              <Row label="慢查询" value={`近 1h ${fmtNumber(data.slow_queries.last_hour)} · 24h ${fmtNumber(data.slow_queries.last_day)}`} hint={`>${data.slow_queries.threshold_ms} ms`} />
            </PanelCard>

            <PanelCard>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK, mb: 1 }}>查询与缓存</Typography>
              <Row label="查询总数" value={fmtNumber(data.query.total)} hint={`进行中 ${data.query.in_flight}`} />
              <Row label="失败 / 超时" value={`${fmtNumber(data.query.failed)} / ${fmtNumber(data.query.timeout)}`} hint={`取消 ${data.query.cancelled}`} />
              <Row label="直连源库" value={`${fmtNumber(data.query.live_ok)} / ${fmtNumber(data.query.live_total)}`} hint={`失败 ${data.query.live_failed}`} />
              <Row
                label="缓存命中率"
                value={hitRate == null ? "—" : `${Math.round(hitRate * 100)}%`}
                hint={`${fmtNumber(data.render_cache.hits)} / ${fmtNumber(data.render_cache.lookups)}`}
              />
              <Row label="缓存写入" value={fmtNumber(data.render_cache.stores)} hint={`失效 ${data.render_cache.invalidations}`} />
              <Row label="错误日志" value={`${fmtNumber(data.errors.total)} 条`} hint={`保留 ${data.errors.retain_days} 天`} />
            </PanelCard>

            <PanelCard>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK, mb: 1 }}>后台任务</Typography>
              <Row label="告警评估" value={`每 ${data.settings.alerts_seconds}s`} />
              <Row label="定时报表" value={`每 ${data.settings.reports_seconds}s`} />
              <Row label="自动同步" value={`每 ${data.settings.sync_seconds}s`} hint={`每轮 ${data.settings.sync_max_per_run} 表`} />
              <Row label="查询超时" value={`${data.settings.query_timeout_ms} ms`} />
              <Row label="并发配额" value={`${data.settings.user_max_concurrent} / 账号`} />
              <Row label="限流" value={`${data.settings.rate_limit_per_min} 次/分钟`} />
            </PanelCard>

            <PanelCard>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK, mb: 0.5 }}>维护操作</Typography>
              <Typography sx={{ fontSize: 11.5, color: MUTED, mb: 1.5 }}>
                只做安全操作：不删业务数据，缓存可随时重建
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Button
                    size="small" variant="outlined" disabled={!canManage || acting !== ""}
                    onClick={() => void clearCache()}
                    startIcon={acting === "cache" ? <CircularProgress size={13} color="inherit" /> : <CacheIcon sx={{ fontSize: 16 }} />}
                    sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, height: 34, borderColor: BORDER, color: INK }}
                  >
                    清空渲染缓存
                  </Button>
                  <Typography sx={{ fontSize: 11.5, color: MUTED }}>
                    修改版面后「没生效」时可手动清一次
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Button
                    size="small" variant="outlined" disabled={!canManage || acting !== ""}
                    onClick={() => void pruneErrors()}
                    startIcon={acting === "prune" ? <CircularProgress size={13} color="inherit" /> : <CleanIcon sx={{ fontSize: 16 }} />}
                    sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, height: 34, borderColor: BORDER, color: INK }}
                  >
                    清理过期错误日志
                  </Button>
                  <Typography sx={{ fontSize: 11.5, color: MUTED }}>
                    按保留天数（{data.errors.retain_days} 天）
                  </Typography>
                </Box>
              </Box>
            </PanelCard>
          </Box>

          <Box sx={{ mt: 2.5, border: `1px solid ${BORDER}`, borderRadius: "12px", bgcolor: "#fff", overflow: "hidden" }}>
            <Box sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${LINE}` }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK }}>慢查询采样</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={TH}>时间</TableCell>
                    <TableCell sx={TH}>表 / 数据集</TableCell>
                    <TableCell sx={{ ...TH, textAlign: "right" }}>耗时</TableCell>
                    <TableCell sx={TH}>来源</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.top_slow.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EmptyState text="暂无慢查询" hint={`超过 ${data.slow_queries.threshold_ms}ms 的查询会被采样`} />
                      </TableCell>
                    </TableRow>
                  ) : data.top_slow.map((item, index) => (
                    <TableRow key={`${item.created_at}-${index}`} hover>
                      <TableCell sx={{ ...TD, color: "#94A3B8", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                        {fmtTime(item.created_at)}
                      </TableCell>
                      <TableCell sx={{ ...TD, fontFamily: "ui-monospace", fontSize: 11.5 }}>{item.table_name}</TableCell>
                      <TableCell sx={{ ...TD, textAlign: "right", fontVariantNumeric: "tabular-nums", color: item.elapsed_ms > 3000 ? "#DC2626" : INK }}>
                        {Math.round(item.elapsed_ms)} ms
                      </TableCell>
                      <TableCell sx={{ ...TD, color: "#64748B" }}>{item.source === "live" ? "直连源库" : "仓内"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        </>
      )}
      {toastNode}
    </Box>
  );
}
