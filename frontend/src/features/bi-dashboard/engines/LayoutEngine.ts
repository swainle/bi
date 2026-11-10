/**
 * 明策BI — 双模式布局计算引擎
 *
 * 统一管理画布坐标、尺寸、吸附碰撞、栅格约束、层级
 * 内置栅格模式(12列) + 自由悬浮模式(像素级)，禁止业务代码直接操作DOM
 *
 * 核心算法：
 *   - 碰撞检测 + 智能避让
 *   - 磁吸吸附(边缘/栅格线)
 *   - 防抖调度器(拖动实时计算，松开300ms输出)
 *   - 坐标转换器(栅格↔像素)
 *   - 冲突修复(导入模板自动消除重叠)
 */

// ─── Types ───
export interface GridCell {
  x: number; y: number; w: number; h: number;
}

export interface PixelPos {
  x: number; y: number; w: number; h: number;
}

export type LayoutMode = 'grid' | 'free';

export interface LayoutConfig {
  mode: LayoutMode;
  cols: number;            // 栅格列数(默认12)
  rowHeight: number;       // 单行高度(px, 默认80)
  margin: [number, number];// 间距[x, y]
  snapThreshold: number;   // 吸附阈值(px, 默认5)
  minW: number; minH: number; // 最小宽高
  canvasWidth: number;     // 画布宽度(px)
  canvasHeight: number;    // 画布高度(px, free模式无限)
}

export interface CardItem {
  id: string;
  layout: GridCell;
}

// ─── Engine ───
export class LayoutEngine {
  private config: LayoutConfig;
  private throttleTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLayout: GridCell[] | null = null;
  private onChange: ((items: GridCell[]) => void) | null = null;
  private snapGuides: { axis: 'x'|'y'; pos: number }[] = [];

  constructor(config: Partial<LayoutConfig> = {}) {
    this.config = {
      mode: 'grid',
      cols: 12,
      rowHeight: 80,
      margin: [8, 8],
      snapThreshold: 5,
      minW: 1,
      minH: 1,
      canvasWidth: 1200,
      canvasHeight: 0,
      ...config,
    };
  }

  // ─── 配置更新 ───
  updateConfig(partial: Partial<LayoutConfig>) {
    Object.assign(this.config, partial);
  }

  onLayoutChange(fn: (items: GridCell[]) => void) {
    this.onChange = fn;
  }

  // ═══════ 防抖调度器 ═══════
  /** 拖动过程中实时调用，300ms 后才输出最终布局 */
  scheduleOutput(items: GridCell[]) {
    this.pendingLayout = items;
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    this.throttleTimer = setTimeout(() => {
      if (this.pendingLayout && this.onChange) {
        this.onChange(this.pendingLayout);
      }
      this.pendingLayout = null;
    }, 300);
  }

  flushOutput() {
    if (this.throttleTimer) clearTimeout(this.throttleTimer);
    if (this.pendingLayout && this.onChange) {
      this.onChange(this.pendingLayout);
    }
    this.pendingLayout = null;
  }

  // ═══════ 碰撞检测 ═══════
  /** 检测两个卡片是否重叠 */
  isColliding(a: GridCell, b: GridCell): boolean {
    return !(
      a.x + a.w <= b.x ||
      b.x + b.w <= a.x ||
      a.y + a.h <= b.y ||
      b.y + b.h <= a.y
    );
  }

  /** 获取与目标碰撞的所有卡片 */
  getCollisions(target: GridCell, others: GridCell[]): GridCell[] {
    return others.filter(o => o !== target && this.isColliding(target, o));
  }

  /** 智能避让：推开碰撞的卡片 */
  resolveCollisions(moved: GridCell, others: GridCell[], alreadyPushed: Set<string> = new Set()): GridCell[] {
    const result = others.map(o => ({ ...o }));
    const collisions = this.getCollisions(moved, result);
    for (const c of collisions) {
      if (alreadyPushed.has(`${c.x},${c.y}`)) continue;
      alreadyPushed.add(`${c.x},${c.y}`);
      // 向下推
      c.y = moved.y + moved.h + this.config.margin[1];
      // 递归解决连锁碰撞
      this.resolveCollisions(c, result, alreadyPushed);
    }
    return result;
  }

