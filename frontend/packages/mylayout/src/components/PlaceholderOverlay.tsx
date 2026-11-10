// @mylayout/components — PlaceholderOverlay（拖拽占位符渲染）
import React from 'react';
import type { PixelCard } from '../types';

interface PlaceholderOverlayProps {
  /** 计算出的占位卡片位置 */
  cards: PixelCard[];
  /** 正在拖拽的卡片 ID */
  activeId?: string | null;
}

/**
 * 拖拽占位符叠加层
 *
 * 在拖拽过程中渲染半透明占位框，
 * 指示卡片松开后的最终位置。
 * 不阻挡鼠标事件（pointer-events: none）。
 */
export const PlaceholderOverlay = React.memo(function PlaceholderOverlay({
  cards,
  activeId,
}: PlaceholderOverlayProps) {
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 999 }}>
      {cards.map(card => {
        const isActive = card.id === activeId;

        return (
          <div
            key={`ph-${card.id}`}
            style={{
              position: 'absolute',
              left: card.px,
              top: card.py,
              width: card.pw,
              height: card.ph,
              borderRadius: 8,
              border: isActive ? '2px dashed #6366F1' : '1px dashed #D1D5DB',
              background: isActive
                ? 'rgba(99,102,241,0.06)'
                : 'rgba(0,0,0,0.02)',
              transition: 'all 0.1s ease',
            }}
          />
        );
      })}
    </div>
  );
});
