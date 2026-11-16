/** 概览 —— 关键计数 + 系统状态 + 最近错误 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, CircularProgress, Typography } from "@mui/material";
import {
  BugReport as BugIcon, Dashboard as DashIcon, DatasetLinked as DatasetIcon,
  Refresh as RefreshIcon, Storage as SourceIcon, People as PeopleIcon,
  HowToReg as HowToRegIcon,
} from "@mui/icons-material";
import client from "../../api/client";
import {
  PanelCard, SectionHead, StatCard, Loading, EmptyState,
  fmtNumber, fmtTime, fmtUptime, MUTED, INK, LINE,
} from "./shared";

interface OverviewData {
  counts: {
    users: number; active_users: number; dashboards: number;
    datasets: number; sources: number; error_24h: number; pending_registrations: number;
  };
  system: {
    version: string; uptime_seconds: number;
    db_ok: boolean; db_latency_ms: number;
    pool: { pool_size: number; checked_in: number; checked_out: number; overflow: number; utilization_pct: number };
    redis: string;
  };
  recent_errors: Array<{ id: number; source: string; message: string; created_at: string }>;
}

function InfoRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 1.5,
      py: 1.1, borderBottom: `1px solid ${LINE}`, "&:last-of-type": { borderBottom: "none" },
    }}>
      <Typography sx={{ fontSize: 12.5, color: MUTED, width: 96, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ minWidth: 0, flex: 1 }}>{value}</Box>
      {hint && <Typography sx={{ fontSize: 11, color: "#A1A1A6", flexShrink: 0 }}>{hint}</Typography>}
    </Box>
  );
}

function Dot({ ok, text }: { ok: boolean; text: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 12.5, color: INK }}>
      <Box sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: ok ? "#10B981" : "#EF4444" }} />
      {text}
    </Box>
  );
}

export default function OverviewPanel({
  onOpenErrors, scope,
}: { onOpenErrors?: () => void; scope?: string }) {
  const scoped = scope === "department";
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  const load = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    if (document.hidden) return;
    inFlight.current = true;
    if (manual) setRefreshing(true);
    try {
      const res = await client.get("/admin/overview");
      setData(res.data);
    } catch {
      /* 失败保留上次数据，下次轮询再试 */
    } finally {
      inFlight.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

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

  const counts = data?.counts;
  const system = data?.system;

  return (
    <Box>
      <SectionHead
        title="概览"
        desc="账号、看板、数据集与运行状态的实时数字"
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
      ) : (
        <>
          <Box sx={{
            display: "grid", gap: 2, mb: 2.5,
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          }}>
            <StatCard
              label={scoped ? "本部门用户" : "用户"} value={fmtNumber(counts?.users)} icon={<PeopleIcon />}
              hint={`启用 ${fmtNumber(counts?.active_users)}`} tone="#6366F1"
            />
            <StatCard
              label="看板" value={fmtNumber(counts?.dashboards)} icon={<DashIcon />}
              hint="全部项目" tone="#0EA5E9"
            />
            <StatCard
              label="数据集" value={fmtNumber(counts?.datasets)} icon={<DatasetIcon />}
              hint={`数据源 ${fmtNumber(counts?.sources)}`} tone="#10B981"
            />
            <StatCard
              label="近 24 小时错误" value={fmtNumber(counts?.error_24h)} icon={<BugIcon />}
              hint={counts?.error_24h ? "侧栏「错误日志」查看" : "运行正常"} tone={counts?.error_24h ? "#EF4444" : "#10B981"}
            />
            <StatCard
              label="待审批注册" value={fmtNumber(counts?.pending_registrations)} icon={<HowToRegIcon />}
              hint={counts?.pending_registrations ? "侧栏「注册审批」处理" : "没有待办"} tone="#F59E0B"
            />
          </Box>

          <Box sx={{
            display: "grid", gap: 2.5,
            gridTemplateColumns: {
              xs: "minmax(0, 1fr)",
              lg: scoped ? "minmax(0, 1fr)" : "minmax(0, 1fr) minmax(0, 1fr)",
            },
          }}>
            <PanelCard>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK, mb: 1 }}>
                系统状态
              </Typography>
              <InfoRow
                label="服务"
                value={<Typography noWrap sx={{ fontSize: 12.5, color: INK }}>{system?.version ? `v${system.version}` : "—"}</Typography>}
                hint={fmtUptime(system?.uptime_seconds)}
              />
              <InfoRow
                label="数据库"
                value={<Dot ok={!!system?.db_ok} text={system?.db_ok ? "连接正常" : "连接失败"} />}
                hint={system ? `${system.db_latency_ms} ms` : undefined}
              />
              <InfoRow
                label="连接池"
                value={
                  <Typography noWrap sx={{ fontSize: 12.5, color: INK, fontVariantNumeric: "tabular-nums" }}>
                    {system ? `${system.pool.checked_out} / ${system.pool.pool_size} 使用中` : "—"}
                  </Typography>
                }
                hint={system ? `${system.pool.utilization_pct}%` : undefined}
              />
              <InfoRow
                label="Redis"
                value={
                  <Dot
                    ok={system?.redis === "up"}
                    text={system?.redis === "up" ? "已连接" : system?.redis === "disabled" ? "未启用" : "连接异常"}
                  />
                }
                hint={system?.redis === "disabled" ? "进程内缓存" : undefined}
              />
            </PanelCard>

            {!scoped && (
            <PanelCard sx={{ display: "flex", flexDirection: "column" }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 700, color: INK }}>最近错误</Typography>
                <Box sx={{ flex: 1 }} />
                {onOpenErrors && (
                  <Button
                    size="small" onClick={onOpenErrors}
                    sx={{ textTransform: "none", fontSize: 12, color: "#4F46E5", minWidth: 0 }}
                  >
                    全部
                  </Button>
                )}
              </Box>
              {data?.recent_errors?.length ? (
                <Box sx={{ flex: 1 }}>
                  {data.recent_errors.map((item) => (
                    <Box key={item.id} sx={{ py: 1, minWidth: 0, borderBottom: `1px solid ${LINE}`, "&:last-of-type": { borderBottom: "none" } }}>
                      <Typography noWrap sx={{ fontSize: 12.5, color: INK, minWidth: 0 }} title={item.message}>
                        {item.message}
                      </Typography>
                      <Typography sx={{ fontSize: 10.5, color: "#A1A1A6", mt: 0.25 }}>
                        {item.source === "backend" ? "后端" : "前端"} · {fmtTime(item.created_at)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              ) : (
                <EmptyState text="暂无错误" hint="前端异常与后端未处理异常会自动记录在这里" />
              )}
            </PanelCard>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
