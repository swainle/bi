import { Link } from "@mui/material";
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

export function FieldDialog({
  datasetId, columns, source, onClose, onSaved,
}: {
  datasetId: number;
  columns: { name: string; type: string }[];
  source: Field | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = source === "new";
  const base = isNew ? null : source;
  const isFormula = isNew || !!base?.expression;
  const [name, setName] = useState(base?.name || "");
  const [column, setColumn] = useState(base?.source_column || "");
  const [expression, setExpression] = useState(base?.expression || "");
  const expressionRef = useRef<HTMLTextAreaElement>(null);
  const [formulaColumns, setFormulaColumns] = useState<{ name: string; identifier: string }[]>([]);
  const [testMessage, setTestMessage] = useState("");
  const [role, setRole] = useState(base?.role || "measure");
  const [dataType, setDataType] = useState(base?.data_type || "numeric");
  const [filterable, setFilterable] = useState(base?.is_filterable ?? true);
  const [groupable, setGroupable] = useState(base?.is_groupable ?? true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!isFormula) return;
    let alive = true;
    client.get(`/bi/semantic/datasets/${datasetId}/formula-columns`)
      .then((res) => { if (alive) setFormulaColumns(res.data?.columns || []); })
      .catch((e) => { if (alive) setErr(e?.response?.data?.detail || "读取可用列失败"); });
    return () => { alive = false; };
  }, [datasetId, isFormula]);

  const changeExpression = (value: string) => {
    setExpression(value);
    setTestMessage("");
    setErr("");
  };

  const testFormula = async () => {
    setBusy(true); setErr(""); setTestMessage("");
    try {
      const res = await client.post(`/bi/semantic/datasets/${datasetId}/formula-test`, { expression });
      setTestMessage(res.data.message);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "测试失败");
    } finally { setBusy(false); }
  };

  const pickColumn = (col: string) => {
    setColumn(col);
    const phys = columns.find((c) => c.name === col);
    const dt = phys ? inferType(phys.type) : "text";
    if (!name || name === column) setName(col);
    if (isNew || dataType !== dt) {
      setDataType(dt);
      if (isNew) setRole(inferRole(dt));
    }
  };

  const submit = async () => {
    if (!name.trim() || !(isFormula ? expression.trim() : column.trim())) return;
    setBusy(true);
    setErr(""); setTestMessage("");
    try {
      const payload = {
        name: name.trim(), source_column: isFormula ? name.trim() : column.trim(), role,
        ...(isFormula ? { expression: expression.trim() } : {}),
        data_type: dataType, is_filterable: filterable, is_groupable: groupable,
      };
      if (isNew) await client.post(`/bi/semantic/datasets/${datasetId}/fields`, payload);
      else await client.patch(`/bi/semantic/datasets/${datasetId}/fields/${base!.id}`, payload);
      onSaved();
    } catch (e: any) {
      setErr(e?.response?.data?.detail || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15.5, fontWeight: 700 }}>{isFormula ? (isNew ? "添加公式字段" : "编辑公式字段") : "编辑字段"}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {!isFormula && <TextField fullWidth select size="small" label="来源列" value={column}
          onChange={(e) => pickColumn(e.target.value)}
          sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
          {columns.length === 0 && (
            <MenuItem value={column} sx={{ fontSize: 13 }}>{column || "（无可用物理列）"}</MenuItem>
          )}
          {columns.map((c) => (
            <MenuItem key={c.name} value={c.name} sx={{ fontSize: 13 }}>
              {c.name} · {c.type}
            </MenuItem>
          ))}
        </TextField>}
        <TextField fullWidth size="small" label="字段名" value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ mt: 2, "& .MuiOutlinedInput-root": { borderRadius: 2 } }} />
        {isFormula && <>
          <TextField fullWidth size="small" label="SQL 表达式" multiline minRows={4}
            value={expression} disabled={busy} inputRef={expressionRef} onChange={(e) => changeExpression(e.target.value)}
            placeholder="revenue - COALESCE(cost, 0)"
            InputProps={{ sx: { fontFamily: "ui-monospace", fontSize: 12.5 } }} sx={{ mt: 2 }} />
          <Box sx={{ mt: 1, textAlign: "right" }}>
            <Link href="/help/formula-fields#formula-fields" target="_blank" rel="noopener noreferrer" sx={{ fontSize: 12 }}>
              公式字段使用说明 ↗
            </Link>
          </Box>
          <Typography sx={{ mt: 1, mb: 0.5, fontSize: 12, color: "text.secondary" }}>可用列（点击插入）</Typography>
          <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", maxHeight: 120, overflow: "auto" }}>
            {formulaColumns.map((col) => <Chip key={col.name} label={col.name} disabled={busy} size="small" onClick={() => {
              const input = expressionRef.current;
              const start = input?.selectionStart ?? expression.length;
              const end = input?.selectionEnd ?? start;
              const identifier = col.identifier;
              changeExpression(expression.slice(0, start) + identifier + expression.slice(end));
              requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start + identifier.length, start + identifier.length); });
            }} />)}
          </Box>
        </>}
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5 }}>
          <TextField select size="small" label="角色" value={role} onChange={(e) => setRole(e.target.value)}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
            {ROLES.map((r) => <MenuItem key={r.v} value={r.v} sx={{ fontSize: 13 }}>{r.l}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="类型" value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2 } }}>
            {TYPES.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: 13 }}>{t}</MenuItem>)}
          </TextField>
        </Box>
        <Box sx={{ display: "flex", gap: 2, mt: 0.5 }}>
          <FormControlLabel control={<Switch size="small" checked={filterable}
            onChange={(e) => setFilterable(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12 }}>可筛选</Typography>} />
          <FormControlLabel control={<Switch size="small" checked={groupable}
            onChange={(e) => setGroupable(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 12 }}>可分组</Typography>} />
        </Box>
        {testMessage && <Alert severity="success" sx={{ mt: 1, fontSize: 12 }}>{testMessage}</Alert>}
        {err && <Alert severity="error" sx={{ mt: 1, fontSize: 12 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} sx={{ textTransform: "none" }}>取消</Button>
        {isFormula && <Button variant="outlined" onClick={testFormula} disabled={busy || !expression.trim()}
          sx={{ textTransform: "none", borderRadius: 2 }}>测试</Button>}
        <Button variant="contained" onClick={submit} disabled={busy || !name.trim() || !(isFormula ? expression.trim() : column.trim())}
          sx={{ bgcolor: "#6366F1", textTransform: "none", borderRadius: 2 }}>保存</Button>
      </DialogActions>
    </Dialog>
  );
}

/* ── 指标编辑 ──────────────────────────────────────────── */
