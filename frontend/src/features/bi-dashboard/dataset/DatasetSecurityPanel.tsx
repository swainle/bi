
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Drawer, FormControlLabel, IconButton,
  InputAdornment, MenuItem, Paper, Snackbar, Switch, Tab, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip,
  Typography,
} from "@mui/material";
import {
  Add, Close, DeleteOutline, Edit, History, Hub, PlayArrow, Refresh, Search,
  TableChart, UploadFileOutlined, VerifiedUser, VerifiedUserOutlined, VisibilityOutlined,
} from "@mui/icons-material";
import { useNavigate } from "react-router-dom";
import client from "../../../api/client";
import ModelImportDialog from "../ModelImportDialog";

import { ROLES, TYPES, FORMATS, Field, Metric, MetricVersion, MetricUsage, Dataset, PhysTable, RemoteTable, SourceBrief, remoteField, td, th, DEMO_TABLE, _NUM, inferType, inferRole, RowRule, ColumnMask, DeptScopeRule, DEPT_MODES, RULE_ROLES, MASK_OPTIONS, FIELD_ROLE_LABEL } from "./types";
import { MiniTable } from "./MiniTable";

export function DatasetSecurityPanel({ datasetId, fields }: { datasetId: number; fields: Field[] }) {
  const [rules, setRules] = useState<RowRule[]>([]);
  const [masks, setMasks] = useState<ColumnMask[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [role, setRole] = useState("");
  const [condition, setCondition] = useState("");
  const [maskField, setMaskField] = useState(fields[0]?.name || "");
  const [maskType, setMaskType] = useState("phone");
  const [maskPattern, setMaskPattern] = useState("{val}");
  const [deptRule, setDeptRule] = useState<DeptScopeRule | null>(null);
  const [deptField, setDeptField] = useState(fields[0]?.name || "");
  const [deptMode, setDeptMode] = useState<"department" | "self" | "all">("department");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get(`/bi/semantic/datasets/${datasetId}/security`);
      setRules(res.data?.row_rules || []);
      setMasks(res.data?.masks || []);
      const scope = res.data?.dept_scope || null;
      setDeptRule(scope);
      if (scope) {
        setDeptField(scope.column_name);
        setDeptMode(scope.mode);
      }
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "权限配置加载失败");
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => { load(); }, [load]);

  const saveDeptScope = async () => {
    if (!deptField) return;
    try {
      await client.put(`/bi/semantic/datasets/${datasetId}/security/dept-scope`, {
        column_name: deptField, mode: deptMode,
      });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "保存部门隔离失败");
    }
  };

  const removeDeptScope = async () => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/security/dept-scope`);
      setDeptRule(null);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "取消部门隔离失败");
    }
  };

  const addRule = async () => {
    if (!condition.trim()) return;
    try {
      await client.post(`/bi/semantic/datasets/${datasetId}/security/row-rules`, {
        role_name: role, filter_rule: condition.trim(),
      });
      setCondition("");
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "添加行级规则失败");
    }
  };

  const removeRule = async (rule: RowRule) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/security/row-rules/${rule.id}`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "删除规则失败");
    }
  };

  const addMask = async () => {
    if (!maskField) return;
    try {
      await client.post(`/bi/semantic/datasets/${datasetId}/security/masks`, {
        column_name: maskField, mask_type: maskType,
        mask_pattern: maskType === "custom" ? maskPattern : "",
      });
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "添加脱敏失败");
    }
  };

  const removeMask = async (mask: ColumnMask) => {
    try {
      await client.delete(`/bi/semantic/datasets/${datasetId}/security/masks/${encodeURIComponent(mask.column_name)}`);
      await load();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "删除脱敏失败");
    }
  };

  if (loading) {
    return <Box sx={{ py: 6, textAlign: "center" }}><CircularProgress size={22} /></Box>;
  }

  return (
    <Box sx={{ maxWidth: 880 }}>
      {err && <Alert severity="error" onClose={() => setErr("")} sx={{ mb: 1.5, fontSize: 12 }}>{err}</Alert>}

      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.4 }}>部门隔离</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
        只返回本部门（含下级）的数据；数据范围为「全部部门」的账号不受影响，列脱敏照旧
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}>
        <TextField select size="small" label="部门列" value={deptField}
          onChange={(e) => setDeptField(e.target.value)}
          sx={{ width: 170, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {fields.map((f) => <MenuItem key={f.id} value={f.name} sx={{ fontSize: 13 }}>{f.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="模式" value={deptMode}
          onChange={(e) => setDeptMode(e.target.value as typeof deptMode)}
          sx={{ width: 190, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {DEPT_MODES.map((m) => <MenuItem key={m.v} value={m.v} sx={{ fontSize: 13 }}>{m.l}</MenuItem>)}
        </TextField>
        <Button size="small" variant="outlined" onClick={saveDeptScope} disabled={!deptField}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5, height: 38 }}>
          {deptRule ? "更新" : "启用"}
        </Button>
        {deptRule && (
          <Button size="small" onClick={removeDeptScope}
            sx={{ textTransform: "none", fontSize: 12, color: "error.main" }}>
            取消隔离
          </Button>
        )}
      </Box>
      {deptRule && (
        <Typography sx={{ fontSize: 11.5, color: "#64748B", mb: 0.5 }}>
          当前：{DEPT_MODES.find((m) => m.v === deptRule.mode)?.l} · 部门列 {deptRule.column_name}
        </Typography>
      )}

      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.4 }}>行级规则</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
        按角色或所有人限制可见行，和表级规则同时生效；模板复制时一并带走
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
        <TextField select size="small" label="范围" value={role}
          onChange={(e) => setRole(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {RULE_ROLES.map((r) => <MenuItem key={r.v} value={r.v} sx={{ fontSize: 13 }}>{r.l}</MenuItem>)}
        </TextField>
        <TextField size="small" label="条件" value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="platform = '拼多多'"
          InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12 } }}
          sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        <Button size="small" variant="outlined" onClick={addRule} disabled={!condition.trim()}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5, height: 38 }}>添加</Button>
      </Box>
      <MiniTable
        head={["范围", "条件", "备注", ""]}
        rows={rules.map((r) => [
          <span key="s" style={{ fontWeight: 600 }}>
            {r.user_id ? `用户 ${r.username || r.user_id}` : (RULE_ROLES.find((x) => x.v === r.role_name)?.l || r.role_name)}
          </span>,
          <code key="c" style={{ fontSize: 11.5, color: "#475569" }}>{r.filter_rule}</code>,
          <span key="n" style={{ color: "#94A3B8" }}>{r.note || "—"}</span>,
          <Box key="a" sx={{ textAlign: "right" }}>
            <IconButton size="small" aria-label="删除行级规则" onClick={() => removeRule(r)} sx={{ p: 0.5, color: "error.main" }}>
              <DeleteOutline sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>,
        ])}
        empty="还没有行级规则（默认全量可见）"
      />

      <Typography sx={{ fontSize: 13, fontWeight: 700, mt: 2.5, mb: 0.4 }}>列级脱敏</Typography>
      <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1 }}>
        查询结果落到前端之前按列替换；自定义模板用 {"{val}"} 占位
      </Typography>
      <Box sx={{ display: "flex", gap: 1, mb: 1 }}>
        <TextField select size="small" label="字段" value={maskField}
          onChange={(e) => setMaskField(e.target.value)}
          sx={{ width: 170, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {fields.map((f) => <MenuItem key={f.id} value={f.name} sx={{ fontSize: 13 }}>{f.name}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="方式" value={maskType}
          onChange={(e) => setMaskType(e.target.value)}
          sx={{ width: 130, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {MASK_OPTIONS.map((o) => <MenuItem key={o.v} value={o.v} sx={{ fontSize: 13 }}>{o.l}</MenuItem>)}
        </TextField>
        {maskType === "custom" && (
          <TextField size="small" label="模板" value={maskPattern}
            onChange={(e) => setMaskPattern(e.target.value)}
            sx={{ width: 160, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        )}
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={addMask} disabled={!maskField}
          sx={{ textTransform: "none", fontSize: 12, borderRadius: 1.5, height: 38 }}>添加</Button>
      </Box>
      <MiniTable
        head={["字段", "方式", "模板", ""]}
        rows={masks.map((m) => [
          <span key="c" style={{ fontWeight: 600 }}>{m.column_name}</span>,
          MASK_OPTIONS.find((o) => o.v === m.mask_type)?.l || m.mask_type,
          <code key="p" style={{ fontSize: 11.5, color: "#64748B" }}>{m.mask_pattern || "—"}</code>,
          <Box key="a" sx={{ textAlign: "right" }}>
            <IconButton size="small" aria-label="删除脱敏" onClick={() => removeMask(m)} sx={{ p: 0.5, color: "error.main" }}>
              <DeleteOutline sx={{ fontSize: 15 }} />
            </IconButton>
          </Box>,
        ])}
        empty="还没有脱敏规则"
      />
    </Box>
  );
}

/* ── 字段血缘（哪些看板用了这个字段）──────────────────── */
