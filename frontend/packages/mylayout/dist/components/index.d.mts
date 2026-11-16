import React__default from 'react';
import { P as PixelCard, L as LayoutConfig } from '../types-DNNhqjF8.mjs';

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
    dragOffset?: {
        x: number;
        y: number;
    } | null;
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
    snapGuides?: {
        type: 'x' | 'y';
        pos: number;
        from: number;
        to: number;
    }[];
    onSelect?: (id: string, shift: boolean) => void;
    onCanvasClick?: () => void;
    onCanvasMouseDown?: (e: React__default.MouseEvent) => void;
    /** 拖拽绑定函数（从 useDrag） */
    getDragProps?: (id: string) => any;
    /** 缩放手柄渲染器 */
    renderResizeHandles?: (id: string) => React__default.ReactNode[];
}
/**
 * 可拖放画布组件
 *
 * 替代旧的 dnd-kit DroppableContext。
 * 集成点阵/线条/白色三种背景、Grid 系统、占位符渲染。
 */
declare const DroppableCanvas: React__default.ForwardRefExoticComponent<DroppableCanvasProps & React__default.RefAttributes<HTMLDivElement>>;

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
    resizeHandles?: React__default.ReactNode[];
}
declare const DraggableCard: React__default.NamedExoticComponent<DraggableCardProps>;

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
declare const PlaceholderOverlay: React__default.NamedExoticComponent<PlaceholderOverlayProps>;

export { DraggableCard, DroppableCanvas, PlaceholderOverlay };
