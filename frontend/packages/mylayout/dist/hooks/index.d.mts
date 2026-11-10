import * as React$1 from 'react';
import { S as SnapGuide } from '../types-DNNhqjF8.mjs';

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
declare function useDrag(options?: UseDragOptions): {
    dragState: DragState;
    /** 绑定到可拖拽元素的 props */
    bindDrag: (id: string) => {
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
        onPointerCancel: (e: React.PointerEvent) => void;
        style: React$1.CSSProperties;
    };
};

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
declare function useResize(options?: UseResizeOptions): {
    resizeState: ResizeState;
    minW: number;
    minH: number;
    /** 绑定缩放手柄的 props */
    bindResizeHandle: (id: string, dir: ResizeDir) => {
        style: React$1.CSSProperties;
        onPointerDown: (e: React.PointerEvent) => void;
        onPointerMove: (e: React.PointerEvent) => void;
        onPointerUp: (e: React.PointerEvent) => void;
        onPointerCancel: (e: React.PointerEvent) => void;
    };
    /** 缩放手柄内部指示点 */
    dotStyle: React$1.CSSProperties;
};

export { useDrag, useResize };
