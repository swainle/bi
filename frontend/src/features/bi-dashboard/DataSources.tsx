import { useState, useEffect } from "react";
import {
  Box, Typography, IconButton, Paper, Button, Chip,
  Select, MenuItem, FormControl, InputLabel, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions,
} from "@mui/material";
import {
  Add as AddIcon, Close, FileUpload,
  DeleteOutline, Check as CheckIcon,
} from "@mui/icons-material";
import client from "../../api/client";
import {
  DsConfig, DsCategory, DsTypeDef, DataRow,
  DS_TYPES, DS_CATEGORIES, DbIcon,
} from "./constants";

// JDBC URL 模版
const jdbcTemplates: Record<string, string> = {
  mysql: "jdbc:mysql://{host}:{port}/{db}",
  mariadb: "jdbc:mariadb://{host}:{port}/{db}",
  oracle: "jdbc:oracle:thin:@{host}:{port}:{db}",
  postgresql: "jdbc:postgresql://{host}:{port}/{db}",
  sqlserver: "jdbc:sqlserver://{host}:{port};databaseName={db}",
  db2: "jdbc:db2://{host}:{port}/{db}",
  tidb: "jdbc:mysql://{host}:{port}/{db}",
  dm: "jdbc:dm://{host}:{port}/{db}",
  kingbase: "jdbc:kingbase8://{host}:{port}/{db}",
  mongodb: "jdbc:mongo://{host}:{port}/{db}",
  mongodb_bi: "jdbc:mysql://{host}:{port}/{db}",
  clickhouse: "jdbc:clickhouse://{host}:{port}/{db}",
  doris: "jdbc:mysql://{host}:{port}/{db}",
  starrocks: "jdbc:mysql://{host}:{port}/{db}",
  impala: "jdbc:impala://{host}:{port}/{db}",
  presto: "jdbc:presto://{host}:{port}/{db}",
  kylin: "jdbc:kylin://{host}:{port}/{db}",
  elasticsearch: "jdbc:elasticsearch://{host}:{port}",
  redshift: "jdbc:redshift://{host}:{port}/{db}",
  hive: "jdbc:hive2://{host}:{port}/{db}",
  maxcompute: "jdbc:odps://{host}:{port}/{db}",
};

