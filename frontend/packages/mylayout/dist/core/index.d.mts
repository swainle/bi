import { R as Rect, C as Collision, a as Command, L as LayoutConfig, G as GridCard, S as SnapGuide } from '../types-DNNhqjF8.mjs';

/**
 * 空间哈希格网
 * 将画布划分为 cellSize×cellSize 的格网单元
 * 每个单元存储该区域内卡片的 id 列表
 *
 * 复杂度：
 * - insert: O(1)
 * - query: O(n) 但 n = 同格网单元内卡片数（通常 < 5）
 * - detectAll: O(k) k = 总卡片数 / 格网密度
 */
declare class SpatialHash {
    private cells;
    private cellSize;
    constructor(cellSize?: number);
    /** 清空所有格网 */
    clear(): void;
    /** 从卡片数组构建格网 */
    build(rects: {
        id: string;
        rect: Rect;
    }[]): void;
    /** 插入单个卡片 */
    insert(id: string, rect: Rect): void;
    /** 查询与指定矩形可能碰撞的卡片 */
    query(rect: Rect): string[];
    /** 检测所有两两碰撞 */
    detectAll(ids: string[], getRect: (id: string) => Rect): Collision[];
    /** 检查两个矩形是否碰撞 */
    static intersects(a: Rect, b: Rect): boolean;
    /** 获取覆盖指定矩形的格网 key 列表 */
    private getKeys;
}
/** 计算两矩形交集 */
declare function rectIntersection(a: Rect, b: Rect): Rect | null;
/** 判断矩形 a 是否包含点 (px, py) */
declare function rectContains(rect: Rect, px: number, py: number): boolean;

/**
 * Unix diff 风格的撤销/重做管理器
 *
 * 特性：
 * - 最大历史长度 50（可配置）
 * - 新操作自动清空 redo 栈
 * - execute/undo/redo 返回值表示是否成功
 */
declare class HistoryManager {
    private undoStack;
    private redoStack;
    private maxSize;
    constructor(maxSize?: number);
    /** 执行一个命令并推入历史 */
    execute(command: Command): void;
    /** 撤销 */
    undo(): boolean;
    /** 重做 */
    redo(): boolean;
    /** 能否撤销 */
    get canUndo(): boolean;
    /** 能否重做 */
    get canRedo(): boolean;
    /** 历史深度 */
    get undoDepth(): number;
    get redoDepth(): number;
    /** 清空历史 */
    clear(): void;
    private trim;
}
/**
 * 移动命令
 */
declare class MoveCommand implements Command {
    private cardId;
    private from;
    private to;
    private setPosition;
    label: string;
    constructor(cardId: string, from: {
        x: number;
        y: number;
    }, to: {
        x: number;
        y: number;
    }, setPosition: (id: string, x: number, y: number) => void);
    execute(): void;
    undo(): void;
}
/**
 * 批量位置变更命令（用于自动排版等批量操作）
 */
declare class BatchMoveCommand implements Command {
    private from;
    private to;
    private setPosition;
    label: string;
    constructor(from: Map<string, {
        x: number;
        y: number;
    }>, to: Map<string, {
        x: number;
        y: number;
    }>, setPosition: (id: string, x: number, y: number) => void);
    execute(): void;
    undo(): void;
}

/**
 * GridSystem — BI看板布局引擎核心
 *
 * 职责：
 * 1. 管理卡片位置（grid单位 + pixel单位双坐标系）
 * 2. 拖拽过程中的碰撞检测 + 吸附计算
 * 3. 占位符渲染（拖拽时计算最终位置，不修改实际状态）
 * 4. 撤销/重做委托给 HistoryManager
 */
declare class GridSystem {
    config: Required<LayoutConfig>;
    canvasWidth: number;
    history: HistoryManager;
    hash: SpatialHash;
    constructor(canvasWidth: number, config?: Partial<LayoutConfig>);
    updateCanvasWidth(w: number): void;
    gridToPixel(card: GridCard): {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    pixelToGrid(px: number, py: number): {
        x: number;
        y: number;
    };
    /** 重建空间哈希索引 */
    buildIndex(cards: GridCard[]): void;
    /** 检测拖拽移动后的碰撞 */
    detectCollisions(movingId: string, movingRect: Rect, allCards: GridCard[]): string[];
    /** 计算拖拽中的吸附引导线 */
    computeSnapGuides(movingId: string, movingRect: Rect, allCards: GridCard[]): SnapGuide[];
    /**
     * 计算拖拽占位：在 targetRect 位置插入卡片，向下推移被碰撞的卡片
     * 返回更新后的卡片位置（不修改原状态）
     */
    computePlaceholder(movingId: string, targetRect: Rect, cards: GridCard[]): GridCard[];
    cardToRect(card: GridCard): Rect;
    /** 将像素偏移转换为网格偏移 */
    deltaToGrid(dx: number, dy: number): {
        dx: number;
        dy: number;
    };
}

interface AdCard {
    id: string;
    rect: Rect;
}
/**
 * 6向吸附计算
 *
 * 吸附方向：
 * - 左对齐 (left):  移动卡片的左边对齐目标卡片的左边
 * - 右对齐 (right): 移动卡片的右边对齐目标卡片的右边
 * - 上对齐 (top):   移动卡片的顶边对齐目标卡片的顶边
 * - 下对齐 (bottom): 移动卡片的底边对齐目标卡片的底边
 * - 垂直居中 (vcenter): 移动卡片的垂直中心对齐目标卡片的垂直中心
 * - 水平居中 (hcenter): 移动卡片的水平中心对齐目标卡片的水平中心
 *
 * 优先级：边吸附 > 中心对齐 > 等间距标注
 */
declare function computeSnap(movingCard: AdCard, allCards: AdCard[], hash: SpatialHash, config?: Partial<LayoutConfig>): SnapGuide[];

export { BatchMoveCommand, Command, GridSystem, HistoryManager, MoveCommand, SpatialHash, computeSnap, rectContains, rectIntersection };
