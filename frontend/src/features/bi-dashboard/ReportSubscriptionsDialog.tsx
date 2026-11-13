/** 定时报表 —— 按天/周生成看板报表（HTML 可打印为 PDF + Excel），站内通知 / Webhook 交付 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Switch, TextField,
  Tooltip, Typography,
} from "@mui/material";
import {
  Add, DeleteOutline, Download, EditOutlined, EventRepeat, PlayArrow, Schedule,
} from "@mui/icons-material";
import client from "../../api/client";

const INK = "#1D1D1F";
const MUTED = "#86868B";
const LINE = "#EEF3FB";
const WEEK = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const CHANNEL_LABEL: Record<string, string> = {
  inapp: "站内", webhook: "站内 + Webhook", dingtalk: "站内 + 钉钉",
  wecom: "站内 + 企业微信", email: "站内 + 邮件",
};
const channelLabel = (channel: string) => CHANNEL_LABEL[channel] || "站内";

function channelUrlMeta(channel: string): { label: string; placeholder: string } {
  if (channel === "dingtalk") {
    return { label: "钉钉机器人 Webhook", placeholder: "https://oapi.dingtalk.com/robot/send?access_token=..." };
  }
  if (channel === "wecom") {
    return { label: "企业微信机器人 Webhook", placeholder: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..." };
  }
  return { label: "Webhook 地址", placeholder: "https://..." };
}

interface Props {
  board: { id: number; name: string } | null;
  onClose: () => void;
}

interface ViewDef { key: string; title: string }

interface Subscription {
  id: number;
  dashboard_id: number;
  name: string;
  view_key: string;
  frequency: "daily" | "weekly";
  send_time: string;
  week_day: number;
  channel: string;
  webhook_url: string;
  email_to: string;
  enabled: boolean;
  last_run_at: string;
  last_status: string;
  last_error: string;
  next_run_at: string;
}

interface ReportRun {
  id: number;
  subscription_id: number;
  subscription_name: string;
  status: "success" | "failed";
  summary: { cards?: number; errors?: any[]; view?: string };
  error: string;
  delivered: string;
  triggered_by: string;
  created_at: string;
  has_html: boolean;
  has_xlsx: boolean;
  has_pdf: boolean;
}

interface FormState {
  id?: number;
  name: string;
  view_key: string;
  frequency: "daily" | "weekly";
  send_time: string;
  week_day: string;
  channel: string;
  webhook_url: string;
  email_to: string;
}

function emptyForm(boardName: string): FormState {
  return {
    name: `${boardName} 日报`,
    view_key: "",
    frequency: "daily",
    send_time: "09:00",
    week_day: "1",
    channel: "inapp",
    webhook_url: "",
    email_to: "",
  };
}

function scheduleText(sub: Subscription): string {
  if (sub.frequency === "weekly") {
    return `每${WEEK[Math.min(Math.max(sub.week_day, 1), 7) - 1]} ${sub.send_time}`;
  }
  return `每天 ${sub.send_time}`;
}

function fmtTime(value: string): string {
  return value ? value.slice(5, 16) : "";
}

export default function ReportSubscriptionsDialog({ board, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [views, setViews] = useState<ViewDef[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Subscription | null>(null);

  const viewLabel = useMemo(() => {
    const map: Record<string, string> = {};
    views.forEach((view) => { map[view.key] = view.title; });
    return map;
  }, [views]);

  const load = useCallback(async () => {
    if (!board) return;
    setLoading(true);
    setError("");
    try {
      const [viewsRes, subsRes, runsRes] = await Promise.all([
        client.get("/bi/reports/views", { params: { dashboard_id: board.id } }),
        client.get("/bi/reports/subscriptions", { params: { dashboard_id: board.id } }),
        client.get("/bi/reports/runs", { params: { dashboard_id: board.id, limit: 8 } }),
      ]);
      setViews(viewsRes.data?.views || []);
      setSubs(subsRes.data?.subscriptions || []);
      setRuns(runsRes.data?.runs || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "读取定时报表失败");
    } finally {
      setLoading(false);
    }
  }, [board]);

  useEffect(() => {
    setForm(null);
    setNotice("");
    setError("");
    if (board) void load();
  }, [board, load]);

  const patch = (next: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...next } : prev));

  const startCreate = () => {
    if (!board) return;
    setNotice("");
    setForm(emptyForm(board.name));
  };

  const startEdit = (sub: Subscription) => {
    setNotice("");
    setForm({
      id: sub.id,
      name: sub.name,
      view_key: sub.view_key || "",
      frequency: sub.frequency,
      send_time: sub.send_time,
      week_day: String(sub.week_day || 1),
      channel: sub.channel || "inapp",
      webhook_url: sub.webhook_url || "",
      email_to: sub.email_to || "",
    });
  };

  const save = async () => {
    if (!form || !board) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        dashboard_id: board.id,
        name: form.name.trim(),
        view_key: form.view_key,
        frequency: form.frequency,
        send_time: form.send_time,
        week_day: Number(form.week_day),
        channel: form.channel,
        webhook_url: form.channel !== "inapp" && form.channel !== "email" ? form.webhook_url.trim() : "",
        email_to: form.channel === "email" ? form.email_to.trim() : "",
      };
      if (form.id) {
        await client.put(`/bi/reports/subscriptions/${form.id}`, payload);
      } else {
        await client.post("/bi/reports/subscriptions", payload);
      }
      setForm(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (sub: Subscription, enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await client.put(`/bi/reports/subscriptions/${sub.id}`, { enabled });
      setSubs((prev) => prev.map((item) => (item.id === sub.id ? { ...item, enabled } : item)));
    } catch (e: any) {
      setError(e?.response?.data?.detail || "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError("");
    try {
      await client.delete(`/bi/reports/subscriptions/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const runNow = async (sub: Subscription) => {
    setRunningId(sub.id);
    setError("");
    setNotice("");
    try {
      const res = await client.post(`/bi/reports/subscriptions/${sub.id}/run`);
      const run = res.data as ReportRun;
      if (run.status === "failed") {
        setError(run.error || "生成失败");
      } else {
        setNotice(`已生成 ${run.summary?.cards ?? 0} 张卡片，可在下方「最近生成」下载`);
      }
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "生成失败");
    } finally {
      setRunningId(null);
    }
  };

  const download = async (run: ReportRun, kind: "html" | "xlsx" | "pdf") => {
    setError("");
    try {
      const res = await client.get(`/bi/reports/runs/${run.id}/download`, {
        params: { kind },
        responseType: "blob",
      });
      const disposition = String(res.headers?.["content-disposition"] || "");
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] || `${run.subscription_name || "report"}-${run.id}.${kind}`;
      const url = URL.createObjectURL(res.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "下载失败");
    }
  };

  return (
    <>
      <Dialog open={!!board} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
          <Schedule sx={{ fontSize: 20, color: "#4F46E5" }} />
          定时报表 · {board?.name}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 1.5 }}>
            按天 / 按周生成看板报表：PDF 和 Excel（另附 HTML 原稿）；生成后进顶栏「告警通知」，也可推 Webhook / 钉钉 / 企业微信 / 邮件。
          </Typography>

          {loading ? (
            <Box sx={{ py: 6, display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>
          ) : (
            <>
              {!form && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Typography sx={{ fontSize: 12.5, color: "#475569", flex: 1 }}>
                    {subs.length ? `已配置 ${subs.length} 条订阅` : "还没有定时报表"}
                  </Typography>
                  <Button size="small" variant="outlined" disabled={busy}
                    startIcon={<Add sx={{ fontSize: 16 }} />} onClick={startCreate}
                    sx={{ textTransform: "none", borderRadius: 2, fontSize: 12.5, borderColor: "#D8E2F5", color: "#4F46E5" }}>
                    新建订阅
                  </Button>
                </Box>
              )}

              {notice && <Alert severity="success" sx={{ borderRadius: 2, fontSize: 12.5, mb: 1 }}>{notice}</Alert>}

              {!form && (
                <Box sx={{ border: `1px solid ${LINE}`, borderRadius: "12px", overflow: "hidden", mb: 1.5 }}>
                  {subs.length === 0 ? (
                    <Box sx={{ py: 3, textAlign: "center" }}>
                      <Typography sx={{ fontSize: 12.5, color: MUTED }}>暂无订阅</Typography>
                    </Box>
                  ) : subs.map((sub, index) => (
                    <Box key={sub.id}>
                      {index > 0 && <Divider sx={{ borderColor: LINE }} />}
                      <Box sx={{ px: 1.5, py: 1.25, display: "flex", alignItems: "center", gap: 0.75 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: INK }} noWrap>
                              {sub.name}
                            </Typography>
                            {!sub.enabled && (
                              <Chip label="已停用" size="small"
                                sx={{ height: 18, fontSize: 10.5, bgcolor: "#F1F5F9", color: MUTED }} />
                            )}
                          </Box>
                          <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 0.25 }} noWrap>
                            {scheduleText(sub)}
                            {sub.view_key ? ` · ${viewLabel[sub.view_key] || sub.view_key}` : " · 主视图"}
                            {" · "}{channelLabel(sub.channel)}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: sub.last_status === "failed" ? "#DC2626" : "#94A3B8", mt: 0.25 }} noWrap>
                            {sub.last_status === "success"
                              ? `上次成功 ${fmtTime(sub.last_run_at)}`
                              : sub.last_status === "failed"
                                ? `上次失败：${sub.last_error || "生成失败"}`
                                : `下次 ${fmtTime(sub.next_run_at)}`}
                          </Typography>
                        </Box>
                        <Tooltip title="立即生成">
                          <span>
                            <IconButton size="small" disabled={busy || runningId === sub.id}
                              onClick={() => void runNow(sub)}>
                              {runningId === sub.id
                                ? <CircularProgress size={15} />
                                : <PlayArrow sx={{ fontSize: 17, color: "#4F46E5" }} />}
                            </IconButton>
                          </span>
                        </Tooltip>
                        <FormControlLabel
                          sx={{ m: 0 }}
                          control={<Switch size="small" checked={sub.enabled} disabled={busy}
                            onChange={(e) => void toggle(sub, e.target.checked)} />}
                          label=""
                        />
                        <IconButton size="small" disabled={busy} onClick={() => startEdit(sub)} title="编辑">
                          <EditOutlined sx={{ fontSize: 16, color: MUTED }} />
                        </IconButton>
                        <IconButton size="small" disabled={busy} onClick={() => setDeleteTarget(sub)} title="删除">
                          <DeleteOutline sx={{ fontSize: 16, color: "#DC2626" }} />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              {form && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, border: `1px solid ${LINE}`, borderRadius: "12px", p: 1.5 }}>
                  <TextField size="small" fullWidth label="报表名称" value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <TextField select size="small" label="视图" value={form.view_key}
                      onChange={(e) => patch({ view_key: e.target.value })}
                      sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                      <MenuItem value="" sx={{ fontSize: 13 }}>主视图</MenuItem>
                      {views.filter((view) => view.key !== "main").map((view) => (
                        <MenuItem key={view.key} value={view.key} sx={{ fontSize: 13 }}>{view.title}</MenuItem>
                      ))}
                    </TextField>
                    <TextField select size="small" label="频率" value={form.frequency}
                      onChange={(e) => patch({ frequency: e.target.value as "daily" | "weekly" })}
                      sx={{ width: 120, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                      <MenuItem value="daily" sx={{ fontSize: 13 }}>每天</MenuItem>
                      <MenuItem value="weekly" sx={{ fontSize: 13 }}>每周</MenuItem>
                    </TextField>
                    {form.frequency === "weekly" && (
                      <TextField select size="small" label="星期" value={form.week_day}
                        onChange={(e) => patch({ week_day: e.target.value })}
                        sx={{ width: 100, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                        {WEEK.map((label, index) => (
                          <MenuItem key={label} value={String(index + 1)} sx={{ fontSize: 13 }}>{label}</MenuItem>
                        ))}
                      </TextField>
                    )}
                  </Box>

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <TextField size="small" label="发送时间" type="time" value={form.send_time}
                      onChange={(e) => patch({ send_time: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                      sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />
                    <TextField select size="small" label="交付方式" value={form.channel}
                      onChange={(e) => patch({ channel: e.target.value })}
                      sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                      <MenuItem value="inapp" sx={{ fontSize: 13 }}>站内通知</MenuItem>
                      <MenuItem value="webhook" sx={{ fontSize: 13 }}>站内 + 自定义 Webhook</MenuItem>
                      <MenuItem value="dingtalk" sx={{ fontSize: 13 }}>站内 + 钉钉机器人</MenuItem>
                      <MenuItem value="wecom" sx={{ fontSize: 13 }}>站内 + 企业微信机器人</MenuItem>
                      <MenuItem value="email" sx={{ fontSize: 13 }}>站内 + 邮件</MenuItem>
                    </TextField>
                  </Box>

                  {form.channel === "email" ? (
                    <TextField size="small" fullWidth label="收件人邮箱"
                      placeholder="用逗号分隔，最多 10 个"
                      value={form.email_to}
                      onChange={(e) => patch({ email_to: e.target.value })}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />
                  ) : form.channel !== "inapp" && (
                    <TextField size="small" fullWidth label={channelUrlMeta(form.channel).label}
                      placeholder={channelUrlMeta(form.channel).placeholder}
                      value={form.webhook_url}
                      onChange={(e) => patch({ webhook_url: e.target.value })}
                      sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />
                  )}

                  <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                    <Button size="small" disabled={busy} onClick={() => setForm(null)}
                      sx={{ textTransform: "none", fontSize: 12.5 }}>
                      取消
                    </Button>
                    <Button size="small" variant="contained"
                      disabled={busy || !form.name.trim() || (form.channel === "email" && !form.email_to.trim())}
                      onClick={save}
                      startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
                      sx={{ textTransform: "none", borderRadius: 2, fontSize: 12.5, bgcolor: "#4F46E5", boxShadow: "none" }}>
                      {form.id ? "保存修改" : "创建订阅"}
                    </Button>
                  </Box>
                </Box>
              )}

              {!form && runs.length > 0 && (
                <>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#64748B", mt: 0.5, mb: 0.75 }}>
                    最近生成
                  </Typography>
                  <Box sx={{ border: `1px solid ${LINE}`, borderRadius: "12px", overflow: "hidden" }}>
                    {runs.map((run, index) => (
                      <Box key={run.id}>
                        {index > 0 && <Divider sx={{ borderColor: LINE }} />}
                        <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", gap: 1 }}>
                          <EventRepeat sx={{ fontSize: 15, color: run.status === "success" ? "#10B981" : "#DC2626" }} />
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: 12.5, color: INK }} noWrap>
                              {run.subscription_name || `订阅 ${run.subscription_id}`}
                              <span style={{ color: "#94A3B8", marginLeft: 6, fontSize: 11 }}>
                                {fmtTime(run.created_at)}
                              </span>
                            </Typography>
                            <Typography sx={{ fontSize: 11, color: run.status === "failed" ? "#DC2626" : "#94A3B8" }} noWrap>
                              {run.status === "failed"
                                ? run.error || "生成失败"
                                : `${run.summary?.cards ?? 0} 张卡片${run.delivered === "failed" ? " · 推送失败" : ["webhook", "dingtalk", "wecom", "email"].includes(run.delivered) ? ` · ${channelLabel(run.delivered)} 已送达` : ""}${run.triggered_by === "manual" ? " · 手动生成" : ""}`}
                            </Typography>
                          </Box>
                          {run.has_html && (
                            <Button size="small" startIcon={<Download sx={{ fontSize: 14 }} />}
                              disabled={busy} onClick={() => void download(run, "html")}
                              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0 }}>
                              HTML
                            </Button>
                          )}
                          {run.has_xlsx && (
                            <Button size="small" startIcon={<Download sx={{ fontSize: 14 }} />}
                              disabled={busy} onClick={() => void download(run, "xlsx")}
                              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0 }}>
                              Excel
                            </Button>
                          )}
                          {run.has_pdf && (
                            <Button size="small" startIcon={<Download sx={{ fontSize: 14 }} />}
                              disabled={busy} onClick={() => void download(run, "pdf")}
                              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0 }}>
                              PDF
                            </Button>
                          )}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </>
          )}

          {error && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>删除定时报表？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: "#475569" }}>
            「{deleteTarget?.name}」删除后不再按时生成，历史生成记录一并清除。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteTarget(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button variant="contained" color="error" disabled={busy} onClick={remove}
            sx={{ textTransform: "none", borderRadius: 2 }}>
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
