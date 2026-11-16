/** 角色权限 —— 角色列表 + 权限矩阵（勾选保存即生效） */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Checkbox,
  CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControlLabel, MenuItem, TextField, Typography,
} from "@mui/material";
import {
  Add as AddIcon, ExpandMore as ExpandIcon,
} from "@mui/icons-material";
import client, { extractErrorMessage } from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import {
  BORDER, ConfirmDialog, INK, LINE, Loading, MUTED, PrimaryButton, SectionHead,
  dialogPaperSx, dialogTitleSx, useToast,
} from "./shared";

interface RoleItem {
  id: number; code: string; name: string; description: string;
  is_system: boolean; locked: boolean; editable?: boolean;
  dept_id?: number | null; dept_name?: string;
  data_scope?: "all" | "dept_and_children" | "dept" | "self";
  user_count: number; permissions: string[];
}

const SCOPE_LABELS: Record<string, string> = {
  all: "全部部门",
  dept_and_children: "本部门及下级",
  dept: "本部门",
  self: "本人",
};

interface PermissionItem { code: string; name: string; group: string }

const PRIMARY_GROUP = "管理后台";
/** 能力权限：给了不进管理后台，只放开 AI / Agent / 导出删除这类动作 */
const CAPABILITY_GROUPS = ["AI 能力", "MCP 能力", "数据能力"];
/** 导出开关：单独提到「数据导出」一栏，便于管理员一眼找到并一键开关 */
const EXPORT_CODES = ["bi:data:export:summary", "bi:data:export:detail"];

