/** 用户管理 —— 列表 / 新建 / 编辑 / 重置密码 / 停用启用 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, InputAdornment, Menu, MenuItem, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import {
  Add as AddIcon, Check as CheckIcon, Close as CloseIcon,
  DeleteOutline as DeleteIcon, DriveFileRenameOutline as RenameIcon,
  MoreHoriz as MoreIcon, Search as SearchIcon,
} from "@mui/icons-material";
import client from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import {
  BORDER, ConfirmDialog, EmptyState, INK, Loading, MUTED, PrimaryButton,
  SectionHead, TD, TH, dialogPaperSx, dialogTitleSx, fmtTime, friendlyError, useToast,
} from "./shared";

interface UserItem {
  id: number; username: string; email: string; role: string; role_name: string;
  account_type?: "admin" | "user";
  position?: "member" | "supervisor" | "manager" | "director";
  position_name?: string;
  is_active: boolean; department_id: number | null; created_at: string;
  approval_status?: "pending" | "approved" | "rejected";
}

interface Department {
  id: number; name: string; user_count: number;
  leader_id: number | null; leader_name: string;
  parent_id?: number | null;
}

interface MetaUser {
  id: number; username: string; department_id: number | null;
}

interface Meta {
  roles: Array<{ code: string; name: string; is_system: boolean }>;
  departments: Department[];
  users: MetaUser[];
}

const POSITIONS = [
  { value: "member", label: "员工" },
  { value: "supervisor", label: "主管" },
  { value: "manager", label: "经理" },
  { value: "director", label: "总监" },
] as const;

const ACCOUNT_TYPES = [
  { value: "user", label: "普通用户" },
  { value: "admin", label: "管理员" },
] as const;

const emptyCreate = {
  username: "", email: "", password: "",
  account_type: "user" as "admin" | "user",
  position: "member" as "member" | "supervisor" | "manager" | "director",
  department_id: "",
};

function passwordProblem(value: string): string {
  if (value.length < 6) return "密码至少 6 位";
  if (!/[a-z]/.test(value)) return "密码需要包含小写字母";
  if (!/[A-Z]/.test(value)) return "密码需要包含大写字母";
  if (!/[0-9]/.test(value)) return "密码需要包含数字";
  return "";
}

export default function UsersPanel({
  scope, ownDepartmentId,
}: { scope?: string; ownDepartmentId?: number | null }) {
  const { user: me } = useAuth();
  const dataScope = scope || "self";
  const scoped = dataScope !== "all";
  const selfOnly = dataScope === "self";
  const ownDeptId = ownDepartmentId ?? null;
  const [items, setItems] = useState<UserItem[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<Meta>({ roles: [], departments: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [deptFilter, setDeptFilter] = useState("all");
  const [menu, setMenu] = useState<{ el: HTMLElement; item: UserItem } | null>(null);
  const { show, node: toastNode } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [editTarget, setEditTarget] = useState<UserItem | null>(null);
  const [editForm, setEditForm] = useState({
    username: "", email: "",
    account_type: "user" as "admin" | "user",
    position: "member" as "member" | "supervisor" | "manager" | "director",
    department_id: "",
  });
  const [pwdTarget, setPwdTarget] = useState<UserItem | null>(null);
  const [pwdForm, setPwdForm] = useState({ password: "", confirm: "" });
  const [disableTarget, setDisableTarget] = useState<UserItem | null>(null);
  const [busy, setBusy] = useState(false);

  // 部门管理（注册页也用这份清单，所以增删都在这里做）
  const [deptOpen, setDeptOpen] = useState(false);
  const [deptNewName, setDeptNewName] = useState("");
  const [deptEditing, setDeptEditing] = useState<Department | null>(null);
  const [deptEditName, setDeptEditName] = useState("");
  const [deptDelete, setDeptDelete] = useState<Department | null>(null);
  const [deptBusy, setDeptBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await client.get("/admin/users", {
        params: {
          q,
          position: positionFilter === "all" ? "" : positionFilter,
          status: statusFilter === "all" ? "" : statusFilter,
          department: deptFilter === "all" ? "" : deptFilter,
        },
      });
      setItems(res.data?.items || []);
      setTotal(Number(res.data?.total || 0));
    } catch (err) {
      show(friendlyError(err, "读取用户失败"), "error");
    } finally {
      setLoading(false);
    }
  }, [q, positionFilter, statusFilter, deptFilter, show]);

  const loadMeta = useCallback(async () => {
    try {
      const res = await client.get("/admin/meta");
      setMeta(res.data || { roles: [], departments: [], users: [] });
    } catch {
      /* 下拉数据拿不到不阻塞列表 */
    }
  }, []);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  // 搜索输入防抖：打字不连发请求
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 260);
    return () => window.clearTimeout(timer);
  }, [load]);

  const positionLabel = (value?: string) =>
    POSITIONS.find((p) => p.value === value)?.label || "员工";
  const accountLabel = (value?: string) => (value === "admin" ? "管理员" : "普通用户");

  const deptName = (id: number | null) =>
    meta.departments.find((d) => d.id === id)?.name || "—";

  const submitCreate = async () => {
    if (busy) return;
    const username = createForm.username.trim();
    const email = createForm.email.trim();
    if (username.length < 2) { show("用户名至少 2 个字符", "error"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show("邮箱格式不对", "error"); return; }
    const problem = passwordProblem(createForm.password);
    if (problem) { show(problem, "error"); return; }
    setBusy(true);
    try {
      await client.post("/admin/users", {
        username, email, password: createForm.password,
        account_type: createForm.account_type,
        position: createForm.position,
        department_id: createForm.department_id ? Number(createForm.department_id) : null,
      });
      setCreateOpen(false);
      setCreateForm(emptyCreate);
      show("用户已创建");
      await load();
    } catch (err) {
      show(friendlyError(err, "创建失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (item: UserItem) => {
    setEditTarget(item);
    setEditForm({
      username: item.username,
      email: item.email,
      account_type: item.account_type || "user",
      position: item.position || "member",
      department_id: item.department_id ? String(item.department_id) : "",
    });
  };

  const submitEdit = async () => {
    if (!editTarget || busy) return;
    setBusy(true);
    try {
      await client.patch(`/admin/users/${editTarget.id}`, {
        username: editForm.username.trim(),
        email: editForm.email.trim(),
        account_type: editForm.account_type,
        position: editForm.position,
        department_id: editForm.department_id ? Number(editForm.department_id) : null,
      });
      setEditTarget(null);
      show("已保存");
      await load();
    } catch (err) {
      show(friendlyError(err, "保存失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const addDepartment = async () => {
    const name = deptNewName.trim();
    if (!name) { show("部门名称不能为空", "error"); return; }
    if (deptBusy) return;
    setDeptBusy(true);
    try {
      await client.post("/admin/departments", { name });
      setDeptNewName("");
      show(`已添加「${name}」`);
      await loadMeta();
    } catch (err) {
      show(friendlyError(err, "添加部门失败"), "error");
    } finally {
      setDeptBusy(false);
    }
  };

  const renameDepartment = async () => {
    if (!deptEditing || deptBusy) return;
    const name = deptEditName.trim();
    if (!name) { show("部门名称不能为空", "error"); return; }
    if (name === deptEditing.name) { setDeptEditing(null); return; }
    setDeptBusy(true);
    try {
      await client.patch(`/admin/departments/${deptEditing.id}`, { name });
      setDeptEditing(null);
      show("部门已改名");
      await loadMeta();
      await load();
    } catch (err) {
      show(friendlyError(err, "改名失败"), "error");
    } finally {
      setDeptBusy(false);
    }
  };

  const setDepartmentLeader = async (deptId: number, leaderId: number | null) => {
    if (deptBusy) return;
    setDeptBusy(true);
    try {
      await client.patch(`/admin/departments/${deptId}`, { leader_id: leaderId });
      show(leaderId ? "负责人已设置" : "已清除负责人");
      await loadMeta();
    } catch (err) {
      show(friendlyError(err, "设置负责人失败"), "error");
    } finally {
      setDeptBusy(false);
    }
  };

  const setDepartmentParent = async (deptId: number, parentId: string) => {
    if (deptBusy) return;
    setDeptBusy(true);
    try {
      await client.patch(`/admin/departments/${deptId}`, {
        parent_id: parentId ? Number(parentId) : null,
      });
      show("上级部门已更新");
      await loadMeta();
    } catch (err) {
      show(friendlyError(err, "设置上级部门失败"), "error");
    } finally {
      setDeptBusy(false);
    }
  };

  const removeDepartment = async () => {
    if (!deptDelete || deptBusy) return;
    setDeptBusy(true);
    try {
      await client.delete(`/admin/departments/${deptDelete.id}`);
      if (deptFilter === String(deptDelete.id)) setDeptFilter("all");
      setDeptDelete(null);
      show("部门已删除");
      await loadMeta();
      await load();
    } catch (err) {
      show(friendlyError(err, "删除失败"), "error");
    } finally {
      setDeptBusy(false);
    }
  };

  const submitPassword = async () => {
    if (!pwdTarget || busy) return;
    const problem = passwordProblem(pwdForm.password);
    if (problem) { show(problem, "error"); return; }
    if (pwdForm.password !== pwdForm.confirm) { show("两次输入的密码不一致", "error"); return; }
    setBusy(true);
    try {
      await client.patch(`/admin/users/${pwdTarget.id}`, { password: pwdForm.password });
      setPwdTarget(null);
      setPwdForm({ password: "", confirm: "" });
      show("密码已重置，该账号需重新登录");
    } catch (err) {
      show(friendlyError(err, "重置失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!disableTarget || busy) return;
    const next = !disableTarget.is_active;
    setBusy(true);
    try {
      await client.patch(`/admin/users/${disableTarget.id}`, { is_active: next });
      setDisableTarget(null);
      show(next ? "已启用" : "已停用，该账号的登录会话已失效");
      await load();
    } catch (err) {
      show(friendlyError(err, "操作失败"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <SectionHead
        title="用户管理"
        desc={scoped
          ? "部门管理员：只能查看和管理本部门账号；停用或改密后旧登录会话立即失效"
          : "权限、职位、部门与启停状态；停用或改密后旧登录会话立即失效"}
        action={
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            {!scoped && (
              <Button
                size="small" variant="outlined"
                onClick={() => { setDeptOpen(true); void loadMeta(); }}
                sx={{
                  textTransform: "none", fontSize: 12.5, height: 36, borderRadius: 2,
                  borderColor: BORDER, color: INK, px: 1.5,
                }}
              >
                部门管理
              </Button>
            )}
            {!selfOnly && <PrimaryButton
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
              onClick={() => {
                setCreateForm((prev) => ({
                  ...prev,
                  account_type: "user" as const,
                  department_id: scoped && ownDeptId ? String(ownDeptId) : prev.department_id,
                }));
                setCreateOpen(true);
              }}
            >
              新建用户
            </PrimaryButton>}
          </Box>
        }
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, mb: 2, flexWrap: "wrap" }}>
        <TextField
          size="small" placeholder="搜索用户名 / 邮箱" value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ width: 240, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: MUTED }} />
              </InputAdornment>
            ),
          }}
        />
        <TextField
          select size="small" value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
        >
          <MenuItem value="all" sx={{ fontSize: 13 }}>全部职位</MenuItem>
          {POSITIONS.map((p) => (
            <MenuItem key={p.value} value={p.value} sx={{ fontSize: 13 }}>{p.label}</MenuItem>
          ))}
        </TextField>
        <TextField
          select size="small" value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
        >
          <MenuItem value="all" sx={{ fontSize: 13 }}>全部状态</MenuItem>
          <MenuItem value="active" sx={{ fontSize: 13 }}>已启用</MenuItem>
          <MenuItem value="inactive" sx={{ fontSize: 13 }}>已停用</MenuItem>
          <MenuItem value="pending" sx={{ fontSize: 13 }}>待审批</MenuItem>
          <MenuItem value="rejected" sx={{ fontSize: 13 }}>已驳回</MenuItem>
        </TextField>
        {!scoped && (
          <TextField
            select size="small" value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            sx={{ width: 160, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
          >
            <MenuItem value="all" sx={{ fontSize: 13 }}>全部部门</MenuItem>
            <MenuItem value="none" sx={{ fontSize: 13 }}>未分配</MenuItem>
            {meta.departments.map((d) => (
              <MenuItem key={d.id} value={String(d.id)} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
            ))}
          </TextField>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, color: MUTED }}>共 {total} 人</Typography>
      </Box>

      <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: "12px", overflow: "hidden" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={TH}>用户</TableCell>
                <TableCell sx={TH}>邮箱</TableCell>
                <TableCell sx={TH}>权限</TableCell>
                <TableCell sx={TH}>职位</TableCell>
                <TableCell sx={TH}>部门</TableCell>
                <TableCell sx={TH}>状态</TableCell>
                <TableCell sx={TH}>创建时间</TableCell>
                <TableCell sx={{ ...TH, width: 48 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={8}><Loading py={4} /></TableCell></TableRow>
              ) : items.length === 0 ? (
                <TableRow><TableCell colSpan={8}><EmptyState text="没有匹配的用户" hint="换个关键词或清空筛选" /></TableCell></TableRow>
              ) : items.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell sx={TD}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{
                        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
                        bgcolor: item.is_active ? "rgba(99,102,241,0.12)" : "#F1F5F9",
                        color: item.is_active ? "#4F46E5" : "#94A3B8",
                        display: "grid", placeItems: "center", fontSize: 11.5, fontWeight: 700,
                      }}>
                        {item.username?.[0]?.toUpperCase() || "U"}
                      </Box>
                      <Typography sx={{ fontSize: 12.5, fontWeight: item.id === me?.id ? 700 : 500, color: INK }}>
                        {item.username}
                        {item.id === me?.id && (
                          <Box component="span" sx={{ ml: 0.75, fontSize: 10.5, color: MUTED }}>（我）</Box>
                        )}
                      </Typography>

                    </Box>
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#475569" }}>{item.email}</TableCell>
                  <TableCell sx={TD}>
                    <Chip
                      label={accountLabel(item.account_type)}
                      size="small"
                      sx={{
                        fontSize: 10.5, height: 20,
                        bgcolor: item.account_type === "admin" ? "rgba(99,102,241,0.10)" : "#F1F5F9",
                        color: item.account_type === "admin" ? "#4F46E5" : "#475569",
                        fontWeight: 600,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#64748B" }}>
                    {positionLabel(item.position)}
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#64748B" }}>{deptName(item.department_id)}</TableCell>
                  <TableCell sx={TD}>
                    {item.approval_status === "pending" ? (
                      <Chip
                        label="待审批" size="small"
                        sx={{ height: 19, fontSize: 10, bgcolor: "rgba(245,158,11,0.14)", color: "#B45309", fontWeight: 600 }}
                      />
                    ) : item.approval_status === "rejected" ? (
                      <Chip
                        label="已驳回" size="small"
                        sx={{ height: 19, fontSize: 10, bgcolor: "rgba(239,68,68,0.10)", color: "#B91C1C" }}
                      />
                    ) : (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                        <Box sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: item.is_active ? "#10B981" : "#CBD5E1" }} />
                        <Typography sx={{ fontSize: 12, color: item.is_active ? INK : MUTED }}>
                          {item.is_active ? "启用" : "停用"}
                        </Typography>
                      </Box>
                    )}
                  </TableCell>
                  <TableCell sx={{ ...TD, color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>{fmtTime(item.created_at)}</TableCell>
                  <TableCell sx={TD}>
                    <Tooltip title="操作">
                      <IconButton size="small" onClick={(e) => setMenu({ el: e.currentTarget, item })}>
                        <MoreIcon sx={{ fontSize: 17, color: MUTED }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>

      <Menu
        anchorEl={menu?.el ?? null} open={!!menu} onClose={() => setMenu(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 148, border: `1px solid ${BORDER}` } } }}
      >
        <MenuItem dense sx={{ fontSize: 13 }} onClick={() => { const it = menu?.item; setMenu(null); if (it) openEdit(it); }}>
          编辑资料
        </MenuItem>
        <MenuItem dense sx={{ fontSize: 13 }} onClick={() => { const it = menu?.item; setMenu(null); if (it) setPwdTarget(it); }}>
          重置密码
        </MenuItem>
        <MenuItem
          dense sx={{ fontSize: 13 }}
          onClick={() => { const it = menu?.item; setMenu(null); if (it) setDisableTarget(it); }}
        >
          {menu?.item.is_active ? "停用账号" : "启用账号"}
        </MenuItem>
      </Menu>

      {/* 部门管理 */}
      <Dialog
        open={deptOpen} onClose={deptBusy ? undefined : () => setDeptOpen(false)}
        maxWidth="md" fullWidth PaperProps={{ sx: dialogPaperSx }}
      >
        <DialogTitle sx={dialogTitleSx}>部门管理</DialogTitle>
        <DialogContent sx={{ pt: "8px !important" }}>
          <Typography sx={{ fontSize: 12, color: MUTED, mb: 1.5 }}>
            注册页的「部门」下拉直接读这份清单；有人在的部门不能删。
          </Typography>

          <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: "10px", overflow: "hidden", mb: 2 }}>
            {meta.departments.length === 0 ? (
              <Typography sx={{ px: 2, py: 3, fontSize: 12.5, color: MUTED, textAlign: "center" }}>
                还没有部门，先添加一个
              </Typography>
            ) : meta.departments.map((dept, index) => (
              <Box
                key={dept.id}
                data-dept-id={dept.id}
                sx={{
                  display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.85,
                  borderBottom: index === meta.departments.length - 1 ? "none" : `1px solid #F1F5F9`,
                  "&:hover": { bgcolor: "rgba(15,23,42,0.02)" },
                }}
              >
                {deptEditing?.id === dept.id ? (
                  <>
                    <TextField
                      size="small" autoFocus value={deptEditName}
                      onChange={(e) => setDeptEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void renameDepartment();
                        if (e.key === "Escape") setDeptEditing(null);
                      }}
                      sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 13, height: 32 } }}
                    />
                    <IconButton size="small" disabled={deptBusy} onClick={() => void renameDepartment()}>
                      <CheckIcon sx={{ fontSize: 17, color: "#10B981" }} />
                    </IconButton>
                    <IconButton size="small" disabled={deptBusy} onClick={() => setDeptEditing(null)}>
                      <CloseIcon sx={{ fontSize: 17, color: MUTED }} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <Typography noWrap sx={{ flex: 1, fontSize: 13, color: INK }}>{dept.name}</Typography>
                    <TextField
                      select size="small"
                      value={dept.parent_id == null ? "" : String(dept.parent_id)}
                      onChange={(e) => void setDepartmentParent(dept.id, e.target.value)}
                      disabled={deptBusy}
                      title="上级部门（用于「本部门及下级」的数据范围）"
                      sx={{ width: 132, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12, height: 30 } }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (value) => (
                          <Typography component="span" sx={{ fontSize: 12, color: value ? INK : "#A1A1A6" }}>
                            {value
                              ? `上级：${meta.departments.find((d) => String(d.id) === value)?.name || ""}`
                              : "一级部门"}
                          </Typography>
                        ),
                      }}
                    >
                      <MenuItem value="" sx={{ fontSize: 12 }}>一级部门</MenuItem>
                      {meta.departments
                        .filter((d) => d.id !== dept.id)
                        .map((d) => (
                          <MenuItem key={d.id} value={String(d.id)} sx={{ fontSize: 12 }}>
                            上级：{d.name}
                          </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                      select size="small" value={dept.leader_id ? String(dept.leader_id) : ""}
                      onChange={(e) => {
                        const value = e.target.value;
                        void setDepartmentLeader(dept.id, value ? Number(value) : null);
                      }}
                      disabled={deptBusy}
                      title="部门负责人可以审批本部门的注册申请"
                      sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12, height: 30 } }}
                      SelectProps={{
                        displayEmpty: true,
                        renderValue: (value) => (
                          <Typography component="span" sx={{ fontSize: 12, color: value ? INK : "#A1A1A6" }}>
                            {dept.leader_name || "设负责人"}
                          </Typography>
                        ),
                      }}
                    >
                      <MenuItem value="" sx={{ fontSize: 12 }}>不指定</MenuItem>
                      {meta.users.map((user) => (
                        <MenuItem key={user.id} value={String(user.id)} sx={{ fontSize: 12 }}>
                          {user.username}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Chip
                      label={`${dept.user_count} 人`} size="small"
                      sx={{ height: 19, fontSize: 10, bgcolor: "#F1F5F9", color: "#64748B" }}
                    />
                    <Tooltip title="改名">
                      <IconButton
                        size="small"
                        onClick={() => { setDeptEditing(dept); setDeptEditName(dept.name); }}
                      >
                        <RenameIcon sx={{ fontSize: 16, color: MUTED }} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={dept.user_count > 0 ? "还有用户在该部门，先调整部门" : "删除"}>
                      <span>
                        <IconButton
                          size="small" disabled={dept.user_count > 0}
                          onClick={() => setDeptDelete(dept)}
                        >
                          <DeleteIcon sx={{ fontSize: 16, color: dept.user_count > 0 ? "#E2E8F0" : "#EF4444" }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                )}
              </Box>
            ))}
          </Box>

          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              size="small" placeholder="添加部门，如：客服部门" value={deptNewName}
              onChange={(e) => setDeptNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addDepartment(); }}
              sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, height: 36 } }}
            />
            <PrimaryButton
              disabled={deptBusy || !deptNewName.trim()}
              onClick={() => void addDepartment()}
              startIcon={<AddIcon sx={{ fontSize: 16 }} />}
            >
              添加
            </PrimaryButton>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDeptOpen(false)} disabled={deptBusy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>关闭</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!deptDelete}
        title="删除部门"
        desc={`确定删除「${deptDelete?.name}」？删除后注册页就不再出现这个选项（历史用户不受影响）。`}
        confirmText="删除"
        danger
        busy={deptBusy}
        onClose={() => setDeptDelete(null)}
        onConfirm={() => void removeDepartment()}
      />

      {/* 新建用户 */}
      <Dialog open={createOpen} onClose={busy ? undefined : () => setCreateOpen(false)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>新建用户</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField label="用户名" size="small" value={createForm.username}
            onChange={(e) => setCreateForm((p) => ({ ...p, username: e.target.value }))}
            sx={{ mt: 1 }} />
          <TextField label="邮箱" size="small" value={createForm.email}
            onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))} />
          <TextField label="初始密码" size="small" type="password" value={createForm.password}
            onChange={(e) => setCreateForm((p) => ({ ...p, password: e.target.value }))}
            helperText="至少 6 位，含大小写字母与数字" />
          <TextField select label="权限" size="small" value={createForm.account_type}
            onChange={(e) => setCreateForm((p) => ({
              ...p,
              account_type: e.target.value as "admin" | "user",
            }))}>
            {ACCOUNT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="职位" size="small" value={createForm.position}
            onChange={(e) => setCreateForm((p) => ({
              ...p,
              position: e.target.value as typeof p.position,
            }))}>
            {POSITIONS.map((p0) => (
              <MenuItem key={p0.value} value={p0.value} sx={{ fontSize: 13 }}>{p0.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="部门" size="small" value={createForm.department_id}
            disabled={scoped}
            onChange={(e) => setCreateForm((p) => ({ ...p, department_id: e.target.value }))}>
            {!scoped && <MenuItem value="" sx={{ fontSize: 13 }}>不指定</MenuItem>}
            {meta.departments.map((d) => (
              <MenuItem key={d.id} value={String(d.id)} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setCreateOpen(false)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void submitCreate()} disabled={busy}>
            {busy ? <CircularProgress size={14} color="inherit" /> : "创建"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* 编辑用户 */}
      <Dialog open={!!editTarget} onClose={busy ? undefined : () => setEditTarget(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>编辑用户</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <TextField label="用户名" size="small" value={editForm.username}
            onChange={(e) => setEditForm((p) => ({ ...p, username: e.target.value }))} sx={{ mt: 1 }} />
          <TextField label="邮箱" size="small" value={editForm.email}
            onChange={(e) => setEditForm((p) => ({ ...p, email: e.target.value }))} />
          <TextField select label="权限" size="small" value={editForm.account_type}
            onChange={(e) => setEditForm((p) => ({
              ...p,
              account_type: e.target.value as "admin" | "user",
            }))}>
            {ACCOUNT_TYPES.map((t) => (
              <MenuItem key={t.value} value={t.value} sx={{ fontSize: 13 }}>{t.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="职位" size="small" value={editForm.position}
            onChange={(e) => setEditForm((p) => ({
              ...p,
              position: e.target.value as typeof p.position,
            }))}>
            {POSITIONS.map((p0) => (
              <MenuItem key={p0.value} value={p0.value} sx={{ fontSize: 13 }}>{p0.label}</MenuItem>
            ))}
          </TextField>
          <TextField select label="部门" size="small" value={editForm.department_id}
            disabled={scoped}
            onChange={(e) => setEditForm((p) => ({ ...p, department_id: e.target.value }))}>
            {!scoped && <MenuItem value="" sx={{ fontSize: 13 }}>不指定</MenuItem>}
            {meta.departments.map((d) => (
              <MenuItem key={d.id} value={String(d.id)} sx={{ fontSize: 13 }}>{d.name}</MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setEditTarget(null)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void submitEdit()} disabled={busy}>
            {busy ? <CircularProgress size={14} color="inherit" /> : "保存"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      {/* 重置密码 */}
      <Dialog open={!!pwdTarget} onClose={busy ? undefined : () => setPwdTarget(null)} maxWidth="xs" fullWidth
        PaperProps={{ sx: dialogPaperSx }}>
        <DialogTitle sx={dialogTitleSx}>重置密码</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "8px !important" }}>
          <Typography sx={{ fontSize: 12.5, color: MUTED }}>
            将重置「{pwdTarget?.username}」的密码，该账号所有登录会话立即失效。
          </Typography>
          <TextField label="新密码" size="small" type="password" value={pwdForm.password}
            onChange={(e) => setPwdForm((p) => ({ ...p, password: e.target.value }))} />
          <TextField label="确认新密码" size="small" type="password" value={pwdForm.confirm}
            onChange={(e) => setPwdForm((p) => ({ ...p, confirm: e.target.value }))} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setPwdTarget(null)} disabled={busy}
            sx={{ textTransform: "none", fontSize: 13, color: MUTED }}>取消</Button>
          <PrimaryButton onClick={() => void submitPassword()} disabled={busy}>
            {busy ? <CircularProgress size={14} color="inherit" /> : "重置"}
          </PrimaryButton>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!disableTarget}
        title={disableTarget?.is_active ? "停用账号" : "启用账号"}
        desc={disableTarget?.is_active
          ? `停用「${disableTarget?.username}」后该账号无法登录，已有会话立即失效。随时可以重新启用。`
          : `重新启用「${disableTarget?.username}」的登录权限。`}
        confirmText={disableTarget?.is_active ? "停用" : "启用"}
        danger={!!disableTarget?.is_active}
        busy={busy}
        onClose={() => setDisableTarget(null)}
        onConfirm={() => void toggleActive()}
      />
      {toastNode}
    </Box>
  );
}
