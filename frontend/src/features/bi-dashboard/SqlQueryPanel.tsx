import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, MenuItem, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography, useTheme,
} from "@mui/material";
import { ChevronRight, ContentCopy, ExpandMore, PlayArrow, Save, TableChart } from "@mui/icons-material";
import client from "../../api/client";
import { useAuth } from "../../hooks/useAuth";
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { PostgreSQL, sql as sqlLanguage } from "@codemirror/lang-sql";

type LocalTable = { table: string; origin: string; columns: { name: string; type: string }[] };
type QueryResult = {
  columns: string[]; rows: Record<string, unknown>[]; count: number;
  limit: number; truncated: boolean; elapsed_ms: number;
};

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const EDITOR_SETUP = { lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: true };

export default function SqlQueryPanel() {
  const { hasPerm } = useAuth();
  const nav = useNavigate();
  const theme = useTheme();
  const [tables, setTables] = useState<LocalTable[]>([]);
  const [tablesBusy, setTablesBusy] = useState(true);
  const [tableError, setTableError] = useState("");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState("");
  const [sql, setSql] = useState("SELECT * FROM bi_finance");
  const [limit, setLimit] = useState(500);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [executedSql, setExecutedSql] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const [chartCol, setChartCol] = useState("");
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const sidebarDrag = useRef<{ x: number; width: number; latest: number } | null>(null);
  const [tableWidth, setTableWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("mzbi.sqlLab.tableWidth"));
      return Number.isFinite(saved) && saved >= 180 ? saved : 280;
    } catch { return 280; }
  });
  const [editorHeight, setEditorHeight] = useState(240);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const extensions = useMemo(() => [
    sqlLanguage({ dialect: PostgreSQL, upperCaseKeywords: true, defaultSchema: "public",
      schema: { public: Object.fromEntries(tables.map((table) => [table.table, table.columns.map((column) => column.name)])) } }),
    EditorView.contentAttributes.of({ "aria-label": "SQL 编辑器" }),
  ], [tables]);
  const busy = loading || saving;
  const canSave = !!result && executedSql === sql && !busy && hasPerm("bi:nav:datasets");

  const resizeTables = (width: number, persist = false) => {
    const next = Math.max(180, Math.min(width, (panesRef.current?.clientWidth || 1000) - 366));
    setTableWidth(next);
    if (sidebarDrag.current) sidebarDrag.current.latest = next;
    if (persist) {
      try { localStorage.setItem("mzbi.sqlLab.tableWidth", String(Math.round(next))); } catch { /* 浏览器禁用存储时仍可调整 */ }
    }
  };

  useEffect(() => {
    const panes = panesRef.current;
    if (!panes) return;
    const observer = new ResizeObserver(() => setTableWidth((width) => Math.max(180, Math.min(width, panes.clientWidth - 366))));
    observer.observe(panes);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    client.get("/bi/semantic/tables", { params: { include_counts: false } })
      .then((r) => { if (active) setTables(r.data?.tables || []); })
      .catch((e) => { if (active) setTableError(e?.response?.data?.detail || "表信息加载失败"); })
      .finally(() => { if (active) setTablesBusy(false); });
    return () => { active = false; };
  }, []);

  const insert = (text: string) => {
    const view = editorRef.current?.view;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } });
    view.focus();
  };

  const run = async () => {
    if (busy || !sql.trim()) return;
    setLoading(true); setError(""); setResult(null); setExecutedSql(""); setSavedId(null);
    try {
      const response = await client.post<QueryResult>("/bi/engine/query", { sql, limit });
      setResult(response.data); setExecutedSql(sql);
      setChartCol(response.data.columns.find((column) => response.data.rows.some((row) => typeof row[column] === "number")) || "");
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "查询失败");
    } finally { setLoading(false); }
  };

  const save = async () => {
    if (!canSave || !name.trim()) return;
    setSaving(true); setSaveError("");
    try {
      const response = await client.post("/bi/semantic/datasets", {
        name: name.trim(), description: description.trim(), sql: executedSql,
      });
      setSavedId(response.data.id); setSaveOpen(false);
    } catch (e: any) {
      setSaveError(e?.response?.data?.detail || "保存失败");
    } finally { setSaving(false); }
  };

  return (
    <Box sx={{ height: "100%", minHeight: 560, display: "flex", flexDirection: "column", bgcolor: "background.paper" }}>
      <Box sx={{ height: 40, flexShrink: 0, px: 2, display: "flex", alignItems: "center", gap: 1, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography fontSize={14} fontWeight={700}>SQL Lab</Typography>
        <Typography fontSize={11} color="text.secondary">本地 PostgreSQL / public</Typography>
      </Box>
      <Box ref={panesRef} sx={{ flex: 1, minHeight: 0, minWidth: 546, display: "flex" }}>
        <Box sx={{ width: tableWidth, flexShrink: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
            <TextField size="small" fullWidth placeholder="搜索表名" value={keyword}
              inputProps={{ "aria-label": "搜索表名" }} onChange={(e) => setKeyword(e.target.value)} />
          </Box>
          {tablesBusy && <CircularProgress size={20} sx={{ m: 2 }} />}
          {tableError && <Alert severity="error" sx={{ m: 1 }}>{tableError}</Alert>}
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", py: 0.5 }}>
            {tables.filter((table) => table.table.toLowerCase().includes(keyword.toLowerCase())).map((table) => (
              <Box key={table.table}>
                <Button fullWidth aria-expanded={selected === table.table} onClick={() => setSelected(selected === table.table ? "" : table.table)}
                  sx={{ px: 1, borderRadius: 0, justifyContent: "flex-start", textTransform: "none", fontSize: 12, gap: 0.5,
                    color: "text.primary", bgcolor: selected === table.table ? "action.selected" : undefined }}>
                  {selected === table.table ? <ExpandMore sx={{ fontSize: 15 }} /> : <ChevronRight sx={{ fontSize: 15 }} />}
                  <TableChart sx={{ fontSize: 15, color: "text.secondary" }} />
                  <Typography noWrap component="span" fontSize={12}>{table.table}</Typography>
                </Button>
                {selected === table.table && <Box sx={{ pb: 0.5 }}>
                  <Box sx={{ display: "flex", pl: 3.5, gap: 0.5 }}>
                    <Tooltip title="插入表名"><Button size="small" disabled={busy} onClick={() => insert(quote(table.table))} sx={{ minWidth: 28 }} aria-label="插入表名"><ContentCopy sx={{ fontSize: 13 }} /></Button></Tooltip>
                    <Button size="small" disabled={busy} onClick={() => setSql(`SELECT * FROM ${quote(table.table)}`)} sx={{ fontSize: 11 }}>生成预览 SQL</Button>
                  </Box>
                  {table.columns.map((column) => <Button key={column.name} fullWidth disabled={busy}
                    onClick={() => insert(quote(column.name))}
                    sx={{ pl: 4.5, pr: 1.5, py: 0.35, borderRadius: 0, justifyContent: "space-between", textTransform: "none", gap: 1, color: "text.primary" }}>
                    <Typography noWrap component="span" fontSize={12}>{column.name}</Typography>
                    <Typography noWrap component="span" fontSize={10} color="text.secondary">{column.type}</Typography>
                  </Button>)}
                </Box>}
              </Box>
            ))}
            {!tablesBusy && !tableError && tables.length === 0 && <Typography sx={{ p: 2 }} fontSize={12}>暂无可查询的表</Typography>}
          </Box>
        </Box>
        <Box role="separator" aria-label="调整表字段树宽度" aria-orientation="vertical" tabIndex={0}
          aria-valuemin={180} aria-valuemax={Math.max(180, (panesRef.current?.clientWidth || 1000) - 366)} aria-valuenow={Math.round(tableWidth)}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); sidebarDrag.current = { x: e.clientX, width: tableWidth, latest: tableWidth }; }}
          onPointerMove={(e) => { if (sidebarDrag.current) resizeTables(sidebarDrag.current.width + e.clientX - sidebarDrag.current.x); }}
          onPointerUp={() => { if (sidebarDrag.current) resizeTables(sidebarDrag.current.latest, true); sidebarDrag.current = null; }}
          onPointerCancel={() => { sidebarDrag.current = null; }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); resizeTables(tableWidth + (e.key === "ArrowRight" ? 20 : -20), true); } }}
          sx={{ width: 6, flexShrink: 0, cursor: "col-resize", touchAction: "none", bgcolor: "action.hover", borderInline: "1px solid", borderColor: "divider", "&:hover, &:focus-visible": { bgcolor: "primary.light" } }} />
        <Box ref={workbenchRef} sx={{ flex: 1, minWidth: 360, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <Box sx={{ px: 1.5, py: 1, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1, borderBottom: "1px solid", borderColor: "divider", flexShrink: 0 }}>
            <Button variant="contained" size="small" startIcon={loading ? <CircularProgress size={14} color="inherit" /> : <PlayArrow />}
              disabled={busy || !sql.trim()} onClick={() => void run()}>执行</Button>
            <TextField select size="small" label="预览上限" value={limit} disabled={busy}
              onChange={(e) => setLimit(Number(e.target.value))} sx={{ width: 110 }}>
              {[100, 500, 1000].map((value) => <MenuItem key={value} value={value}>{value} 行</MenuItem>)}
            </TextField>
            <Tooltip title={!hasPerm("bi:nav:datasets") ? "需要数据集管理权限" : "执行成功后可保存"}>
              <span><Button size="small" startIcon={<Save />} disabled={!canSave}
                onClick={() => { setSaveError(""); setSaveOpen(true); }}>保存为虚拟数据集</Button></span>
            </Tooltip>
            <Typography fontSize={11} color="text.secondary" sx={{ ml: "auto" }}>Ctrl / ⌘ + Enter</Typography>
          </Box>
          <Box sx={{ flexShrink: 0, overflow: "hidden" }} onKeyDownCapture={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void run(); }
          }}>
            <CodeMirror ref={editorRef} value={sql} height={`${editorHeight}px`} extensions={extensions}
              editable={!busy} theme={theme.palette.mode} onChange={setSql}
              basicSetup={EDITOR_SETUP}
              indentWithTab={false} />
          </Box>
          <Box role="separator" aria-label="调整编辑器高度" aria-orientation="horizontal" tabIndex={0}
            aria-valuemin={140} aria-valuemax={600} aria-valuenow={editorHeight}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { y: e.clientY, height: editorHeight }; }}
            onPointerMove={(e) => { if (drag.current) setEditorHeight(Math.max(140, Math.min(600, (workbenchRef.current?.clientHeight || 800) - 180, drag.current.height + e.clientY - drag.current.y))); }}
            onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
            onKeyDown={(e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setEditorHeight((height) => Math.max(140, Math.min(600, height + (e.key === "ArrowDown" ? 20 : -20)))); } }}
            sx={{ height: 7, flexShrink: 0, cursor: "row-resize", touchAction: "none", bgcolor: "action.hover", borderBlock: "1px solid", borderColor: "divider", "&:hover, &:focus-visible": { bgcolor: "primary.light" } }} />
          <Box sx={{ px: 2, height: 36, flexShrink: 0, display: "flex", alignItems: "center", gap: 1, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography fontSize={12} fontWeight={700} color="primary.main">查询结果</Typography>
            {result && <><Typography fontSize={11} color="text.secondary">{result.count} 行 · {result.elapsed_ms} ms</Typography>
              {result.truncated && <Chip size="small" color="warning" label={`仅返回前 ${result.limit} 行`} sx={{ height: 20, fontSize: 10 }} />}</>}
          </Box>
          <Box sx={{ flex: 1, minHeight: 100, overflow: "auto" }}>
            {!hasPerm("bi:nav:datasets") && <Alert severity="info" sx={{ m: 1 }}>创建虚拟数据集需要数据集管理权限。</Alert>}
            {result && executedSql !== sql && <Alert severity="info" sx={{ m: 1 }}>SQL 已修改，请重新执行后再保存。</Alert>}
            {error && <Alert severity="error" sx={{ m: 1 }}>{error}</Alert>}
            {savedId !== null && <Alert severity="success" sx={{ m: 1 }} action={<Button size="small" onClick={() => nav(`/bi?view=datasets&edit=${savedId}`)}>配置数据集</Button>}>虚拟数据集已创建。</Alert>}
            {!result && !error && <Box sx={{ height: "100%", minHeight: 140, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 1, color: "text.secondary" }}>
              {loading ? <CircularProgress size={28} /> : <TableChart sx={{ fontSize: 48, opacity: 0.2 }} />}
              <Typography fontSize={13}>{loading ? "正在执行查询…" : "执行查询后在这里查看结果"}</Typography>
            </Box>}
            {result && <TableContainer>
              <Table stickyHeader size="small">
                <TableHead><TableRow>{result.columns.map((column) => <TableCell key={column} sx={{ py: 0.75, whiteSpace: "nowrap", fontWeight: 700, fontSize: 12 }}>{column}</TableCell>)}</TableRow></TableHead>
                <TableBody>{result.rows.map((row, index) => <TableRow key={index} hover>{result.columns.map((column) => <TableCell key={column} sx={{ py: 0.5, whiteSpace: "nowrap", fontSize: 12 }}>{row[column] == null ? "NULL" : typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column])}</TableCell>)}</TableRow>)}</TableBody>
              </Table>
              {result.count === 0 && <Typography sx={{ p: 2 }} fontSize={12} color="text.secondary">查询成功，结果为空。仍可保存字段结构。</Typography>}
            </TableContainer>}
            {result && chartCol && <Accordion elevation={0} sx={{ borderTop: "1px solid", borderColor: "divider" }}>
              <AccordionSummary expandIcon={<ExpandMore />}>图表预览</AccordionSummary>
              <AccordionDetails>
                <TextField select size="small" label="数值列" value={chartCol} onChange={(e) => setChartCol(e.target.value)} sx={{ mb: 2, minWidth: 140 }}>{result.columns.filter((column) => result.rows.some((row) => typeof row[column] === "number")).map((column) => <MenuItem key={column} value={column}>{column}</MenuItem>)}</TextField>
                <Box sx={{ height: 200 }}><PreviewChart rows={result.rows} col={chartCol} /></Box>
              </AccordionDetails>
            </Accordion>}
          </Box>
        </Box>
      </Box>
      <Dialog open={saveOpen} onClose={() => { if (!saving) setSaveOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle>保存为虚拟数据集</DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important" }}>
          <TextField autoFocus label="数据集名称" value={name} disabled={saving} required inputProps={{ maxLength: 120 }} onChange={(e) => setName(e.target.value)} />
          <TextField label="描述" value={description} disabled={saving} multiline minRows={2} onChange={(e) => setDescription(e.target.value)} />
          <Typography fontSize={12} color="text.secondary">保存 SQL 定义，系统预览上限不会写入定义。SQL 自身的 LIMIT 会保留。</Typography>
          {saveError && <Alert severity="error">{saveError}</Alert>}
        </DialogContent>
        <DialogActions><Button disabled={saving} onClick={() => setSaveOpen(false)}>取消</Button><Button variant="contained" disabled={!canSave || !name.trim()} onClick={() => void save()}>{saving ? "保存中…" : "创建数据集"}</Button></DialogActions>
      </Dialog>
    </Box>
  );
}

function PreviewChart({ rows, col }: { rows: Record<string, unknown>[]; col: string }) {
  const maxVal = Math.max(...rows.map(r => Number(r[col]) || 0), 1);
  const barCount = Math.min(rows.length, 50);
  const step = Math.max(1, Math.floor(rows.length / barCount));
  const bars = [];
  for (let i = 0; i < rows.length; i += step) {
    bars.push({ label: String(i + 1), value: Number(rows[i]?.[col]) || 0 });
    if (bars.length >= barCount) break;
  }

  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: "2px", height: "100%", pt: 2 }}>
      {bars.map((b, i) => (
        <Box key={i} sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
          <Box sx={{
            width: "100%", bgcolor: "#6366F1", borderRadius: "2px 2px 0 0",
            height: `${Math.max(2, (b.value / maxVal) * 100)}%`,
            minHeight: 2,
            transition: "height 0.2s",
          }} title={`${b.label}: ${b.value.toLocaleString()}`} />
        </Box>
      ))}
    </Box>
  );
}
