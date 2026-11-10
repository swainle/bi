// @mylayout/hooks — useResize（8向缩放封装）
import { useCallback, useRef, useState } from 'react';

type ResizeDir = 'se' | 'e' | 's' | 'nw' | 'ne' | 'sw' | 'n' | 'w';

interface ResizeState {
  /** 正在缩放的卡片 ID */
  activeId: string | null;
  /** 缩放方向 */
  direction: ResizeDir | null;
  /** 起始 x */
  startX: number;
  /** 起始 y */
  startY: number;
  /** 偏移 */
  deltaX: number;
  deltaY: number;
  isResizing: boolean;
}

interface UseResizeOptions {
  /** 最小宽度 px */
  minW?: number;
  /** 最小高度 px */
  minH?: number;
  /** 缩放结束回调 */
  onResizeEnd?: (id: string, direction: ResizeDir, dx: number, dy: number) => void;
}

/**
 * 8向缩放 Hook
 *
 * 方向：
 *   se - 右下角
 *   e  - 右边
 *   s  - 底边
 *   nw - 左上角
 *   ne - 右上角
 *   sw - 左下角
 *   n  - 顶边
 *   w  - 左边
 */
export function useResize(options: UseResizeOptions = {}) {
  const { minW = 60, minH = 40, onResizeEnd } = options;

  const [resizeState, setResizeState] = useState<ResizeState>({
    activeId: null, direction: null, startX: 0, startY: 0, deltaX: 0, deltaY: 0, isResizing: false,
  });

  const rafRef = useRef<number>(0);

  const handleResizeStart = useCallback((id: string, direction: ResizeDir, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    setResizeState({
      activeId: id,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      deltaY: 0,
      isResizing: false,
    });
  }, []);

  const handleResizeMove = useCallback((e: React.PointerEvent) => {
    if (!resizeState.activeId) return;

    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setResizeState(prev => ({
        ...prev,
        deltaX: e.clientX - prev.startX,
        deltaY: e.clientY - prev.startY,
        isResizing: true,
      }));
    });
  }, [resizeState.activeId]);

  const handleResizeEnd = useCallback((e: React.PointerEvent) => {
    if (!resizeState.activeId || !resizeState.direction) return;

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const el = e.currentTarget as HTMLElement;
    el.releasePointerCapture(e.pointerId);

    onResizeEnd?.(
      resizeState.activeId,
      resizeState.direction,
      resizeState.deltaX,
      resizeState.deltaY,
    );

    setResizeState({
      activeId: null, direction: null, startX: 0, startY: 0, deltaX: 0, deltaY: 0, isResizing: false,
    });
  }, [resizeState.activeId, resizeState.direction, resizeState.deltaX, resizeState.deltaY, onResizeEnd]);

  /** 获取缩放手柄的样式（绝对定位 + 光标形状） */
  const getHandleStyle = (dir: ResizeDir): React.CSSProperties => {
    const cursorMap: Record<ResizeDir, string> = {
      se: 'nwse-resize', e: 'ew-resize', s: 'ns-resize',
      nw: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
      n: 'ns-resize', w: 'ew-resize',
    };

    const posMap: Record<ResizeDir, Partial<React.CSSProperties>> = {
      se: { right: -4, bottom: -4 },
      e:  { right: -4, top: '50%', marginTop: -4 },
      s:  { bottom: -4, left: '50%', marginLeft: -4 },
      nw: { left: -4, top: -4 },
      ne: { right: -4, top: -4 },
      sw: { left: -4, bottom: -4 },
      n:  { top: -4, left: '50%', marginLeft: -4 },
      w:  { left: -4, top: '50%', marginTop: -4 },
    };

    return {
      position: 'absolute',
      width: 8, height: 8,
      cursor: cursorMap[dir],
      zIndex: 20,
      ...posMap[dir],
    };
  };

  /** 缩放手柄可见指示点样式 */
  const dotStyle: React.CSSProperties = {
    position: 'absolute',
    width: 6, height: 6,
    background: '#6366F1',
    borderRadius: '50%',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
  };

  return {
    resizeState,
    minW,
    minH,
    /** 绑定缩放手柄的 props */
    bindResizeHandle: (id: string, dir: ResizeDir) => ({
      style: getHandleStyle(dir),
      onPointerDown: (e: React.PointerEvent) => handleResizeStart(id, dir, e),
      onPointerMove: handleResizeMove,
      onPointerUp: handleResizeEnd,
      onPointerCancel: handleResizeEnd,
    }),
    /** 缩放手柄内部指示点 */
    dotStyle,
  };
}
