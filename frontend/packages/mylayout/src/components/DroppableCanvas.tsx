// @mylayout/components — DroppableCanvas（拖放画布）
import React, { useRef, useEffect, useCallback } from 'react';
import type { PixelCard, LayoutConfig } from '../types';
import { DEFAULT_CONFIG } from '../utils/constants';
import { DraggableCard } from './DraggableCard';
import { PlaceholderOverlay } from './PlaceholderOverlay';

interface DroppableCanvasProps {
  /** 像素坐标卡片列表 */
  cards: PixelCard[];
  /** 画布宽度 px */
  canvasWidth?: number;
  /** 选中的卡片 ID 列表 */
  selectedIds?: string[];
  /** 拖拽中的卡片 ID */
  draggingId?: string | null;
  /** 拖拽偏移 */
  dragOffset?: { x: number; y: number } | null;
  /** 缩放状态 */
  resizeState?: {
    activeId: string | null;
    deltaX: number;
    deltaY: number;
    direction: string | null;
    isResizing: boolean;
  } | null;
  /** 布局配置 */
  layoutConfig?: Partial<LayoutConfig>;
  /** 背景类型 */
  background?: 'dots' | 'lines' | 'white';
  /** 占位符卡片位置 */
  placeholderCards?: PixelCard[] | null;
  /** 吸附引导线 */
  snapGuides?: { type: 'x' | 'y'; pos: number; from: number; to: number }[];

  onSelect?: (id: string, shift: boolean) => void;
  onCanvasClick?: () => void;
  onCanvasMouseDown?: (e: React.MouseEvent) => void;
  /** 拖拽绑定函数（从 useDrag） */
  getDragProps?: (id: string) => any;
  /** 缩放手柄渲染器 */
  renderResizeHandles?: (id: string) => React.ReactNode[];
}

/**
 * 可拖放画布组件
 *
 * 替代旧的 dnd-kit DroppableContext。
 * 集成点阵/线条/白色三种背景、Grid 系统、占位符渲染。
 */
export const DroppableCanvas = React.forwardRef<HTMLDivElement, DroppableCanvasProps>(
  function DroppableCanvas(props, ref) {
    const {
      cards, canvasWidth, selectedIds = [], draggingId, dragOffset, resizeState,
      layoutConfig, background = 'dots', placeholderCards, snapGuides,
      onSelect, onCanvasClick, onCanvasMouseDown, getDragProps, renderResizeHandles,
    } = props;

    const { cellPadding, columns, rowHeight, grid } = { ...DEFAULT_CONFIG, ...layoutConfig };
    const innerRef = useRef<HTMLDivElement>(null);

    // 合并外部 ref
    useEffect(() => {
      if (!ref) return;
      if (typeof ref === 'function') {
        ref(innerRef.current);
      } else {
        (ref as React.MutableRefObject<HTMLDivElement | null>).current = innerRef.current;
      }
    }, [ref]);

    // 计算最小高度
    const maxBottom = cards.length > 0
      ? Math.max(...cards.map(c => c.py + c.ph))
      : 600;

    const containerStyle: React.CSSProperties = {
      width: canvasWidth || '100%',
      minHeight: Math.max(600, maxBottom + 200),
      position: 'relative',
      userSelect: 'none',
      overflow: 'hidden',
    };

    // 背景样式
    if (background === 'dots') {
      containerStyle.backgroundImage = `radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)`;
      containerStyle.backgroundSize = `${grid}px ${grid}px`;
    } else if (background === 'lines') {
      containerStyle.background = '#FFFFFF';
      containerStyle.backgroundImage = `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`;
      containerStyle.backgroundSize = `${grid}px ${grid}px`;
    } else {
      containerStyle.background = '#FFFFFF';
    }

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onCanvasClick?.();
      }
      onCanvasMouseDown?.(e);
    }, [onCanvasClick, onCanvasMouseDown]);

    return (
      <div ref={innerRef} style={containerStyle} onMouseDown={handleMouseDown}>
        {/* 原有卡片 */}
        {cards.map(card => {
          const isSelected = selectedIds.includes(card.id);
          const isDragging = draggingId === card.id;

          let displayCard = card;
          if (isDragging && dragOffset) {
            displayCard = {
              ...card,
              px: card.px + dragOffset.x,
              py: card.py + dragOffset.y,
            };
          }

          // 缩放中
          let resizeAdjusted = displayCard;
          if (resizeState?.activeId === card.id && resizeState.isResizing) {
            const dir = resizeState.direction;
            const dx = resizeState.deltaX;
            const dy = resizeState.deltaY;
            resizeAdjusted = { ...displayCard };

            if (dir?.includes('e') || dir?.includes('se') || dir?.includes('ne')) {
              resizeAdjusted.pw = Math.max(60, displayCard.pw + dx);
            }
            if (dir?.includes('s') || dir?.includes('se') || dir?.includes('sw')) {
              resizeAdjusted.ph = Math.max(40, displayCard.ph + dy);
            }
            if (dir?.includes('w') || dir?.includes('nw') || dir?.includes('sw')) {
              resizeAdjusted.px = displayCard.px + Math.min(dx, displayCard.pw - 60);
              resizeAdjusted.pw = Math.max(60, displayCard.pw - dx);
            }
            if (dir?.includes('n') || dir?.includes('nw') || dir?.includes('ne')) {
              resizeAdjusted.py = displayCard.py + Math.min(dy, displayCard.ph - 40);
              resizeAdjusted.ph = Math.max(40, displayCard.ph - dy);
            }
          }

          return (
            <DraggableCard
              key={card.id}
              card={resizeAdjusted}
              isSelected={isSelected}
              isDragging={isDragging}
              isLocked={card.locked}
              zIndex={isDragging ? 1000 : (card.zIndex || 1)}
              dragProps={getDragProps?.(card.id)}
              onClick={(shift) => onSelect?.(card.id, shift)}
              resizeHandles={renderResizeHandles?.(card.id)}
            />
          );
        })}

        {/* 占位符 */}
        {placeholderCards && (
          <PlaceholderOverlay
            cards={placeholderCards}
            activeId={draggingId}
          />
        )}

        {/* 吸附引导线 */}
        {snapGuides?.map((g, i) => (
          <div key={i} style={{
            position: 'absolute',
            ...(g.type === 'x'
              ? { left: g.pos, top: g.from, width: 1, height: (g.to - g.from) || '100%' }
              : { top: g.pos, left: g.from, height: 1, width: (g.to - g.from) || '100%' }
            ),
            background: '#6366F1',
            zIndex: 9999,
            pointerEvents: 'none',
          }} />
        ))}
      </div>
    );
  }
);
