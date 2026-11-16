/** 模型配置 —— AI 生成链路使用的默认模型（真实连通性测试） */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add as AddIcon, DeleteOutline as DeleteIcon, EditOutlined as EditIcon,
  ScienceOutlined as TestIcon, SmartToy as ModelIcon,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import {
  BORDER, ConfirmDialog, EmptyState, INK, LINE, Loading, MUTED, PrimaryButton,
  SectionHead, dialogPaperSx, dialogTitleSx, fmtTime, useToast,
} from "./shared";

interface ModelItem {
  id: number; name: string; provider: string; base_url: string; model: string;
  has_key: boolean; key_mask: string; temperature: number; max_tokens: number;
  enabled: boolean; is_default: boolean;
  last_test_at: string; last_test_ok: boolean | null; last_test_ms: number | null; last_test_error: string;
}

interface ProviderItem {
  code: string; name: string; base_url: string; model: string;
  /** 官方参考值：选中供应商时自动带出，用户可再改 */
  temperature?: number | null; max_tokens?: number | null; context_window?: number | null;
}

interface FormState {
  name: string; provider: string; base_url: string; model: string;
  api_key: string; temperature: string; max_tokens: string;
  enabled: boolean; is_default: boolean;
}

const emptyForm: FormState = {
  name: "", provider: "deepseek", base_url: "https://api.deepseek.com/v1", model: "deepseek-chat",
  api_key: "", temperature: "1", max_tokens: "8192", enabled: true, is_default: false,
};

const SOURCE_TEXT: Record<string, string> = {
  database: "管理后台配置",
  file: "data/ai_models.json",
  env: "环境变量",
};

