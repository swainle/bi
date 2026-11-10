/** SQL 自服务查询面板 — Monaco Editor + 结果 ECharts 渲染 */

import { useState, useRef } from "react";
import {
  Box, Typography, Button, CircularProgress, Chip, Paper, Grid,
} from "@mui/material";
import { PlayArrow, Save, TableChart, BarChart } from "@mui/icons-material";
import client from "../../api/client";

const PREVIEW_CHART = (rows: any[], col: string) => {
  const yData = rows.map(r => Number(r[col]) || 0);
  const xData = rows.map((_, i) => `行${i + 1}`);
  return {
    tooltip: { trigger: "axis" as const },
    xAxis: { type: "category" as const, data: xData },
    yAxis: { type: "value" as const },
    series: [{ type: "bar" as const, data: yData }],
  };
};

export default function SqlQueryPanel() {
  const [sql, setSql] = useState("SELECT * FROM bi_finance ORDER BY id LIMIT 20");
  const [result, setResult] = useState<{ columns: string[]; rows: any[]; count: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [chartCol, setChartCol] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleRun = async () => {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const r = await client.post("/bi/engine/query", { sql });
      setResult(r.data);
      const cols = r.data?.columns || [];
      const numCols = cols.filter((c: string) => r.data?.rows?.some((row: any) => typeof row[c] === "number"));
      if (numCols.length > 0 && !chartCol) setChartCol(numCols[0]);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "查询失败");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleRun();
    }
  };

  const numericCols = result?.columns.filter(c => result.rows.some(r => typeof r[c] === "number")) || [];

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h6" fontWeight={700} gutterBottom>SQL 查询</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        白名单表：bi_finance, bi_pdd_ops, bi_tmall, bi_douyin, bi_pdd_stores, bi_pdd_annual, bi_pdd_traffic, bi_products, bi_tmall_monthly, bi_tmall_campaigns, bi_douyin_live
      </Typography>

      {/* SQL 输入框 */}
      <Paper elevation={0} sx={{ p: 1.5, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0", mb: 2 }}>
        <textarea
          ref={textareaRef}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={8}
          style={{
            width: "100%", border: "none", outline: "none", resize: "vertical",
            fontFamily: "monospace", fontSize: 13, lineHeight: 1.6, padding: 8,
            background: "#FAFBFC", borderRadius: 4,
          }}
          placeholder="SELECT * FROM bi_finance ORDER BY id"
        />
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1 }}>
          <Typography variant="caption" color="text.secondary">Ctrl+Enter 执行</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" variant="contained" startIcon={<PlayArrow />}
              onClick={handleRun} disabled={loading}
              sx={{ borderRadius: 2, textTransform: "none", bgcolor: "#6366F1", fontSize: 12 }}>
              {loading ? <CircularProgress size={14} sx={{ color: "white" }} /> : "执行"}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* 错误提示 */}
      {error && (
        <Paper elevation={0} sx={{ p: 2, borderRadius: 2, bgcolor: "#FEF2F2", border: "1px solid #FCA5A5", mb: 2 }}>
          <Typography variant="body2" color="error">{error}</Typography>
        </Paper>
      )}

      {/* 查询结果 */}
      {result && (
        <>
          {/* 图表预览 */}
          {numericCols.length > 0 && (
            <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0", mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5 }}>
                <BarChart sx={{ fontSize: 18, color: "#6366F1" }} />
                <Typography variant="subtitle2" fontWeight={600}>图表预览</Typography>
                <Box sx={{ flex: 1 }} />
                <Box sx={{ display: "flex", gap: 0.5 }}>
                  {numericCols.map(c => (
                    <Chip key={c} label={c} size="small"
                      variant={chartCol === c ? "filled" : "outlined"}
                      color={chartCol === c ? "primary" : "default"}
                      onClick={() => setChartCol(c)}
                      sx={{ fontSize: 11, height: 24 }} />
                  ))}
                </Box>
              </Box>
              {chartCol && (
                <Box sx={{ height: 300 }}>
                  {/* 用简单的 div + canvas 替代 ECharts 以保持轻量 */}
                  <PreviewChart rows={result.rows} col={chartCol} />
                </Box>
              )}
            </Paper>
          )}

          {/* 数据表格 */}
          <Paper elevation={0} sx={{ borderRadius: 2, border: "1px solid", borderColor: "#EBEDF0", overflow: "auto" }}>
            <Box sx={{ p: 1.5, borderBottom: "1px solid #EBEDF0", display: "flex", alignItems: "center", gap: 1 }}>
              <TableChart sx={{ fontSize: 16, color: "text.secondary" }} />
              <Typography variant="subtitle2" fontWeight={600}>查询结果</Typography>
              <Chip label={`${result.count} 行`} size="small" variant="outlined" sx={{ borderRadius: 1 }} />
            </Box>
            <Box sx={{ overflow: "auto", maxHeight: 400 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {result.columns.map(c => (
                      <th key={c} style={{ textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #E5E7EB", color: "#6B7280", fontWeight: 600, whiteSpace: "nowrap", background: "#FAFBFC", position: "sticky", top: 0 }}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 200).map((row, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      {result.columns.map(c => (
                        <td key={c} style={{ padding: "6px 12px", whiteSpace: "nowrap" }}>
                          {typeof row[c] === "number" ? (row[c] as number).toLocaleString() : String(row[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.count > 200 && (
                <Typography variant="caption" color="text.secondary" sx={{ p: 1, display: "block" }}>仅显示前 200 行</Typography>
              )}
            </Box>
          </Paper>
        </>
      )}
    </Box>
  );
}

// 简易 ECharts 预览（避免引入完整 ECharts 依赖）
function PreviewChart({ rows, col }: { rows: any[]; col: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