export default function RolesPanel({ scope }: { scope?: string }) {
  const { user } = useAuth();
  const canPickAllScope = user?.data_scope === "all" || user?.role === "admin" || user?.role === "super_admin";
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<{
    name: string; description: string;
    permissions: string[];
    data_scope: "all" | "dept_and_children" | "dept" | "self";
  }>({
    name: "", description: "", permissions: [], data_scope: "dept",
  });
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", code: "", description: "" });
  const [deleteTarget, setDeleteTarget] = useState<RoleItem | null>(null);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    try {
      const [rolesRes, permRes] = await Promise.all([
        client.get("/admin/roles"),
        client.get("/admin/permissions"),
      ]);
      const items = (rolesRes.data?.items || []) as RoleItem[];
      setRoles(items);
      setPermissions(permRes.data?.items || []);
      setSelectedId((prev) => (prev && items.some((r) => r.id === prev) ? prev : items[0]?.id ?? null));
    } catch (err) {
      show(extractErrorMessage(err, "读取角色失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(() => roles.find((r) => r.id === selectedId) || null, [roles, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      description: selected.description,
      permissions: [...selected.permissions],
      data_scope: selected.data_scope || "dept",
    });
  }, [selected]);

  const groups = useMemo(() => {
    const order = [
      "bi:overview", "bi:user:manage", "bi:role:manage",
      "bi:model:manage", "bi:error:view", "bi:ops:manage", "bi:mcp:manage",
    ];
    const primary = permissions
      .filter((p) => p.group === PRIMARY_GROUP)
      .sort((a, b) => {
        const ai = order.indexOf(a.code);
        const bi = order.indexOf(b.code);
        if (ai === -1 && bi === -1) return a.code.localeCompare(b.code);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    const business = permissions.filter((p) => p.group === "业务入口");
    const exportPerms = permissions.filter((p) => EXPORT_CODES.includes(p.code));
    const capability = permissions.filter(
      (p) => CAPABILITY_GROUPS.includes(p.group) && !EXPORT_CODES.includes(p.code),
    );
    const legacy = permissions.filter(
      (p) => p.group !== PRIMARY_GROUP && p.group !== "业务入口" && !CAPABILITY_GROUPS.includes(p.group),
    );
    const legacyGroups = new Map<string, PermissionItem[]>();
    legacy.forEach((p) => {
      const key = p.group || "其他";
      legacyGroups.set(key, [...(legacyGroups.get(key) || []), p]);
    });
    return { primary, business, exportPerms, capability, legacy: [...legacyGroups.entries()] };
  }, [permissions]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    const before = [...selected.permissions].sort().join(",");
    const after = [...draft.permissions].sort().join(",");
    return (
      before !== after ||
      draft.name !== selected.name ||
      draft.description !== selected.description ||
      draft.data_scope !== (selected.data_scope || "dept")
    );
  }, [selected, draft]);

  const canEdit = !!selected && selected.editable !== false && !selected.locked;

  const toggle = (code: string) => {
    if (!selected || !canEdit) return;
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(code)
        ? prev.permissions.filter((c) => c !== code)
        : [...prev.permissions, code],
    }));
  };

  /** 导出开关：一键全开 / 全关（仍只改草稿，点保存才生效） */
  const toggleExportAll = (on: boolean) => {
    if (!selected || !canEdit) return;
    setDraft((prev) => {
      const rest = prev.permissions.filter((code) => !EXPORT_CODES.includes(code));
      return { ...prev, permissions: on ? [...rest, ...EXPORT_CODES] : rest };
    });
  };

  const save = async () => {
    if (!selected || busy || !canEdit) return;
    setBusy(true);
    try {
      await client.patch(`/admin/roles/${selected.id}`, {
        name: draft.name.trim() || selected.name,
        description: draft.description,
        permissions: draft.permissions,
        data_scope: draft.data_scope,
      });
      show("权限已保存，相关账号下次请求即生效");
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "保存失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const createRole = async () => {
    if (busy) return;
    const name = createForm.name.trim();
    const code = createForm.code.trim().toLowerCase();
    if (!name) { show("角色名称不能为空", "error"); return; }
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) {
      show("标识需为 2-31 位小写字母/数字/下划线，且以字母开头", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await client.post("/admin/roles", {
        name, code, description: createForm.description.trim(), permissions: [],
      });
      setCreateOpen(false);
      setCreateForm({ name: "", code: "", description: "" });
      show("角色已创建，请在右侧勾选权限");
      await load();
      if (res.data?.id) setSelectedId(res.data.id);
    } catch (err) {
      show(extractErrorMessage(err, "创建失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const removeRole = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    try {
      await client.delete(`/admin/roles/${deleteTarget.id}`);
      setDeleteTarget(null);
      show("角色已删除");
      if (selectedId === deleteTarget.id) setSelectedId(null);
      await load();
    } catch (err) {
      show(extractErrorMessage(err, "删除失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const renderPermission = (p: PermissionItem) => {
    const checked = canEdit ? draft.permissions.includes(p.code) : (selected?.permissions.includes(p.code) ?? false);
    return (
      <FormControlLabel
        key={p.code}
        disabled={!canEdit}
        control={
          <Checkbox
            size="small" checked={checked} onChange={() => toggle(p.code)}
            sx={{ py: 0.35, "& .MuiSvgIcon-root": { fontSize: 18 } }}
          />
        }
        label={
          <Typography sx={{ fontSize: 12.5, color: canEdit ? INK : MUTED }}>
            {p.name}
            <Box component="span" sx={{ ml: 0.75, fontSize: 10.5, color: "#A1A1A6", fontFamily: "ui-monospace" }}>
              {p.code}
            </Box>
          </Typography>
        }
        sx={{ mr: 2 }}
      />
    );
  };

  return (
    <Box>
      <SectionHead
        title="角色与权限"
        desc={scope === "department"
          ? "部门管理员：只能修改本部门创建的角色；系统角色与全局角色只读"
          : "勾选即保存：管理员角色固定拥有全部权限，其余角色按勾选生效"}
        action={<PrimaryButton startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={() => setCreateOpen(true)}>新建角色</PrimaryButton>}
      />

      {loading ? (
        <Loading />
      ) : (
        <Box sx={{ display: "flex", gap: 2.5, alignItems: "flex-start" }}>
          {/* 左：角色列表 */}
          <Box sx={{
            width: 216, flexShrink: 0, border: `1px solid ${BORDER}`, borderRadius: "12px",
            overflow: "hidden", bgcolor: "#fff",
          }}>
            {roles.map((role) => {
              const active = role.id === selectedId;
              return (
                <Box
                  key={role.id}
                  onClick={() => setSelectedId(role.id)}
                  sx={{
                    px: 2, py: 1.25, cursor: "pointer",
                    bgcolor: active ? "rgba(99,102,241,0.07)" : "transparent",
                    borderBottom: `1px solid ${LINE}`,
                    "&:last-of-type": { borderBottom: "none" },
                    "&:hover": { bgcolor: active ? "rgba(99,102,241,0.09)" : "rgba(15,23,42,0.035)" },
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Typography
                      noWrap
                      sx={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? "#4F46E5" : INK }}
                    >
                      {role.name}
                    </Typography>
                    {role.locked && (
                      <Typography sx={{ fontSize: 9.5, px: 0.5, borderRadius: "4px", bgcolor: "rgba(99,102,241,0.12)", color: "#4F46E5" }}>
                        全部
                      </Typography>
                    )}
                    {!role.locked && role.dept_name && (
                      <Typography sx={{ fontSize: 9.5, px: 0.5, borderRadius: "4px", bgcolor: "#F1F5F9", color: "#64748B" }}>
                        {role.dept_name}
                      </Typography>
                    )}
                    {!role.locked && role.data_scope && (
                      <Typography sx={{ fontSize: 9.5, px: 0.5, borderRadius: "4px", bgcolor: "#EEF2FF", color: "#4F46E5" }}>
                        {SCOPE_LABELS[role.data_scope]}
                      </Typography>
                    )}
                    {!role.locked && role.editable === false && !role.dept_name && (
                      <Typography sx={{ fontSize: 9.5, px: 0.5, borderRadius: "4px", bgcolor: "#F1F5F9", color: "#94A3B8" }}>
                        只读
                      </Typography>
                    )}
                  </Box>
                  <Typography noWrap sx={{ fontSize: 10.5, color: "#A1A1A6", fontFamily: "ui-monospace", mt: 0.25 }}>
                    {role.code} · {role.user_count} 人
                  </Typography>
                </Box>
              );
            })}
          </Box>

          {/* 右：详情 */}
          <Box sx={{ flex: 1, minWidth: 0, border: `1px solid ${BORDER}`, borderRadius: "12px", bgcolor: "#fff", p: 2.5 }}>
            {!selected ? (
              <Typography sx={{ fontSize: 13, color: MUTED, py: 4, textAlign: "center" }}>
                左侧选一个角色
              </Typography>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 2 }}>
                  <Box sx={{ flex: 1, minWidth: 0, display: "flex", gap: 1.5, flexWrap: "wrap" }}>
                    <TextField
                      label="角色名称" size="small" value={draft.name} disabled={!canEdit}
                      onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                      sx={{ width: 180, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}
                    />
                    <TextField
                      label="说明" size="small" value={draft.description} disabled={!canEdit}
                      onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                      sx={{ flex: 1, minWidth: 200, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}
                    />
                    <TextField
                      select label="数据范围" size="small" value={draft.data_scope} disabled={!canEdit}
                      onChange={(e) => setDraft((p) => ({
                        ...p,
                        data_scope: e.target.value as typeof p.data_scope,
                      }))}
                      sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13 } }}
                    >
                      {(canPickAllScope
                        ? ["all", "dept_and_children", "dept", "self"]
                        : ["dept_and_children", "dept", "self"]
                      ).map((value) => (
                        <MenuItem key={value} value={value} sx={{ fontSize: 12.5 }}>
                          {SCOPE_LABELS[value]}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Box>
                  <PrimaryButton onClick={() => void save()} disabled={!dirty || busy || !canEdit}>
                    {busy ? <CircularProgress size={14} color="inherit" /> : "保存"}
                  </PrimaryButton>
                  {!selected.is_system && (
                    <Button
                      size="small" onClick={() => setDeleteTarget(selected)} disabled={selected.user_count > 0}
                      sx={{
                        textTransform: "none", fontSize: 12.5, color: "#EF4444", height: 36, px: 1.25,
                        "&.Mui-disabled": { color: "#E2E8F0" },
                      }}
                    >
                      删除
                    </Button>
                  )}
                </Box>

                {!canEdit ? (
                  <Typography sx={{ fontSize: 12.5, color: MUTED, mb: 2 }}>
                    {selected.locked
                      ? "内置管理员角色拥有全部权限，不可修改。"
                      : "该角色由全局管理员维护，部门管理员只读。"}
                  </Typography>
                ) : (
                  <Divider sx={{ borderColor: LINE, mb: 2 }} />
                )}

                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 0.5, letterSpacing: 0.3 }}>
                  管理后台
                </Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", mb: 1.5 }}>
                  {groups.primary.map(renderPermission)}
                </Box>

                {groups.business.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mt: 1.5, mb: 0.5, letterSpacing: 0.3 }}>
                      业务入口
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: "#A1A1A6", mb: 0.5 }}>
                      控制主页左侧菜单能看到哪些入口；关掉后接口层的增删改也会被拒绝
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", mb: 1.5 }}>
                      {groups.business.map(renderPermission)}
                    </Box>
                  </>
                )}

                {groups.exportPerms.length > 0 && (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5, mb: 0.5 }}>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", letterSpacing: 0.3 }}>
                        数据导出
                      </Typography>
                      {canEdit && (
                        <>
                          <Button size="small" onClick={() => toggleExportAll(true)}
                            sx={{ minWidth: 0, fontSize: 11, textTransform: "none", color: "#4F46E5" }}>
                            全部开启
                          </Button>
                          <Button size="small" onClick={() => toggleExportAll(false)}
                            sx={{ minWidth: 0, fontSize: 11, textTransform: "none", color: "#64748B" }}>
                            全部关闭
                          </Button>
                        </>
                      )}
                    </Box>
                    <Typography sx={{ fontSize: 11, color: "#A1A1A6", mb: 0.5 }}>
                      勾选 = 允许导出，取消 = 关闭导出；关闭后该角色看不到导出按钮，
                      直接调导出接口返回 403（管理员角色始终可用）。保存后生效。
                    </Typography>
                    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", mb: 1.5 }}>
                      {groups.exportPerms.map(renderPermission)}
                    </Box>
                  </>
                )}

                {groups.capability.length > 0 && (
                  <>
                    <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mt: 1.5, mb: 0.5, letterSpacing: 0.3 }}>
                      能力权限
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: "#A1A1A6", mb: 0.75 }}>
                      AI 分析、Agent 代调用与删除；与后台分区无关，勾了也不会进管理后台
                    </Typography>
                    {CAPABILITY_GROUPS.map((group) => {
                      const items = groups.capability.filter((p) => p.group === group);
                      if (items.length === 0) return null;
                      return (
                        <Box key={group} sx={{ mb: 1 }}>
                          <Typography sx={{ fontSize: 11, color: "#A1A1A6", mb: 0.25 }}>{group}</Typography>
                          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                            {items.map(renderPermission)}
                          </Box>
                        </Box>
                      );
                    })}
                  </>
                )}

                {groups.legacy.length > 0 && (
                  <Accordion
                    disableGutters elevation={0}
                    sx={{
                      "&:before": { display: "none" }, bgcolor: "transparent",
                      borderTop: `1px solid ${LINE}`,
                    }}
                  >
                    <AccordionSummary expandIcon={<ExpandIcon sx={{ fontSize: 18, color: MUTED }} />} sx={{ px: 0, minHeight: 40 }}>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", letterSpacing: 0.3 }}>
                        其他模块权限
                      </Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ px: 0, pt: 0 }}>
                      {groups.legacy.map(([group, items]) => (
                        <Box key={group} sx={{ mb: 1.5 }}>
                          <Typography sx={{ fontSize: 11, color: "#A1A1A6", mb: 0.25 }}>{group}</Typography>
                          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                            {items.map(renderPermission)}
                          </Box>
                        </Box>
                      ))}
                    </AccordionDetails>
                  </Accordion>
                )}
              </>
            )}
          </Box>
        </Box>
      )}

      <Dialog open={createOpen} onClose={busy ? undefined : () => setCreateOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>新建角色</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField label="角色名称" size="small" value={createForm.name} sx={{ mt: 1 }}
            onChange={(e) => setCreateForm((p) => ({ ...p, name: e.target.value }))} />
          <TextField label="角色标识" size="small" value={createForm.code}
            onChange={(e) => setCreateForm((p) => ({ ...p, code: e.target.value }))}
            helperText="小写字母开头，如 analyst" />
          <TextField label="说明" size="small" value={createForm.description}
            onChange={(e) => setCreateForm((p) => ({ ...p, description: e.target.value }))} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setCreateOpen(false)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void createRole()} disabled={busy}>
            {busy ? <CircularProgress size={14} color="inherit" /> : "创建"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除角色"
        desc={`删除「${deleteTarget?.name}」后不可恢复。`}
        confirmText="删除"
        danger
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void removeRole()}
      />
      {toastNode}
    </Box>
  );
}
