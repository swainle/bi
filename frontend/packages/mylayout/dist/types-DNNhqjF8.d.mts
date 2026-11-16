/** 12列网格布局卡片（grid单位） */
interface GridCard {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minW?: number;
    minH?: number;
    zIndex?: number;
    locked?: boolean;
}
/** 像素坐标系卡片（渲染用） */
interface PixelCard extends GridCard {
    px: number;
    py: number;
    pw: number;
    ph: number;
}
/** 矩形（用于碰撞检测） */
interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}
/** 吸附引导线 */
interface SnapGuide {
    type: 'x' | 'y';
    pos: number;
    from: number;
    to: number;
}
/** 碰撞结果 */
interface Collision {
    id1: string;
    id2: string;
    overlap: Rect;
}
/** 命令接口（Command Pattern 撤销/重做） */
interface Command {
    execute(): void;
    undo(): void;
    /** 用于调试 */
    label?: string;
}
/** 拖拽状态 */
interface DragState {
    activeId: string;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
    isDragging: boolean;
}
/** 布局引擎配置 */
interface LayoutConfig {
    columns: number;
    rowHeight: number;
    cellPadding: number;
    snapThreshold: number;
    grid: number;
}

export type { Collision as C, DragState as D, GridCard as G, LayoutConfig as L, PixelCard as P, Rect as R, SnapGuide as S, Command as a };
