/**
 * 明策BI — 看板编辑设计器 (墨刀风格)
 *
 * 墨刀经典布局：深色顶栏 | 左侧组件面板 | 中央画布(带标尺) | 右侧属性面板 | 底部状态栏
 * 基于 @dnd-kit 自由拖拽画布
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, IconButton, Button, Chip, Paper,
  TextField, Select, MenuItem, FormControl, InputLabel,
  Tooltip, Snackbar, Alert,
  Dialog, DialogTitle, CircularProgress,
} from '@mui/material';
import {
  ArrowBack as BackIcon, Save as SaveIcon, Delete as DelIcon,
  ContentCopy, Visibility, Edit, Undo, Redo,
  BarChart, ShowChart, PieChart, PieChartOutline, TableChart, Radar, FilterList,
  Numbers, TextFields, Dashboard, Add,
  DonutLarge, ScatterPlot, WaterfallChart, CandlestickChart,
  GridOn, Cloud, ViewStream, LinearScale, Speed,
  AutoGraph, MultilineChart, StackedBarChart, StackedLineChart,
  BubbleChart, PivotTableChart, TableView, LineAxis,
  InsertChart, ViewAgenda, AccountTree, DonutSmall,
} from '@mui/icons-material';
import client from '../api/client';
import BIEditorCanvas from '../features/bi-dashboard/BIEditorCanvas';
import { LayerPanel, type DesignCard } from '../features/bi-dashboard/LayerPanel';
import TipTapInline from '../features/bi-dashboard/TipTapInline';

/* ═══════ Types ═══════ */
interface CardLayout { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number; }
interface EditorCard {
  cardId: string; title: string; chartType: string;
  datasetId?: string; layout: CardLayout; chartConfig?: any;
}

/* ═══════ Constants ═══════ */
const CHART_TYPES = [
  { value: 'bar', label: '基础柱状图', icon: BarChart, color: '#3B82F6', defaultW: 4, defaultH: 3, category: '柱形图' },
  { value: 'bar_stack', label: '堆叠柱状图', icon: StackedBarChart, color: '#3B82F6', defaultW: 4, defaultH: 3, category: '柱形图' },
  { value: 'bar_group', label: '分组柱状图', icon: InsertChart, color: '#3B82F6', defaultW: 4, defaultH: 3, category: '柱形图' },
  { value: 'waterfall', label: '瀑布图', icon: WaterfallChart, color: '#3B82F6', defaultW: 4, defaultH: 3, category: '柱形图' },
  { value: 'hbar', label: '基础条形图', icon: ViewAgenda, color: '#8B5CF6', defaultW: 4, defaultH: 3, category: '条形图' },
  { value: 'hbar_stack', label: '堆叠条形图', icon: StackedBarChart, color: '#8B5CF6', defaultW: 4, defaultH: 3, category: '条形图' },
  { value: 'progress', label: '进度条', icon: LinearScale, color: '#8B5CF6', defaultW: 3, defaultH: 2, category: '条形图' },
  { value: 'line', label: '基础折线图', icon: ShowChart, color: '#10B981', defaultW: 4, defaultH: 3, category: '折线图' },
  { value: 'line_area', label: '面积图', icon: MultilineChart, color: '#10B981', defaultW: 4, defaultH: 3, category: '折线图' },
  { value: 'pie', label: '饼图', icon: PieChart, color: '#F59E0B', defaultW: 3, defaultH: 3, category: '分布图' },
  { value: 'donut', label: '环形图', icon: DonutLarge, color: '#F59E0B', defaultW: 3, defaultH: 3, category: '分布图' },
  { value: 'rose', label: '玫瑰图', icon: PieChartOutline, color: '#F59E0B', defaultW: 3, defaultH: 3, category: '分布图' },
  { value: 'radar', label: '雷达图', icon: Radar, color: '#EC4899', defaultW: 3, defaultH: 3, category: '分布图' },
  { value: 'treemap', label: '矩形树图', icon: AccountTree, color: '#EC4899', defaultW: 4, defaultH: 3, category: '分布图' },
  { value: 'wordcloud', label: '词云', icon: Cloud, color: '#EC4899', defaultW: 4, defaultH: 3, category: '分布图' },
  { value: 'scatter', label: '散点图', icon: ScatterPlot, color: '#EF4444', defaultW: 4, defaultH: 3, category: '关系图' },
  { value: 'funnel', label: '漏斗图', icon: FilterList, color: '#EF4444', defaultW: 3, defaultH: 3, category: '关系图' },
  { value: 'sankey', label: '桑基图', icon: ViewStream, color: '#EF4444', defaultW: 5, defaultH: 4, category: '关系图' },
  { value: 'dual_barline', label: '柱线组合图', icon: AutoGraph, color: '#6366F1', defaultW: 4, defaultH: 3, category: '双轴图' },
  { value: 'dual_line', label: '双线图', icon: LineAxis, color: '#6366F1', defaultW: 4, defaultH: 3, category: '双轴图' },
  { value: 'table', label: '明细表', icon: TableChart, color: '#0EA5E9', defaultW: 6, defaultH: 4, category: '表格' },
  { value: 'table_pivot', label: '透视表', icon: PivotTableChart, color: '#0EA5E9', defaultW: 6, defaultH: 4, category: '表格' },
  { value: 'heatmap', label: '热力图', icon: GridOn, color: '#0EA5E9', defaultW: 4, defaultH: 3, category: '表格' },
  { value: 'number', label: 'KPI 数值', icon: Numbers, color: '#6366F1', defaultW: 3, defaultH: 2, category: '其他' },
  { value: 'text', label: '文本', icon: TextFields, color: '#6B7280', defaultW: 3, defaultH: 2, category: '其他' },
  { value: 'filter', label: '筛选器', icon: FilterList, color: '#EF4444', defaultW: 3, defaultH: 1, category: '其他' },
] as const;

