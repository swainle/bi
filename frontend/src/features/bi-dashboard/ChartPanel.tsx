import { useState, useMemo, useCallback } from "react";
import ReactEChartsCore from "echarts-for-react";
import * as echarts from "echarts/core";
import { SunburstChart, SankeyChart, RadarChart, FunnelChart } from "echarts/charts";
import { TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "echarts-wordcloud";

echarts.use([SunburstChart, SankeyChart, RadarChart, FunnelChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);
import {
  Box, Typography, IconButton, Paper, Grid, Button, Chip, Tooltip,
  Select, MenuItem, FormControl, InputLabel, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from "@mui/material";
import {
  Add as AddIcon, Edit, Close,
  TrendingUp, BarChart, PieChart, TableChart, FileUpload,
  DeleteOutline, DragIndicator, Dashboard,
  Search as SearchIcon,
} from "@mui/icons-material";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";
import * as XLSX from "xlsx";
import {
  DataRow, ChartPanel as ChartPanelType, ChartType, PanelSize, Template,
  COLORS, fmt, pId, TEMPLATES, DEMO_DATA, DEMO_PANELS,
} from "./constants";

const TABLE_LABELS: Record<string, string> = {
  id: "序号", store: "店铺名称", department: "部门/人员",
  revenue: "销售收入", gross_profit: "毛利", gross_margin: "毛利率(%)",
  net_profit: "净利润", promo_cost: "推广费", platform_cost: "平台费",
  labor_cost: "人工成本", other_cost: "其它费用", express_cost: "快递费",
  packaging_cost: "包材费", order_count: "订单数", profit_rate: "利润率(%)",
  ad_spend: "广告费", logistics_cost: "物流成本", orders: "订单量",
  quarterly_revenue: "季度收入", data_month: "数据月份", updated_at: "更新时间",
  gmv: "GMV", pv: "PV", uv: "UV", roi: "ROI", cvr: "转化率(%)",
  ctr: "点击率(%)", avg_order: "客单价", refund_rate: "退款率(%)",
  conversion_rate: "转化率(%)", repurchase_rate: "复购率(%)",
  return_rate: "退货率(%)", rating: "评分", monthly_sales: "月销量",
  revenue_clean: "正向收入", refund: "退款", special_rev: "特殊单收入",
  tmall_1688: "1688托管", return_orders: "退单数", special_orders: "特殊单",
  shipping_rev: "运费收入", cogs: "销售成本", gift_cost: "赠品成本",
  cost_adj: "人工调整", special_cost: "特殊单成本", damage: "货损",
  warehouse_rent: "仓租", warehouse_labor: "仓人工", other_logistics: "其它物流",
  packaging_import: "包材导入",
};

interface ChartPanelViewProps {
  rows: DataRow[];
  setRows: React.Dispatch<React.SetStateAction<DataRow[]>>;
  panels: ChartPanelType[];
  setPanels: React.Dispatch<React.SetStateAction<ChartPanelType[]>>;
  editMode: boolean;
  setEditMode: React.Dispatch<React.SetStateAction<boolean>>;
  fields: string[];
  numberFields: string[];
  panelStyles: Record<string, { color?: string; theme?: string; fontSize?: number; smooth?: boolean; title?: string }>;
  setPanelStyles: React.Dispatch<React.SetStateAction<Record<string, { color?: string; theme?: string; fontSize?: number; smooth?: boolean; title?: string }>>>;
  linkageField: string;
  linkageValue: string;
  setLinkageField: React.Dispatch<React.SetStateAction<string>>;
  setLinkageValue: React.Dispatch<React.SetStateAction<string>>;
  showFilterBar: boolean;
  setShowFilterBar: React.Dispatch<React.SetStateAction<boolean>>;
  templateDialogOpen: boolean;
  setTemplateDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setDashboardName: React.Dispatch<React.SetStateAction<string>>;
  setOriginalName: React.Dispatch<React.SetStateAction<string>>;
  setCurrentDashboardId: React.Dispatch<React.SetStateAction<string | null>>;
  setActiveTab: React.Dispatch<React.SetStateAction<number>>;
  setSearchParams: (params: Record<string, string>, opts?: { replace?: boolean }) => void;
}

export default function ChartPanelView({
  rows, setRows, panels, setPanels, editMode, setEditMode,
  fields, numberFields, panelStyles, setPanelStyles,
  linkageField, linkageValue, setLinkageField, setLinkageValue,
  showFilterBar, setShowFilterBar, templateDialogOpen, setTemplateDialogOpen,
  setDashboardName, setOriginalName, setCurrentDashboardId,
  setActiveTab, setSearchParams,
}: ChartPanelViewProps) {
  const [editPanel, setEditPanel] = useState<ChartPanelType | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // 图表点击联动：点击图表元素→设置联动筛选
  const handleChartClick = useCallback((panel: ChartPanelType) => (e: any) => {
    if (!panel.xField) return;
    const name = e?.name;
    if (name === undefined || name === null) return;
    const nameStr = String(name);
    if (linkageField === panel.xField && linkageValue === nameStr) {
      setLinkageField(""); setLinkageValue("");
    } else {
      setLinkageField(panel.xField); setLinkageValue(nameStr);
      setShowFilterBar(true);
    }
  }, [linkageField, linkageValue, setLinkageField, setLinkageValue, setShowFilterBar]);

  const sortedPanels = useMemo(() => [...panels].sort((a, b) => a.order - b.order), [panels]);

  // ====== 拖拽排序 (hello-pangea/dnd) ======
  const handleDragEndReorder = (result: any) => {
    if (!result.destination) return;
    setPanels(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(result.source.index, 1);
      arr.splice(result.destination.index, 0, moved);
      return arr.map((p, i) => ({ ...p, order: i }));
    });
  };

  // ====== 应用模板 ======
  const applyTemplate = (tmpl: Template) => {
    setRows(tmpl.data);
    setPanels(tmpl.panels);
    setDashboardName(tmpl.name);
    setOriginalName(tmpl.name);
    setCurrentDashboardId(null);
    setTemplateDialogOpen(false);
    setActiveTab(0);
    setSearchParams({ tab: "0" }, { replace: true });
  };

  // ====== 模板分类 ======
  const categories = useMemo(() => {
    const cats = new Set(TEMPLATES.map(t => t.category));
    return Array.from(cats);
  }, []);

  // ====== 图表配置 ======
  const getChartOption = (panel: ChartPanelType): any => {
    const style = panelStyles[panel.id];
    const mainColor = style?.color || COLORS[0];
    const fontSize = style?.fontSize || 11;
    const smooth = style?.smooth !== undefined ? style.smooth : true;

    if (panel.type === "table") return {};

    let filteredRows = rows;
    if (linkageField && linkageValue) {
      filteredRows = rows.filter(r => String(r[linkageField]) === String(linkageValue));
    }

    if (panel.type === "number") {
      const vals = filteredRows.map(r => Number(r[panel.yField])).filter(v => !isNaN(v));
      const total = vals.reduce((a, b) => a + b, 0);
      return {
        graphic: { type: "text", left: "center", top: "center",
          style: { text: fmt(total), fontSize: panel.size === "sm" ? 28 : 36, fontWeight: 700, fill: mainColor } },
      };
    }

    const xData = filteredRows.map(r => String(r[panel.xField] || ""));
    const yData = filteredRows.map(r => Number(r[panel.yField]) || 0);

    if (panel.type === "pie") {
      return {
        tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
        series: [{ type: "pie", radius: ["40%", "70%"], center: ["50%", "55%"],
          data: filteredRows.map((r, i) => ({ name: String(r[panel.xField] || ""), value: Number(r[panel.yField]) || 0 })),
          label: { fontSize: 10, formatter: "{b}\n{d}%" },
          itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
        }],
      };
    }

    // ── 高级图表类型 ──
    if (panel.type === "radar") {
      const indicator = xData.map(k => ({ name: k, max: Math.max(...yData, 1) * 1.2 }));
      return { tooltip: {}, legend: { data: [panel.title || "指标"], bottom: 0, textStyle: { fontSize } }, radar: { indicator, center: ["50%", "48%"], radius: "60%" }, series: [{ type: "radar", data: [{ value: yData, name: panel.title || "指标", areaStyle: { color: mainColor + "30" }, itemStyle: { color: mainColor } }] }] };
    }
    if (panel.type === "funnel") {
      const fData = filteredRows.map(r => ({ name: String(r[panel.xField] || ""), value: Number(r[panel.yField]) || 0 })).sort((a, b) => b.value - a.value);
      return { tooltip: { trigger: "item", formatter: "{b}: {c}" }, series: [{ type: "funnel", left: "10%", right: "10%", top: 20, bottom: 20, sort: "descending", gap: 3, data: fData, label: { fontSize } }] };
    }
    if (panel.type === "sunburst") {
      const sData = filteredRows.map((r, i) => ({ name: String(r[panel.xField] || ""), value: Number(r[panel.yField]) || 0, itemStyle: { color: COLORS[i % COLORS.length] } }));
      return { tooltip: { trigger: "item" }, series: [{ type: "sunburst", data: sData, radius: ["15%", "70%"], itemStyle: { borderRadius: 6 }, label: { fontSize } }] };
    }
    if (panel.type === "sankey") {
      const nodes: { name: string }[] = []; const nameIdx: Record<string, number> = {};
      xData.forEach(n => { if (!(n in nameIdx)) { nameIdx[n] = nodes.length; nodes.push({ name: n }); } });
      yData.forEach(n => { const s = String(n); if (!(s in nameIdx)) { nameIdx[s] = nodes.length; nodes.push({ name: s }); } });
      const links = xData.map((n, i) => ({ source: n, target: String(yData[i]), value: 1 }));
      return { tooltip: {}, series: [{ type: "sankey", layout: "none", emphasis: { focus: "adjacency" }, data: nodes, links, label: { fontSize } }] };
    }
    if (panel.type === "wordcloud") {
      const wData = filteredRows.map((r, i) => ({ name: String(r[panel.xField] || ""), value: Number(r[panel.yField]) || 0 }));
      return { tooltip: { show: true }, series: [{ type: "wordCloud", shape: "circle", sizeRange: [14, 60], rotationRange: [-45, 45], gridSize: 8, data: wData }] };
    }

    // line/bar 默认
    // line/bar 默认（含图例交互 + 悬浮高亮）
    return {
      tooltip: { trigger: "axis" },
      legend: { data: [panel.title || panel.yField], bottom: 0, textStyle: { fontSize }, selectedMode: true },
      toolbox: { feature: { saveAsImage: { title: "下载" }, restore: { title: "还原" } }, right: 10, top: 0 },
      grid: { left: 50, right: 30, top: 30, bottom: 35 },
      xAxis: { type: "category", data: xData, axisLine: { lineStyle: { color: "#E5E7EB" } }, axisLabel: { color: "#6B7280", fontSize } },
      yAxis: { type: "value", axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: "#F3F4F6" } }, axisLabel: { color: "#9CA3AF", fontSize, formatter: (v: number) => fmt(v) } },
      series: [{
        name: panel.title || panel.yField,
        data: yData, type: panel.type, smooth,
        symbol: panel.type === "line" ? "circle" : undefined, symbolSize: 6,
        itemStyle: { color: mainColor, borderRadius: [6, 6, 0, 0] },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: mainColor + "80" }, scale: 1.05 },
        barWidth: "60%",
        areaStyle: panel.type === "line" ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: mainColor + "40" }, { offset: 1, color: mainColor + "05" }] } } : undefined,
      }],
    };
  };

  // ====== 面板操作 ======
  const addPanel = (type: ChartType) => {
    const p: ChartPanelType = {
      id: pId(), type, title: type === "number" ? "新指标" : type === "table" ? "新表格" : "新图表",
      xField: fields[0] || "", yField: numberFields[0] || "", size: "md", order: panels.length,
    };
    setPanels(prev => [...prev, p]);
  };

  const copyPanel = (p: ChartPanelType) => {
    const copy: ChartPanelType = { ...p, id: pId(), title: p.title + " (副本)", order: panels.length };
    setPanels(prev => [...prev, copy]);
  };

  const removePanel = (id: string) => setPanels(prev => prev.filter(p => p.id !== id));

  const saveEditedPanel = () => {
    if (!editPanel) return;
    setPanels(prev => prev.map(p => p.id === editPanel.id ? editPanel : p));
    setEditDialogOpen(false); setEditPanel(null);
  };

  // ====== CSV / XLSX / JSON 导入 ======
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const ext = f.name.split(".").pop()?.toLowerCase();

    const parseCsv = (text: string) => {
      const lines = text.trim().split("\n"); if (lines.length < 2) return;
      const headers = lines[0].split(",").map(h => h.trim());
      const data: DataRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map(v => v.trim());
        const row: DataRow = {};
        headers.forEach((h, j) => { const n = Number(vals[j]); row[h] = isNaN(n) ? vals[j] : n; });
        data.push(row);
      }
      setRows(data);
    };

    if (ext === "csv" || ext === "txt") {
      const reader = new FileReader();
      reader.onload = (ev) => { parseCsv(ev.target?.result as string); };
      reader.readAsText(f);
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const wb = XLSX.read(ev.target?.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: DataRow[] = XLSX.utils.sheet_to_json(ws);
        setRows(rows);
      };
      reader.readAsArrayBuffer(f);
    } else if (ext === "json") {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const arr = JSON.parse(ev.target?.result as string);
          if (Array.isArray(arr) && arr.length > 0) setRows(arr);
        } catch {}
      };
      reader.readAsText(f);
    }
    e.target.value = "";
  }, [setRows]);

  if (rows.length === 0) {
    return (
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Paper elevation={0} sx={{
          textAlign: "center", p: 6, borderRadius: 4, maxWidth: 480,
          border: "2px dashed", borderColor: "#D1D5DB", bgcolor: "#FAFBFC",
        }}>
          <BarChart sx={{ fontSize: 64, color: "#D1D5DB", mb: 2 }} />
          <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>暂无数据看板</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            从模板库选择电商数据模板，或上传自己的 CSV 数据表来创建你的第一个 明策BI
          </Typography>
          <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
            <Button variant="contained" startIcon={<Dashboard />}
              onClick={() => setTemplateDialogOpen(true)}
              sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}>
              模板库
            </Button>
            <Button variant="outlined" startIcon={<FileUpload />} component="label"
              sx={{ borderRadius: 2, textTransform: "none" }}>
              导入 CSV / Excel / JSON
              <input type="file" accept=".csv,.xlsx,.xls,.json" hidden onChange={handleFileUpload} />
            </Button>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <>
      {/* 筛选栏 + 联动提示 */}
      {(editMode || showFilterBar) && (
        <Paper elevation={0} sx={{ p: 1.5, mb: 2, borderRadius: 2, border: "1px dashed", borderColor: "#6366F1", bgcolor: "#F5F3FF", display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Typography variant="caption" fontWeight={700} sx={{ color: "#6366F1", whiteSpace: "nowrap" }}>🔍 筛选</Typography>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <Select value={linkageField} displayEmpty
              onChange={e => { setLinkageField(e.target.value); setLinkageValue(""); }}
              sx={{ fontSize: 11, "& .MuiSelect-select": { py: 0.5 } }}>
              <MenuItem value="">全部数据</MenuItem>
              {fields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </Select>
          </FormControl>
          {linkageField && (
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <Select value={linkageValue} displayEmpty
                onChange={e => setLinkageValue(e.target.value)}
                sx={{ fontSize: 11, "& .MuiSelect-select": { py: 0.5 } }}>
                <MenuItem value="">全部</MenuItem>
                {[...new Set(rows.map(r => String(r[linkageField])))].map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
              </Select>
            </FormControl>
          )}
          {(linkageField && linkageValue) && (
            <>
              <Chip label={`${linkageField}=${linkageValue}`} size="small" color="primary"
                onDelete={() => { setLinkageField(""); setLinkageValue(""); }} />
              <Typography variant="caption" color="text.secondary">{rows.filter(r => String(r[linkageField]) === String(linkageValue)).length} 条匹配</Typography>
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={() => { setLinkageField(""); setLinkageValue(""); setShowFilterBar(false); }}
            sx={{ fontSize: 10, textTransform: "none", borderRadius: 2 }}>清除</Button>
        </Paper>
      )}

      {/* 面板网格（支持拖拽排序） */}
      {editMode ? (
        <DragDropContext onDragEnd={handleDragEndReorder}>
          <Droppable droppableId="panels" direction="horizontal" isDropDisabled={false}>
            {(provided) => (
              <Box ref={provided.innerRef} {...provided.droppableProps}
                sx={{ display: "flex", flexWrap: "wrap", gap: 1.5, mb: 2 }}>
                {sortedPanels.map((panel, idx) => {
                  const isNumber = panel.type === "number";
                  const isLg = !isNumber && panel.size === "lg";
                  const w = isNumber ? "calc(25% - 4.5px)" : isLg ? "100%" : "calc(50% - 4.5px)";
                  return (
                    <Draggable key={panel.id} draggableId={panel.id} index={idx}>
                      {(provided, snapshot) => (
                        <Box ref={provided.innerRef} {...provided.draggableProps}
                          sx={{ width: w, opacity: snapshot.isDragging ? 0.5 : 1 }}>
                          <Paper elevation={0} sx={{
                            p: 2, borderRadius: 3, bgcolor: "#FFFFFF",
                            border: "1px solid", borderColor: "#F59E0B",
                            position: "relative", height: isNumber ? 120 : "auto",
                            cursor: "grab", transition: "all 0.15s",
                          }}>
                            <Box {...provided.dragHandleProps} sx={{ display: "flex", alignItems: "center", mb: isNumber ? 0 : 1 }}>
                              <DragIndicator sx={{ fontSize: 18, color: "#F59E0B", mr: 0.5 }} />
                              <Typography variant={isNumber ? "caption" : "subtitle2"} color={isNumber ? "text.secondary" : "text.primary"} fontWeight={600} sx={{ flex: 1 }}>
                                {panel.title}
                              </Typography>
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditPanel({ ...panel }); setEditDialogOpen(true); }}>
                                <Edit sx={{ fontSize: isNumber ? 12 : 14 }} />
                              </IconButton>
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); removePanel(panel.id); }} sx={{ "&:hover": { color: "error.main" } }}>
                                <DeleteOutline sx={{ fontSize: isNumber ? 12 : 14 }} />
                              </IconButton>
                            </Box>
                            {isNumber ? (
                              <ReactEChartsCore option={getChartOption(panel)} style={{ height: 70, width: "100%" }} onEvents={{ click: () => { setLinkageField(""); setLinkageValue(""); } }} opts={{ renderer: "svg" }} notMerge />
                            ) : panel.type === "table" ? (
                              <Box sx={{ overflow: "auto", maxHeight: 300 }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                  <thead><tr>{fields.map(f => <th key={f} style={{ textAlign: "left", padding: "6px 10px", borderBottom: "2px solid #E5E7EB", color: "#6B7280", fontWeight: 600 }}>{TABLE_LABELS[f] || f}</th>)}</tr></thead>
                                  <tbody>{rows.slice(0, 20).map((r, i) => (<tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>{fields.map(f => <td key={f} style={{ padding: "6px 10px" }}>{typeof r[f] === "number" ? r[f].toLocaleString() : String(r[f])}</td>)}</tr>))}</tbody>
                                </table>
                              </Box>
                            ) : (
                              <ReactEChartsCore option={getChartOption(panel)} style={{ height: 300 }} onEvents={{ click: handleChartClick(panel) }} opts={{ renderer: "svg" }} notMerge />
                            )}
                          </Paper>
                        </Box>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </Box>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        /* 查看模式：普通 Grid */
        <Grid container spacing={2} sx={{ mb: 2 }}>
          {sortedPanels.map(panel => {
            const isNumber = panel.type === "number";
            const isLg = panel.size === "lg";
            const isTable = panel.type === "table";
            // 布局：指标卡4列 | 大图表2列 | 中图表3列 | 表格全宽
            const colSpan = isNumber ? { xs: 6, sm: 3 } : (isTable ? { xs: 12 } : (isLg ? { xs: 12, md: 6 } : { xs: 12, sm: 6, md: 4 }));
            return (
              <Grid item key={panel.id} {...colSpan}>
                <Paper elevation={0} sx={{
                  p: 2, borderRadius: 3, bgcolor: "#FFFFFF", border: "1px solid", borderColor: "#EBEDF0",
                  height: isNumber ? 120 : (isLg ? 400 : 340),
                  display: "flex", flexDirection: "column",
                  transition: "box-shadow 0.2s",
                  "&:hover": { boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
                }}>
                  <Typography variant={isNumber ? "caption" : "subtitle2"} color={isNumber ? "text.secondary" : "text.primary"} fontWeight={600} sx={{ mb: 0.5 }}>
                    {panel.title}
                  </Typography>
                  {isNumber ? (
                    <ReactEChartsCore option={getChartOption(panel)} style={{ height: 70, width: "100%" }} onEvents={{ click: () => { setLinkageField(""); setLinkageValue(""); } }} opts={{ renderer: "svg" }} notMerge />
                  ) : panel.type === "table" ? (
                    <Box sx={{ overflow: "auto", flex: 1 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead><tr style={{ position: "sticky", top: 0, background: "#F9FAFB" }}>{fields.map(f => <th key={f} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "2px solid #E5E7EB", color: "#6B7280", fontWeight: 600, fontSize: 12 }}>{TABLE_LABELS[f] || f}</th>)}</tr></thead>
                        <tbody>{rows.slice(0, 50).map((r, i) => (<tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>{fields.map(f => <td key={f} style={{ padding: "6px 10px", fontSize: 12 }}>{typeof r[f] === "number" ? r[f].toLocaleString() : String(r[f])}</td>)}</tr>))}</tbody>
                      </table>
                    </Box>
                  ) : (
                    <ReactEChartsCore option={getChartOption(panel)} style={{ flex: 1, minHeight: 0 }} onEvents={{ click: handleChartClick(panel) }} opts={{ renderer: "svg" }} notMerge />
                  )}
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* 编辑模式工具栏 */}
      {editMode && (
        <Box sx={{ mt: 3, display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1, alignSelf: "center" }}>添加面板：</Typography>
          <Chip icon={<AddIcon />} label="指标卡" color="primary" variant="outlined" onClick={() => addPanel("number")} sx={{ borderRadius: 2, cursor: "pointer" }} />
          <Chip icon={<TrendingUp />} label="折线图" color="primary" variant="outlined" onClick={() => addPanel("line")} sx={{ borderRadius: 2, cursor: "pointer" }} />
          <Chip icon={<BarChart />} label="柱状图" color="primary" variant="outlined" onClick={() => addPanel("bar")} sx={{ borderRadius: 2, cursor: "pointer" }} />
          <Chip icon={<PieChart />} label="饼图" color="primary" variant="outlined" onClick={() => addPanel("pie")} sx={{ borderRadius: 2, cursor: "pointer" }} />
          <Chip icon={<TableChart />} label="表格" color="primary" variant="outlined" onClick={() => addPanel("table")} sx={{ borderRadius: 2, cursor: "pointer" }} />
          <Chip label="雷达图" variant="outlined" onClick={() => addPanel("radar")} sx={{ borderRadius: 2, cursor: "pointer", fontSize: 12 }} />
          <Chip label="漏斗图" variant="outlined" onClick={() => addPanel("funnel")} sx={{ borderRadius: 2, cursor: "pointer", fontSize: 12 }} />
          <Chip label="旭日图" variant="outlined" onClick={() => addPanel("sunburst")} sx={{ borderRadius: 2, cursor: "pointer", fontSize: 12 }} />
          <Chip label="桑基图" variant="outlined" onClick={() => addPanel("sankey")} sx={{ borderRadius: 2, cursor: "pointer", fontSize: 12 }} />
          <Chip label="词云" variant="outlined" onClick={() => addPanel("wordcloud")} sx={{ borderRadius: 2, cursor: "pointer", fontSize: 12 }} />
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" size="small" onClick={() => { setShowFilterBar(!showFilterBar); if (!showFilterBar) { setEditMode(false); setTimeout(() => setEditMode(true), 50); } }}
            sx={{ borderRadius: 2, textTransform: "none", fontSize: 11 }}>
            {showFilterBar ? "隐藏筛选" : "筛选器"}</Button>
        </Box>
      )}

      {/* ====== 模板弹窗 ====== */}
      <Dialog open={templateDialogOpen} onClose={() => setTemplateDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          📂 数据模板库
          <IconButton size="small" onClick={() => setTemplateDialogOpen(false)}><Close /></IconButton>
        </DialogTitle>
        <DialogContent>
          {categories.map(cat => (
            <Box key={cat} sx={{ mb: 2 }}>
              <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", letterSpacing: 1 }}>{cat}</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1 }}>
                {TEMPLATES.filter(t => t.category === cat).map(tmpl => (
                  <Paper key={tmpl.name}
                    onClick={() => applyTemplate(tmpl)}
                    elevation={0}
                    sx={{
                      p: 2, borderRadius: 2, cursor: "pointer",
                      border: "1px solid", borderColor: "#EBEDF0",
                      display: "flex", alignItems: "center", gap: 1.5,
                      "&:hover": { borderColor: "#6366F1", bgcolor: "#F5F3FF", transform: "translateY(-2px)", boxShadow: 1 },
                      transition: "all 0.2s",
                    }}>
                    <Box sx={{ color: "#6366F1", fontSize: 28 }}>{tmpl.icon}</Box>
                    <Box>
                      <Typography fontWeight={700} sx={{ fontSize: 14 }}>{tmpl.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {tmpl.data.length} 行数据 · {tmpl.panels.length} 个面板
                      </Typography>
                    </Box>
                  </Paper>
                ))}
              </Box>
            </Box>
          ))}
        </DialogContent>
      </Dialog>

      {/* ====== 面板编辑弹窗 ====== */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 16, display: "flex", justifyContent: "space-between" }}>
          编辑面板
          <IconButton size="small" onClick={() => setEditDialogOpen(false)}><Close /></IconButton>
        </DialogTitle>
        <DialogContent>
          {editPanel && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 0.5 }}>
              <TextField label="面板标题" size="small" fullWidth
                value={editPanel.title}
                onChange={e => setEditPanel({ ...editPanel, title: e.target.value })} />
              <Box sx={{ display: "flex", gap: 1 }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>图表类型</InputLabel>
                  <Select value={editPanel.type} label="图表类型"
                    onChange={e => setEditPanel({ ...editPanel, type: e.target.value as ChartType, xField: e.target.value === "number" ? "" : editPanel.xField, yField: e.target.value === "table" ? "" : editPanel.yField })}>
                    <MenuItem value="number">📊 指标卡</MenuItem>
                    <MenuItem value="line">📈 折线图</MenuItem>
                    <MenuItem value="bar">📊 柱状图</MenuItem>
                    <MenuItem value="pie">🥧 饼图</MenuItem>
                    <MenuItem value="table">📋 表格</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>尺寸</InputLabel>
                  <Select value={editPanel.size} label="尺寸"
                    onChange={e => setEditPanel({ ...editPanel, size: e.target.value as PanelSize })}>
                    <MenuItem value="sm">小 (1/4)</MenuItem>
                    <MenuItem value="md">中 (1/2)</MenuItem>
                    <MenuItem value="lg">大 (全宽)</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Typography variant="caption" color="text.secondary" fontWeight={600}>🎨 图表样式</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {["#6366F1","#EC4899","#10B981","#F59E0B","#3B82F6","#8B5CF6","#EF4444","#06B6D4"].map(c => (
                  <Box key={c} onClick={() => setPanelStyles(prev => ({ ...prev, [editPanel.id]: { color: c, theme: prev[editPanel.id]?.theme || "" } }))}
                    sx={{ width: 26, height: 26, borderRadius: "50%", bgcolor: c, cursor: "pointer",
                      border: panelStyles[editPanel.id]?.color === c ? "3px solid #333" : "3px solid transparent",
                      transition: "all 0.1s", "&:hover": { transform: "scale(1.15)" } }} />
                ))}
              </Box>

              {(editPanel.type !== "number" && editPanel.type !== "table") && (
                <>
                  <Divider />
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>📐 数据字段</Typography>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <FormControl size="small" sx={{ flex: 1 }}>
                      <InputLabel>X 轴（分类）</InputLabel>
                      <Select value={editPanel.xField} label="X 轴（分类）"
                        onChange={e => setEditPanel({ ...editPanel, xField: e.target.value })}>
                        {fields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1 }}>
                      <InputLabel>Y 轴（数值）</InputLabel>
                      <Select value={editPanel.yField} label="Y 轴（数值）"
                        onChange={e => setEditPanel({ ...editPanel, yField: e.target.value })}>
                        {numberFields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </Box>
                </>
              )}

              {(editPanel.type === "number") && (
                <FormControl size="small" fullWidth>
                  <InputLabel>指标字段</InputLabel>
                  <Select value={editPanel.yField} label="指标字段"
                    onChange={e => setEditPanel({ ...editPanel, yField: e.target.value })}>
                    {numberFields.map(f => <MenuItem key={f} value={f}>{f}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ gap: 1 }}>
          <Button size="small" variant="outlined" color="error" onClick={() => { removePanel(editPanel!.id); setEditDialogOpen(false); }}
            startIcon={<DeleteOutline />} sx={{ borderRadius: 2, textTransform: "none", mr: "auto" }}>
            删除面板
          </Button>
          <Button size="small" variant="outlined" onClick={() => { copyPanel(editPanel!); setEditDialogOpen(false); }}
            startIcon={<AddIcon />} sx={{ borderRadius: 2, textTransform: "none" }}>
            复制面板
          </Button>
          <Button onClick={() => setEditDialogOpen(false)} sx={{ textTransform: "none" }}>取消</Button>
          <Button onClick={saveEditedPanel} variant="contained" sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1" }}>保存</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
