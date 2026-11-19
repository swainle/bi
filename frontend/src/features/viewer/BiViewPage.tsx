/** 明策BI子页 — ECharts 渲染 + 导出 + 自动刷新 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box, Typography, IconButton, CircularProgress, Chip, Button, Menu, MenuItem,
  Select, FormControl, InputLabel, Dialog, DialogTitle, DialogContent, DialogActions,
  Paper, Alert, LinearProgress,
} from "@mui/material";
import {
  ArrowBack as BackIcon, Refresh as RefreshIcon,
  Download as DownloadIcon, Image as ImageIcon,
  TableChart as ExcelIcon, Functions as FuncIcon,
  Settings as SettingsIcon, Fullscreen as FullscreenIcon,
  PictureAsPdf as PdfIcon, SmartToy as AIIcon,
  Upload as UploadIcon,
} from "@mui/icons-material";
import client from "../../api/client";
import ChartPanelView from "../bi-dashboard/ChartPanel";
import ChartConfigPanel, { type ChartStyle } from "../bi-dashboard/ChartConfigPanel";
import BigScreen from "../bi-dashboard/BigScreen";
import BoardViewer from "../components/board/BoardViewer";
import PddCockpitView from "../bi-dashboard/PddCockpitView";
import PddProfitDashboard from "../bi-dashboard/PddProfitDashboard";
import WatermarkOverlay from "../../components/WatermarkOverlay";
import { useWatermarkText } from "../../hooks/useWatermarkText";
import { useAuth } from "../auth/useAuth";
import ImportWizard from "../bi-dashboard/ImportWizard";
import type { DataRow, ChartPanel } from "../bi-dashboard/constants";

interface TemplateDef {
  id: string; type: string; title: string;
  metric?: string; xField?: string; yField?: string;
}

export default function BiViewPage() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const watermarkText = useWatermarkText();
  const { hasPerm } = useAuth();
  const canExportDetail = hasPerm("bi:data:export:detail");
  const [rows, setRows] = useState<DataRow[]>([]);
  const [panels, setPanels] = useState<ChartPanel[]>([]);
  // 画布发布出来的看板：直接按画布布局只读渲染
  const [canvasItems, setCanvasItems] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [tableName, setTableName] = useState("");
  const [panelDefs, setPanelDefs] = useState<TemplateDef[]>([]);
  const [exportMenu, setExportMenu] = useState<null | HTMLElement>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [funcType, setFuncType] = useState<string>("");
  const [funcOptions, setFuncOptions] = useState<{ key: string; label: string; desc: string }[]>([]);
  const [funcData, setFuncData] = useState<DataRow[]>([]);
  const [funcLoading, setFuncLoading] = useState(false);
  const [panelStyles, setPanelStyles] = useState<Record<string, ChartStyle>>({});
  const [configOpen, setConfigOpen] = useState(false);
  const [bigScreenOpen, setBigScreenOpen] = useState(false);
  const [useCockpit, setUseCockpit] = useState(false);
  const [useProfitDash, setUseProfitDash] = useState(false);

  // Universal import & AI analyze
  const [importOpen, setImportOpen] = useState(false);
  const [aiAnalyzeOpen, setAiAnalyzeOpen] = useState(false);
  const [aiAnalyzeResult, setAiAnalyzeResult] = useState<any>(null);
  const [aiAnalyzeLoading, setAiAnalyzeLoading] = useState(false);

  const handleAIAnalyze = async () => {
    setAiAnalyzeLoading(true); setAiAnalyzeOpen(true); setAiAnalyzeResult(null);
    try {
      const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
      const summary = {
        row_count: rows.length,
        columns: cols.slice(0, 15),
        sample_rows: rows.slice(0, 3),
      };
      const prompt = `电商数据分析。数据表共${rows.length}行, 列: ${cols.slice(0,15).join(',')}。样例: ${JSON.stringify(summary.sample_rows).slice(0, 800)}。请分析并返回JSON: {"summary":"整体分析", "highlights":["亮点"], "risks":["风险"], "recommendations":["建议"]}`;

      const r = await client.post('/bi/engine/ai/analyze', { prompt }, { timeout: 120000 });
      const resp = r.data?.response || '';
      try {
        const m = /\{[\s\S]*\}/.exec(resp);
        setAiAnalyzeResult({ ai_analysis: JSON.parse(m?.[0] || '{}') });
      } catch { setAiAnalyzeResult({ ai_analysis: { summary: resp.slice(0, 200) || '分析完成' } }); }
    } catch (e: any) {
      setAiAnalyzeResult({ error: e?.response?.data?.detail || 'AI分析失败' });
    } finally { setAiAnalyzeLoading(false); }
  };

  const getImportEndpoint = () => {
    if (tableName === 'bi_pdd_profit') return '/bi/engine/import/pdd-profit';
    return '/bi/engine/import/pdd-profit'; // default
  };

  const isTemplate = id && !/^\d+$/.test(id);
  const dashId = isTemplate ? null : parseInt(id || "0");

  const loadFromTemplate = useCallback(async (templateName: string) => {
    try {
      const r = await client.get("/bi/engine/templates");
      const tblMap = r.data?.table_map || {};
      const allPanels = r.data?.panels || {};

      // templateName 可能是模板名(如"财务总览")或表名(如"bi_finance")
      let table = tblMap[templateName];
      if (!table) {
        // 尝试直接作为表名使用
        const allowedTables = Object.keys(tblMap);
        if (allowedTables.some(k => tblMap[k] === templateName)) {
          table = templateName;
        }
      }
      // 仍未找到：检查是否是已知的表名
      if (!table && Object.values(tblMap).includes(templateName)) {
        table = templateName;
      }

      const defs = allPanels[table] || [];
      if (!table || defs.length === 0) { setError("模板未找到"); setLoading(false); return; }
      setTitle(templateName);
      setTableName(table);
      // 拼多多店铺模板 → 使用驾驶舱视图
      if (table === 'bi_pdd_stores' || templateName === '拼多多店铺利润') {
        setUseCockpit(true);
      }
      // 拼多多利润看板 → 使用利润看板视图
      if (table === 'bi_pdd_profit' || templateName === '拼多多店铺利润看板') {
        setUseProfitDash(true);
      }
      setPanelDefs(defs);

      const r2 = await client.get(`/bi/engine/data/${table}`, { params: { precomputed: false } });
      const data = r2.data?.rows || [];
      setRows(data);
      setPanels(defs.map((p: TemplateDef, i: number) => ({
        id: p.id || `p${i}`,
        type: p.type as ChartPanel["type"],
        title: p.title,
        xField: p.xField || "",
        yField: p.yField || p.metric || "",
        size: (p.type === "number" ? "sm" : p.type === "line" ? "lg" : p.type === "table" ? "lg" : "md") as ChartPanel["size"],
        order: i,
      })));
    } catch (e: any) { setError(e?.message || "加载失败"); }
  }, []);

  const loadFromDashboard = useCallback(async (dId: number) => {
    try {
      const r = await client.get("/bi/engine/dashboards");
      const list = r.data?.dashboards || [];
      const dash = list.find((d: any) => d.id === dId);
      if (!dash) { setError("看板未找到"); return; }
      setTitle(dash.name);

      // 画布发布出来的看板：面板是 {kind, spec, x, y, w, h}，直接按画布布局渲染
      const earlyPanels = dash.panels || [];
      const isCanvasDash = earlyPanels.length > 0 &&
        earlyPanels.every((p: any) => p && p.spec && p.kind && typeof p.x === "number");
      if (isCanvasDash) {
        setCanvasItems(earlyPanels);
        setPanels([]);
        return;
      }

      // 优先使用看板自带的 table_map（克隆模板时保存的）
      const dashTableMap = dash.table_map || {};
      const vals = Object.values(dashTableMap).filter(v => typeof v === "string");
      const firstTable = vals[0] as string | undefined;

      if (firstTable) {
        setTableName(firstTable);
        // 拼多多驾驶舱
        if (firstTable === 'bi_pdd_stores') {
          setUseCockpit(true);
        }
        // 拼多多利润看板
        if (firstTable === 'bi_pdd_profit') {
          setUseProfitDash(true);
        }
        const r3 = await client.get(`/bi/engine/data/${firstTable}`, { params: { precomputed: false } });
        setRows(r3.data?.rows || []);
      } else {
        // 兜底：尝试从模板定义匹配
        const r2 = await client.get("/bi/engine/templates");
        const tblMap = r2.data?.table_map || {};
        for (const [tname, table] of Object.entries(tblMap)) {
          const defs = r2.data?.panels?.[table as string] || [];
          if (defs.length > 0 && dash.panels?.[0]?.title === defs[0]?.title) {
            setTableName(table as string);
            if (table === 'bi_pdd_stores') setUseCockpit(true);
            if (table === 'bi_pdd_profit') setUseProfitDash(true);
            break;
          }
        }
        if (!tableName) {
          const r3 = await client.get("/bi/engine/data/bi_finance");
          setRows(r3.data?.rows || []);
        }
      }

      // 转换 panels：模板格式(有 metric 字段) → ChartPanel 格式(有 size/order 字段)
      const rawPanels = dash.panels || [];
      const looksCanvas = Array.isArray(rawPanels) && rawPanels.length > 0 &&
        rawPanels.every((p: any) => p && p.spec && p.kind && typeof p.x === "number");
      if (looksCanvas) {
        setCanvasItems(rawPanels);
        setPanels([]);
        return;
      }
      setCanvasItems(null);

      const convertedPanels = rawPanels.map((p: any, i: number) => ({
        id: p.id || `p${i}`,
        type: p.type as ChartPanel["type"],
        title: p.title || "",
        xField: p.xField || "",
        yField: p.yField || p.metric || "",
        size: (p.size || (p.type === "number" ? "sm" : p.type === "line" || p.type === "table" ? "lg" : "md")) as ChartPanel["size"],
        order: p.order ?? i,
      }));
      setPanels(convertedPanels);
    } catch (e: any) { setError(e?.message || "加载失败"); }
  }, [tableName]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    (isTemplate ? loadFromTemplate(id) : loadFromDashboard(dashId!))
      .finally(() => setLoading(false));
    // 加载分析函数列表
    client.get("/bi/engine/functions").then(r => setFuncOptions(r.data?.functions || [])).catch(() => {});
  }, [id]); // eslint-disable-line

  // 执行分析函数
  useEffect(() => {
    if (!funcType || !tableName || panelDefs.length === 0) { setFuncData([]); return; }
    const firstDef = panelDefs[0];
    const timeCol = firstDef?.xField || "";
    const metricCol = firstDef?.yField || firstDef?.metric || "";
    if (!timeCol || !metricCol) return;
    setFuncLoading(true);
    client.post("/bi/engine/analyze", { table: tableName, time_col: timeCol, metric_col: metricCol, func: funcType })
      .then(r => setFuncData(r.data?.rows || []))
      .catch(() => setFuncData([]))
      .finally(() => setFuncLoading(false));
  }, [funcType, tableName, panelDefs]);

  useEffect(() => {
    if (!tableName || panelDefs.length === 0) return;
    const loadData = async () => {
      try {
        const r = await client.get(`/bi/engine/data/${tableName}`, { params: { precomputed: false } });
        setRows(r.data?.rows || []);
      } catch {}
    };
    loadData();
  }, [tableName, panelDefs]);

  // 自动刷新
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!autoRefresh || !tableName) return;
    timerRef.current = setInterval(async () => {
      try {
        const r = await client.get(`/bi/engine/data/${tableName}`, { params: { precomputed: false } });
        setRows(r.data?.rows || []);
      } catch {}
    }, refreshInterval * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshInterval, tableName]);

  // 导出 Excel（后端需要明细导出权限；无权限时不显示入口）
  const handleExportExcel = () => {
    if (!tableName) return;
    if (!canExportDetail) { alert("没有明细导出权限，请联系管理员开通"); return; }
    window.open(`/api/bi/engine/export/${tableName}`, "_blank");
    setExportMenu(null);
  };

  // 导出整个看板为图片（通过浏览器截图）
  const handleExportImage = () => {
    import("html2canvas").then(({ default: html2canvas }) => {
      const el = document.getElementById("bi-dashboard-content");
      if (!el) return;
      html2canvas(el, { scale: 2, backgroundColor: "#F8F9FB" }).then((canvas: HTMLCanvasElement) => {
        const link = document.createElement("a");
        link.download = `${title || "看板"}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      });
    }).catch(() => { alert("请安装 html2canvas 依赖以支持导出图片"); });
    setExportMenu(null);
  };

  // PDF 导出（通过浏览器打印 + 水印文字）
  const handleExportPDF = () => {
    const style = document.createElement("style");
    style.textContent = `@media print { body { -webkit-print-color-adjust: exact; } #bi-watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg); font-size: 80px; color: rgba(0,0,0,0.04); z-index: 9999; pointer-events: none; white-space: nowrap; } }`;
    document.head.appendChild(style);
    const wm = document.createElement("div");
    wm.id = "bi-watermark"; wm.textContent = watermarkText;
    document.body.appendChild(wm);
    window.print();
    setTimeout(() => { document.head.removeChild(style); document.body.removeChild(wm); }, 1000);
    setExportMenu(null);
  };

  const fields = rows.length > 0 ? Object.keys(rows[0]) : [];
  const numberFields = fields.filter(f => rows.some(r => typeof r[f] === "number"));

  return (
    <Box sx={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 1200,
      display: "flex", flexDirection: "column",
      bgcolor: (useCockpit || useProfitDash || isTemplate) ? "transparent" : "#F8F9FB",
    }}>
      {/* 工具栏 — 模板/驾驶舱/看板模式全屏隐藏 */}
      {!(useCockpit || useProfitDash || isTemplate) && (
      <Box sx={{
        px: 2, py: 0.75, display: "flex", alignItems: "center", gap: 1,
        borderBottom: "1px solid", borderColor: "#EBEDF0", bgcolor: "#FFFFFF", flexShrink: 0,
      }}>
        <IconButton size="small" onClick={() => nav("/bi")}><BackIcon sx={{ fontSize: 18 }} /></IconButton>
        <Typography variant="subtitle1" fontWeight={700}>{title || "加载中..."}</Typography>
        {isTemplate && <Chip label="模板" size="small" color="warning" variant="outlined" sx={{ fontSize: 11 }} />}
        <Box sx={{ flex: 1 }} />

        {/* AI分析 & 导入数据 */}
        <Button size="small" startIcon={<AIIcon sx={{ fontSize: 14, color: '#6366F1' }} />}
          onClick={handleAIAnalyze} variant="outlined"
          sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: 11, mr: 0.5, borderColor: '#C7D2FE', color: '#6366F1', '&:hover': { borderColor: '#6366F1', bgcolor: 'rgba(99,102,241,0.06)' } }}>
          AI分析
        </Button>
        <Button size="small" startIcon={<UploadIcon />}
          onClick={() => setImportOpen(true)} variant="outlined"
          sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: 11, mr: 0.5 }}>
          导入数据
        </Button>

        {/* 分析函数选择器 */}
        {panelDefs.length > 0 && (
          <FormControl size="small" sx={{ minWidth: 150, mr: 0.5 }}>
            <InputLabel sx={{ fontSize: 12 }}>分析函数</InputLabel>
            <Select
              value={funcType}
              label="分析函数"
              onChange={e => setFuncType(e.target.value)}
              sx={{ fontSize: 12, "& .MuiSelect-select": { py: 0.75 } }}
            >
              <MenuItem value=""><em>无</em></MenuItem>
              {funcOptions.map(f => (
                <MenuItem key={f.key} value={f.key}>
                  <Box sx={{ display: "flex", flexDirection: "column" }}>
                    <Typography variant="body2" fontSize={12}>{f.label}</Typography>
                    <Typography variant="caption" color="text.secondary">{f.desc}</Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* 自动刷新 */}
        <Chip label={autoRefresh ? `自动刷新 ${refreshInterval}s` : "手动刷新"} size="small"
          color={autoRefresh ? "success" : "default"} variant={autoRefresh ? "filled" : "outlined"}
          onClick={() => setAutoRefresh(!autoRefresh)}
          sx={{ fontSize: 11, height: 26, mr: 0.5 }} />
        {autoRefresh && (
          <Box sx={{ display: "flex", gap: 0.5, mr: 0.5 }}>
            {[15, 30, 60, 120].map(s => (
              <Chip key={s} label={`${s}s`} size="small"
                variant={refreshInterval === s ? "filled" : "outlined"}
                color={refreshInterval === s ? "primary" : "default"}
                onClick={() => setRefreshInterval(s)}
                sx={{ fontSize: 10, height: 22 }} />
            ))}
          </Box>
        )}

        {/* 导出菜单 */}
        <Button size="small" variant="outlined" startIcon={<DownloadIcon />}
          onClick={(e) => setExportMenu(e.currentTarget)}
          sx={{ borderRadius: 2, textTransform: "none", fontSize: 11, mr: 0.5 }}>
          导出
        </Button>

        {/* 图表配置 */}
        <IconButton size="small" onClick={() => setConfigOpen(true)}
          sx={{ mr: 0.5 }} title="图表配置">
          <SettingsIcon fontSize="small" />
        </IconButton>

        {/* 大屏模式 */}
        <IconButton size="small" onClick={() => setBigScreenOpen(true)}
          sx={{ mr: 0.5 }} title="数据大屏">
          <FullscreenIcon fontSize="small" />
        </IconButton>
        <Menu anchorEl={exportMenu} open={!!exportMenu} onClose={() => setExportMenu(null)}>
          <MenuItem onClick={handleExportImage}><ImageIcon sx={{ fontSize: 16, mr: 1 }} />导出图片 PNG</MenuItem>
          {canExportDetail && (
            <MenuItem onClick={handleExportExcel}><ExcelIcon sx={{ fontSize: 16, mr: 1 }} />导出 Excel</MenuItem>
          )}
          <MenuItem onClick={handleExportPDF}><PdfIcon sx={{ fontSize: 16, mr: 1 }} />导出 PDF（含水印）</MenuItem>
        </Menu>

        <IconButton size="small" onClick={() => {
          isTemplate ? loadFromTemplate(id!) : loadFromDashboard(dashId!);
        }} disabled={loading}>
          {loading ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
        </IconButton>
      </Box>
      )}

      <Box id="bi-dashboard-content" sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {/* 驾驶舱视图（拼多多店铺利润模板专用） */}
        {useCockpit ? (
          <PddCockpitView onBack={() => {
            setUseCockpit(false);
            nav('/bi');
          }} />
        ) : useProfitDash ? (
          <PddProfitDashboard onBack={() => {
            setUseProfitDash(false);
            nav('/bi');
          }} />
        ) : loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 20 }}><CircularProgress /></Box>
        ) : error ? (
          <Box sx={{ textAlign: "center", pt: 20, color: "error.main" }}>{error}</Box>
        ) : canvasItems && canvasItems.length > 0 ? (
          <BoardViewer items={canvasItems} docId={Number(id) || undefined} />
        ) : panels.length === 0 ? (
          <Box sx={{ textAlign: "center", pt: 20, color: "text.secondary" }}>暂无图表</Box>
        ) : (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {/* 模板全屏模式 — 浮动返回栏 */}
            {isTemplate && !useCockpit && !useProfitDash && (
              <Box sx={{
                position: "absolute", top: 12, left: 12, zIndex: 10,
                display: "flex", alignItems: "center", gap: 1,
              }}>
                <IconButton size="small" onClick={() => nav("/bi")}
                  sx={{ bgcolor: "rgba(255,255,255,0.9)", backdropFilter: "blur(8px)", boxShadow: 1,
                    "&:hover": { bgcolor: "rgba(255,255,255,1)" } }}>
                  <BackIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <Typography variant="subtitle2" sx={{ color: "text.primary", fontWeight: 600, ml: 0.5 }}>
                  {title || ""}
                </Typography>
              </Box>
            )}
            <Box sx={{ p: 2, pt: isTemplate ? 6 : 2 }}>
            <ChartPanelView
              rows={funcData.length > 0 ? funcData : rows} setRows={setRows}
              panels={panels} setPanels={setPanels}
              editMode={false} setEditMode={() => {}}
              fields={fields} numberFields={numberFields}
              panelStyles={panelStyles} setPanelStyles={setPanelStyles}
              linkageField={""} linkageValue={""}
              setLinkageField={() => {}} setLinkageValue={() => {}}
              showFilterBar={false} setShowFilterBar={() => {}}
              templateDialogOpen={false} setTemplateDialogOpen={() => {}}
              setDashboardName={() => {}} setOriginalName={() => {}} setCurrentDashboardId={() => {}}
              setActiveTab={() => {}} setSearchParams={() => {}}
            />
            {/* 分析函数结果提示 */}
            {funcType && (
              <Box sx={{ mt: 1, px: 1, display: "flex", alignItems: "center", gap: 1 }}>
                <Chip icon={<FuncIcon />} label={`${funcOptions.find(f => f.key === funcType)?.label || funcType} - 已应用到所有图表`}
                  color="info" size="small" onDelete={() => setFuncType("")} />
                {funcLoading && <CircularProgress size={14} />}
                {funcData.length === 0 && !funcLoading && funcType && (
                  <Typography variant="caption" color="warning.main">数据不足，无法计算</Typography>
                )}
              </Box>
            )}
          </Box>
          </Box>
        )}
      </Box>

      {/* 图表配置面板 */}
      {configOpen && (
        <ChartConfigPanel
          styles={panelStyles}
          onStylesChange={setPanelStyles}
          onClose={() => setConfigOpen(false)}
        />
      )}
      {/* 数据大屏 */}
      {bigScreenOpen && (
        <BigScreen rows={rows} panels={panels} title={title} onClose={() => setBigScreenOpen(false)} />
      )}

      {/* 导入数据 */}
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)}
        onImportComplete={() => {}} importEndpoint={getImportEndpoint()} />

      {/* AI 分析弹窗 */}
      <Dialog open={aiAnalyzeOpen} onClose={() => setAiAnalyzeOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>🤖 AI 数据分析 — DeepSeek</DialogTitle>
        <DialogContent sx={{ pt: 1, minHeight: 150 }}>
          {aiAnalyzeLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
              <CircularProgress size={40} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">DeepSeek 正在分析 {rows.length} 行数据...</Typography>
            </Box>
          ) : aiAnalyzeResult?.error ? (
            <Alert severity="error">{aiAnalyzeResult.error}</Alert>
          ) : aiAnalyzeResult?.ai_analysis ? (
            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
              {aiAnalyzeResult.ai_analysis.summary && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="#6366F1" sx={{ mb: 0.5 }}>📊 整体分析</Typography>
                  <Typography variant="body2">{aiAnalyzeResult.ai_analysis.summary}</Typography>
                </Paper>
              )}
              {(aiAnalyzeResult.ai_analysis.highlights || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#F0FDF4' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="success.main">✨ 亮点</Typography>
                  {aiAnalyzeResult.ai_analysis.highlights.map((h: string, i: number) => <Typography key={i} variant="body2" color="success.dark" sx={{ fontSize: 13 }}>· {h}</Typography>)}
                </Paper>
              )}
              {(aiAnalyzeResult.ai_analysis.risks || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#FFF7ED' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="warning.main">⚠️ 风险</Typography>
                  {aiAnalyzeResult.ai_analysis.risks.map((r: string, i: number) => <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 13 }}>· {r}</Typography>)}
                </Paper>
              )}
              {(aiAnalyzeResult.ai_analysis.recommendations || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)', borderColor: '#C7D2FE' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="#6366F1">💡 建议</Typography>
                  {aiAnalyzeResult.ai_analysis.recommendations.map((r: string, i: number) => <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>· {r}</Typography>)}
                </Paper>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setAiAnalyzeOpen(false)} variant="contained" sx={{ borderRadius: 1.5, px: 4 }}>关闭</Button>
        </DialogActions>
      </Dialog>
      <WatermarkOverlay text={watermarkText} />
    </Box>
  );
}