type ChartTypeValue = typeof CHART_TYPES[number]['value'];

const PALETTE_CATEGORIES = [
  { label: '柱形图', types: ['bar', 'bar_stack', 'bar_group', 'waterfall'] as ChartTypeValue[] },
  { label: '条形图', types: ['hbar', 'hbar_stack', 'progress'] as ChartTypeValue[] },
  { label: '折线图', types: ['line', 'line_area'] as ChartTypeValue[] },
  { label: '分布图', types: ['pie', 'donut', 'rose', 'radar', 'treemap', 'wordcloud'] as ChartTypeValue[] },
  { label: '关系图', types: ['scatter', 'funnel', 'sankey'] as ChartTypeValue[] },
  { label: '双轴图', types: ['dual_barline', 'dual_line'] as ChartTypeValue[] },
  { label: '表格', types: ['table', 'table_pivot', 'heatmap'] as ChartTypeValue[] },
  { label: '其他', types: ['number', 'text', 'filter'] as ChartTypeValue[] },
];

/* ═══════ Mini chart preview ═══════ */
function MiniChart({ type }: { type: string }) {
  const w = 80, h = 50;
  if (type === 'bar') return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      {[0,1,2,3,4].map(i => <rect key={i} x={8+i*14} y={h-20-i*7} width={10} height={20+i*7} rx={2} fill="#3B82F6" opacity={0.7}/>)}
    </svg>
  );
  if (type === 'line') return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <path d="M8,38 L22,22 L36,34 L50,14 L64,28" fill="none" stroke="#10B981" strokeWidth="2"/>
      {[[8,38],[22,22],[36,34],[50,14],[64,28]].map(([cx,cy],i) => <circle key={i} cx={cx} cy={cy} r="3" fill="#10B981"/>)}
    </svg>
  );
  if (type === 'pie') return (
    <svg width={h} height={h} viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="none" stroke="#F59E0B" strokeWidth="12" strokeDasharray="38 50" transform="rotate(-90 16 16)"/>
      <circle cx="16" cy="16" r="14" fill="none" stroke="#3B82F6" strokeWidth="12" strokeDasharray="25 63" transform="rotate(25 16 16)"/>
      <circle cx="16" cy="16" r="14" fill="none" stroke="#10B981" strokeWidth="12" strokeDasharray="15 73" transform="rotate(80 16 16)"/>
    </svg>
  );
  if (type === 'number') return (<Box sx={{ textAlign: 'center' }}><Typography variant="h6" fontWeight={700} color="#6366F1">1,234</Typography><Typography variant="caption" color="success.main">↑12.5%</Typography></Box>);
  if (type === 'table') return (<Box sx={{ width: '100%' }}>{[20,16,14].map((op,i) => <Box key={i} sx={{height:6, bgcolor:'#E5E7EB', borderRadius:1, mb:0.5, width:'100%', opacity:1-i*0.3}}/>)}</Box>);
  return <Dashboard sx={{ fontSize: 28, color: '#D1D5DB' }} />;
}

