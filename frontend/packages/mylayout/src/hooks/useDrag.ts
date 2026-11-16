// @mylayout/hooks — useDrag（Pointer 事件拖拽封装）
import { useCallback, useRef, useState } from 'react';
import type { SnapGuide, LayoutConfig } from '../types';
import { DEFAULT_CONFIG } from '../utils/constants';

interface UseDragOptions {
  /** 拖拽开始的回调 */
  onDragStart?: (id: string, x: number, y: number) => void;
  /** 拖拽结束的回调，返回最终位置 */
  onDragEnd?: (id: string, deltaX: number, deltaY: number) => void;
  /** 吸附阈值 px */
  snapThreshold?: number;
  /** 吸附引导线变更回调 */
  onSnapGuides?: (guides: SnapGuide[]) => void;
}

interface DragState {
  activeId: string | null;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  isDragging: boolean;
}

/**
 * 基于 Pointer 事件的拖拽 Hook
 *
 * 替代 dnd-kit，实现：
 * 1. Pointer 事件捕获（比 mouse 更精确，支持触摸）
 * 2. requestAnimationFrame 节流（60fps）
 * 3. 拖拽阈值（dist > 5px 才开始拖拽）
 * 4. Grid 吸附（拖拽结束时对齐到最近网格点）
 */
export function useDrag(options: UseDragOptions = {}) {
  const {
    onDragStart,
    onDragEnd,
    snapThreshold = DEFAULT_CONFIG.snapThreshold,
    onSnapGuides,
  } = options;

  const [dragState, setDragState] = useState<DragState>({
    activeId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0, isDragging: false,
  });

  const rafRef = useRef<number>(0);
  const lastMoveRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const threshold = 5; // px, 超过才激活拖拽

  const handlePointerDown = useCallback((id: string, e: React.PointerEvent) => {
    // 只响应主鼠标按钮或触摸
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    setDragState({
      activeId: id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      isDragging: false,
    });
    lastMoveRef.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;

    onDragStart?.(id, e.clientX, e.clientY);
  }, [onDragStart]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.activeId) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    // 阈值检测
    if (!hasMovedRef.current && Math.abs(dx) + Math.abs(dy) < threshold) return;
    hasMovedRef.current = true;

    // raf 节流
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;

      setDragState(prev => ({
        ...prev,
        offsetX: e.clientX - prev.startX,
        offsetY: e.clientY - prev.startY,
        isDragging: true,
      }));

      lastMoveRef.current = { x: e.clientX, y: e.clientY };
    });
  }, [dragState.activeId, dragState.startX, dragState.startY]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragState.activeId) return;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture(e.pointerId);

    const finalDx = lastMoveRef.current.x - dragState.startX;
    const finalDy = lastMoveRef.current.y - dragState.startY;

    // Grid 吸附
    const snappedDx = Math.round(finalDx / snapThreshold) * snapThreshold;
    const snappedDy = Math.round(finalDy / snapThreshold) * snapThreshold;

    onDragEnd?.(dragState.activeId, snappedDx, snappedDy);

    setDragState({
      activeId: null, startX: 0, startY: 0, offsetX: 0, offsetY: 0, isDragging: false,
    });
  }, [dragState.activeId, dragState.startX, dragState.startY, snapThreshold, onDragEnd]);

  return {
    dragState,
    /** 绑定到可拖拽元素的 props */
    bindDrag: (id: string) => ({
      onPointerDown: (e: React.PointerEvent) => handlePointerDown(id, e),
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      style: dragState.activeId === id && dragState.isDragging
        ? {
            transform: `translate3d(${dragState.offsetX}px, ${dragState.offsetY}px, 0)`,
            opacity: 0.4,
            zIndex: 1000,
            cursor: 'grabbing',
            touchAction: 'none',
          } as React.CSSProperties
        : { cursor: 'grab', touchAction: 'none' } as React.CSSProperties,
    }),
  };
}
