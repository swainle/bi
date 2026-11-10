// @mylayout/components — DraggableCard（可拖拽卡片）
import React, { useRef } from 'react';
import type { PixelCard } from '../types';

interface DraggableCardProps {
  card: PixelCard;
  isSelected: boolean;
  isDragging: boolean;
  isLocked?: boolean;
  zIndex?: number;
  /** useDrag 返回的 dragProps */
  dragProps?: Record<string, any>;
  /** 点击回调（shiftKey 用于多选） */
  onClick?: (shift: boolean) => void;
  /** 缩放手柄 React 节点数组 */
  resizeHandles?: React.ReactNode[];
}

export const DraggableCard = React.memo(function DraggableCard({
  card,
  isSelected,
  isDragging,
  isLocked,
  zIndex = 1,
  dragProps,
  onClick,
  resizeHandles,
}: DraggableCardProps) {
  const divRef = useRef<HTMLDivElement>(null);

  const style: React.CSSProperties = {
    position: 'absolute',
    left: card.px,
    top: card.py,
    width: card.pw,
    height: card.ph,
    zIndex: isDragging ? 1000 : zIndex,
    opacity: isDragging ? 0.4 : isLocked ? 0.8 : 1,
    cursor: isLocked ? 'not-allowed' : isDragging ? 'grabbing' : 'grab',
    transition: isDragging ? 'none' : 'box-shadow 0.1s',
    touchAction: isLocked ? 'auto' : 'none',
    borderRadius: 8,
    background: '#fff',
    border: isSelected ? '2px solid #6366F1' : '1px solid #E5E7EB',
    boxShadow: isSelected
      ? '0 0 0 2px rgba(99,102,241,0.15), 0 2px 8px rgba(0,0,0,0.08)'
      : '0 1px 3px rgba(0,0,0,0.06)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  };

  if (dragProps) {
    Object.assign(style, dragProps.style || {});
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick?.(e.shiftKey);
  };

  return (
    <div
      ref={divRef}
      style={style}
      onClick={handleClick}
      {...(dragProps || {})}
      data-card-id={card.id}
    >
      {/* 卡片标题栏 */}
      <div style={{
        padding: '6px 10px',
        borderBottom: '1px solid #F3F4F6',
        fontSize: 11,
        fontWeight: 600,
        color: isSelected ? '#6366F1' : '#6B7280',
        background: isSelected ? 'rgba(99,102,241,0.04)' : 'transparent',
        flexShrink: 0,
      }}>
        {card.id}
      </div>

      {/* 卡片内容区（由外部 children 渲染） */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9CA3AF',
        fontSize: 12,
        padding: 8,
      }}>
        {card.ph}×{card.pw}
      </div>

      {/* 缩放手柄 */}
      {!isLocked && isSelected && resizeHandles}
    </div>
  );
});
