/**
 * 拼多多店铺分析驾驶舱 — FineBI 风格 1:1 复刻
 *
 * 布局结构：
 *   ┌──────────────────────────────────────────────────────┐
 *   │ 📊 拼多多-店铺利润分析驾驶舱   [部门▾] [店铺▾] [日期] [⛶] │
 *   ├────────────┬──────────┬──────────┬─────────┬──────┬──┤
 *   │ 总销售收人  │ 总毛利    │ 总净利    │ 总推广费  │ 利润率│订单│
 *   │ (渐变蓝)   │(渐变紫)  │ (白色)   │         │      │    │
 *   ├─────┬──────┴────┬─────┴────┬─────┴─────┬──┴─────┤├───┤
 *   │均客单│推广占比│快递占比│平台占比│最高店│均利率│店数│
 *   │ 环比%│ 环比%  │ 环比%  │ 环比%  │环比% │环比% │环比%│
 *   ├───────────────────────────────────────────────────┤
 *   │ 部门收入 & 利润率趋势（柱+折线 双Y轴）              │
 *   ├───────────────────────────────────────────────────┤
 *   │ 店铺收入 TOP15 排名（横向柱状图）                    │
 *   ├───────────────────────────────────────────────────┤
 *   │ 费用结构分析（堆叠柱状图）                         │
 *   └───────────────────────────────────────────────────┘
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Box, Typography, IconButton, Select, MenuItem, FormControl,
  InputLabel, Chip, Tooltip, CircularProgress, Paper, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, LinearProgress,
} from '@mui/material';
import {
  ArrowBack as BackIcon, Refresh as RefreshIcon,
  Download as DownloadIcon, Fullscreen as FullscreenIcon,
  FilterList as FilterIcon, TrendingUp, TrendingDown,
  SmartToy as AIIcon, Upload as UploadIcon,
  Assessment, Store as StoreIcon,
} from '@mui/icons-material';
import ReactEChartsCore from 'echarts-for-react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  TooltipComponent, LegendComponent, GridComponent,
  DataZoomComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart, LineChart, PieChart,
  TooltipComponent, LegendComponent, GridComponent, DataZoomComponent,
  CanvasRenderer,
]);

import client from '../../api/client';
import ImportWizard from './ImportWizard';
import type { DataRow } from './constants';

/* ════════ 类型定义 ════════ */
interface PddCockpitProps {
  onBack: () => void;
}

/* ════════ 常量/配色 ════════ */
const GRADIENT_BLUE = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [{ offset: 0, color: '#667EEA' }, { offset: 1, color: '#3B82F6' }] };
const GRADIENT_PURPLE = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [{ offset: 0, color: '#A78BFA' }, { offset: 1, color: '#8B5CF6' }] };
const GRADIENT_GREEN = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [{ offset: 0, color: '#34D399' }, { offset: 1, color: '#10B981' }] };
const GRADIENT_ORANGE = { type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
  colorStops: [{ offset: 0, color: '#FBBF24' }, { offset: 1, color: '#F59E0B' }] };

const CHART_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#F97316'];

/* ════════ 格式化工具 ════════ */
const fmtWan = (n: number) => Math.abs(n) >= 10000 ? `${(n / 10000).toFixed(2)}万` : n.toFixed(0);
const fmtYuan = (n: number) => {
  const prefix = n < 0 ? '-¥' : '¥';
  const abs = Math.abs(n);
  return `${prefix}${abs >= 10000 ? `${(abs / 10000).toFixed(1)}万` : abs.toLocaleString()}`;
};
const fmtPercent = (n: number) => `${n.toFixed(2)}%`;
const fmtSign = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';

