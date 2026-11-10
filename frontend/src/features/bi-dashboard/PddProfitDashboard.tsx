/**
 * 拼多多店铺利润看板 — 1:1 复刻 HTML 设计稿
 *
 * 结构：
 *   Header (深色渐变) → 5 KPI Cards → 4 Nav Tabs
 *   ├─ 概览: 4 Insight Cards + 6 ECharts + Cost Flow
 *   ├─ 负责人: Person Cards Grid
 *   ├─ 店铺明细: Filterable Sortable Table
 *   └─ 亏损店铺: Loss Summary + Table
 *   Modal: 店铺/负责人详情弹窗
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Box, Typography, IconButton, Select, MenuItem, FormControl,
  InputLabel, Chip, Tooltip, CircularProgress, Paper, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, TextField, Dialog, DialogTitle, DialogContent,
  DialogActions, Button, useTheme, LinearProgress, Stepper, Step, StepLabel,
} from '@mui/material';
import {
  ArrowBack as BackIcon, Refresh as RefreshIcon,
  Download as DownloadIcon, Fullscreen as FullscreenIcon,
  Upload as UploadIcon, SmartToy as AIIcon,
} from '@mui/icons-material';
import ReactEChartsCore from 'echarts-for-react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart } from 'echarts/charts';
import {
  TooltipComponent, LegendComponent, GridComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, PieChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);

import client from '../../api/client';
import ImportWizard from './ImportWizard';

/* ════════ Types ════════ */
interface ProfitRow {
  id: number;
  person: string;
  store: string;
  revenue: number;
  positive_rev: number;
  refund: number;
  special_rev: number;
  positive_orders: number;
  reverse_orders: number;
  postage_income: number;
  cost: number;
  product_cost: number;
  gift_cost: number;
  special_cost: number;
  damage: number;
  gross: number;
  gross_rate: number;
  logistics: number;
  express: number;
  other_logistics: number;
  promo: number;
  product_promo: number;
  wujie_promo: number;
  platform_fee: number;
  platform_commission: number;
  labor: number;
  op_labor: number;
  alloc_labor: number;
  other_expense: number;
  rent: number;
  utility: number;
  admin_alloc: number;
  other_income: number;
  net_profit: number;
  net_rate: number;
  data_month: string;
  is_loss: boolean;
}

interface PersonAgg {
  name: string;
  stores: number;
  revenue: number;
  cost: number;
  gross: number;
  promo: number;
  logistics: number;
  labor: number;
  platform_fee: number;
  net_profit: number;
  other_expense: number;
  other_income: number;
  refund: number;
  positive_orders: number;
  gross_rate: number;
  net_rate: number;
}

interface PddProfitDashboardProps {
  onBack: () => void;
}

/* ════════ Constants ════════ */
const COLORS = ['#3b5bff', '#22c55e', '#f59e0b', '#ef4444', '#7c5cff', '#06b6d4', '#ec4899', '#6366f1', '#84cc16', '#f97316', '#8b5cf6', '#14b8a6', '#e11d48', '#0ea5e9', '#a855f7', '#64748b', '#10b981'];

