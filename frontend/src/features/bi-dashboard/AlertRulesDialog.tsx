/** 指标告警 —— 给看板里的指标卡设阈值 / 波动告警，触发后进顶栏「告警通知」 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Switch, TextField,
  Typography,
} from "@mui/material";
import {
  Add, DeleteOutline, EditOutlined, NotificationsActive, PlayArrow,
} from "@mui/icons-material";
import client from "../../api/client";

const INK = "#1D1D1F";
const MUTED = "#86868B";
const LINE = "#EEF3FB";

interface Props {
  board: { id: number; name: string } | null;
  onClose: () => void;
}

interface AlertCard {
  view_key: string;
  item_key: string;
  title: string;
  metric: string;
  unit: string;
}

interface Rule {
  id: number;
  dashboard_id: number;
  item_key: string;
  name: string;
  metric: string;
  op: string;
  threshold: number;
  change_pct: number | null;
  channel: string;
  webhook_url: string;
  email_to: string;
  enabled: boolean;
  cooldown_minutes: number;
  last_value: number | null;
  last_checked_at: string;
  last_triggered_at: string;
}

interface FormState {
  id?: number;
  name: string;
  item_key: string;
  op: string;
  threshold: string;
  change_pct: string;
  cooldown_minutes: string;
  channel: string;
  webhook_url: string;
  email_to: string;
}

const OPS = [
  { value: ">", label: "大于 >" },
  { value: ">=", label: "大于等于 ≥" },
  { value: "<", label: "小于 <" },
  { value: "<=", label: "小于等于 ≤" },
];

const COOLDOWNS = [
  { value: "5", label: "5 分钟" },
  { value: "15", label: "15 分钟" },
  { value: "30", label: "30 分钟" },
  { value: "60", label: "1 小时" },
  { value: "240", label: "4 小时" },
  { value: "0", label: "不限制" },
];

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

function emptyForm(): FormState {
  return {
    name: "",
    item_key: "",
    op: ">",
    threshold: "",
    change_pct: "",
    cooldown_minutes: "30",
    channel: "inapp",
    webhook_url: "",
    email_to: "",
  };
}

function fmtNum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function fmtTime(value: string): string {
  return value ? value.slice(5, 16) : "";
}

export default function AlertRulesDialog({ board, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<AlertCard[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [test, setTest] = useState<any>(null);
  const [deleteRule, setDeleteRule] = useState<Rule | null>(null);

  const cardMap = useMemo(() => {
    const map: Record<string, AlertCard> = {};
    cards.forEach((card) => { map[card.item_key] = card; });
    return map;
  }, [cards]);

  const load = useCallback(async () => {
    if (!board) return;
    setLoading(true);
    setError("");
    try {
      const [cardsRes, rulesRes] = await Promise.all([
        client.get("/bi/alerts/cards", { params: { dashboard_id: board.id } }),
        client.get("/bi/alerts/rules", { params: { dashboard_id: board.id } }),
      ]);
      setCards(cardsRes.data?.cards || []);
      setRules(rulesRes.data?.rules || []);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "读取告警配置失败");
    } finally {
      setLoading(false);
    }
  }, [board]);

  useEffect(() => {
    setForm(null);
    setTest(null);
    if (board) void load();
  }, [board, load]);

  const startCreate = () => {
    const first = cards[0];
    setTest(null);
    setForm({
      ...emptyForm(),
      item_key: first?.item_key || "",
      name: first ? `${first.title} 告警` : "",
    });
  };

  const startEdit = (rule: Rule) => {
    setTest(null);
    setForm({
      id: rule.id,
      name: rule.name,
      item_key: rule.item_key,
      op: rule.op,
      threshold: String(rule.threshold ?? ""),
      change_pct: rule.change_pct === null || rule.change_pct === undefined ? "" : String(rule.change_pct),
      cooldown_minutes: String(rule.cooldown_minutes ?? 30),
      channel: rule.channel || "inapp",
      webhook_url: rule.webhook_url || "",
      email_to: rule.email_to || "",
    });
  };

  const patch = (next: Partial<FormState>) => setForm((prev) => (prev ? { ...prev, ...next } : prev));

  const body = (state: FormState) => ({
    dashboard_id: board?.id,
    name: state.name.trim(),
    item_key: state.item_key,
    op: state.op,
    threshold: state.threshold === "" ? 0 : Number(state.threshold),
    change_pct: state.change_pct === "" ? null : Number(state.change_pct),
    cooldown_minutes: Number(state.cooldown_minutes),
    channel: state.channel,
    webhook_url: state.channel !== "inapp" && state.channel !== "email" ? state.webhook_url.trim() : "",
    email_to: state.channel === "email" ? state.email_to.trim() : "",
  });

  const runTest = async () => {
    if (!form || !board) return;
    setBusy(true);
    setError("");
    setTest(null);
    try {
      const res = form.id
        ? await client.post(`/bi/alerts/rules/${form.id}/test`, {})
        : await client.post("/bi/alerts/preview", body(form));
      setTest(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "测试失败");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!form || !board) return;
    setBusy(true);
    setError("");
    try {
      if (form.id) {
        await client.put(`/bi/alerts/rules/${form.id}`, body(form));
      } else {
        await client.post("/bi/alerts/rules", body(form));
      }
      setForm(null);
      setTest(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleRule = async (rule: Rule, enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      await client.put(`/bi/alerts/rules/${rule.id}`, { enabled });
      setRules((prev) => prev.map((item) => (item.id === rule.id ? { ...item, enabled } : item)));
    } catch (e: any) {
      setError(e?.response?.data?.detail || "更新失败");
    } finally {
      setBusy(false);
    }
  };

  const removeRule = async () => {
    if (!deleteRule) return;
    setBusy(true);
    setError("");
    try {
      await client.delete(`/bi/alerts/rules/${deleteRule.id}`);
      setDeleteRule(null);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const conditionText = (rule: Rule) => {
    const parts = [`${rule.op} ${fmtNum(rule.threshold)}`];
    if (rule.change_pct) parts.push(`波动 ±${fmtNum(rule.change_pct)}%`);
    return parts.join(" 或 ");
  };

  return (
    <>
      <Dialog open={!!board} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
          <NotificationsActive sx={{ fontSize: 20, color: "#4F46E5" }} />
          指标告警 · {board?.name}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 1.5 }}>
            给指标卡设阈值，后台每分钟检查一次；触发后进顶栏「告警通知」，也可推送 Webhook / 钉钉 / 企业微信 / 邮件。
          </Typography>

          {loading ? (
            <Box sx={{ py: 6, display: "grid", placeItems: "center" }}><CircularProgress size={24} /></Box>
          ) : (
            <>
              {!form && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Typography sx={{ fontSize: 12.5, color: "#475569", flex: 1 }}>
                    {rules.length ? `已配置 ${rules.length} 条规则` : "还没有告警规则"}
                  </Typography>
                  <Button size="small" variant="outlined" disabled={busy || cards.length === 0}
                    startIcon={<Add sx={{ fontSize: 16 }} />} onClick={startCreate}
                    sx={{ textTransform: "none", borderRadius: 2, fontSize: 12.5, borderColor: "#D8E2F5", color: "#4F46E5" }}>
                    新建规则
                  </Button>
                </Box>
              )}

              {cards.length === 0 && (
                <Alert severity="info" sx={{ borderRadius: 2, fontSize: 12.5, mb: 1 }}>
                  这个看板还没有指标卡，先加一张指标卡才能设告警。
                </Alert>
              )}

              {!form && (
                <Box sx={{ border: `1px solid ${LINE}`, borderRadius: "12px", overflow: "hidden" }}>
                  {rules.length === 0 ? (
                    <Box sx={{ py: 3, textAlign: "center" }}>
                      <Typography sx={{ fontSize: 12.5, color: MUTED }}>暂无规则</Typography>
                    </Box>
                  ) : rules.map((rule, index) => (
                    <Box key={rule.id}>
                      {index > 0 && <Divider sx={{ borderColor: LINE }} />}
                      <Box sx={{ px: 1.5, py: 1.25, display: "flex", alignItems: "center", gap: 1 }}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                            <Typography sx={{ fontSize: 13, fontWeight: 600, color: INK }} noWrap>
                              {rule.name}
                            </Typography>
                            {!rule.enabled && (
                              <Chip label="已停用" size="small" sx={{ height: 18, fontSize: 10.5, bgcolor: "#F1F5F9", color: MUTED }} />
                            )}
                          </Box>
                          <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 0.25 }} noWrap>
                            {cardMap[rule.item_key]?.title || rule.item_key} · {conditionText(rule)}
                            {" · "}冷却 {rule.cooldown_minutes ? `${rule.cooldown_minutes} 分钟` : "不限"}
                            {" · "}{channelLabel(rule.channel)}
                          </Typography>
                          <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: 0.25 }} noWrap>
                            当前 {fmtNum(rule.last_value)}
                            {rule.last_checked_at ? ` · ${fmtTime(rule.last_checked_at)} 检查` : ""}
                            {rule.last_triggered_at ? ` · ${fmtTime(rule.last_triggered_at)} 触发过` : ""}
                          </Typography>
                        </Box>
                        <FormControlLabel
                          sx={{ m: 0 }}
                          control={<Switch size="small" checked={rule.enabled} disabled={busy}
                            onChange={(e) => void toggleRule(rule, e.target.checked)} />}
                          label=""
                        />
                        <IconButton size="small" disabled={busy} onClick={() => startEdit(rule)} title="编辑">
                          <EditOutlined sx={{ fontSize: 16, color: MUTED }} />
                        </IconButton>
                        <IconButton size="small" disabled={busy} onClick={() => setDeleteRule(rule)} title="删除">
                          <DeleteOutline sx={{ fontSize: 16, color: "#DC2626" }} />
                        </IconButton>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}

              {form && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, border: `1px solid ${LINE}`, borderRadius: "12px", p: 1.5 }}>
                  <TextField size="small" fullWidth label="规则名称" value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                    sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />

                  <TextField select size="small" fullWidth label="监控卡片" value={form.item_key}
                    onChange={(e) => {
                      const key = e.target.value;
                      const card = cardMap[key];
                      patch({
                        item_key: key,
                        name: form.id ? form.name : card ? `${card.title} 告警` : form.name,
                      });
                    }}
                    sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                    {cards.map((card) => (
                      <MenuItem key={card.item_key} value={card.item_key} sx={{ fontSize: 13 }}>
                        {card.title}{card.metric ? ` · ${card.metric}` : ""}
                      </MenuItem>
                    ))}
                  </TextField>

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <TextField select size="small" label="条件" value={form.op}
                      onChange={(e) => patch({ op: e.target.value })}
                      sx={{ width: 132, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                      {OPS.map((op) => <MenuItem key={op.value} value={op.value} sx={{ fontSize: 13 }}>{op.label}</MenuItem>)}
                    </TextField>
                    <TextField size="small" label="阈值" value={form.threshold}
                      onChange={(e) => patch({ threshold: e.target.value })}
                      inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }}
                      sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />
                    <TextField size="small" label="波动 ±%" value={form.change_pct} placeholder="可选"
                      onChange={(e) => patch({ change_pct: e.target.value })}
                      inputProps={{ inputMode: "decimal", style: { textAlign: "right" } }}
                      sx={{ width: 120, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }} />
                  </Box>
                  <Typography sx={{ fontSize: 11, color: "#94A3B8", mt: -0.5 }}>
                    阈值或波动任一满足就告警；波动是「较上次检查（每分钟）」的变化。
                  </Typography>

                  <Box sx={{ display: "flex", gap: 1 }}>
                    <TextField select size="small" label="冷却" value={form.cooldown_minutes}
                      onChange={(e) => patch({ cooldown_minutes: e.target.value })}
                      sx={{ width: 140, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13 } }}>
                      {COOLDOWNS.map((item) => (
                        <MenuItem key={item.value} value={item.value} sx={{ fontSize: 13 }}>{item.label}</MenuItem>
                      ))}
                    </TextField>
                    <TextField select size="small" label="通知" value={form.channel}
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

                  {test && (
                    <Alert severity={test.error ? "error" : test.triggered ? "warning" : "success"}
                      sx={{ borderRadius: 2, fontSize: 12.5 }}>
                      {test.error || `${test.triggered ? "会触发" : "不会触发"} · ${test.reason || ""}`}
                      {test.notified ? ` · 推送：${test.notified === "failed" ? `失败（${test.notify_error || "连接失败"}）` : "已送达"}` : ""}
                    </Alert>
                  )}

                  <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
                    <Button size="small" disabled={busy} onClick={runTest}
                      startIcon={<PlayArrow sx={{ fontSize: 16 }} />}
                      sx={{ textTransform: "none", fontSize: 12.5 }}>
                      {form.id ? "立即测试" : "试算当前值"}
                    </Button>
                    <Button size="small" disabled={busy} onClick={() => { setForm(null); setTest(null); }}
                      sx={{ textTransform: "none", fontSize: 12.5 }}>
                      取消
                    </Button>
                    <Button size="small" variant="contained"
                      disabled={busy || !form.name.trim() || !form.item_key
                        || (form.channel === "email" && !form.email_to.trim())}
                      onClick={save}
                      startIcon={busy ? <CircularProgress size={13} color="inherit" /> : null}
                      sx={{ textTransform: "none", borderRadius: 2, fontSize: 12.5, bgcolor: "#4F46E5", boxShadow: "none" }}>
                      {form.id ? "保存修改" : "创建规则"}
                    </Button>
                  </Box>
                </Box>
              )}
            </>
          )}

          {error && <Alert severity="error" sx={{ mt: 1.5, borderRadius: 2, fontSize: 12.5 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={onClose} sx={{ textTransform: "none" }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteRule} onClose={() => setDeleteRule(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>删除告警规则？</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: "#475569" }}>
            「{deleteRule?.name}」删除后不再检查，历史告警事件一并清除。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeleteRule(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button variant="contained" color="error" disabled={busy} onClick={removeRule}
            sx={{ textTransform: "none", borderRadius: 2 }}>
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