export default function ModelsPanel() {
  const [items, setItems] = useState<ModelItem[]>([]);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [active, setActive] = useState<{ model: string; base_url: string; source: string }>({
    model: "", base_url: "", source: "",
  });
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<{ mode: "create" | "edit"; id?: number } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [dialogTest, setDialogTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [dialogTesting, setDialogTesting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelItem | null>(null);
  const [busy, setBusy] = useState(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await client.get("/admin/models");
      setItems(res.data?.items || []);
      setProviders(res.data?.providers || []);
      setActive(res.data?.active || { model: "", base_url: "", source: "" });
    } catch (err) {
      show(extractErrorMessage(err, "读取模型配置失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { void load(); }, [load]);

  const openCreate = () => {
    setForm(emptyForm);
    setDialogTest(null);
    setDialog({ mode: "create" });
  };

  const openEdit = (item: ModelItem) => {
    setForm({
      name: item.name, provider: item.provider, base_url: item.base_url, model: item.model,
      api_key: "", temperature: String(item.temperature), max_tokens: String(item.max_tokens),
      enabled: item.enabled, is_default: item.is_default,
    });
    setDialogTest(null);
    setDialog({ mode: "edit", id: item.id });
  };

  /** 选中供应商时把温度 / 最大 Token 也带成官方默认值；用户改过的值只在「自定义」时保留 */
  const applyProvider = (code: string) => {
    const preset = providers.find((p) => p.code === code);
    setForm((prev) => ({
      ...prev,
      provider: code,
      name: prev.name || (preset ? preset.name : ""),
      base_url: preset?.base_url || prev.base_url,
      model: preset?.model || prev.model,
      temperature: preset?.temperature == null ? prev.temperature : String(preset.temperature),
      max_tokens: preset?.max_tokens == null ? prev.max_tokens : String(preset.max_tokens),
    }));
  };

  const providerPreset = useMemo(
    () => providers.find((p) => p.code === form.provider) || null,
    [providers, form.provider],
  );

  const save = async () => {
    if (!dialog || saving) return;
    if (!form.name.trim()) { show("给模型起个名字", "error"); return; }
    if (!form.base_url.trim()) { show("Base URL 不能为空", "error"); return; }
    if (!form.model.trim()) { show("模型名不能为空", "error"); return; }
    if (dialog.mode === "create" && !form.api_key.trim()) { show("API Key 不能为空", "error"); return; }

    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(), provider: form.provider,
        base_url: form.base_url.trim(), model: form.model.trim(),
        temperature: Number(form.temperature) || 0.3,
        max_tokens: Number(form.max_tokens) || 4096,
        enabled: form.enabled, is_default: form.is_default,
      };
      if (form.api_key.trim()) payload.api_key = form.api_key.trim();
      if (dialog.mode === "create") {
        await client.post("/admin/models", payload);
      } else {
        await client.patch(`/admin/models/${dialog.id}`, payload);
      }
      setDialog(null);
      show("模型已保存");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "保存失败"), "error");
    } finally {
      setSaving(false);
    }
  };

  const testDraft = async () => {
    if (dialogTesting) return;
    if (!form.base_url.trim() || !form.model.trim()) { show("先填 Base URL 和模型名", "error"); return; }
    setDialogTesting(true);
    setDialogTest(null);
    try {
      const res = await client.post("/admin/models/test", {
        model_id: dialog?.mode === "edit" ? dialog.id : null,
        base_url: form.base_url.trim(), model: form.model.trim(),
        api_key: form.api_key.trim() || null,
      });
      setDialogTest({ ok: !!res.data?.ok, message: res.data?.message || "" });
    } catch (err) {
      setDialogTest({ ok: false, message: extractErrorMessage(err, "测试失败") });
    } finally {
      setDialogTesting(false);
    }
  };

  const testSaved = async (item: ModelItem) => {
    if (testingId) return;
    setTestingId(item.id);
    try {
      const res = await client.post("/admin/models/test", { model_id: item.id });
      show(res.data?.ok ? "连接正常" : `连接失败：${res.data?.message || ""}`, res.data?.ok ? "success" : "error");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "测试失败"), "error");
    } finally {
      setTestingId(null);
    }
  };

  const toggleField = async (item: ModelItem, patch: Record<string, unknown>) => {
    try {
      await client.patch(`/admin/models/${item.id}`, patch);
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "保存失败"), "error");
    }
  };

  const removeModel = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await client.delete(`/admin/models/${deleteTarget.id}`);
      setDeleteTarget(null);
      show("模型已删除");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "删除失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const activeText = useMemo(() => {
    if (!active.source) return "未设置默认模型：AI 生成会回退到规则生成";
    const where = SOURCE_TEXT[active.source] || active.source;
    return `当前生效：${active.model} · 来源 ${where}`;
  }, [active]);

  return (
    <Box>
      <SectionHead
        title="模型配置"
        desc={activeText}
        action={<PrimaryButton startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={openCreate}>新建模型</PrimaryButton>}
      />

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <Box sx={{ border: `1px dashed ${BORDER}`, borderRadius: "12px", bgcolor: "#fff" }}>
          <EmptyState
            text="还没有配置模型"
            hint="添加一个模型并设为默认，AI 生成看板 / 自然语言查询就会用它"
          />
        </Box>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {items.map((item) => (
            <Box key={item.id} sx={{
              border: `1px solid ${BORDER}`, borderRadius: "12px", bgcolor: "#fff", p: 2,
              display: "flex", flexDirection: "column", gap: 1.25,
            }}>
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                <Box sx={{
                  width: 30, height: 30, borderRadius: "9px", flexShrink: 0,
                  bgcolor: "rgba(99,102,241,0.10)", color: "#4F46E5", display: "grid", placeItems: "center",
                  "& .MuiSvgIcon-root": { fontSize: 17 },
                }}>
                  <ModelIcon />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, color: INK }}>{item.name}</Typography>
                    {item.is_default && (
                      <Chip label="默认" size="small" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(99,102,241,0.12)", color: "#4F46E5", fontWeight: 600 }} />
                    )}
                    {!item.enabled && (
                      <Chip label="已停用" size="small" sx={{ height: 18, fontSize: 10, bgcolor: "#F1F5F9", color: "#64748B" }} />
                    )}
                  </Box>
                  <Typography noWrap sx={{ fontSize: 11.5, color: MUTED, fontFamily: "ui-monospace", mt: 0.25 }} title={item.base_url}>
                    {item.model} · {item.base_url}
                  </Typography>
                </Box>
                <Tooltip title={item.enabled ? "停用" : "启用"}>
                  <Switch
                    size="small" checked={item.enabled}
                    onChange={(e) => void toggleField(item, { enabled: e.target.checked })}
                    sx={{ mt: -0.5 }}
                  />
                </Tooltip>
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 11.5, color: MUTED }}>
                <Typography sx={{ fontSize: 11.5, color: MUTED, fontFamily: "ui-monospace" }}>
                  {item.key_mask || "未配置 Key"}
                </Typography>
                <Box sx={{ flex: 1 }} />
                {item.last_test_at ? (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: item.last_test_ok ? "#10B981" : "#EF4444" }} />
                    <Typography sx={{ fontSize: 11, color: item.last_test_ok ? "#059669" : "#DC2626" }}>
                      {item.last_test_ok ? `正常 ${item.last_test_ms ?? 0}ms` : "测试失败"}
                    </Typography>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: 11, color: "#A1A1A6" }}>未测试</Typography>
                )}
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, borderTop: `1px solid ${LINE}`, pt: 1 }}>
                <Button
                  size="small" onClick={() => void testSaved(item)} disabled={testingId === item.id}
                  startIcon={testingId === item.id ? <CircularProgress size={12} color="inherit" /> : <TestIcon sx={{ fontSize: 15 }} />}
                  sx={{ textTransform: "none", fontSize: 12, color: "#4F46E5", minWidth: 0, px: 0.75 }}
                >
                  测试连接
                </Button>
                {!item.is_default && (
                  <Button
                    size="small" onClick={() => void toggleField(item, { is_default: true })}
                    sx={{ textTransform: "none", fontSize: 12, color: MUTED, minWidth: 0, px: 0.75 }}
                  >
                    设为默认
                  </Button>
                )}
                <Box sx={{ flex: 1 }} />
                <Tooltip title="编辑">
                  <Box component="span">
                    <Button size="small" onClick={() => openEdit(item)} sx={{ minWidth: 0, px: 0.5 }}>
                      <EditIcon sx={{ fontSize: 16, color: MUTED }} />
                    </Button>
                  </Box>
                </Tooltip>
                <Tooltip title="删除">
                  <Box component="span">
                    <Button size="small" onClick={() => setDeleteTarget(item)} sx={{ minWidth: 0, px: 0.5 }}>
                      <DeleteIcon sx={{ fontSize: 16, color: "#CBD5E1" }} />
                    </Button>
                  </Box>
                </Tooltip>
              </Box>

              {item.last_test_at && !item.last_test_ok && item.last_test_error && (
                <Typography
                  noWrap title={item.last_test_error}
                  sx={{ fontSize: 10.5, color: "#DC2626", bgcolor: "#FEF2F2", borderRadius: 1, px: 1, py: 0.5 }}
                >
                  {item.last_test_error}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      <Dialog open={!!dialog} onClose={saving ? undefined : () => setDialog(null)} maxWidth="sm" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>{dialog?.mode === "edit" ? "编辑模型" : "新建模型"}</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.75, pt: "8px !important" }}>
          <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
            <TextField select label="供应商" size="small" value={form.provider} sx={{ width: 170 }}
              onChange={(e) => applyProvider(e.target.value)}>
              {providers.map((p) => (
                <MenuItem key={p.code} value={p.code} sx={{ fontSize: 13 }}>{p.name}</MenuItem>
              ))}
            </TextField>
            <TextField label="名称" size="small" value={form.name} sx={{ flex: 1 }}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </Box>
          <TextField label="Base URL" size="small" value={form.base_url}
            onChange={(e) => setForm((p) => ({ ...p, base_url: e.target.value }))}
            helperText="填到 /v1 即可，请求会补 /chat/completions" />
          <TextField label="模型名" size="small" value={form.model}
            onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} />
          <TextField
            label="API Key" size="small" type="password" value={form.api_key}
            onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
            placeholder={dialog?.mode === "edit" ? "留空表示不修改" : ""}
            helperText={dialog?.mode === "edit" ? "留空则保留原 Key（不回显明文）" : "加密存储，界面只显示掩码"}
          />
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <TextField label="温度" size="small" value={form.temperature} sx={{ width: 120 }}
              onChange={(e) => setForm((p) => ({ ...p, temperature: e.target.value }))} />
            <TextField label="最大 Token" size="small" value={form.max_tokens} sx={{ width: 140 }}
              onChange={(e) => setForm((p) => ({ ...p, max_tokens: e.target.value }))} />
            <Box sx={{ flex: 1 }} />
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: 12, color: MUTED }}>启用</Typography>
              <Switch size="small" checked={form.enabled}
                onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))} />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: 12, color: MUTED }}>设为默认</Typography>
              <Switch size="small" checked={form.is_default}
                onChange={(e) => setForm((p) => ({ ...p, is_default: e.target.checked }))} />
            </Box>
          </Box>
          <Typography sx={{ fontSize: 11, color: MUTED, mt: -1, lineHeight: 1.6 }}>
            {providerPreset?.temperature != null
              ? `供应商参考值：温度 ${providerPreset.temperature} · 最大输出 ${providerPreset.max_tokens}`
                + `${providerPreset.context_window ? ` · 上下文 ${Math.round(providerPreset.context_window / 1024)}K` : ""}`
                + "（可自行修改）"
              : "自定义供应商：温度 / 最大 Token 按服务商文档填写"}
          </Typography>
          {dialogTest && (
            <Box sx={{
              fontSize: 12, px: 1.25, py: 0.75, borderRadius: 1.5,
              bgcolor: dialogTest.ok ? "#ECFDF5" : "#FEF2F2",
              color: dialogTest.ok ? "#047857" : "#B91C1C",
            }}>
              {dialogTest.message}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button
            onClick={() => void testDraft()} disabled={dialogTesting}
            startIcon={dialogTesting ? <CircularProgress size={12} color="inherit" /> : <TestIcon sx={{ fontSize: 15 }} />}
            sx={{ textTransform: "none", fontSize: 12.5, color: "#4F46E5" }}
          >
            测试连接
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDialog(null)} disabled={saving}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void save()} disabled={saving}>
            {saving ? <CircularProgress size={14} color="inherit" /> : "保存"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除模型"
        desc={`删除「${deleteTarget?.name}」后，若它是默认模型，AI 生成会回退到文件 / 环境变量配置。`}
        confirmText="删除"
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void removeModel()}
      />
      {toastNode}
    </Box>
  );
}
