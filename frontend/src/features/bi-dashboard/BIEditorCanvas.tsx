/**
 * BIEditorCanvas — @mylayout 画布适配层
 * 替换 LCDesigner + dnd-kit，使用 Pointer 事件拖拽
 */
import React, { useRef, useCallback, useMemo } from 'react';
import { Box } from '@mui/material';
import {
  GridSystem, useDrag, useResize,
  DroppableCanvas,
  HistoryManager, MoveCommand,
} from '@mylayout/core';
import type { PixelCard as MLPixelCard } from '@mylayout/core';
import type { DesignCard } from './LayerPanel';

type ResizeDir = 'se' | 'e' | 's' | 'nw' | 'ne' | 'sw' | 'n' | 'w';

interface Props {
  cards: DesignCard[];
  onCardsChange: (cards: DesignCard[]) => void;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  previewMode?: boolean;
  canvasWidth?: number;
  canvasBackground?: 'dots' | 'lines' | 'white';
  gridSize?: number;
}

export default function BIEditorCanvas({
  cards, onCardsChange, selectedIds, onSelect,
  previewMode, canvasWidth, canvasBackground, gridSize,
}: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<GridSystem>(new GridSystem(canvasWidth || 1200));

  // 同步 canvasWidth
  gridRef.current.updateCanvasWidth(canvasWidth || 1200);

  // GridCard → PixelCard 转换
  const pixelCards = useMemo(() => cards.map(c => ({
    id: c.id,
    x: 0, y: 0, w: c.w, h: c.h,
    px: c.x, py: c.y, pw: c.w, ph: c.h,
    zIndex: c.zIndex || 1,
    locked: c.locked || false,
  } as MLPixelCard)), [cards]);

  // ── 拖拽 ──
  const handleDragEnd = useCallback((id: string, dx: number, dy: number) => {
    const canvasW = canvasRef.current?.offsetWidth || canvasWidth || 1200;
    const newCards = cards.map(c => {
      if (c.id !== id) return c;
      const nx = Math.max(0, Math.min(c.x + dx, canvasW - c.w));
      const ny = Math.max(0, c.y + dy);
      return { ...c, x: nx, y: ny };
    });
    onCardsChange(newCards);
  }, [cards, canvasWidth, onCardsChange]);

  const { dragState, bindDrag } = useDrag({ onDragEnd: handleDragEnd });

  // ── 缩放 ──
  const handleResizeEnd = useCallback((id: string, dir: string, dx: number, dy: number) => {
    onCardsChange(cards.map(c => {
      if (c.id !== id) return c;
      let { x, y, w, h } = c;
      switch (dir) {
        case 'se': w = c.w + dx; h = c.h + dy; break;
        case 'e':  w = c.w + dx; break;
        case 's':  h = c.h + dy; break;
        case 'nw': x = c.x + dx; y = c.y + dy; w = c.w - dx; h = c.h - dy; break;
        case 'ne': y = c.y + dy; w = c.w + dx; h = c.h - dy; break;
        case 'sw': x = c.x + dx; h = c.h + dy; w = c.w - dx; break;
        case 'n':  y = c.y + dy; h = c.h - dy; break;
        case 'w':  x = c.x + dx; w = c.w - dx; break;
      }
      return { ...c, x, y, w: Math.max(100, w), h: Math.max(60, h) };
    }));
  }, [cards, onCardsChange]);

  const { resizeState, bindResizeHandle, dotStyle } = useResize({ onResizeEnd: handleResizeEnd });

  // ── 选择 ──
  const handleSelect = useCallback((id: string, shift: boolean) => {
    if (shift) {
      onSelect(selectedIds.includes(id) ? selectedIds.filter(s => s !== id) : [...selectedIds, id]);
    } else {
      onSelect([id]);
    }
  }, [selectedIds, onSelect]);

  // ── 缩放手柄渲染器 ──
  const RESIZE_DIRS: ResizeDir[] = ['se', 'e', 's', 'nw', 'ne', 'sw', 'n', 'w'];
  const renderResizeHandles = useCallback((id: string) => {
    return RESIZE_DIRS.map(dir => {
      const bindings = bindResizeHandle(id, dir);
      return (
        <div key={dir} {...bindings}>
          <div style={dotStyle} />
        </div>
      );
    });
  }, [bindResizeHandle, dotStyle]);

  if (previewMode) {
    return (
      <Box sx={{ position: 'relative', width: '100%', minHeight: 600 }}>
        {pixelCards.map(c => (
          <Box key={c.id} sx={{
            position: 'absolute', left: c.px, top: c.py,
            width: c.pw, height: c.ph,
            background: '#fff', borderRadius: 1,
            border: '1px solid #E5E7EB',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Box component="span" sx={{ fontSize: 11, color: 'text.disabled' }}>
              {c.id}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, overflow: 'hidden' }}>
      <DroppableCanvas
        ref={canvasRef}
        cards={pixelCards}
        canvasWidth={canvasWidth}
        selectedIds={selectedIds}
        draggingId={dragState.activeId}
        dragOffset={dragState.isDragging ? { x: dragState.offsetX, y: dragState.offsetY } : null}
        resizeState={resizeState}
        background={canvasBackground || 'dots'}
        onSelect={handleSelect}
        onCanvasClick={() => onSelect([])}
        getDragProps={(id: string) => bindDrag(id)}
        renderResizeHandles={renderResizeHandles}
      />
    </Box>
  );
}
