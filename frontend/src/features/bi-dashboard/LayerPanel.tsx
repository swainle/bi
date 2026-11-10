// bi-dashboard/layer-panel.tsx
// 图层面板组件 — 从 LCDesigner 提取为独立模块

import { Box, Typography, IconButton, Chip } from '@mui/material';
import { VerticalAlignTop, ArrowUpward } from '@mui/icons-material';

export interface DesignCard {
  id: string; title: string; chartType: string;
  x: number; y: number; w: number; h: number;
  zIndex?: number; locked?: boolean; config?: any;
}

interface LayerPanelProps {
  cards: DesignCard[];
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onReorder?: (id: string, action: 'top' | 'bottom' | 'up' | 'down') => void;
  onLock?: (id: string) => void;
  onDelete?: (ids: string[]) => void;
}

export function LayerPanel({ cards, selectedIds, onSelect, onReorder, onLock, onDelete }: LayerPanelProps) {
  const sorted = [...cards].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  return (
    <Box sx={{ width: '100%', bgcolor: '#fff', borderLeft: '1px solid #E5E7EB', overflow: 'auto', p: 1 }}>
      <Typography variant="overline" sx={{ fontSize: 10, fontWeight: 700, color: '#9CA3AF' }}>图层 ({cards.length})</Typography>
      {sorted.map((c) => (
        <Box key={c.id} onClick={() => onSelect([c.id])}
          onDoubleClick={() => onDelete?.([c.id])}
          sx={{
            display: 'flex', alignItems: 'center', gap: 0.5, p: 0.5, borderRadius: 1, cursor: 'pointer',
            bgcolor: selectedIds.includes(c.id) ? 'rgba(99,102,241,0.08)' : 'transparent',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.03)' },
          }}>
          <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: selectedIds.includes(c.id) ? '#6366F1' : '#D1D5DB', flexShrink: 0 }} />
          <Typography variant="caption" sx={{ fontSize: 10, flex: 1, color: c.locked ? '#9CA3AF' : '#374151' }} noWrap>
            {c.title || c.id}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0 }}>
            <IconButton size="small" onClick={e => { e.stopPropagation(); onReorder?.(c.id, 'top'); }} sx={{ p: 0, opacity: 0.5 }}><VerticalAlignTop sx={{ fontSize: 12 }} /></IconButton>
            <IconButton size="small" onClick={e => { e.stopPropagation(); onReorder?.(c.id, 'up'); }} sx={{ p: 0, opacity: 0.5 }}><ArrowUpward sx={{ fontSize: 12 }} /></IconButton>
          </Box>
        </Box>
      ))}
      {selectedIds.length > 1 && (
        <Chip label={`删除${selectedIds.length}个`} size="small" color="error" variant="outlined"
          onClick={() => onDelete?.(selectedIds)} sx={{ mt: 1, fontSize: 10, width: '100%' }} />
      )}
    </Box>
  );
}