/* ═══════ Main Component ═══════ */
export default function EditorPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [templateList, setTemplateList] = useState<any[]>([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(true);
  const [boardName, setBoardName] = useState('新建看板');
  const [cards, setCards] = useState<EditorCard[]>([]);
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [history, setHistory] = useState<EditorCard[][]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [toast, setToast] = useState({ open: false, msg: '', sev: 'success' as 'success' | 'error' });
  const [canvasBg, setCanvasBg] = useState<'dots'|'lines'|'white'>('dots');
  const [gridSize, setGridSize] = useState(10);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCat = (label: string) => setCollapsed(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  /* ─── Canvas size ─── */
  const centerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(window.innerWidth - 620);
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCanvasWidth(el.offsetWidth - 16));
    ro.observe(el);
    setCanvasWidth(el.offsetWidth - 16);
    return () => ro.disconnect();
  }, []);

  const selCard = cards.find(c => c.cardId === selectedCard);

  /* ─── Zoom ─── */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); setCanvasZoom(z => Math.max(0.25, Math.min(2, z - e.deltaY * 0.001))); }
    };
    const onKeyHelp = (e: KeyboardEvent) => {
      if (e.key === '?' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); setHelpOpen(h => !h); }
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyHelp);
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKeyHelp); };
  }, []);

  /* ─── History ─── */
  const pushHistory = useCallback((newCards: EditorCard[]) => {
    setHistory(prev => [...prev.slice(0, historyIdx + 1), JSON.parse(JSON.stringify(newCards))]);
    setHistoryIdx(i => i + 1);
  }, [historyIdx]);

  const updateCards = useCallback((newCards: EditorCard[]) => { setCards(newCards); pushHistory(newCards); }, [pushHistory]);

  const undo = () => { if (historyIdx <= 0) return; const idx = historyIdx - 1; setHistoryIdx(idx); setCards(JSON.parse(JSON.stringify(history[idx]))); setSelectedCard(null); };
  const redo = () => { if (historyIdx >= history.length - 1) return; const idx = historyIdx + 1; setHistoryIdx(idx); setCards(JSON.parse(JSON.stringify(history[idx]))); setSelectedCard(null); };

  /* ─── Load templates ─── */
  useEffect(() => {
    client.get('/bi/engine/market').then(r => {
      setTemplateList(r.data?.templates || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  /* ─── Template picker ─── */
  const startFromTemplate = useCallback(async (tplId: number) => {
    setLoading(true);
    try {
      const r = await client.get(`/bi/engine/market/${tplId}`);
      const panels = r.data.panels || [];
      const newCards: EditorCard[] = panels.map((p: any, i: number) => {
        const tDef = CHART_TYPES.find(t => t.value === (p.type || 'bar'));
        const w = p.layout?.w || p.w || (tDef?.defaultW || 3);
        const h = p.layout?.h || p.h || (tDef?.defaultH || 2);
        const x = p.layout?.x ?? 0;
        const y = p.layout?.y ?? i * 3;
        return {
          cardId: `card-${Date.now()}-${i}`, title: p.title || `图表 ${i + 1}`,
          chartType: p.type || 'bar',
          chartConfig: { xField: p.xField || '', yField: p.yField || p.metric || '' },
          layout: { i: `card-${Date.now()}-${i}`, x, y, w: Math.min(w, 12), h, minW: 2, minH: 1 },
        };
      });
      setCards(newCards); setBoardName(r.data.name || '模板编辑'); setShowTemplatePicker(false);
      setHistory([newCards]); setHistoryIdx(0);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  const startBlank = () => { setCards([]); setBoardName('新建空白看板'); setShowTemplatePicker(false); setHistory([]); setHistoryIdx(-1); };

  /* ─── Card CRUD ─── */
  const addCardFromPalette = (chartType: ChartTypeValue) => {
    const tDef = CHART_TYPES.find(t => t.value === chartType)!;
    const id = `card-${Date.now()}`;
    let cx = 0, cy = 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i];
      if (c.layout.y === cy) {
        cx += c.layout.w;
        if (cx + tDef.defaultW > 12 && cx > 0) { cx = 0; cy += 3; }
      }
    }
    const newCard: EditorCard = { cardId: id, title: tDef.label, chartType, layout: { i: id, x: cx, y: cy, w: Math.min(tDef.defaultW, 12 - cx), h: tDef.defaultH, minW: 2, minH: 1 } };
    updateCards([...cards, newCard]);
    setSelectedCard(id);
  };

  const duplicateCard = (id: string) => {
    const card = cards.find(c => c.cardId === id); if (!card) return;
    const newCard = { ...card, cardId: `card-${Date.now()}`, title: card.title + ' (副本)', layout: { ...card.layout, i: `card-${Date.now()}`, y: card.layout.y + card.layout.h + 1 } };
    updateCards([...cards, newCard]);
  };

  const deleteCard = (id: string) => { updateCards(cards.filter(c => c.cardId !== id)); if (selectedCard === id) setSelectedCard(null); };

  const updateCardProp = (id: string, key: string, value: any) => {
    setCards(prev => prev.map(c => c.cardId === id ? { ...c, [key]: value } : c));
  };

  /* ─── Batch align ─── */
  const alignCards = (dir: string) => {
    if (cards.length < 2) return;
    const newCards = cards.map(c => ({ ...c, layout: { ...c.layout } }));
    const ref = newCards[0].layout;
    for (const c of newCards) {
      switch (dir) {
        case 'left': c.layout.x = ref.x; break;
        case 'center': c.layout.x = ref.x + Math.floor((ref.w - c.layout.w) / 2); break;
        case 'right': c.layout.x = ref.x + ref.w - c.layout.w; break;
        case 'top': c.layout.y = ref.y; break;
        case 'middle': c.layout.y = ref.y + Math.floor((ref.h - c.layout.h) / 2); break;
        case 'bottom': c.layout.y = ref.y + ref.h - c.layout.h; break;
      }
    }
    updateCards(newCards);
  };

  const autoLayout = useCallback(() => {
    let y = 0; const rows: number[][] = [];
    for (let i = 0; i < cards.length; i++) {
      let placed = false;
      for (const row of rows) {
        const rw = row.reduce((s, ci) => s + cards[ci].layout.w, 0);
        if (rw + cards[i].layout.w <= 12) { row.push(i); placed = true; break; }
      }
      if (!placed) rows.push([i]);
    }
    let cy = 0;
    const newCards = cards.map((c, i) => {
      const row = rows.find(r => r.includes(i))!;
      const x = Math.min(12 - c.layout.w, row.slice(0, row.indexOf(i)).reduce((s, ci) => s + cards[ci].layout.w, 0));
      const ny = cy;
      if (row[row.length - 1] === i) cy += 3;
      return { ...c, layout: { ...c.layout, x, y: ny } };
    });
    updateCards(newCards);
  }, [cards, updateCards]);

  // Clamp all cards to stay within 12-column boundary
  useEffect(() => {
    if (cards.length === 0) return;
    let needsFix = false;
    for (const c of cards) {
      if (c.layout.x + c.layout.w > 12) { needsFix = true; break; }
    }
    if (needsFix) {
      setCards(prev => prev.map(c => ({
        ...c, layout: { ...c.layout, x: Math.max(0, Math.min(12 - c.layout.w, c.layout.x)) }
      })));
    }
  }, [cards]);

  /* ─── Save ─── */
  const saveBoard = async () => {
    try {
      const res = await client.post('/bi/engine/editor/save', {
        dashboard_id: (window as any).__editorDashboardId || 0,
        name: boardName,
        cards: cards.map((c, i) => ({ card_id: c.cardId, title: c.title, chart_type: c.chartType, layout: c.layout, chart_config: c.chartConfig || {}, sort: i })),
        version: historyIdx + 1,
      });
      const savedId = res.data?.id;
      if (savedId) (window as any).__editorDashboardId = savedId;
      pushHistory(cards);
      setToast({ open: true, msg: '保存成功！已加入我的看板', sev: 'success' });
    } catch (e: any) { setToast({ open: true, msg: '保存失败', sev: 'error' }); }
  };

  const saveAsTemplate = async () => {
    try {
      await client.post('/bi/engine/market', {
        name: boardName, description: `${cards.length}个图表`, category: '通用',
        panels: cards.map(c => ({ type: c.chartType, title: c.title, w: c.layout.w, h: c.layout.h })),
      });
      setToast({ open: true, msg: '已发布到模板市场！', sev: 'success' });
    } catch (e: any) { setToast({ open: true, msg: '保存失败', sev: 'error' }); }
  };

  /* ─── Keyboard shortcuts ─── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (mod && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
      if (mod && e.key === 's') { e.preventDefault(); saveBoard(); }
      if (e.key === 'Delete' && selectedCard) { deleteCard(selectedCard); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedCard, historyIdx, history, cards]);

  /* ─── mm size input ─── */
  const [widthInput, setWidthInput] = useState('');
  const [heightInput, setHeightInput] = useState('');
  useEffect(() => {
    if (!selCard) return;
    setWidthInput(String(Math.round(selCard.layout.w * (canvasWidth / 12) / 3.78)));
    setHeightInput(String(Math.round(selCard.layout.h * 80 / 3.78)));
  }, [selectedCard, selCard?.layout.w, selCard?.layout.h, canvasWidth]);

  const onWidthMm = (raw: string) => {
    setWidthInput(raw); const mm = parseFloat(raw);
    if (isNaN(mm) || mm <= 0) return;
    setCards(prev => prev.map(c => c.cardId === selectedCard ? { ...c, layout: { ...c.layout, w: Math.max(1, Math.min(12, Math.round(mm * 3.78 / (canvasWidth / 12)))) } } : c));
  };
  const onHeightMm = (raw: string) => {
    setHeightInput(raw); const mm = parseFloat(raw);
    if (isNaN(mm) || mm <= 0) return;
    setCards(prev => prev.map(c => c.cardId === selectedCard ? { ...c, layout: { ...c.layout, h: Math.max(1, Math.round(mm * 3.78 / 80)) } } : c));
  };

  /* ─── Loading ─── */
  if (loading && showTemplatePicker) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', pt: 20, height: '100vh', bgcolor: '#F8F9FC' }}><CircularProgress sx={{ color: '#6366F1' }} /></Box>;
  }

  /* ─── Template picker screen ─── */
  if (showTemplatePicker) {
    return (
      <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#F8F9FC', position: 'fixed', inset: 0, zIndex: 1300 }}>
        <Box sx={{ px: 3, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, bgcolor: '#fff', borderBottom: '1px solid #E5E7EB' }}>
          <IconButton size="small" onClick={() => nav('/bi')} sx={{ color: '#6B7280' }}><BackIcon /></IconButton>
          <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#1F2937' }}>看板编辑设计</Typography>
        </Box>
        <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 2, md: 5 }, maxWidth: 900, mx: 'auto', width: '100%' }}>
          <Typography variant="h4" fontWeight={700} sx={{ mb: 1, color: '#1F2937' }}>新建看板</Typography>
          <Typography sx={{ mb: 4, color: '#6B7280' }}>从空白画布开始，或选择一个模板快速开始</Typography>
          <Paper onClick={startBlank} sx={{
            p: 5, mb: 4, borderRadius: 3, cursor: 'pointer', textAlign: 'center',
            border: '2px dashed #D1D5DB', bgcolor: '#fff',
            transition: 'all 0.2s', '&:hover': { borderColor: '#6366F1', bgcolor: 'rgba(99,102,241,0.02)' },
          }}>
            <Add sx={{ fontSize: 48, color: '#6366F1', mb: 1.5 }} />
            <Typography variant="h6" fontWeight={700} color="#6366F1">空白画布</Typography>
            <Typography sx={{ color: '#9CA3AF', mt: 0.5 }}>从零开始自由搭建</Typography>
          </Paper>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2, color: '#374151' }}>从模板开始</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 2 }}>
            {templateList.map(tpl => (
              <Paper key={tpl.id} onClick={() => startFromTemplate(tpl.id)} sx={{
                p: 2.5, borderRadius: 2, cursor: 'pointer', bgcolor: '#fff', border: '1px solid #E5E7EB',
                transition: 'all 0.15s', '&:hover': { borderColor: '#6366F1', boxShadow: '0 2px 8px rgba(99,102,241,0.1)' },
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Dashboard sx={{ fontSize: 18, color: '#6366F1' }} />
                  </Box>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#1F2937' }}>{tpl.name}</Typography>
                </Box>
                <Typography variant="caption" sx={{ color: '#9CA3AF' }}>{(tpl.panels || []).length} 个图表 · {tpl.category || '通用'}</Typography>
              </Paper>
            ))}
          </Box>
        </Box>
      </Box>
    );
  }

  /* ═══════════════════════════════════════════
     Editor — 墨刀风格
     ═══════════════════════════════════════════ */
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', bgcolor: '#F8F9FC', position: 'fixed', inset: 0, zIndex: 1300, color: '#1F2937' }}>
      {/* ═══ Top Toolbar ═══ */}
      <Box sx={{
        height: 44, display: 'flex', alignItems: 'center', px: 2, gap: 2,
        bgcolor: '#F8F9FC', flexShrink: 0,
      }}>
        <IconButton size="small" onClick={() => nav('/bi')} sx={{ color: '#6B7280', p: 0.5 }}><BackIcon sx={{ fontSize: 18 }} /></IconButton>
        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13, color: '#1F2937', mr: 1, whiteSpace: 'nowrap' }}>编辑设计</Typography>
        <TextField size="small" value={boardName} onChange={e => setBoardName(e.target.value)} variant="standard"
          sx={{ input: { color: '#1F2937', fontSize: 13 }, width: 140, '& .MuiInput-underline:before': { borderColor: '#D1D5DB' }, '& .MuiInput-underline:hover:before': { borderColor: '#6366F1' } }} />

        <Box sx={{ width: 1, bgcolor: '#E5E7EB', height: 16, mx: 0.5 }} />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {['left','center','right'].map(d => (
            <Tooltip key={d} title={{left:'左对齐',center:'水平居中',right:'右对齐'}[d]!}><IconButton size="small" onClick={() => alignCards(d)} sx={{ p: 0.5, color: '#6B7280' }}><svg width="14" height="14"><rect x={d==='left'?0:d==='right'?11:5} y="2" width="1.5" height="10" fill="currentColor"/><rect x="2" y="3" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.5"/><rect x="2" y="8" width="6" height="3" rx="0.5" fill="currentColor" opacity="0.5"/></svg></IconButton></Tooltip>
          ))}
          <Box sx={{ width: 1, bgcolor: '#E5E7EB', height: 12, mx: 0.25 }} />
          {['top','middle','bottom'].map(d => (
            <Tooltip key={d} title={{top:'顶对齐',middle:'垂直居中',bottom:'底对齐'}[d]!}><IconButton size="small" onClick={() => alignCards(d)} sx={{ p: 0.5, color: '#6B7280' }}><svg width="14" height="14"><rect x="2" y={d==='top'?0:d==='bottom'?11:5} width="10" height="1.5" fill="currentColor"/><rect x="2" y="2" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.5"/><rect x="7" y="2" width="6" height="3" rx="0.5" fill="currentColor" opacity="0.5"/></svg></IconButton></Tooltip>
          ))}
        </Box>

        <Tooltip title="自动排版"><IconButton size="small" onClick={autoLayout} sx={{ color: '#6366F1', p: 0.5 }}><AutoGraph sx={{ fontSize: 16 }} /></IconButton></Tooltip>

        <Box sx={{ flex: 1 }} />

        <Tooltip title="撤销"><span><IconButton size="small" onClick={undo} disabled={historyIdx <= 0} sx={{ p: 0.5, color: historyIdx <= 0 ? '#D1D5DB' : '#6B7280' }}><Undo sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
        <Tooltip title="重做"><span><IconButton size="small" onClick={redo} disabled={historyIdx >= history.length - 1} sx={{ p: 0.5, color: historyIdx >= history.length - 1 ? '#D1D5DB' : '#6B7280' }}><Redo sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>

        <Tooltip title={previewMode ? '编辑模式' : '预览模式'}><IconButton size="small" onClick={() => setPreviewMode(!previewMode)} sx={{ p: 0.5, color: previewMode ? '#6366F1' : '#6B7280' }}>{previewMode ? <Edit sx={{ fontSize: 16 }} /> : <Visibility sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
        <Tooltip title="存为模板"><IconButton size="small" onClick={saveAsTemplate} sx={{ p: 0.5, color: '#6B7280' }}><Dashboard sx={{ fontSize: 16 }} /></IconButton></Tooltip>
        <Tooltip title="保存 (⌘S)"><IconButton size="small" onClick={saveBoard} sx={{ p: 0.5, color: '#6366F1' }}><SaveIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
      </Box>

      {/* ═══ Body: Grid Layout ═══ */}
      <Box sx={{ flex: 1, display: 'grid', gridTemplateColumns: previewMode ? '1fr' : '220px 1fr 160px 240px', overflow: 'hidden' }}>
        {!previewMode && (
        /* ─── Left Panel ─── */
        <Box sx={{
          bgcolor: '#fff', borderRight: '1px solid #E5E7EB',
          overflow: 'auto', display: 'flex', flexDirection: 'column',
        }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #E5E7EB' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 }}>组件库</Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto', p: 1 }}>
            {PALETTE_CATEGORIES.map(cat => (
              <Box key={cat.label} sx={{ mb: 0.5 }}>
                <Box onClick={() => toggleCat(cat.label)} sx={{
                  display: 'flex', alignItems: 'center', gap: 0.5, py: 0.75, px: 1, cursor: 'pointer', borderRadius: 1,
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.04)' },
                }}>
                  <Typography sx={{ fontSize: 10, color: '#6B7280', transition: '0.15s', transform: collapsed.has(cat.label) ? 'none' : 'rotate(90deg)' }}>▶</Typography>
                  <Typography sx={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase', flex: 1 }}>{cat.label}</Typography>
                  <Typography sx={{ fontSize: 9, color: '#9CA3AF' }}>{cat.types.length}</Typography>
                </Box>
                {!collapsed.has(cat.label) && cat.types.map(typeVal => {
                  const tDef = CHART_TYPES.find(t => t.value === typeVal)!;
                  const Icon = tDef.icon;
                  return (
                    <Box key={typeVal} onClick={() => addCardFromPalette(typeVal)} sx={{
                      display: 'flex', alignItems: 'center', gap: 1.5, p: 1, ml: 2, borderRadius: 1.5, mb: 0.25,
                      cursor: 'pointer', transition: 'all 0.12s',
                      '&:hover': { bgcolor: 'rgba(99,102,241,0.12)' },
                    }}>
                      <Icon sx={{ fontSize: 16, color: tDef.color, opacity: 0.8 }} />
                      <Typography sx={{ fontSize: 12, color: '#374151' }}>{tDef.label}</Typography>
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Box>
        </Box>
        )}

        {/* ─── Center: Canvas ─── */}
        <Box ref={centerRef} sx={{ overflowY: 'auto', overflowX: 'hidden', bgcolor: '#F8F9FC' }}>
          {cards.length === 0 ? (
            <Box sx={{ height: '100%', minHeight: 400, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF' }}>
              <Dashboard sx={{ fontSize: 48, mb: 1.5, opacity: 0.3 }} />
              <Typography sx={{ color: '#6B7280', fontSize: 14, fontWeight: 500 }}>空白画布</Typography>
              <Typography sx={{ color: '#9CA3AF', fontSize: 11, mt: 0.5 }}>点击左侧组件添加图表</Typography>
            </Box>
          ) : (
            <BIEditorCanvas
              cards={cards.map(c => ({
                id: c.cardId, title: c.title, chartType: c.chartType,
                x: c.layout.x * (canvasWidth / 12),
                y: c.layout.y * 80,
                w: c.layout.w * (canvasWidth / 12) - 16,
                h: c.layout.h * 80 - 16,
                config: c.chartConfig,
              }))}
              onCardsChange={(dcs) => {
                setCards(dcs.map(dc => {
                  const existing = cards.find(c => c.cardId === dc.id);
                  return existing
                    ? { ...existing, title: dc.title, chartType: dc.chartType,
                        layout: { i: dc.id, x: Math.round(dc.x / (canvasWidth / 12)), y: Math.round(dc.y / 80), w: Math.max(1, Math.round((dc.w + 16) / (canvasWidth / 12))), h: Math.max(1, Math.round((dc.h + 16) / 80)), minW: 2, minH: 1 },
                        chartConfig: dc.config }
                    : { cardId: dc.id, title: dc.title, chartType: dc.chartType,
                        layout: { i: dc.id, x: Math.round(dc.x / (canvasWidth / 12)), y: Math.round(dc.y / 80), w: Math.max(1, Math.round((dc.w + 16) / (canvasWidth / 12))), h: Math.max(1, Math.round((dc.h + 16) / 80)), minW: 2, minH: 1 },
                        chartConfig: dc.config };
                }));
                pushHistory(cards);
              }}
              selectedIds={selectedCard ? [selectedCard] : []}
              onSelect={(ids: string[]) => setSelectedCard(ids[0] || null)}
              previewMode={previewMode}
              canvasWidth={canvasWidth}
              canvasBackground={canvasBg}
              gridSize={gridSize}
            />
                  )}
        </Box>

        {/* ─── Right: Layer Panel ─── */}
        {!previewMode && (
          <LayerPanel
            cards={cards.map(c => ({
              id: c.cardId, title: c.title, chartType: c.chartType,
              x: c.layout.x, y: c.layout.y,
              w: c.layout.w * (canvasWidth / 12) - 16,
              h: c.layout.h * 80 - 16,
              zIndex: 0, locked: false,
            }))}
            selectedIds={selectedCard ? [selectedCard] : []}
            onSelect={(ids) => setSelectedCard(ids[0] || null)}
            onReorder={(id, action) => {}}
            onLock={(id) => {}}
            onDelete={(ids) => ids.forEach(deleteCard)}
          />
        )}

        {/* ─── Right Panel (Properties) ─── */}
        {selCard && (
          <Box sx={{
            width: '100%', bgcolor: '#fff',
            borderLeft: '1px solid #E5E7EB', overflow: 'auto',
          }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid #E5E7EB' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', letterSpacing: 1 }}>属性</Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {/* Title */}
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: '#6B7280', mb: 0.5 }}>标题</Typography>
                <TextField fullWidth size="small" value={selCard.title}
                  onChange={e => updateCardProp(selCard.cardId, 'title', e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' } }, '& .MuiOutlinedInput-input': { color: '#1F2937', fontSize: 12, py: 0.75 } }} />
              </Box>

              {/* Chart type */}
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: '#6B7280', mb: 0.5 }}>图表类型</Typography>
                <FormControl fullWidth size="small">
                  <Select value={selCard.chartType} onChange={e => updateCardProp(selCard.cardId, 'chartType', e.target.value)}
                    sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' } }, '& .MuiSelect-select': { color: '#1F2937', fontSize: 12, py: 0.75 } }}>
                    {CHART_TYPES.map(t => (
                      <MenuItem key={t.value} value={t.value} sx={{ fontSize: 12 }}><t.icon sx={{ fontSize: 14, mr: 1, color: t.color }} />{t.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              {/* Data binding */}
              {selCard.chartType !== 'text' && selCard.chartType !== 'filter' && (
                <Box sx={{ mb: 2, p: 1.5, bgcolor: '#F8F9FC', borderRadius: 2, border: '1px solid #1E3A5F' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#6366F1', mb: 1 }}>数据绑定</Typography>
                  <Box sx={{ mb: 1 }}>
                    <Typography sx={{ fontSize: 9, color: '#6B7280', mb: 0.25 }}>X轴字段 (维度)</Typography>
                    <TextField fullWidth size="small" placeholder="如: 月份、品类"
                      value={selCard.chartConfig?.xField || ''}
                      onChange={e => updateCardProp(selCard.cardId, 'chartConfig', { ...selCard.chartConfig, xField: e.target.value })}
                      sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff', '& fieldset': { borderColor: '#E5E7EB' } }, '& .MuiOutlinedInput-input': { color: '#1F2937', fontSize: 11, py: 0.5 } }} />
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: 9, color: '#6B7280', mb: 0.25 }}>Y轴字段 (指标)</Typography>
                    <TextField fullWidth size="small" placeholder="如: 销售额、数量"
                      value={selCard.chartConfig?.yField || ''}
                      onChange={e => updateCardProp(selCard.cardId, 'chartConfig', { ...selCard.chartConfig, yField: e.target.value })}
                      sx={{ '& .MuiOutlinedInput-root': { bgcolor: '#fff', '& fieldset': { borderColor: '#E5E7EB' } }, '& .MuiOutlinedInput-input': { color: '#1F2937', fontSize: 11, py: 0.5 } }} />
                  </Box>
                </Box>
              )}

              {/* Size */}
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: '#6B7280', mb: 0.5 }}>尺寸 (宽 × 高)</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField type="number" size="small" value={widthInput}
                    onChange={e => onWidthMm(e.target.value)}
                    InputProps={{ sx: { color: '#1F2937', fontSize: 12, py: 0 }, endAdornment: <Typography sx={{ fontSize: 9, color: '#6B7280' }}>mm</Typography> }}
                    sx={{ width: 70, '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' } } }} />
                  <Typography sx={{ color: '#9CA3AF' }}>×</Typography>
                  <TextField type="number" size="small" value={heightInput}
                    onChange={e => onHeightMm(e.target.value)}
                    InputProps={{ sx: { color: '#1F2937', fontSize: 12, py: 0 }, endAdornment: <Typography sx={{ fontSize: 9, color: '#6B7280' }}>mm</Typography> }}
                    sx={{ width: 70, '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' } } }} />
                  <Typography sx={{ fontSize: 9, color: '#9CA3AF' }}>{selCard.layout.w}×{selCard.layout.h}</Typography>
                </Box>
              </Box>

              {/* Position */}
              <Box sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, color: '#6B7280', mb: 0.5 }}>位置 (X × Y)</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField type="number" size="small" value={selCard.layout.x}
                    onChange={e => { const v = Math.max(0, Math.min(12 - selCard.layout.w, parseInt(e.target.value) || 0)); setCards(prev => prev.map(c => c.cardId === selCard.cardId ? { ...c, layout: { ...c.layout, x: v } } : c)); }}
                    InputProps={{ endAdornment: <Typography sx={{ fontSize: 9, color: '#6B7280' }}>列</Typography> }}
                    sx={{ width: 60, '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' }, '& input': { color: '#1F2937', fontSize: 11, py: 0.5 } } }} />
                  <Typography sx={{ color: '#9CA3AF' }}>×</Typography>
                  <TextField type="number" size="small" value={selCard.layout.y}
                    onChange={e => { const v = Math.max(0, parseInt(e.target.value) || 0); setCards(prev => prev.map(c => c.cardId === selCard.cardId ? { ...c, layout: { ...c.layout, y: v } } : c)); }}
                    InputProps={{ endAdornment: <Typography sx={{ fontSize: 9, color: '#6B7280' }}>行</Typography> }}
                    sx={{ width: 60, '& .MuiOutlinedInput-root': { bgcolor: '#F8F9FC', '& fieldset': { borderColor: '#E5E7EB' }, '& input': { color: '#1F2937', fontSize: 11, py: 0.5 } } }} />
                </Box>
              </Box>

              {/* Actions */}
              <Box sx={{ display: 'flex', gap: 1, pt: 1, borderTop: '1px solid #E5E7EB' }}>
                <Button size="small" startIcon={<ContentCopy sx={{ fontSize: 14 }} />} onClick={() => duplicateCard(selCard.cardId)}
                  fullWidth sx={{ fontSize: 11, textTransform: 'none', color: '#6B7280', borderColor: '#E5E7EB' }} variant="outlined">复制</Button>
                <Button size="small" startIcon={<DelIcon sx={{ fontSize: 14 }} />} onClick={() => deleteCard(selCard.cardId)}
                  fullWidth color="error" sx={{ fontSize: 11, textTransform: 'none' }} variant="outlined">删除</Button>
              </Box>
            </Box>
          </Box>
        )}
      </Box>

      {/* ═══ Status Bar ═══ */}
      <Box sx={{
        height: 24, display: 'flex', alignItems: 'center', px: 2, gap: 2,
        bgcolor: '#fff', borderTop: '1px solid #E5E7EB', flexShrink: 0,
      }}>
        <Typography sx={{ fontSize: 10, color: '#6B7280' }}>{canvasWidth}px</Typography>
        <Typography sx={{ fontSize: 10, color: '#6B7280' }}>{cards.length} 张卡片</Typography>
        {selectedCard && <Typography sx={{ fontSize: 10, color: '#6366F1' }}>选中: {selCard?.title} · {selCard?.layout.w}×{selCard?.layout.h}</Typography>}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 10, color: '#9CA3AF' }}>⌘? 快捷键</Typography>
      </Box>

      {/* ═══ Toast ═══ */}
      <Snackbar open={toast.open} autoHideDuration={2500} onClose={() => setToast(t => ({ ...t, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={toast.sev} onClose={() => setToast(t => ({ ...t, open: false }))} sx={{ borderRadius: 2, bgcolor: '#fff', color: '#1F2937' }}>{toast.msg}</Alert>
      </Snackbar>

      {/* ═══ Help Dialog ═══ */}
      <Dialog open={helpOpen} onClose={() => setHelpOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: '#fff', color: '#1F2937' } }}>
        <DialogTitle sx={{ fontSize: 14, fontWeight: 700, borderBottom: '1px solid #E5E7EB' }}>快捷键速查</DialogTitle>
        <Box sx={{ p: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
          {[
            ['⌘Z','撤销'],['⌘⇧Z','重做'],['⌘S','保存'],['⌘A','全选'],
            ['⌘D','复制'],['⌫','删除'],['Esc','取消选中'],
            ['方向键','移动1px'],['Shift+方向键','移动10px'],
            ['Shift+拖拽','保持比例'],['Ctrl+滚轮','缩放画布'],
            ['Shift+点击','多选'],['拖拽空白','框选'],
          ].map(([key, desc]) => (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 0.5, borderRadius: 1, bgcolor: '#F8F9FC' }}>
              <Chip label={key} size="small" sx={{ fontSize: 10, height: 20, bgcolor: '#E5E7EB', color: '#1F2937' }} />
              <Typography sx={{ fontSize: 11, color: '#6B7280' }}>{desc}</Typography>
            </Box>
          ))}
        </Box>
      </Dialog>
    </Box>
  );
}