interface DataSourcesProps {
  rows: DataRow[];
  setRows: React.Dispatch<React.SetStateAction<DataRow[]>>;
  fields: string[];
  setActiveTab: React.Dispatch<React.SetStateAction<number>>;
  setSearchParams: (params: Record<string, string>, opts?: { replace?: boolean }) => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function DataSources({
  rows, setRows, fields, setActiveTab, setSearchParams, handleFileUpload,
}: DataSourcesProps) {
  const [dsList, setDsList] = useState<DsConfig[]>(() => {
    try { return JSON.parse(localStorage.getItem("mingzebi_bi_datasources") || "[]"); } catch { return []; }
  });
  const [dsDialogOpen, setDsDialogOpen] = useState(false);
  const [dsEditTarget, setDsEditTarget] = useState<DsConfig | null>(null);
  const [dsTypeFilter, _setDsTypeFilter] = useState<DsCategory | "all">("all");
  const [dsForm, setDsForm] = useState<Partial<DsConfig>>({});
  const [dsSelectedType, setDsSelectedType] = useState<DsTypeDef | null>(null);
  const [dsTestResult, setDsTestResult] = useState<"" | "success" | "error">("");
  const [dsConMode, setDsConMode] = useState<"basic" | "jdbc">("basic");

  useEffect(() => { localStorage.setItem("mingzebi_bi_datasources", JSON.stringify(dsList)); }, [dsList]);

  const genJdbcUrl = () => {
    const t = dsForm.type || "";
    const h = dsForm.host || "localhost";
    const p = dsForm.port || "";
    const d = dsForm.dbName || "";
    const tmpl = jdbcTemplates[t];
    if (!tmpl) return "";
    return tmpl.replace("{host}", h).replace("{port}", String(p)).replace("{db}", d);
  };

  return (
    <Box sx={{ flex: 1, overflow: "auto", p: 3 }}>
      {/* 数据源管理标题栏 */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700}>🔌 数据源管理 · {dsList.length} 个</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button component="label" size="small" variant="outlined" startIcon={<FileUpload />}
            sx={{ borderRadius: 2, textTransform: "none", fontSize: 12 }}>
            导入数据<input type="file" accept=".csv,.xlsx,.xls,.json" hidden onChange={handleFileUpload} />
          </Button>
          <Button size="small" variant="contained" startIcon={<AddIcon />}
            onClick={() => { setDsEditTarget(null); setDsForm({}); setDsSelectedType(null); setDsTestResult(""); setDsConMode("basic"); setDsDialogOpen(true); }}
            sx={{ borderRadius: 2, textTransform: "none", fontSize: 12, bgcolor: "#6366F1" }}>
            添加数据源
          </Button>
        </Box>
      </Box>

      {/* 已配置的数据源列表 */}
      {dsList.length > 0 && (
        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, border: "1px solid", borderColor: "#EBEDF0", mb: 3 }}>
          <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: 1, mb: 1.5, display: "block" }}>
            已连接数据源
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1 }}>
            {dsList.map(ds => (
              <Paper key={ds.id} elevation={0} sx={{
                p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0",
                display: "flex", alignItems: "center", gap: 1,
                "&:hover": { borderColor: "#6366F1", bgcolor: "#F5F3FF" }, cursor: "pointer", transition: "all 0.15s",
              }} onClick={() => {
                const t = DS_TYPES.find(t => t.id === ds.type);
                setDsEditTarget(ds); setDsForm({ ...ds }); setDsSelectedType(t || null);
                setDsTestResult(""); setDsDialogOpen(true);
              }}>
                <Box sx={{ color: "#6366F1", fontSize: 20, flexShrink: 0 }}>
                  {DS_TYPES.find(t => t.id === ds.type)?.icon || <DbIcon type="mysql" />}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 600 }}>{ds.name}</Typography>
                  <Typography noWrap variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    {DS_TYPES.find(t => t.id === ds.type)?.label || ds.type} {ds.host ? `· ${ds.host}` : ""}
                  </Typography>
                </Box>
                <IconButton size="small" onClick={e => {
                  e.stopPropagation();
                  setDsList(prev => prev.filter(d => d.id !== ds.id));
                }} sx={{ opacity: 0.4, "&:hover": { opacity: 1, color: "error.main" } }}>
                  <DeleteOutline sx={{ fontSize: 14 }} />
                </IconButton>
              </Paper>
            ))}
          </Box>
        </Paper>
      )}

      {/* 支持的数据源类型总览 */}
      <Paper elevation={0} sx={{ p: 3, borderRadius: 3, border: "1px solid", borderColor: "#EBEDF0" }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
          📡 支持 {DS_TYPES.length} 种数据源（对标 DataEase 全量）
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: "block" }}>
          支持 OLTP · OLAP · 数据湖 · API 数据 · 文件 五大类，{24} 种数据源引擎
        </Typography>

        {DS_CATEGORIES.map(cat => (
          <Box key={cat.key} sx={{ mb: 2.5 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: cat.color, flexShrink: 0 }} />
              <Typography variant="overline" sx={{ fontWeight: 700, fontSize: 11, color: cat.color, letterSpacing: 0.5 }}>
                {cat.label} · {DS_TYPES.filter(t => t.category === cat.key).length} 种
              </Typography>
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 0.75, pl: 2 }}>
              {DS_TYPES.filter(t => t.category === cat.key).map(dt => {
                const configured = dsList.filter(d => d.type === dt.id);
                return (
                <Paper key={dt.id} elevation={0}
                  onClick={() => {
                    setDsEditTarget(null); setDsForm({ type: dt.id, host: "", port: dt.defaultPort || undefined, dbName: "", username: "", password: "", url: "", filePath: "" });
                    setDsSelectedType(dt); setDsTestResult(""); setDsConMode("basic"); setDsDialogOpen(true);
                  }}
                  sx={{
                    p: 1.25, borderRadius: 2, cursor: "pointer", textAlign: "center",
                    border: "1px solid", borderColor: configured.length > 0 ? cat.color : "#EBEDF0",
                    bgcolor: configured.length > 0 ? `${cat.color}08` : "#fff",
                    "&:hover": { borderColor: cat.color, bgcolor: `${cat.color}10`, transform: "translateY(-1px)" },
                    transition: "all 0.15s",
                  }}>
                  <Box sx={{ color: cat.color, fontSize: 30, mb: 0.5, display: "flex", justifyContent: "center" }}>{dt.icon}</Box>
                  <Typography sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3, mb: 0.25 }}>{dt.label}</Typography>
                  <Typography variant="caption" sx={{ fontSize: 10, color: "text.disabled" }}>{dt.desc}</Typography>
                  {configured.length > 0 && (
                    <Chip label={`${configured.length}`} size="small" color="primary" variant="outlined"
                      sx={{ height: 16, fontSize: 9, mt: 0.5 }} />
                  )}
                </Paper>
                );
              })}
            </Box>
          </Box>
        ))}
      </Paper>

      {/* 原始数据表格（折叠） */}
      {rows.length > 0 && (
        <Paper elevation={0} sx={{ mt: 3, p: 3, borderRadius: 3, border: "1px solid", borderColor: "#EBEDF0" }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>📋 当前加载数据 · {rows.length} 行</Typography>
          <Box sx={{ overflow: "auto", maxHeight: 300 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead><tr>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #E5E7EB", color: "#6B7280" }}>#</th>
                {fields.map(f => <th key={f} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #E5E7EB", color: "#6B7280" }}>{f}</th>)}
              </tr></thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                    <td style={{ padding: "6px 12px", color: "#9CA3AF" }}>{i + 1}</td>
                    {fields.map(f => <td key={f} style={{ padding: "6px 12px" }}>{typeof r[f] === "number" ? (r[f] as number).toLocaleString() : String(r[f])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>仅显示前 100 行</Typography>}
          </Box>
        </Paper>
      )}

      {/* ====== 数据源连接配置弹窗 ====== */}
      <Dialog open={dsDialogOpen} onClose={() => setDsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {dsEditTarget ? "✏️ 编辑数据源" : "➕ 添加数据源"}
          <IconButton size="small" onClick={() => setDsDialogOpen(false)}><Close /></IconButton>
        </DialogTitle>
        <DialogContent>
          {/* 数据源类型选择 */}
          <FormControl fullWidth size="small" sx={{ mb: 2, mt: 1 }}>
            <InputLabel>数据源类型</InputLabel>
            <Select
              value={dsForm.type || ""}
              label="数据源类型"
              onChange={e => {
                const dt = DS_TYPES.find(t => t.id === e.target.value);
                setDsSelectedType(dt || null);
                setDsForm({ type: e.target.value, host: "", port: dt?.defaultPort || undefined, dbName: "", username: "", password: "", url: "", filePath: "" });
                setDsTestResult("");
              }}
              disabled={!!dsEditTarget}
            >
              {DS_CATEGORIES.map(cat => [
                <MenuItem key={cat.key} disabled sx={{ fontSize: 11, fontWeight: 700, color: cat.color, opacity: 1 }}>
                  {cat.label}
                </MenuItem>,
                ...DS_TYPES.filter(t => t.category === cat.key).map(dt => (
                  <MenuItem key={dt.id} value={dt.id} sx={{ pl: 4, fontSize: 12 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Box sx={{ color: cat.color, fontSize: 16 }}>{dt.icon}</Box>
                      <Box>
                        <Typography sx={{ fontSize: 12 }}>{dt.label}</Typography>
                        <Typography variant="caption" color="text.secondary">{dt.desc}</Typography>
                      </Box>
                    </Box>
                  </MenuItem>
                ))
              ])}
            </Select>
          </FormControl>

          {/* 连接配置表单 */}
          {dsSelectedType && (
            <Box sx={{ bgcolor: "#FAFBFC", p: 2, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {dsSelectedType.label} 连接配置
                </Typography>
                {dsSelectedType.fields.includes("host") && (
                  <Box sx={{ display: "flex", gap: 0.5, bgcolor: "#E5E7EB", borderRadius: 2, p: 0.25 }}>
                    <Button size="small"
                      variant={dsConMode === "basic" ? "contained" : "text"}
                      onClick={() => setDsConMode("basic")}
                      sx={{ fontSize: 10, textTransform: "none", py: 0, px: 1, minWidth: 0, borderRadius: 1.5,
                        bgcolor: dsConMode === "basic" ? "#6366F1" : "transparent",
                        color: dsConMode === "basic" ? "#fff" : "text.secondary" }}>
                      基础
                    </Button>
                    <Button size="small"
                      variant={dsConMode === "jdbc" ? "contained" : "text"}
                      onClick={() => setDsConMode("jdbc")}
                      sx={{ fontSize: 10, textTransform: "none", py: 0, px: 1, minWidth: 0, borderRadius: 1.5,
                        bgcolor: dsConMode === "jdbc" ? "#6366F1" : "transparent",
                        color: dsConMode === "jdbc" ? "#fff" : "text.secondary" }}>
                      JDBC
                    </Button>
                  </Box>
                )}
              </Box>

              {dsConMode === "jdbc" ? (
                <TextField fullWidth size="small" label="JDBC 连接串" placeholder="jdbc:mysql://host:3306/db"
                  value={genJdbcUrl()}
                  onChange={e => setDsForm(prev => ({ ...prev, url: e.target.value }))}
                  InputProps={{ sx: { fontSize: 11, fontFamily: "monospace", bgcolor: "#F9FAFB" } }}
                  sx={{ mb: 1.5 }} />
              ) : (
                <>
                  {dsSelectedType.fields.includes("url") && (
                    <TextField fullWidth size="small" label="连接 URL" placeholder="https://api.example.com/data" value={dsForm.url || ""}
                      onChange={e => setDsForm(prev => ({ ...prev, url: e.target.value }))} sx={{ mb: 1.5 }} />
                  )}

                  {dsSelectedType.fields.includes("host") && (
                    <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
                      <TextField size="small" label="主机地址" placeholder="192.168.1.100" value={dsForm.host || ""}
                        onChange={e => setDsForm(prev => ({ ...prev, host: e.target.value }))} sx={{ flex: 1 }} />
                      <TextField size="small" label="端口" type="number" value={dsForm.port || ""}
                        onChange={e => setDsForm(prev => ({ ...prev, port: parseInt(e.target.value) || undefined }))} sx={{ width: 120 }} />
                    </Box>
                  )}

                  {dsSelectedType.fields.includes("dbName") && (
                    <TextField fullWidth size="small" label="数据库名" placeholder="my_database" value={dsForm.dbName || ""}
                      onChange={e => setDsForm(prev => ({ ...prev, dbName: e.target.value }))} sx={{ mb: 1.5 }} />
                  )}
                </>
              )}

              {dsSelectedType.fields.includes("username") && (
                <Box sx={{ display: "flex", gap: 1, mb: 1.5 }}>
                  <TextField size="small" label="用户名" placeholder="root" value={dsForm.username || ""}
                    onChange={e => setDsForm(prev => ({ ...prev, username: e.target.value }))} sx={{ flex: 1 }} />
                  {dsSelectedType.fields.includes("password") && (
                    <TextField size="small" label="密码" type="password" placeholder="****" value={dsForm.password || ""}
                      onChange={e => setDsForm(prev => ({ ...prev, password: e.target.value }))} sx={{ flex: 1 }} />
                  )}
                </Box>
              )}

              {dsSelectedType.fields.includes("filePath") && (
                <TextField fullWidth size="small" label="文件路径" placeholder="/data/sales_2026.xlsx" value={dsForm.filePath || ""}
                  onChange={e => setDsForm(prev => ({ ...prev, filePath: e.target.value }))} sx={{ mb: 1.5 }} />
              )}

              <Box sx={{ mt: 1.5 }}>
                <TextField fullWidth size="small" label="数据源名称" placeholder="例如：生产库 MySQL" value={dsForm.name || ""}
                  onChange={e => setDsForm(prev => ({ ...prev, name: e.target.value }))} />
              </Box>
            </Box>
          )}

          {/* 测试连接 + 查询 */}
          <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
            <Button variant="outlined" onClick={async () => {
              setDsTestResult("");
              try {
                const payload = { type: dsForm.type, host: dsForm.host || "", port: dsForm.port || 0, dbName: dsForm.dbName || "", username: dsForm.username || "", password: dsForm.password || "", url: dsForm.url || "", filePath: dsForm.filePath || "" };
                const r = await client.post("/bi/datasource/test", payload);
                setDsTestResult(r.data?.ok ? "success" : "error");
                setTimeout(() => setDsTestResult(""), 3000);
              } catch (e: any) {
                setDsTestResult("error");
                setTimeout(() => setDsTestResult(""), 3000);
              }
            }} size="small" sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
              测试连接
            </Button>
            <Button variant="outlined" onClick={async () => {
              try {
                const payload = { type: dsForm.type, host: dsForm.host || "", port: dsForm.port || 0, dbName: dsForm.dbName || "", username: dsForm.username || "", password: dsForm.password || "", url: dsForm.url || "", filePath: dsForm.filePath || "", sql: "SELECT * FROM (SELECT 1) t LIMIT 100", method: "GET", queryPath: dsForm.url || "" };
                const r = await client.post("/bi/datasource/query", payload);
                if (r.data?.rows?.length) {
                  setRows(r.data.rows as DataRow[]);
                  setDsDialogOpen(false);
                  setActiveTab(0);
                  setSearchParams({ tab: "0" }, { replace: true });
                }
              } catch (e: any) {
                alert("查询失败: " + (e.response?.data?.detail || e.message));
              }
            }} size="small" sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
              查询数据
            </Button>
          </Box>
          {dsTestResult === "success" && <Chip icon={<CheckIcon />} label={dsForm.type === "api" ? "API 可达" : "连接成功"} color="success" size="small" sx={{ mt: 1 }} />}
          {dsTestResult === "error" && <Chip label="连接失败，请检查配置" color="error" size="small" sx={{ mt: 1 }} />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDsDialogOpen(false)} sx={{ textTransform: "none" }}>取消</Button>
          <Button variant="contained" onClick={() => {
            if (!dsForm.type || !dsForm.name) return;
            const now = Date.now();
            if (dsEditTarget) {
              setDsList(prev => prev.map(d => d.id === dsEditTarget.id ? { ...d, ...dsForm, id: d.id, createdAt: d.createdAt } as DsConfig : d));
            } else {
              setDsList(prev => [...prev, { id: "ds-" + now, ...dsForm, createdAt: now } as DsConfig]);
            }
            setDsDialogOpen(false);
          }} sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}>
            {dsEditTarget ? "保存" : "添加"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