  // ═══════ 磁吸吸附 ═══════
  /** 计算吸附对齐后的位置 */
  snap(target: GridCell, others: GridCell[]): GridCell {
    const snapped = { ...target };
    const T = this.config.snapThreshold;

    for (const other of others) {
      if (other === target) continue;
      // X轴：左边缘/右边缘
      if (Math.abs(target.x - other.x) < T) snapped.x = other.x;
      if (Math.abs(target.x + target.w - other.x - other.w) < T) snapped.x = other.x + other.w - target.w;
      // Y轴：上边缘/下边缘
      if (Math.abs(target.y - other.y) < T) snapped.y = other.y;
      if (Math.abs(target.y + target.h - other.y - other.h) < T) snapped.y = other.y + other.h - target.h;
    }

    this.snapGuides = [];
    if (snapped.x !== target.x) this.snapGuides.push({ axis: 'x', pos: snapped.x });
    if (snapped.y !== target.y) this.snapGuides.push({ axis: 'y', pos: snapped.y });

    return snapped;
  }

  /** 获取当前吸附辅助线(UI显示用) */
  getSnapGuides(): { axis: 'x'|'y'; pos: number }[] {
    return this.snapGuides;
  }

  // ═══════ 栅格约束 ═══════
  /** 将坐标吸附到最近的栅格线 */
  constrainToGrid(item: GridCell): GridCell {
    const cols = this.config.cols;
    return {
      x: Math.max(0, Math.min(cols - item.w, Math.round(item.x))),
      y: Math.max(0, Math.round(item.y)),
      w: Math.max(this.config.minW, Math.min(cols, Math.round(item.w))),
      h: Math.max(this.config.minH, Math.round(item.h)),
    };
  }

  /** 边界约束 */
  constrainToCanvas(item: GridCell): GridCell {
    const cols = this.config.cols;
    return {
      x: Math.max(0, Math.min(cols - item.w, item.x)),
      y: Math.max(0, item.y),
      w: item.w,
      h: item.h,
    };
  }

  // ═══════ 坐标转换 ────────
  /** 栅格 → 像素 */
  gridToPixel(g: GridCell): PixelPos {
    const rh = this.config.rowHeight;
    const [mx, my] = this.config.margin;
    return {
      x: g.x * (this.config.canvasWidth / this.config.cols),
      y: g.y * (rh + my),
      w: g.w * (this.config.canvasWidth / this.config.cols) - mx,
      h: g.h * (rh + my) - my,
    };
  }

  /** 像素 → 栅格 */
  pixelToGrid(p: PixelPos): GridCell {
    const rh = this.config.rowHeight;
    const [mx, my] = this.config.margin;
    const colW = this.config.canvasWidth / this.config.cols;
    return {
      x: Math.round(p.x / colW),
      y: Math.round(p.y / (rh + my)),
      w: Math.max(1, Math.round((p.w + mx) / colW)),
      h: Math.max(1, Math.round((p.h + my) / (rh + my))),
    };
  }

  // ═══════ 冲突修复 ═══════
  /** 导入模板后消除重叠 */
  fixOverlaps(items: GridCell[]): GridCell[] {
    const result = items.map(i => ({ ...i }));
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (this.isColliding(result[i], result[j])) {
          result[j].y = result[i].y + result[i].h + this.config.margin[1];
        }
      }
    }
    return result;
  }

  // ═══════ 批量操作 ────────
  /** 批量左对齐 */
  alignLeft(items: GridCell[]): GridCell[] {
    const minX = Math.min(...items.map(i => i.x));
    return items.map(i => ({ ...i, x: minX }));
  }

  /** 批量水平等距 */
  distributeHorizontal(items: GridCell[]): GridCell[] {
    const sorted = [...items].sort((a, b) => a.x - b.x);
    if (sorted.length < 3) return sorted.map(i => ({ ...i }));
    const first = sorted[0].x;
    const last = sorted[sorted.length - 1].x + sorted[sorted.length - 1].w;
    const totalGap = last - first - sorted.reduce((s, i) => s + i.w, 0);
    const gap = totalGap / (sorted.length - 1);
    return sorted.map((item, i) => ({ ...item, x: first + i * (item.w + gap) - item.w * i }));
  }

  /** 批量统一宽度 */
  unifyWidth(items: GridCell[]): GridCell[] {
    const maxW = Math.max(...items.map(i => i.w));
    return items.map(i => ({ ...i, w: maxW }));
  }
}