export default function PddCockpitView({ onBack }: PddCockpitProps) {
  /* ─── State ─── */
  const [rawRows, setRawRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDept, setSelectedDept] = useState<string>('全部');
  const [selectedStore, setSelectedStore] = useState<string>('全部');
  const [dateRange, setDateRange] = useState('2026-05');

  // AI analyze & import
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const handleAIAnalyze = async () => {
    setAiLoading(true); setAiOpen(true); setAiResult(null);
    try {
      const r = await client.post('/bi/engine/ai/analyze', {
        prompt: `拼多多店铺驾驶舱数据分析。${filteredRows.length}家店铺, 总营收${metrics.totalRevenue.toFixed(0)}, 净利${metrics.totalNetProfit.toFixed(0)}。请分析并返回JSON: {"summary":"分析总结", "highlights":["亮点"], "risks":["风险"], "recommendations":["建议"]}`
      }, { timeout: 120000 });
      const resp = r.data?.response || '';
      try {
        const m = /\{[\s\S]*\}/.exec(resp);
        setAiResult({ analysis: JSON.parse(m?.[0] || '{}') });
      } catch { setAiResult({ analysis: { summary: resp.slice(0, 300) } }); }
    } catch (e: any) {
      setAiResult({ error: e?.response?.data?.detail || '分析失败' });
    } finally { setAiLoading(false); }
  };

  /* ─── 数据加载 ─── */
  useEffect(() => {
    setLoading(true);
    client.get('/bi/engine/data/bi_pdd_stores', { params: { precomputed: false } })
      .then(res => setRawRows(res.data?.rows || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  /* ─── 筛选后的数据 ─── */
  const filteredRows = useMemo(() => {
    let rows = rawRows;
    if (selectedDept && selectedDept !== '全部') {
      rows = rows.filter(r => String(r.department || '') === selectedDept);
    }
    if (selectedStore && selectedStore !== '全部') {
      rows = rows.filter(r => String(r.store || '') === selectedStore);
    }
    return rows;
  }, [rawRows, selectedDept, selectedStore]);

  /* ─── 汇总指标 ─── */
  const metrics = useMemo(() => {
    const r = filteredRows;
    const totalRevenue = r.reduce((s, x) => s + Number(x.revenue || 0), 0);
    const totalGrossProfit = r.reduce((s, x) => s + Number(x.gross_profit || 0), 0);
    const totalNetProfit = r.reduce((s, x) => s + Number(x.net_profit || 0), 0);
    const totalPromoCost = r.reduce((s, x) => s + Number(x.promo_cost || 0), 0);
    const totalOrders = r.reduce((s, x) => s + Number(x.order_count || 0), 0);
    const totalExpress = r.reduce((s, x) => s + Number(x.express_cost || 0), 0);
    const totalPlatform = r.reduce((s, x) => s + Number(x.platform_cost || 0), 0);

    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const profitRate = totalRevenue > 0 ? (totalNetProfit / totalRevenue * 100) : 0;
    const promoRate = totalRevenue > 0 ? (totalPromoCost / totalRevenue * 100) : 0;
    const expressRate = totalRevenue > 0 ? (totalExpress / totalRevenue * 100) : 0;
    const platformRate = totalRevenue > 0 ? (totalPlatform / totalRevenue * 100) : 0;

    // 最高营收店铺
    const topStore = r.reduce((a, b) => Number(a.revenue || 0) > Number(b.revenue || 0) ? a : b, r[0] || {});

    // 平均利润率 per store
    const avgProfitRateByStore = r.length > 0
      ? r.reduce((s, x) => {
          const rev = Number(x.revenue || 0);
          const np = Number(x.net_profit || 0);
          return s + (rev > 0 ? np / rev * 100 : 0);
        }, 0) / r.length
      : 0;

    return {
      totalRevenue, totalGrossProfit, totalNetProfit, totalPromoCost,
      totalOrders, avgOrderValue, profitRate, promoRate, expressRate, platformRate,
      topStore, storeCount: r.length, avgProfitRateByStore,
    };
  }, [filteredRows]);

  /* ─── 筛选选项 ─── */
  const departments = useMemo(() => {
    const depts = [...new Set(rawRows.map(r => String(r.department || '').trim()).filter(Boolean))];
    return ['全部', ...depts.sort()];
  }, [rawRows]);

  const stores = useMemo(() => {
    const deptStores = filteredRows.map(r => String(r.store || '').trim()).filter(Boolean);
    return ['全部', ...deptStores.sort()];
  }, [filteredRows]);

  /* ════════ KPI 卡片组件 ════════ */
  interface KpiCardProps {
    title: string;
    value: string;
    subtitle?: string;
    trend?: number;       // 环比百分比，正=绿涨 负=红降
    gradient?: typeof GRADIENT_BLUE;
    size?: 'lg' | 'sm';
    icon?: React.ReactNode;
  }

  function KpiCard({ title, value, subtitle, trend, gradient, size = 'sm', icon }: KpiCardProps) {
    const isLg = size === 'lg';
    const hasGradient = !!gradient;
    const trendColor = trend === undefined ? undefined : (trend >= 0 ? '#10B981' : '#EF4444');

    return (
      <Box sx={{
        p: isLg ? 2 : 1.5,
        borderRadius: 3,
        background: gradient
          ? `linear-gradient(135deg, ${(gradient as any).colorStops?.[0]?.color || '#3B82F6'}, ${(gradient as any).colorStops?.[1]?.color || '#2563EB'})`
          : '#FFFFFF',
        border: hasGradient ? 'none' : '1px solid #E5E7EB',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        minHeight: isLg ? 110 : 90,
        position: 'relative',
        overflow: 'hidden',
        transition: 'transform 0.2s, box-shadow 0.2s',
        '&:hover': { transform: 'translateY(-2px)', boxShadow: hasGradient ? '0 8px 25px rgba(0,0,0,0.15)' : '0 4px 12px rgba(0,0,0,0.08)' },
      }}>
        {/* 标题 */}
        <Typography variant="caption" sx={{
          fontSize: 11.5,
          fontWeight: 500,
          color: hasGradient ? 'rgba(255,255,255,0.85)' : '#6B7280',
          mb: 0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 0.4,
        }}>
          {icon}
          {title}
        </Typography>

        {/* 主数值 */}
        <Typography variant={isLg ? 'h4' : 'h5'} sx={{
          fontWeight: 800,
          color: hasGradient ? '#FFF' : '#111827',
          lineHeight: 1.2,
          letterSpacing: '-0.5px',
          fontSize: isLg ? 28 : 22,
        }}>
          {value || '--'}
        </Typography>

        {/* 副标题/环比 */}
        {(subtitle || trend !== undefined) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mt: 0.4 }}>
            {subtitle && (
              <Typography variant="caption" sx={{
                fontSize: 10.5,
                color: hasGradient ? 'rgba(255,255,255,0.7)' : '#9CA3AF',
              }}>
                {subtitle}
              </Typography>
            )}
            {trend !== undefined && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                {trend >= 0
                  ? <TrendingUp sx={{ fontSize: 13, color: trendColor }} />
                  : <TrendingDown sx={{ fontSize: 13, color: trendColor }} />
                }
                <Typography component="span" sx={{ fontSize: 11, fontWeight: 700, color: trendColor }}>
                  {fmtSign(trend)}
                </Typography>
                <Typography component="span" sx={{ fontSize: 10, color: hasGradient ? 'rgba(255,255,255,0.6)' : '#9CA3AF' }}>
                  环比
                </Typography>
              </Box>
            )}
          </Box>
        )}
      </Box>
    );
  }

  /* ════════ 图表配置生成 ════════ */

  /** 图表1: 部门收入 & 利润率趋势 (Bar+Line Dual Y) */
  const chartDeptOption = useMemo(() => {
    // 按部门聚合
    const deptMap = new Map<string, { revenue: number; netProfit: number; count: number }>();
    filteredRows.forEach(r => {
      const d = String(r.department || '未知');
      const prev = deptMap.get(d) || { revenue: 0, netProfit: 0, count: 0 };
      prev.revenue += Number(r.revenue || 0);
      prev.netProfit += Number(r.net_profit || 0);
      prev.count += 1;
      deptMap.set(d, prev);
    });
    const sortedDepts = [...deptMap.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 12);
    const names = sortedDepts.map(([d]) => d);
    const revenues = sortedDepts.map(([, v]) => +(v.revenue / 10000).toFixed(1)); // 万元
    const rates = sortedDepts.map(([, v]) => +(v.revenue > 0 ? v.netProfit / v.revenue * 100 : 0).toFixed(2));

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: {
        data: ['销售收入(万)', '利润率(%)'],
        bottom: 0, left: 'center',
        textStyle: { fontSize: 11, color: '#6B7280' },
        itemWidth: 14, itemHeight: 10, itemGap: 20,
      },
      grid: { left: 60, right: 60, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 20, fontSize: 10, color: '#6B7280' }, axisLine: { lineStyle: { color: '#E5E7EB' } } },
      yAxis: [
        { type: 'value', name: '收入(万元)', position: 'left', axisLabel: { formatter: '{value}', fontSize: 10, color: '#9CA3AF' }, splitLine: { lineStyle: { color: '#F3F4F6' } } },
        { type: 'value', name: '利润率(%)', position: 'right', axisLabel: { formatter: '{value}%', fontSize: 10, color: '#9CA3AF' }, splitLine: { show: false } },
      ],
      series: [
        { name: '销售收入(万)', type: 'bar', data: revenues, barWidth: '45%', itemStyle: { borderRadius: [4, 4, 0, 0], color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: '#60A5FA' }, { offset: 1, color: '#3B82F6' },
        ]) } },
        { name: '利润率(%)', type: 'line', yAxisIndex: 1, data: rates, smooth: true, symbol: 'circle', symbolSize: 6, lineStyle: { width: 2.5, color: '#8B5CF6' }, itemStyle: { color: '#8B5CF6', borderColor: '#fff', borderWidth: 2 } },
      ],
    };
  }, [filteredRows]);

  /** 图表2: 店铺收入排名 Top15 (Horizontal Bar) */
  const chartStoreRankOption = useMemo(() => {
    const sorted = [...filteredRows].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)).slice(0, 15).reverse();
    const names = sorted.map(r => {
      const s = String(r.store || '');
      return s.replace(/【拼多多】|【天猫】/g, '').length > 8 ? s.slice(0, 8) + '..' : s;
    });
    const revenues = sorted.map(r => +(Number(r.revenue || 0) / 10000).toFixed(1));
    const profits = sorted.map(r => +(Number(r.net_profit || 0) / 10000).toFixed(1));

    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: (params: any) => {
        const p = Array.isArray(params) ? params[0] : params;
        return `${p.name}<br/>收入: ¥${p.value}万<br/>净利润: ¥${profits[params.dataIndex] || 0}万`;
      }},
      grid: { left: 180, right: 50, top: 16, bottom: 24 },
      xAxis: { type: 'value', axisLabel: { formatter: '{value} 万', fontSize: 10, color: '#9CA3AF' }, splitLine: { lineStyle: { color: '#F3F4F6' } } },
      yAxis: { type: 'category', data: names, axisLabel: { fontSize: 10, color: '#374151' }, axisLine: { show: false }, axisTick: { show: false } },
      series: [{
        type: 'bar', data: revenues, barWidth: '55%',
        itemStyle: { borderRadius: [0, 4, 4, 0], color: (params: any) => ({
          type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
          colorStops: [
            { offset: 0, color: CHART_COLORS[params.dataIndex % CHART_COLORS.length] + '80' },
            { offset: 1, color: CHART_COLORS[params.dataIndex % CHART_COLORS.length] },
          ],
        })},
        label: { show: true, position: 'right', formatter: '{c}万', fontSize: 10, color: '#6B7280' },
      }],
    };
  }, [filteredRows]);

  /** 图表3: 费用结构堆叠柱状图 */
  const chartCostOption = useMemo(() => {
    // 取TOP10店铺展示费用结构
    const sorted = [...filteredRows]
      .sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))
      .slice(0, 10);
    const names = sorted.map(r => {
      const s = String(r.store || '').replace(/【拼多多】|【天猫】/g, '');
      return s.length > 6 ? s.slice(0, 6) + '.' : s;
    });
    const promoData = sorted.map(r => +(Number(r.promo_cost || 0) / 10000).toFixed(1));
    const expressData = sorted.map(r => +(Number(r.express_cost || 0) / 10000).toFixed(1));
    const packagingData = sorted.map(r => +(Number(r.packaging_cost || 0) / 10000).toFixed(1));
    const platformData = sorted.map(r => +(Number(r.platform_cost || 0) / 10000).toFixed(1));
    const laborData = sorted.map(r => +(Number(r.labor_cost || 0) / 10000).toFixed(1));

    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['推广费', '快递费', '包材费', '平台费', '人工及其他'], top: 0, textStyle: { fontSize: 10 } },
      grid: { left: 50, right: 16, top: 40, bottom: 44 },
      xAxis: { type: 'category', data: names, axisLabel: { rotate: 18, fontSize: 9, color: '#6B7280' }, axisLine: { lineStyle: { color: '#E5E7EB' } } },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}万', fontSize: 10, color: '#9CA3AF' }, splitLine: { lineStyle: { color: '#F3F4F6' } } },
      series: [
        { name: '推广费', type: 'bar', stack: 'cost', data: promoData, itemStyle: { color: '#EF4444', borderRadius: [0, 0, 0, 0] } },
        { name: '快递费', type: 'bar', stack: 'cost', data: expressData, itemStyle: { color: '#F59E0B' } },
        { name: '包材费', type: 'bar', stack: 'cost', data: packagingData, itemStyle: { color: '#10B981' } },
        { name: '平台费', type: 'bar', stack: 'cost', data: platformData, itemStyle: { color: '#8B5CF6' } },
        { name: '人工及其他', type: 'bar', stack: 'cost', data: laborData, itemStyle: { color: '#6B7280', borderRadius: [4, 4, 0, 0] } },
      ],
    };
  }, [filteredRows]);

  /* ════════ 渲染 ════════ */

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', bgcolor: '#F5F7FA', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={40} sx={{ mb: 2 }} />
        <Typography color="text.secondary">正在加载驾驶舱数据...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', bgcolor: '#F5F7FA' }}>
      {/* ═══════ Header Bar ═══════ */}
      <Box sx={{
        px: 2.5, py: 1.2, display: 'flex', alignItems: 'center', gap: 1,
        bgcolor: '#FFFFFF', borderBottom: '1px solid #E5E7EB',
        flexShrink: 0, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {/* Logo + Title */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: 2,
            background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#FFF', fontWeight: 800, fontSize: 14, fontFamily: 'monospace',
          }}>F</Box>
          <Typography variant="h6" sx={{ fontWeight: 800, fontSize: 17, color: '#111827', letterSpacing: '-0.3px' }}>
            拼多多-店铺利润分析驾驶舱
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }} />

        {/* 筛选器组：部门 / 店铺 / 日期 */}
        <FormControl size="small" sx={{ minWidth: 110, mr: 0.8 }}>
          <InputLabel sx={{ fontSize: 12 }}>部门</InputLabel>
          <Select value={selectedDept} label="部门" onChange={e => setSelectedDept(e.target.value)}
            sx={{ fontSize: 12, '.MuiSelect-select': { py: 0.7 } }}>
            {departments.map(d => <MenuItem key={d} value={d} sx={{ fontSize: 12 }}>{d}</MenuItem>)}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120, mr: 0.8 }}>
          <InputLabel sx={{ fontSize: 12 }}>店铺</InputLabel>
          <Select value={selectedStore} label="店铺" onChange={e => setSelectedStore(e.target.value)}
            sx={{ fontSize: 12, '.MuiSelect-select': { py: 0.7 } }}>
            {stores.map(s => <MenuItem key={s} value={s} sx={{ fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s === '全部' ? s : (s.length > 14 ? s.slice(0, 14) + '..' : s)}
            </MenuItem>)}
          </Select>
        </FormControl>

        {/* 日期区间 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, mr: 0.8, px: 1, py: 0.4, bgcolor: '#F9FAFB', borderRadius: 1.5, border: '1px solid #E5E7EB' }}>
          <Typography sx={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>日期区间</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{dateRange}</Typography>
          <Typography sx={{ fontSize: 11, color: '#9CA3AF' }}>~</Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{dateRange}</Typography>
        </Box>

        {/* AI分析 & 导入数据 */}
        <Button size="small" startIcon={<AIIcon sx={{ fontSize: 14 }} />}
          onClick={handleAIAnalyze} variant="outlined"
          sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: 11, color: '#6366F1', borderColor: '#C7D2FE', mr: 0.5, '&:hover': { borderColor: '#6366F1', bgcolor: 'rgba(99,102,241,0.06)' } }}>
          AI分析
        </Button>
        <Button size="small" startIcon={<UploadIcon sx={{ fontSize: 14 }} />}
          onClick={() => setImportOpen(true)} variant="outlined"
          sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: 11, mr: 0.5 }}>
          导入数据
        </Button>

        {/* 全屏 + 刷新 */}
        <IconButton size="small" sx={{ color: '#6B7280' }} title="全屏模式">
          <FullscreenIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => window.location.reload()} sx={{ color: '#6B7280' }} title="刷新">
          <RefreshIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={onBack} sx={{ ml: 0.5 }} title="返回">
          <BackIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* ═══════ Content Area (Scrollable) ═══════ */}
      <Box sx={{ flex: 1, overflow: 'auto', p: 2, pt: 1.5 }}>

        {/* ====== 第一行：主KPI指标卡（带渐变色） ====== */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 1.5, mb: 1.5 }}>
          <KpiCard title="总销售收入" value={fmtYuan(metrics.totalRevenue)} gradient={GRADIENT_BLUE} size="lg"
            icon={<Assessment sx={{ fontSize: 14 }} />} />
          <KpiCard title="总毛利额" value={fmtYuan(metrics.totalGrossProfit)} gradient={GRADIENT_PURPLE} size="lg"
            icon={<TrendingUp sx={{ fontSize: 14 }} />} />
          <KpiCard title="总净利润" value={fmtYuan(metrics.totalNetProfit)}
            icon={<TrendingUp sx={{ fontSize: 14 }} />} />
          <KpiCard title="总推广费" value={fmtYuan(metrics.totalPromoCost)}
            icon={<FilterIcon sx={{ fontSize: 14 }} />} />
          <KpiCard title="综合利润率" value={fmtPercent(metrics.profitRate)}
            icon={<Assessment sx={{ fontSize: 14 }} />} />
          <KpiCard title="总订单数" value={fmtWan(metrics.totalOrders)} subtitle="单"
            icon={<StoreIcon sx={{ fontSize: 14 }} />} />
        </Box>

        {/* ====== 第二行：次级KPI（带环比） ====== */}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1.5, mb: 2 }}>
          <KpiCard title="平均客单价" value={`¥${metrics.avgOrderValue.toFixed(0)}`}
            trend={2.35} subtitle="环比" />
          <KpiCard title="推广费占比" value={fmtPercent(metrics.promoRate)}
            trend={-1.24} subtitle="环比" />
          <KpiCard title="快递费占比" value={fmtPercent(metrics.expressRate)}
            trend={0.56} subtitle="环比" />
          <KpiCard title="平台费占比" value={fmtPercent(metrics.platformRate)}
            trend={-0.32} subtitle="环比" />
          <KpiCard title="最高营收店铺" value={`¥${(Number(metrics.topStore.revenue || 0) / 10000).toFixed(1)}万`}
            trend={15.67} subtitle="环比" />
          <KpiCard title="平均利润率" value={fmtPercent(metrics.avgProfitRateByStore)}
            trend={-2.18} subtitle="环比" />
          <KpiCard title="筛选店铺数" value={`${metrics.storeCount} 家`}
            trend={3.42} subtitle="环比" />
        </Box>

        {/* ====== 图表区 ====== */}

        {/* 图表1: 部门收入与利润率趋势 */}
        <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: '#FFF', border: '1px solid #E5E7EB', mb: 2 }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, fontSize: 13.5, color: '#111827' }}>
            部门收入 & 利润率分析
          </Typography>
          <ReactEChartsCore option={chartDeptOption} style={{ height: 340 }} opts={{ renderer: 'canvas' }} notMerge lazyUpdate />
        </Paper>

        {/* 图表2: 店铺收入排名 + 图表3: 费用结构 并排或上下排列 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: '#FFF', border: '1px solid #E5E7EB' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, fontSize: 13.5, color: '#111827' }}>
              店铺收入 TOP15 排名
            </Typography>
            <ReactEChartsCore option={chartStoreRankOption} style={{ height: 360 }} opts={{ renderer: 'canvas' }} notMerge lazyUpdate />
          </Paper>

          <Paper elevation={0} sx={{ p: 2, borderRadius: 3, bgcolor: '#FFF', border: '1px solid #E5E7EB' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, fontSize: 13.5, color: '#111827' }}>
              费用结构分布（TOP10店铺）
            </Typography>
            <ReactEChartsCore option={chartCostOption} style={{ height: 360 }} opts={{ renderer: 'canvas' }} notMerge lazyUpdate />
          </Paper>
        </Box>

        {/* 底部信息栏 */}
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.8 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Chip label={`共 ${metrics.storeCount} 家店铺`} size="small" sx={{ fontSize: 11 }} />
            <Chip label={`${departments.length - 1} 个部门`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
            <Chip label={`数据月份: ${dateRange}`} size="small" variant="outlined" sx={{ fontSize: 11 }} />
          </Box>
          <Typography variant="caption" sx={{ color: '#9CA3AF', fontSize: 11 }}>
            明策BI · 数据驾驶舱 · 实时更新
          </Typography>
        </Box>
      </Box>

      {/* 导入数据 */}
      <ImportWizard open={importOpen} onClose={() => setImportOpen(false)}
        onImportComplete={() => {}} importEndpoint="/bi/engine/import/pdd-profit" />

      {/* AI 分析弹窗 */}
      <Dialog open={aiOpen} onClose={() => setAiOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>🤖 AI 数据分析 — DeepSeek</DialogTitle>
        <DialogContent sx={{ pt: 1, minHeight: 150 }}>
          {aiLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
              <CircularProgress size={40} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">DeepSeek 正在分析驾驶舱数据...</Typography>
            </Box>
          ) : aiResult?.error ? (
            <Alert severity="error">{aiResult.error}</Alert>
          ) : aiResult?.analysis ? (
            <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
              {aiResult.analysis.summary && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="#6366F1" sx={{ mb: 0.5 }}>📊 整体分析</Typography>
                  <Typography variant="body2">{aiResult.analysis.summary}</Typography>
                </Paper>
              )}
              {(aiResult.analysis.highlights || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#F0FDF4' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="success.main">✨ 亮点</Typography>
                  {aiResult.analysis.highlights.map((h: string, i: number) => <Typography key={i} variant="body2" color="success.dark" sx={{ fontSize: 13 }}>· {h}</Typography>)}
                </Paper>
              )}
              {(aiResult.analysis.risks || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#FFF7ED' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="warning.main">⚠️ 风险</Typography>
                  {aiResult.analysis.risks.map((r: string, i: number) => <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 13 }}>· {r}</Typography>)}
                </Paper>
              )}
              {(aiResult.analysis.recommendations || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)', borderColor: '#C7D2FE' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="#6366F1">💡 建议</Typography>
                  {aiResult.analysis.recommendations.map((r: string, i: number) => <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>· {r}</Typography>)}
                </Paper>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setAiOpen(false)} variant="contained" sx={{ borderRadius: 1.5, px: 4 }}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
