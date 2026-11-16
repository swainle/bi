/** 自助分析画布 — 拖拽字段生成图表 + 日期层级下钻 */

import { useState, useCallback, useMemo, useEffect } from "react";
import ReactEChartsCore from "echarts-for-react";
import * as echarts from "echarts/core";
import { SunburstChart, SankeyChart, RadarChart, FunnelChart } from "echarts/charts";
import { TooltipComponent, LegendComponent, GridComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import "echarts-wordcloud";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  Box, Typography, Chip, Select, MenuItem, FormControl, Button, CircularProgress, Paper, IconButton,
} from "@mui/material";
import { PlayArrow as RunIcon, BarChart, TrendingUp, PieChart, TableChart, Save as SaveIcon, Close, AutoAwesome as AIIcon } from "@mui/icons-material";
import client from "../../api/client";

echarts.use([SunburstChart, SankeyChart, RadarChart, FunnelChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

interface ColumnMeta { name: string; type: string; col?: string }
interface TableMeta { table: string; columns: ColumnMeta[] }

const CHART_TYPES = [
  { key: "bar", label: "柱状图", icon: <BarChart /> },
  { key: "line", label: "折线图", icon: <TrendingUp /> },
  { key: "pie", label: "饼图", icon: <PieChart /> },
  { key: "table", label: "表格", icon: <TableChart /> },
  { key: "radar", label: "雷达图" },
  { key: "funnel", label: "漏斗图" },
  { key: "sunburst", label: "旭日图" },
];

const AGG_FUNCS = ["SUM", "AVG", "COUNT", "MAX", "MIN"];
const ITEM_TYPE = "FIELD";

// ── Draggable Field ──
function DraggableField({ col, color }: { col: ColumnMeta; color: string }) {
  const [, drag] = useDrag(() => ({ type: ITEM_TYPE, item: col, collect: m => ({ isDragging: m.isDragging() }) }));
  return (
    <Box ref={drag} sx={{
      px: 1, py: 0.3, borderRadius: 1, cursor: "grab", fontSize: 11,
      bgcolor: color + "18", color, display: "inline-flex", alignItems: "center",
      mb: 0.5, mr: 0.5, border: `1px solid ${color}30`, userSelect: "none",
      "&:hover": { bgcolor: color + "28" },
    }}>{col.name}</Box>
  );
}

// ── Drop Zone ──
function DropZone({ accept, label, color, items, onDrop, onRemove, showAgg }: {
  accept: string; label: string; color: string; items: any[];
  onDrop: (col: ColumnMeta) => void; onRemove: (col: ColumnMeta) => void;
  showAgg?: boolean;
}) {
  const [{ isOver }, drop] = useDrop(() => ({
    accept: ITEM_TYPE,
    drop: (item: ColumnMeta) => onDrop(item),
    collect: m => ({ isOver: m.isOver() }),
  }));

  return (
    <Box ref={drop} sx={{
      minHeight: 40, p: 1, border: `2px dashed ${isOver ? color : "#E5E7EB"}`, borderRadius: 2,
      bgcolor: isOver ? color + "08" : "transparent", transition: "all 0.2s",
      display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center",
    }}>
      <Typography variant="caption" sx={{ color: isOver ? color : "#9CA3AF", fontSize: 10, mr: 1 }}>{label}</Typography>
      {items.length === 0 && !isOver && <Typography variant="caption" color="#D1D5DB" fontSize={10}>拖拽字段到此处</Typography>}
      {items.map((item, i) => (
        <Chip key={i} label={showAgg && item.agg ? `${item.agg}(${item.name || item.col})` : (item.name || item.col)}
          size="small" color={color === "#EC4899" ? "error" : color === "#6366F1" ? "primary" : "warning"}
          onDelete={() => onRemove(item)} sx={{ fontSize: 10, height: 22 }} />
      ))}
    </Box>
  );
}

// ── Main Canvas ──
export default function AnalysisCanvas() {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selectedTable, setSelectedTable] = useState("");
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [dimensions, setDimensions] = useState<ColumnMeta[]>([]);
  const [metrics, setMetrics] = useState<(ColumnMeta & { agg: string })[]>([]);
  const [filters, setFilters] = useState<{ col: string; op: string; val: string }[]>([]);
  const [chartType, setChartType] = useState("bar");
  const [result, setResult] = useState<{ columns: string[]; rows: any[]; count: number; sql: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [drillPath, setDrillPath] = useState<string[]>([]);
  const [drillLevel, setDrillLevel] = useState<"month" | "quarter" | "year" | "day" | "">("");
  const [savedTemplates, setSavedTemplates] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    client.get("/bi/engine/tables").then(r => {
      const tbls = (r.data?.tables || []) as TableMeta[];
      setTables(tbls);
      if (tbls.length > 0) { setSelectedTable(tbls[0].table); setColumns(tbls[0].columns); }
    }).catch(() => {});
    client.get("/bi/engine/filter_templates").then(r => setSavedTemplates(r.data?.templates || [])).catch(() => {});
  }, []);

  const handleTableChange = (tbl: string) => {
    setSelectedTable(tbl);
    const t = tables.find(t2 => t2.table === tbl);
    setColumns(t?.columns || []);
    setDimensions([]); setMetrics([]); setFilters([]); setResult(null); setDrillPath([]);
  };

  const dimCols = columns.filter(c => c.type.includes("char") || c.type.includes("text") || c.type.includes("date"));
  const metricCols = columns.filter(c => c.type.includes("int") || c.type.includes("float") || c.type.includes("numeric") || c.type.includes("double") || c.type.includes("dec"));

  const isDateDim = dimensions[0]?.type?.includes("date") || dimensions[0]?.name?.includes("month") || dimensions[0]?.name?.includes("date");

  // ── Execute (with date drill support) ──
  const executeQuery = useCallback(async () => {
    if (!selectedTable) return;
    setLoading(true);
    try {
      let dimNames = dimensions.map(d => d.name);
      if (isDateDim && drillLevel) {
        const d = dimensions[0].name; dimNames = [];
        if (drillLevel === "year") dimNames = [`EXTRACT(YEAR FROM "${d}"::date)::text || '年' AS "${d}"`];
        else if (drillLevel === "quarter") dimNames = [`EXTRACT(YEAR FROM "${d}"::date)::text || 'Q' || EXTRACT(QUARTER FROM "${d}"::date)::text AS "${d}"`];
        else if (drillLevel === "month") dimNames = [`"${d}"`];
        else if (drillLevel === "day") dimNames = [`DATE("${d}")::text AS "${d}"`];
      }
      const metDefs = metrics.map(m => ({ col: m.name, agg: m.agg, alias: `${m.agg.toLowerCase()}_${m.name}` }));
      const r = await client.post("/bi/engine/query_builder", { table: selectedTable, dimensions: dimNames, metrics: metDefs, filters, limit: 500 });
      setResult(r.data);
    } catch { setResult({ columns: [], rows: [], count: 0, sql: "" }); }
    finally { setLoading(false); }
  }, [selectedTable, dimensions, metrics, filters, drillLevel, isDateDim]);

  // ── Drill Down ──
  const handleDrillDown = useCallback((val: string) => {
    if (!dimensions[0]) return;
    const dimName = dimensions[0].name;
    if (drillPath.includes(val)) return;
    setDrillPath(prev => [...prev, val]);
    setFilters(prev => [...prev, { col: dimName, op: "=", val: `'${val}'` }]);
    setTimeout(executeQuery, 100);
  }, [dimensions, drillPath, executeQuery]);

  const clearDrill = () => {
    setDrillPath([]);
    setFilters(prev => prev.filter(f => !dimensions.some(d => d.name === f.col)));
    setTimeout(executeQuery, 100);
  };

  // ── Chart Option ──
  const chartOption = useMemo(() => {
    if (!result || result.rows.length === 0) return null;
    const dim = dimensions[0]?.name || result.columns[0];
    const met = metrics[0]?.name || result.columns[result.columns.length - 1];
    const xData = result.rows.map((r: any) => String(r[dim] || ""));
    const yData = result.rows.map((r: any) => Number(r[`sum_${met}`] || r[met] || 0));
    if (chartType === "table") return null;
    if (chartType === "pie") return { tooltip: { trigger: "item" }, series: [{ type: "pie", radius: ["40%", "70%"], data: result.rows.map((r: any) => ({ name: String(r[dim] || ""), value: Number(r[`sum_${met}`] || r[met] || 0) })), label: { fontSize: 10 } }] };
    return {
      tooltip: { trigger: "axis" }, grid: { left: 60, right: 20, top: 20, bottom: 40 },
      xAxis: { type: "category", data: xData, axisLabel: { fontSize: 10, rotate: xData.length > 8 ? 30 : 0 } },
      yAxis: { type: "value", axisLabel: { fontSize: 10 } },
      series: [{ data: yData, type: chartType, smooth: chartType === "line", itemStyle: { color: "#6366F1" } }],
    };
  }, [result, chartType]);

  return (
    <DndProvider backend={HTML5Backend}>
      <Box sx={{ display: "flex", height: "100%", gap: 0 }}>
        {/* Left: Field Panel */}
        <Paper sx={{ width: 240, flexShrink: 0, borderRight: "1px solid #EBEDF0", borderRadius: 0, overflow: "auto", p: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom>数据表</Typography>
          <FormControl size="small" fullWidth sx={{ mb: 2 }}>
            <Select value={selectedTable} onChange={e => handleTableChange(e.target.value)} sx={{ fontSize: 12 }}>
              {tables.map(t => <MenuItem key={t.table} value={t.table} sx={{ fontSize: 12 }}>{t.table}</MenuItem>)}
            </Select>
          </FormControl>

          <Typography variant="caption" fontWeight={600} color="#EC4899" sx={{ mb: 0.5, display: "block" }}>维度（拖到 X 轴）</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
            {dimCols.map(c => <DraggableField key={c.name} col={c} color="#EC4899" />)}
          </Box>

          <Typography variant="caption" fontWeight={600} color="#6366F1" sx={{ mb: 0.5, display: "block" }}>指标（拖到 Y 轴）</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
            {metricCols.map(c => <DraggableField key={c.name} col={c} color="#6366F1" />)}
          </Box>

          {/* Agg selector per metric */}
          {metrics.map(m => (
            <Box key={m.name} sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
              <Chip label={m.name} size="small" color="primary" variant="filled" sx={{ fontSize: 10, height: 22 }} />
              <Select size="small" value={m.agg}
                onChange={e => setMetrics(prev => prev.map(p => p.name === m.name ? { ...p, agg: e.target.value } : p))}
                sx={{ fontSize: 11, height: 24, "& .MuiSelect-select": { py: 0.2 } }}>
                {AGG_FUNCS.map(a => <MenuItem key={a} value={a} sx={{ fontSize: 11 }}>{a}</MenuItem>)}
              </Select>
            </Box>
          ))}

          <Button variant="contained" fullWidth startIcon={<RunIcon />}
            onClick={executeQuery} disabled={loading}
            sx={{ mt: 2, borderRadius: 2, textTransform: "none", fontSize: 12, bgcolor: "#6366F1" }}>
            运行查询
          </Button>
        </Paper>

        {/* Center: Drop Zones + Chart */}
        <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", p: 2 }}>
          {/* Drop zones */}
          <Box sx={{ display: "flex", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
            <Box sx={{ flex: 1, minWidth: 150 }}>
              <DropZone accept={ITEM_TYPE} label="X 轴（维度）" color="#EC4899"
                items={dimensions}
                onDrop={col => { if (!dimensions.find(d => d.name === col.name)) setDimensions(prev => [...prev, col]); }}
                onRemove={col => setDimensions(prev => prev.filter(d => d.name !== col.name))} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 150 }}>
              <DropZone accept={ITEM_TYPE} label="Y 轴（指标）" color="#6366F1"
                items={metrics}
                showAgg
                onDrop={col => { if (!metrics.find(m => m.name === col.name)) setMetrics(prev => [...prev, { ...col, agg: "SUM" }]); }}
                onRemove={col => setMetrics(prev => prev.filter(m => m.name !== col.name))} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 150 }}>
              <DropZone accept={ITEM_TYPE} label="筛选条件" color="#F59E0B"
                items={filters.map(f => ({ name: `${f.col} ${f.op} ${f.val}`, type: "filter", col: f.col }))}
                onDrop={col => {
                  const val = prompt(`筛选条件: ${col.name} > ?`);
                  if (val) setFilters(prev => [...prev, { col: col.name, op: ">", val: isNaN(Number(val)) ? `'${val}'` : val }]);
                }}
                onRemove={item => setFilters(prev => prev.filter(f => f.col !== item.col))} />
            </Box>
          </Box>

          {/* AI 自然语言输入 */}
          <Box sx={{ display: "flex", gap: 1, mb: 1.5, alignItems: "center" }}>
            <Paper sx={{ flex: 1, display: "flex", alignItems: "center", px: 1.5, py: 0.5, border: "1px solid #E5E7EB", borderRadius: 2 }}>
              <AIIcon sx={{ color: "#8B5CF6", fontSize: 18, mr: 1 }} />
              <Box component="input" placeholder="自然语言查询，例如：财务总览中收入最高的3个月"
                onKeyDown={(e: any) => {
                  if (e.key === "Enter" && selectedTable) {
                    const val = e.target.value;
                    setLoading(true);
                    client.post("/bi/engine/ai/nl_to_sql", { question: val, table: selectedTable })
                      .then(r => {
                        setResult(r.data);
                        if (r.data?.chart_type) setChartType(r.data.chart_type);
                      }).catch(() => {}).finally(() => setLoading(false));
                  }
                }}
                sx={{ flex: 1, border: "none", outline: "none", fontSize: 13, bgcolor: "transparent", py: 0.5 }} />
            </Paper>
            <Button variant="contained" size="small" onClick={() => {
              const el = document.querySelector("input[placeholder*='自然语言']") as HTMLInputElement;
              if (!el || !selectedTable) return;
              setLoading(true);
              client.post("/bi/engine/ai/nl_to_sql", { question: el.value, table: selectedTable })
                .then(r => { setResult(r.data); if (r.data?.chart_type) setChartType(r.data.chart_type); })
                .catch(() => {}).finally(() => setLoading(false));
            }}
              sx={{ borderRadius: 2, textTransform: "none", fontSize: 12, bgcolor: "#8B5CF6", minWidth: 60 }}>
              查询
            </Button>
          </Box>

          {/* Chart toolbar */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, flexWrap: "wrap" }}>
            {CHART_TYPES.map(ct => (
              <Chip key={ct.key} icon={ct.icon as any} label={ct.label} size="small"
                variant={chartType === ct.key ? "filled" : "outlined"}
                color={chartType === ct.key ? "primary" : "default"}
                onClick={() => setChartType(ct.key)} sx={{ fontSize: 11, cursor: "pointer" }} />
            ))}
            {loading && <CircularProgress size={16} />}
            {drillPath.length > 0 && (
              <Chip label={`下钻: ${drillPath.join(" → ")}`} size="small" color="info" onDelete={clearDrill} sx={{ fontSize: 10 }} />
            )}
            {/* 日期层级下钻 */}
            {isDateDim && (
              <Box sx={{ display: "flex", gap: 0.5, ml: 1 }}>
                {(["year", "quarter", "month", "day"] as const).map(lvl => (
                  <Chip key={lvl} label={lvl === "year" ? "年" : lvl === "quarter" ? "季" : lvl === "month" ? "月" : "日"}
                    size="small" variant={drillLevel === lvl ? "filled" : "outlined"}
                    color={drillLevel === lvl ? "success" : "default"}
                    onClick={() => { setDrillLevel(prev => prev === lvl ? "" : lvl); setDrillPath([]); setTimeout(executeQuery, 50); }}
                    sx={{ fontSize: 10, height: 22, cursor: "pointer" }} />
                ))}
              </Box>
            )}
            <Box sx={{ flex: 1 }} />
            {savedTemplates.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <Select value="" displayEmpty onChange={e => {
                  const r = savedTemplates.find(t => t.id === Number(e.target.value));
                  if (r) { client.get("/bi/engine/filter_templates").then(res => { const all = res.data?.templates || []; const m = all.find((t: any) => t.id === r.id); if (m?.filters) setFilters(typeof m.filters === "string" ? JSON.parse(m.filters) : m.filters); }); }
                }} sx={{ fontSize: 11, "& .MuiSelect-select": { py: 0.5 } }}>
                  <MenuItem value="" disabled sx={{ fontSize: 11 }}>加载筛选模板</MenuItem>
                  {savedTemplates.map(t => <MenuItem key={t.id} value={t.id} sx={{ fontSize: 11 }}>{t.name}</MenuItem>)}
                </Select>
              </FormControl>
            )}
          </Box>

          {/* Result */}
          {result && result.rows.length > 0 && (
            <>
              {chartType !== "table" && chartOption && (
                <Paper sx={{ p: 2, mb: 2, borderRadius: 2, minHeight: 350 }}>
                  <ReactEChartsCore option={chartOption} style={{ height: 350 }}
                    onEvents={{ click: (p: any) => p.name && dimensions[0] && handleDrillDown(String(p.name)) }} />
                </Paper>
              )}
              <Paper sx={{ borderRadius: 2, overflow: "auto", flex: chartType === "table" ? 1 : undefined }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead><tr style={{ background: "#F3F4F6" }}>{result.columns.map(c => <th key={c} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, borderBottom: "1px solid #E5E7EB" }}>{c}</th>)}</tr></thead>
                  <tbody>{result.rows.map((r: any, i: number) => (<tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>{result.columns.map(c => <td key={c} style={{ padding: "6px 12px" }}>{String(r[c] ?? "")}</td>)}</tr>))}</tbody>
                </table>
              </Paper>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, fontFamily: "monospace", fontSize: 10, p: 1, bgcolor: "#F8F9FB", borderRadius: 1 }}>{result.sql}</Typography>
            </>
          )}
          {!result && !loading && (
            <Box sx={{ textAlign: "center", color: "text.secondary", pt: 10 }}>
              <BarChart sx={{ fontSize: 48, color: "#E5E7EB", mb: 1 }} />
              <Typography>拖拽字段到 X/Y 轴，点击「运行查询」</Typography>
            </Box>
          )}
        </Box>
      </Box>
    </DndProvider>
  );
}