/* ════════ Formatters ════════ */
const fmt = (v: number | null | undefined): string => {
  if (v == null || isNaN(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmt0 = (v: number | null | undefined): string => v == null ? '—' : Math.round(v).toLocaleString('zh-CN');
const fmtPct = (v: number | null | undefined): string => v == null ? '—' : (v * 100).toFixed(2) + '%';
const fmtFull = (v: number | null | undefined): string => v == null ? '—' : v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const shortStore = (s: string): string =>
  s.replace(/【拼多多】/, '').replace(/【天猫】/, '').replace(/宠物用品店$/, '').replace(/宠物食品旗舰店$/, '').replace(/宠物用品大店$/, '').replace(/宠物用品旗舰店$/, '').replace(/宠物用品官方旗舰店$/, '').replace(/宠物生活专营店$/, '').replace(/宠物生活馆$/, '').replace(/旗舰店$/, '');

/* ════════ Component ════════ */
export default function PddProfitDashboard({ onBack }: PddProfitDashboardProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const [rows, setRows] = useState<ProfitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'persons' | 'stores' | 'loss'>('overview');
  const [modalStore, setModalStore] = useState<ProfitRow | null>(null);
  const [modalPerson, setModalPerson] = useState<PersonAgg | null>(null);

  // Import state
  const [importOpen, setImportOpen] = useState(false);

  // AI 分析
  const [aiAnalyzeOpen, setAiAnalyzeOpen] = useState(false);
  const [aiAnalyzeResult, setAiAnalyzeResult] = useState<any>(null);
  const [aiAnalyzeLoading, setAiAnalyzeLoading] = useState(false);

  const handleAIAnalyze = async () => {
    setAiAnalyzeLoading(true);
    setAiAnalyzeOpen(true);
    setAiAnalyzeResult(null);
    try {
      const r = await client.post('/bi/engine/import/pdd-profit/ai-analyze', null, {
        params: { data_month: rows[0]?.data_month || '2026-05' },
        timeout: 120000,
      });
      setAiAnalyzeResult(r.data);
    } catch (e: any) {
      setAiAnalyzeResult({ error: e?.response?.data?.detail || 'AI分析失败' });
    } finally {
      setAiAnalyzeLoading(false);
    }
  };

  const handleImportComplete = (result: any) => {
    // 导入完成后刷新数据（绕过缓存）
    client.get('/bi/engine/data/bi_pdd_profit', { params: { precomputed: false, cache: false } })
      .then(r2 => setRows(r2.data?.rows || []))
      .catch(() => {});
  };

  // Table state
  const [sortKey, setSortKey] = useState<string>('revenue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [personFilter, setPersonFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [lossFilter, setLossFilter] = useState('');

  // Chart refs
  const chartPersonRef = useRef<ReactEChartsCore>(null);
  const chartCostRef = useRef<ReactEChartsCore>(null);
  const chartStoreRef = useRef<ReactEChartsCore>(null);
  const chartDistRef = useRef<ReactEChartsCore>(null);
  const chartRateRef = useRef<ReactEChartsCore>(null);

  /* ─── Load Data ─── */
  useEffect(() => {
    (async () => {
      try {
        const r = await client.get('/bi/engine/data/bi_pdd_profit', { params: { precomputed: false, cache: false } });
        setRows(r.data?.rows || []);
      } catch (e) {
        console.error('Failed to load profit data', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ─── Aggregations ─── */
  const persons = useMemo<PersonAgg[]>(() => {
    const map = new Map<string, PersonAgg>();
    for (const r of rows) {
      const name = r.person || '未分配';
      if (!map.has(name)) {
        map.set(name, {
          name, stores: 0, revenue: 0, cost: 0, gross: 0, promo: 0,
          logistics: 0, labor: 0, platform_fee: 0, net_profit: 0,
          other_expense: 0, other_income: 0, refund: 0, positive_orders: 0,
          gross_rate: 0, net_rate: 0,
        });
      }
      const p = map.get(name)!;
      p.stores++;
      p.revenue += r.revenue;
      p.cost += r.cost;
      p.gross += r.gross;
      p.promo += r.promo;
      p.logistics += r.logistics;
      p.labor += r.labor;
      p.platform_fee += r.platform_fee;
      p.net_profit += r.net_profit;
      p.other_expense += r.other_expense;
      p.other_income += r.other_income;
      p.refund += r.refund;
      p.positive_orders += r.positive_orders;
    }
    const arr = Array.from(map.values());
    for (const p of arr) {
      p.gross_rate = p.revenue > 0 ? p.gross / p.revenue : 0;
      p.net_rate = p.revenue > 0 ? p.net_profit / p.revenue : 0;
    }
    return arr.sort((a, b) => b.revenue - a.revenue);
  }, [rows]);

  const lossStores = useMemo(() => rows.filter(r => r.is_loss || r.net_profit < 0), [rows]);

  const totals = useMemo(() => {
    const t = {
      revenue: 0, positive_rev: 0, refund: 0, positive_orders: 0,
      cost: 0, gross: 0, logistics: 0, promo: 0, platform_fee: 0,
      labor: 0, other_expense: 0, other_income: 0, damage: 0,
      net_profit: 0, gross_rate: 0, net_rate: 0,
    };
    for (const r of rows) {
      t.revenue += r.revenue;
      t.positive_rev += r.positive_rev;
      t.refund += r.refund;
      t.positive_orders += r.positive_orders;
      t.cost += r.cost;
      t.gross += r.gross;
      t.logistics += r.logistics;
      t.promo += r.promo;
      t.platform_fee += r.platform_fee;
      t.labor += r.labor;
      t.other_expense += r.other_expense;
      t.other_income += r.other_income;
      t.damage += r.damage;
      t.net_profit += r.net_profit;
    }
    t.gross_rate = t.revenue > 0 ? t.gross / t.revenue : 0;
    t.net_rate = t.revenue > 0 ? t.net_profit / t.revenue : 0;
    return t;
  }, [rows]);

  /* ─── Filtered + Sorted Table Data ─── */
  const filteredStores = useMemo(() => {
    let filtered = rows.filter(s => {
      if (personFilter && (s.person || '未分配') !== personFilter) return false;
      if (searchText && !s.store.toLowerCase().includes(searchText.toLowerCase())) return false;
      if (lossFilter === 'loss' && s.net_profit >= 0) return false;
      if (lossFilter === 'profit' && s.net_profit < 0) return false;
      return true;
    });
    filtered.sort((a: any, b: any) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') return sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === 'asc' ? va - vb : vb - va;
    });
    return filtered;
  }, [rows, personFilter, searchText, lossFilter, sortKey, sortDir]);

  /* ─── Handlers ─── */
  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  /* ─── Chart Options ─── */
  const cardBg = isDark ? '#1e1e2e' : '#ffffff';
  const textCol = isDark ? '#e2e8f0' : '#1e293b';
  const textSub = isDark ? '#94a3b8' : '#64748b';
  const textMuted = isDark ? '#64748b' : '#94a3b8';
  const borderCol = isDark ? 'rgba(255,255,255,0.08)' : '#e8ecf1';
  const gridCol = isDark ? 'rgba(255,255,255,0.05)' : '#f1f5f9';
  const bgCol = isDark ? '#0f0f1a' : '#f5f6fa';

  // Person Bar Chart
  const personChartOption = useMemo(() => {
    const top = persons.slice(0, 10);
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          let s = params[0].name + '<br/>';
          params.forEach(p => { s += `${p.marker} ${p.seriesName}: ${fmtFull(p.value)}<br/>`; });
          return s;
        },
      },
      legend: { top: 0, textStyle: { fontSize: 12, color: textSub } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: top.map(p => p.name), axisLabel: { fontSize: 12, color: textSub } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11, color: textSub, formatter: (v: number) => fmt(v) }, splitLine: { lineStyle: { color: gridCol } } },
      series: [
        { name: '销售收入', type: 'bar', data: top.map(p => p.revenue), itemStyle: { color: '#3b5bff', borderRadius: [4, 4, 0, 0] } },
        { name: '净利润', type: 'bar', data: top.map(p => p.net_profit), itemStyle: { color: '#f59e0b', borderRadius: [4, 4, 0, 0] } },
      ],
    };
  }, [persons, textSub, gridCol]);

  // Cost Doughnut
  const costChartOption = useMemo(() => ({
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `${p.name}: ${fmtFull(p.value)} (${p.percent}%)`,
    },
    legend: { orient: 'vertical', right: 10, top: 'center', textStyle: { fontSize: 12, color: textSub } },
    series: [{
      type: 'pie', radius: ['40%', '70%'], center: ['35%', '50%'],
      data: [
        { name: '销售成本', value: totals.cost, itemStyle: { color: '#3b5bff' } },
        { name: '运营推广', value: totals.promo, itemStyle: { color: '#f59e0b' } },
        { name: '仓库物流', value: totals.logistics, itemStyle: { color: '#22c55e' } },
        { name: '人工成本', value: totals.labor, itemStyle: { color: '#7c5cff' } },
        { name: '平台费用', value: totals.platform_fee, itemStyle: { color: '#06b6d4' } },
        { name: '其它费用', value: totals.other_expense, itemStyle: { color: '#ef4444' } },
        { name: '货损', value: totals.damage, itemStyle: { color: '#94a3b8' } },
      ],
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
    }],
  }), [totals, textSub]);

  // Store Top 20 Bar
  const storeChartOption = useMemo(() => {
    const top = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
    return {
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          const idx = params[0].dataIndex;
          const s = top[idx];
          return [s.store, `收入: ${fmtFull(s.revenue)}`, `净利: ${fmtFull(s.net_profit)}`, `净利率: ${fmtPct(s.net_rate)}`].join('<br/>');
        },
      },
      grid: { left: '3%', right: '6%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value', axisLabel: { fontSize: 11, color: textSub, formatter: (v: number) => fmt(v) }, splitLine: { lineStyle: { color: gridCol } } },
      yAxis: { type: 'category', data: top.map(s => shortStore(s.store)).reverse(), axisLabel: { fontSize: 11, color: textSub } },
      series: [{
        type: 'bar', data: top.map(s => s.revenue).reverse(),
        itemStyle: { color: (p: any) => top[top.length - 1 - p.dataIndex].net_profit < 0 ? '#ef4444' : '#3b5bff', borderRadius: [0, 3, 3, 0] },
      }],
    };
  }, [rows, textSub, gridCol]);

  // Profit Distribution
  const distChartOption = useMemo(() => {
    const buckets = [
      { label: '亏损', min: -1e18, max: 0, color: '#ef4444' },
      { label: '0-1万', min: 0, max: 1e4, color: '#fbbf24' },
      { label: '1-3万', min: 1e4, max: 3e4, color: '#fcd34d' },
      { label: '3-5万', min: 3e4, max: 5e4, color: '#86efac' },
      { label: '5-8万', min: 5e4, max: 8e4, color: '#22c55e' },
      { label: '8万+', min: 8e4, max: 1e18, color: '#15803d' },
    ];
    return {
      tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}: ${p[0].value} 家` },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: buckets.map(b => b.label), axisLabel: { fontSize: 12, color: textSub } },
      yAxis: { type: 'value', axisLabel: { fontSize: 12, color: textSub, formatter: (v: number) => v + '家' }, splitLine: { lineStyle: { color: gridCol } } },
      series: [{
        type: 'bar', data: buckets.map(b => ({ value: rows.filter(s => s.net_profit >= b.min && s.net_profit < b.max).length, itemStyle: { color: b.color, borderRadius: [4, 4, 0, 0] } })),
      }],
    };
  }, [rows, textSub, gridCol]);

  // Rate Comparison
  const rateChartOption = useMemo(() => {
    const top = persons.slice(0, 12);
    return {
      tooltip: { trigger: 'axis', formatter: (p: any[]) => p.map(x => `${x.marker} ${x.seriesName}: ${x.value.toFixed(2)}%`).join('<br/>') },
      legend: { top: 0, textStyle: { fontSize: 12, color: textSub } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: top.map(p => p.name), axisLabel: { fontSize: 11, color: textSub } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11, color: textSub, formatter: (v: number) => v.toFixed(0) + '%' }, splitLine: { lineStyle: { color: gridCol } } },
      series: [
        { name: '毛利率', type: 'bar', data: top.map(p => (p.gross_rate * 100).toFixed(2)), itemStyle: { color: '#22c55e', borderRadius: [3, 3, 0, 0] } },
        { name: '净利率', type: 'bar', data: top.map(p => (p.net_rate * 100).toFixed(2)), itemStyle: { color: '#f59e0b', borderRadius: [3, 3, 0, 0] } },
      ],
    };
  }, [persons, textSub, gridCol]);

  /* ─── Cost Flow Data ─── */
  const costFlowData = useMemo(() => [
    { label: '销售收入', val: totals.revenue, color: '#3b5bff', isBase: true },
    { label: '销售成本', val: -totals.cost, color: '#6366f1' },
    { label: '运营推广', val: -totals.promo, color: '#f59e0b' },
    { label: '仓库物流', val: -totals.logistics, color: '#22c55e' },
    { label: '人工成本', val: -totals.labor, color: '#7c5cff' },
    { label: '平台费用', val: -totals.platform_fee, color: '#06b6d4' },
    { label: '其它费用', val: -totals.other_expense, color: '#ef4444' },
    { label: '其它收入', val: totals.other_income, color: '#84cc16' },
    { label: '净利润', val: totals.net_profit, color: '#f59e0b', isFinal: true },
  ], [totals]);

  const maxAbs = Math.max(...costFlowData.map(d => Math.abs(d.val)));

  /* ─── Loading ─── */
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  /* ════════ Render ════════ */
  return (
    <Box sx={{ bgcolor: bgCol, minHeight: '100vh' }}>
      {/* ─── Header ─── */}
      <Box sx={{
        background: 'linear-gradient(135deg, #101625 0%, #1a1f35 100%)',
        position: 'relative', overflow: 'hidden',
        '&::after': {
          content: '""', position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 80% 50%, rgba(59,91,255,0.08) 0%, transparent 60%)',
          pointerEvents: 'none',
        },
      }}>
        <Box sx={{
          maxWidth: "none", mx: 'auto', px: 3, py: 2.5,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'relative', zIndex: 1,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <IconButton onClick={onBack} sx={{ color: 'rgba(255,255,255,0.6)' }}>
              <BackIcon />
            </IconButton>
            <Typography variant="h5" sx={{ color: '#fff', fontWeight: 700, letterSpacing: '0.5px', fontSize: 22 }}>
              拼多多店铺利润看板
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 2.5, fontSize: 12, color: 'rgba(255,255,255,0.55)', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#3b5bff' }} />
              口径：发货
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#3b5bff' }} />
              数据月份：{rows[0]?.data_month || '2026-05'}
            </Box>
            <Button
              size="small"
              startIcon={<AIIcon sx={{ fontSize: 14, color: '#6366F1' }} />}
              onClick={handleAIAnalyze}
              sx={{
                color: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.25)',
                fontSize: 12, textTransform: 'none',
                '&:hover': { borderColor: 'rgba(99,102,241,0.5)', bgcolor: 'rgba(99,102,241,0.1)' },
              }}
              variant="outlined"
            >
              AI分析
            </Button>
            <Button
              size="small"
              startIcon={<UploadIcon />}
              onClick={() => setImportOpen(true)}
              sx={{
                color: 'rgba(255,255,255,0.9)', borderColor: 'rgba(255,255,255,0.25)',
                fontSize: 12, textTransform: 'none', ml: 1,
                '&:hover': { borderColor: 'rgba(255,255,255,0.5)', bgcolor: 'rgba(255,255,255,0.08)' },
              }}
              variant="outlined"
            >
              导入数据
            </Button>
          </Box>
        </Box>
      </Box>

      {/* ─── KPI Cards ─── */}
      <Box sx={{ maxWidth: "none", mx: 'auto', px: 3, py: 2.5, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1.75 }}>
        {[
          { label: '销售收入', value: fmt(totals.revenue), sub: `${fmt0(totals.positive_orders)} 单正向订单`, cls: 'rev', color: '#3b5bff', bg: 'rgba(59,91,255,0.1)' },
          { label: '毛利', value: fmt(totals.gross), sub: `毛利率 ${fmtPct(totals.gross_rate)}`, cls: 'gross', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
          { label: '净利润', value: fmt(totals.net_profit), sub: `净利润率 ${fmtPct(totals.net_rate)}`, cls: 'net', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
          { label: '活跃店铺', value: rows.length + ' 家', sub: `${persons.length} 位负责人`, cls: 'stores', color: '#7c5cff', bg: 'rgba(124,92,255,0.1)' },
          { label: '亏损店铺', value: lossStores.length + ' 家', sub: `亏损 ${fmt(lossStores.reduce((s, x) => s + x.net_profit, 0))}`, cls: 'loss', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
        ].map((k, i) => (
          <Paper
            key={i}
            onClick={() => setActiveTab(k.cls === 'loss' ? 'loss' : k.cls === 'rev' || k.cls === 'stores' ? 'stores' : 'overview')}
            sx={{
              p: 2.25, cursor: 'pointer', border: `1px solid ${borderCol}`, borderRadius: 3,
              bgcolor: cardBg, transition: 'all 0.2s',
              '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' },
            }}
          >
            <Box sx={{
              width: 36, height: 36, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, fontWeight: 700, bgcolor: k.bg, color: k.color, mb: 1.5,
            }}>
              {k.label[0]}
            </Box>
            <Typography sx={{ fontSize: 12, color: textMuted, mb: 0.5, fontWeight: 500 }}>{k.label}</Typography>
            <Typography sx={{ fontSize: 24, fontWeight: 700, color: k.color, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
              {k.value}
            </Typography>
            <Typography sx={{ fontSize: 11, color: textMuted, mt: 0.5 }}>{k.sub}</Typography>
          </Paper>
        ))}
      </Box>

      {/* ─── Nav Tabs ─── */}
      <Box sx={{ maxWidth: "none", mx: 'auto', px: 3, borderBottom: `1px solid ${borderCol}` }}>
        {[
          { key: 'overview', label: '概览' },
          { key: 'persons', label: '负责人' },
          { key: 'stores', label: '店铺明细' },
          { key: 'loss', label: '亏损店铺' },
        ].map(t => (
          <Box
            key={t.key}
            component="button"
            onClick={() => setActiveTab(t.key as any)}
            sx={{
              px: 3, py: 1.5, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              color: activeTab === t.key ? '#3b5bff' : textSub,
              borderBottom: activeTab === t.key ? '2px solid #3b5bff' : '2px solid transparent',
              bgcolor: 'transparent', border: 'none', borderBottomWidth: 2,
              borderBottomStyle: 'solid', borderBottomColor: activeTab === t.key ? '#3b5bff' : 'transparent',
              transition: 'all 0.15s', borderRadius: '6px 6px 0 0',
              '&:hover': { color: '#3b5bff', bgcolor: 'rgba(59,91,255,0.05)' },
            }}
          >
            {t.label}
          </Box>
        ))}
      </Box>

      {/* ─── Main Content ─── */}
      <Box sx={{ maxWidth: "none", mx: 'auto', px: 3, py: 2.5, pb: 5 }}>
        {/* ═══ Overview Tab ═══ */}
        {activeTab === 'overview' && (
          <Box>
            {/* Insight Cards */}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.75, mb: 2.25 }}>
              {[
                { label: '净利润率', val: fmtPct(totals.net_rate), desc: '净利润 / 销售收入', color: '#22c55e', border: '#22c55e' },
                { label: '推广费占比', val: fmtPct(totals.promo / totals.revenue), desc: '推广费 / 销售收入', color: '#f59e0b', border: '#f59e0b' },
                { label: '客单价', val: '¥' + (totals.revenue / totals.positive_orders).toFixed(2), desc: '销售收入 / 正向订单', color: '#3b5bff', border: '#3b5bff' },
                { label: '退款率', val: fmtPct(totals.refund / totals.positive_rev), desc: '退款 / 正向销售收入', color: '#ef4444', border: '#ef4444' },
              ].map((c, i) => (
                <Paper key={i} sx={{ p: 2, borderLeft: `3px solid ${c.border}`, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, borderLeftWidth: 3, borderLeftColor: c.border }}>
                  <Typography sx={{ fontSize: 12, color: textMuted, fontWeight: 600, mb: 1, textTransform: 'uppercase', letterSpacing: '0.3px' }}>{c.label}</Typography>
                  <Typography sx={{ fontSize: 22, fontWeight: 700, color: c.color, fontVariantNumeric: 'tabular-nums', mb: 0.5 }}>{c.val}</Typography>
                  <Typography sx={{ fontSize: 12, color: textMuted }}>{c.desc}</Typography>
                </Paper>
              ))}
            </Box>

            {/* Charts Row 1 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.75, mb: 1.75 }}>
              <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                  负责人收入 vs 净利润 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>Top 10</Box>
                </Typography>
                <ReactEChartsCore ref={chartPersonRef} echarts={echarts} option={personChartOption} style={{ height: 360 }} />
              </Paper>
              <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                  成本费用结构 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>占收入比</Box>
                </Typography>
                <ReactEChartsCore ref={chartCostRef} echarts={echarts} option={costChartOption} style={{ height: 360 }} />
              </Paper>
            </Box>

            {/* Cost Flow */}
            <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, mb: 1.75 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 1.5, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                收入到净利润 资金流 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>蓝=流入 橙=流出</Box>
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.875 }}>
                {costFlowData.map((d, i) => {
                  const pct = (Math.abs(d.val) / maxAbs) * 100;
                  const sign = d.val >= 0 ? '+' : '';
                  return (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ width: 120, fontSize: 13, color: textSub, textAlign: 'right', flexShrink: 0, fontWeight: 500 }}>{d.label}</Box>
                      <Box sx={{ flex: 1, height: 24, bgcolor: bgCol, borderRadius: 1, overflow: 'hidden', position: 'relative' }}>
                        <Box sx={{
                          height: '100%', borderRadius: 1, display: 'flex', alignItems: 'center', pl: 1.25,
                          color: '#fff', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
                          width: `${pct}%`, bgcolor: d.color, transition: 'width 0.4s',
                        }}>
                          {pct > 15 ? sign + fmt(d.val) : ''}
                        </Box>
                      </Box>
                      <Box sx={{ width: 110, fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right', flexShrink: 0, color: d.isBase || d.isFinal ? d.color : textCol }}>
                        {sign + fmtFull(d.val)}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Paper>

            {/* Store Top 20 */}
            <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, mb: 1.75 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                Top 20 店铺收入排名 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>点击查看详情</Box>
              </Typography>
              <ReactEChartsCore
                ref={chartStoreRef}
                echarts={echarts}
                option={storeChartOption}
                style={{ height: 400 }}
                onEvents={{ click: (params: any) => {
                  const top = [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 20);
                  const reversed = top.reverse();
                  const s = reversed[params.dataIndex];
                  if (s) setModalStore(s);
                }}}
              />
            </Paper>

            {/* Charts Row 2 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.75 }}>
              <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                  净利润分布 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>按区间</Box>
                </Typography>
                <ReactEChartsCore ref={chartDistRef} echarts={echarts} option={distChartOption} style={{ height: 320 }} />
              </Paper>
              <Paper sx={{ p: 2.25, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                  毛利率 vs 净利率 <Box component="span" sx={{ fontSize: 11, fontWeight: 500, color: textMuted, bgcolor: bgCol, px: 1.25, py: 0.4, borderRadius: 1.5 }}>按负责人</Box>
                </Typography>
                <ReactEChartsCore ref={chartRateRef} echarts={echarts} option={rateChartOption} style={{ height: 320 }} />
              </Paper>
            </Box>
          </Box>
        )}

        {/* ═══ Persons Tab ═══ */}
        {activeTab === 'persons' && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 1.75 }}>
            {persons.map((p, i) => {
              const isLoss = p.net_profit < 0;
              const color = COLORS[i % COLORS.length];
              const maxRev = persons[0]?.revenue || 1;
              const barPct = (p.revenue / maxRev) * 100;
              return (
                <Paper
                  key={i}
                  onClick={() => setModalPerson(p)}
                  sx={{
                    p: 2, cursor: 'pointer', bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3,
                    borderTop: `3px solid ${isLoss ? '#ef4444' : color}`,
                    transition: 'all 0.2s',
                    '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 16px rgba(0,0,0,0.08)' },
                  }}
                >
                  <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 0.75, display: 'flex', justifyContent: 'space-between', color: textCol }}>
                    {p.name}
                    <Box component="span" sx={{ fontSize: 11, color: textMuted, fontWeight: 500, bgcolor: bgCol, px: 1, py: 0.4, borderRadius: 1.25 }}>{p.stores}家店</Box>
                  </Typography>
                  {[
                    { label: '销售收入', val: fmtFull(p.revenue) },
                    { label: '毛利', val: `${fmtFull(p.gross)} (${fmtPct(p.gross_rate)})` },
                    { label: '推广费', val: fmtFull(p.promo) },
                    { label: '人工成本', val: fmtFull(p.labor) },
                    { label: '净利润', val: `${fmtFull(p.net_profit)} (${fmtPct(p.net_rate)})`, color: isLoss ? '#ef4444' : '#22c55e' },
                  ].map((row, j) => (
                    <Box key={j} sx={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, py: 0.25, color: textSub }}>
                      <span>{row.label}</span>
                      <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: row.color || textCol }}>{row.val}</Box>
                    </Box>
                  ))}
                  <Box sx={{ height: 4, bgcolor: bgCol, borderRadius: 0.5, mt: 1, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', borderRadius: 0.5, width: `${barPct}%`, bgcolor: isLoss ? '#ef4444' : color, transition: 'width 0.3s' }} />
                  </Box>
                </Paper>
              );
            })}
          </Box>
        )}

        {/* ═══ Stores Tab ═══ */}
        {activeTab === 'stores' && (
          <Paper sx={{ bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, overflow: 'hidden' }}>
            {/* Toolbar */}
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${borderCol}`, flexWrap: 'wrap', gap: 1.25 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: textCol }}>
                店铺明细（共 {filteredStores.length} 家）
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <Select
                    value={personFilter}
                    onChange={e => setPersonFilter(e.target.value)}
                    displayEmpty
                    sx={{ fontSize: 13 }}
                  >
                    <MenuItem value="">全部负责人</MenuItem>
                    {persons.map(p => (
                      <MenuItem key={p.name} value={p.name}>{p.name} ({p.stores}店)</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  size="small" placeholder="搜索店铺名…"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                  sx={{ width: 180, fontSize: 13 }}
                />
                <FormControl size="small" sx={{ minWidth: 120 }}>
                  <Select
                    value={lossFilter}
                    onChange={e => setLossFilter(e.target.value)}
                    displayEmpty
                    sx={{ fontSize: 13 }}
                  >
                    <MenuItem value="">全部店铺</MenuItem>
                    <MenuItem value="loss">仅亏损</MenuItem>
                    <MenuItem value="profit">仅盈利</MenuItem>
                  </Select>
                </FormControl>
              </Box>
            </Box>

            {/* Table */}
            <TableContainer sx={{ maxHeight: 560 }}>
              <Table stickyHeader size="small" sx={{ fontSize: 13 }}>
                <TableHead>
                  <TableRow>
                    {[
                      { label: '排名', key: 'rank', center: true, width: 50 },
                      { label: '负责人', key: 'person' },
                      { label: '店铺名称', key: 'store' },
                      { label: '销售收入', key: 'revenue', right: true },
                      { label: '订单数', key: 'positive_orders', right: true },
                      { label: '销售成本', key: 'cost', right: true },
                      { label: '毛利', key: 'gross', right: true },
                      { label: '毛利率', key: 'gross_rate', right: true },
                      { label: '推广费', key: 'promo', right: true },
                      { label: '人工成本', key: 'labor', right: true },
                      { label: '净利润', key: 'net_profit', right: true },
                      { label: '净利率', key: 'net_rate', right: true },
                    ].map(col => (
                      <TableCell
                        key={col.key}
                        sortDirection={sortKey === col.key ? sortDir : false}
                        sx={{
                          fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.3px',
                          color: textSub, bgcolor: isDark ? '#1a1a2e' : '#fafbfc',
                          whiteSpace: 'nowrap', cursor: 'pointer',
                          textAlign: col.center ? 'center' : col.right ? 'right' : 'left',
                          width: col.width,
                        }}
                        onClick={() => col.key !== 'rank' && handleSort(col.key)}
                      >
                        {col.key !== 'rank' ? (
                          <TableSortLabel active={sortKey === col.key} direction={sortDir as any} sx={{ '& .MuiTableSortLabel-icon': { opacity: 0.5 } }}>
                            {col.label}
                          </TableSortLabel>
                        ) : col.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredStores.map((s, idx) => {
                    const rank = rows.indexOf(s) + 1;
                    const isLoss = s.net_profit < 0;
                    const pi = persons.findIndex(p => p.name === (s.person || '未分配'));
                    const pc = COLORS[pi % COLORS.length];
                    return (
                      <TableRow
                        key={s.id}
                        hover
                        onClick={() => setModalStore(s)}
                        sx={{
                          cursor: 'pointer',
                          bgcolor: isLoss ? (isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)') : 'transparent',
                          '&:hover': { bgcolor: isLoss ? (isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)') : (isDark ? 'rgba(59,91,255,0.08)' : 'rgba(59,91,255,0.04)') },
                        }}
                      >
                        <TableCell sx={{ textAlign: 'center', width: 50 }}>
                          <Box sx={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                            bgcolor: rank === 1 ? '#fbbf24' : rank === 2 ? '#d1d5db' : rank === 3 ? '#d97706' : (isDark ? '#374151' : '#e5e7eb'),
                            color: rank <= 3 ? (rank === 3 ? '#fff' : rank === 1 ? '#78350f' : '#374151') : (isDark ? '#9ca3af' : '#6b7280'),
                          }}>
                            {rank}
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Box component="span" sx={{ display: 'inline-block', px: 1.25, py: 0.4, borderRadius: 1.25, fontSize: 11, fontWeight: 600, bgcolor: `${pc}1a`, color: pc }}>
                            {s.person || '未分配'}
                          </Box>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.store}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.revenue)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt0(s.positive_orders)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.cost)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.gross)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(s.gross_rate)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.promo)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.labor)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: isLoss ? '#ef4444' : '#22c55e', fontWeight: 600 }}>{fmtFull(s.net_profit)}</TableCell>
                        <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: isLoss ? '#ef4444' : 'inherit' }}>{fmtPct(s.net_rate)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        )}

        {/* ═══ Loss Tab ═══ */}
        {activeTab === 'loss' && (
          <Box>
            {/* Loss Summary */}
            <Box sx={{ display: 'flex', gap: 1.75, mb: 1.75, flexWrap: 'wrap' }}>
              {[
                { label: '亏损店铺数', val: lossStores.length + ' 家' },
                { label: '亏损总额', val: fmtFull(lossStores.reduce((s, x) => s + x.net_profit, 0)) },
                { label: '亏损店铺收入', val: fmtFull(lossStores.reduce((s, x) => s + x.revenue, 0)) },
              ].map((s, i) => (
                <Paper key={i} sx={{ p: 1.75, bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, borderTop: '3px solid #ef4444', minWidth: 160 }}>
                  <Typography sx={{ fontSize: 12, color: textMuted, mb: 0.5, fontWeight: 500 }}>{s.label}</Typography>
                  <Typography sx={{ fontSize: 20, fontWeight: 700, color: '#ef4444', fontVariantNumeric: 'tabular-nums' }}>{s.val}</Typography>
                </Paper>
              ))}
            </Box>

            {/* Loss Table */}
            <Paper sx={{ bgcolor: cardBg, border: `1px solid ${borderCol}`, borderRadius: 3, overflow: 'hidden' }}>
              <Box sx={{ p: 2, borderBottom: `1px solid ${borderCol}` }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700, color: textCol }}>亏损店铺明细</Typography>
              </Box>
              <TableContainer sx={{ maxHeight: 560 }}>
                <Table stickyHeader size="small">
                  <TableHead>
                    <TableRow>
                      {['排名', '负责人', '店铺名称', '销售收入', '毛利', '毛利率', '推广费', '推广占收入', '人工成本', '人工占收入', '净利润', '净利率'].map((h, i) => (
                        <TableCell key={i} sx={{
                          fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.3px',
                          color: textSub, bgcolor: isDark ? '#1a1a2e' : '#fafbfc',
                          textAlign: i === 0 ? 'center' : i >= 3 ? 'right' : 'left',
                        }}>{h}</TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {lossStores.map((s, i) => {
                      const pr = s.revenue > 0 ? s.promo / s.revenue : 0;
                      const lr = s.revenue > 0 ? s.labor / s.revenue : 0;
                      return (
                        <TableRow
                          key={s.id}
                          hover
                          onClick={() => setModalStore(s)}
                          sx={{
                            cursor: 'pointer',
                            bgcolor: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.04)',
                            '&:hover': { bgcolor: isDark ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.08)' },
                          }}
                        >
                          <TableCell sx={{ textAlign: 'center' }}>{i + 1}</TableCell>
                          <TableCell>{s.person || '未分配'}</TableCell>
                          <TableCell sx={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.store}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.revenue)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.gross)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtPct(s.gross_rate)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.promo)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#ef4444' }}>{fmtPct(pr)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtFull(s.labor)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#ef4444' }}>{fmtPct(lr)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#ef4444', fontWeight: 600 }}>{fmtFull(s.net_profit)}</TableCell>
                          <TableCell sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#ef4444' }}>{fmtPct(s.net_rate)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Box>
        )}
      </Box>

      {/* ─── Store Modal ─── */}
      <Dialog
        open={!!modalStore}
        onClose={() => setModalStore(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2, maxWidth: 540 } }}
      >
        {modalStore && (
          <>
            <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
              {modalStore.store}
              <Typography sx={{ fontSize: 13, color: textMuted, mt: 0.5, fontWeight: 400 }}>
                负责人：{modalStore.person || '未分配'}  |  排名：第{rows.indexOf(modalStore) + 1}名
              </Typography>
            </DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', mt: 1 }}>
                {[
                  ['销售收入', fmtFull(modalStore.revenue)],
                  ['正向订单', fmt0(modalStore.positive_orders) + ' 单'],
                  ['退款金额', fmtFull(modalStore.refund)],
                  ['退款率', modalStore.positive_rev > 0 ? fmtPct(modalStore.refund / modalStore.positive_rev) : '—'],
                  ['销售成本', fmtFull(modalStore.cost)],
                  ['毛利', fmtFull(modalStore.gross)],
                  ['毛利率', fmtPct(modalStore.gross_rate)],
                  ['快递费', fmtFull(modalStore.express)],
                  ['仓库物流', fmtFull(modalStore.logistics)],
                  ['运营推广', fmtFull(modalStore.promo)],
                  ['推广占收入', modalStore.revenue > 0 ? fmtPct(modalStore.promo / modalStore.revenue) : '—'],
                  ['平台费用', fmtFull(modalStore.platform_fee)],
                  ['人工成本', fmtFull(modalStore.labor)],
                  ['其它费用', fmtFull(modalStore.other_expense)],
                  ['其它收入', fmtFull(modalStore.other_income)],
                  ['净利润', fmtFull(modalStore.net_profit)],
                  ['净利润率', fmtPct(modalStore.net_rate)],
                ].map(([label, val], i) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.875, borderBottom: `1px solid ${borderCol}`, fontSize: 13 }}>
                    <Box component="span" sx={{ color: textSub }}>{label}</Box>
                    <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: textCol }}>{val}</Box>
                  </Box>
                ))}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setModalStore(null)} variant="contained" fullWidth sx={{ borderRadius: 1, fontWeight: 600 }}>
                关闭
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      {/* ─── Person Modal ─── */}
      <Dialog
        open={!!modalPerson}
        onClose={() => setModalPerson(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2, maxWidth: 540 } }}
      >
        {modalPerson && (() => {
          const p = modalPerson;
          const pStores = rows.filter(s => (s.person || '未分配') === p.name).sort((a, b) => b.revenue - a.revenue);
          const items: [string, string][] = [
            ['销售收入', fmtFull(p.revenue)],
            ['退款金额', fmtFull(p.refund)],
            ['销售成本', fmtFull(p.cost)],
            ['毛利', fmtFull(p.gross)],
            ['毛利率', fmtPct(p.gross_rate)],
            ['仓库物流', fmtFull(p.logistics)],
            ['运营推广', fmtFull(p.promo)],
            ['推广占收入', p.revenue > 0 ? fmtPct(p.promo / p.revenue) : '—'],
            ['平台费用', fmtFull(p.platform_fee)],
            ['人工成本', fmtFull(p.labor)],
            ['其它费用', fmtFull(p.other_expense)],
            ['其它收入', fmtFull(p.other_income)],
            ['净利润', fmtFull(p.net_profit)],
            ['净利润率', fmtPct(p.net_rate)],
          ];
          return (
            <>
              <DialogTitle sx={{ fontSize: 18, fontWeight: 700 }}>
                {p.name}（{p.stores}家店）
                <Typography sx={{ fontSize: 13, color: textMuted, mt: 0.5, fontWeight: 400 }}>
                  负责店铺：{pStores.map(s => shortStore(s.store)).join('、')}
                </Typography>
              </DialogTitle>
              <DialogContent>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 24px', mt: 1 }}>
                  {items.map(([label, val], i) => (
                    <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.875, borderBottom: `1px solid ${borderCol}`, fontSize: 13 }}>
                      <Box component="span" sx={{ color: textSub }}>{label}</Box>
                      <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: textCol }}>{val}</Box>
                    </Box>
                  ))}
                  <Box sx={{ gridColumn: '1 / -1', mt: 1.25, fontSize: 13, fontWeight: 600, color: '#3b5bff', borderBottom: '2px solid rgba(59,91,255,0.1)', pb: 0.75 }}>
                    店铺明细（收入 / 净利）
                  </Box>
                  {pStores.map(s => (
                    <Box key={s.id} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.875, borderBottom: `1px solid ${borderCol}`, fontSize: 13 }}>
                      <Box component="span" sx={{ color: textSub }}>{shortStore(s.store)}</Box>
                      <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: textCol }}>{fmtFull(s.revenue)} / {fmtFull(s.net_profit)}</Box>
                    </Box>
                  ))}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setModalPerson(null)} variant="contained" fullWidth sx={{ borderRadius: 1, fontWeight: 600 }}>
                  关闭
                </Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      {/* ─── AI 导入向导 ─── */}
      <ImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImportComplete={handleImportComplete}
        importEndpoint="/bi/engine/import/pdd-profit"
        dataMonth={rows[0]?.data_month || '2026-05'}
      />

      {/* ─── AI 分析弹窗 ─── */}
      <Dialog open={aiAnalyzeOpen} onClose={() => setAiAnalyzeOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { borderRadius: 3 } }}>
        <DialogTitle sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          🤖 AI 数据分析 — DeepSeek
        </DialogTitle>
        <DialogContent sx={{ pt: 1, minHeight: 200 }}>
          {aiAnalyzeLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 6 }}>
              <CircularProgress size={40} sx={{ mb: 2 }} />
              <Typography variant="body2" color="text.secondary">DeepSeek 正在分析 {rows.length} 家店铺数据...</Typography>
            </Box>
          ) : aiAnalyzeResult?.error ? (
            <Alert severity="error">{aiAnalyzeResult.error}</Alert>
          ) : aiAnalyzeResult?.ai_analysis ? (
            <Box sx={{ maxHeight: 450, overflow: 'auto' }}>
              <Alert severity="info" sx={{ mb: 2, fontSize: 13 }}>
                {aiAnalyzeResult.data_summary}
              </Alert>
              <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)' }}>
                <Typography variant="subtitle2" fontWeight={700} color="#6366F1" sx={{ mb: 1 }}>📊 整体分析</Typography>
                <Typography variant="body2" sx={{ lineHeight: 1.8 }}>{aiAnalyzeResult.ai_analysis.summary}</Typography>
              </Paper>
              {(aiAnalyzeResult.ai_analysis.highlights || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#F0FDF4' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="success.main" sx={{ mb: 0.5 }}>✨ 亮点</Typography>
                  {aiAnalyzeResult.ai_analysis.highlights.map((h: string, i: number) => (
                    <Typography key={i} variant="body2" color="success.dark" sx={{ fontSize: 13 }}>· {h}</Typography>
                  ))}
                </Paper>
              )}
              {(aiAnalyzeResult.ai_analysis.risks || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2, bgcolor: '#FFF7ED' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="warning.main" sx={{ mb: 0.5 }}>⚠️ 风险预警</Typography>
                  {aiAnalyzeResult.ai_analysis.risks.map((r: string, i: number) => (
                    <Typography key={i} variant="body2" color="warning.dark" sx={{ fontSize: 13 }}>· {r}</Typography>
                  ))}
                </Paper>
              )}
              {aiAnalyzeResult.ai_analysis.cost_analysis && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>💰 成本结构</Typography>
                  <Typography variant="body2" color="text.secondary">{aiAnalyzeResult.ai_analysis.cost_analysis}</Typography>
                </Paper>
              )}
              {aiAnalyzeResult.ai_analysis.profit_trend && (
                <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, borderRadius: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>📈 利润趋势</Typography>
                  <Typography variant="body2" color="text.secondary">{aiAnalyzeResult.ai_analysis.profit_trend}</Typography>
                </Paper>
              )}
              {(aiAnalyzeResult.ai_analysis.actions || []).length > 0 && (
                <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(99,102,241,0.03)', borderColor: '#C7D2FE' }}>
                  <Typography variant="subtitle2" fontWeight={700} color="#6366F1" sx={{ mb: 0.5 }}>💡 行动建议</Typography>
                  {aiAnalyzeResult.ai_analysis.actions.map((a: string, i: number) => (
                    <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>· {a}</Typography>
                  ))}
                </Paper>
              )}
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setAiAnalyzeOpen(false)} variant="contained" sx={{ borderRadius: 1.5, px: 4 }}>关闭</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
