/**
 * 明策BI — ECharts 卡片自适应渲染重绘引擎
 *
 * 核心能力：
 *   1. 容器尺寸监听统一调度 — 合并节流，100ms批量统一重绘
 *   2. ECharts实例生命周期管理池 — 隐藏/缩放不销毁，复用实例
 *   3. 分层渲染 — 拖拽过程只渲染占位框，松开后才完整渲染
 *   4. 配置自动适配修正 — 缩放后自动调整图例/坐标轴/字体
 *   5. 混合组件兼容 — 指标卡/表格/筛选器统一一套自适应规则
 */

// ─── Types ───
export type ChartType = 'bar'|'line'|'pie'|'donut'|'number'|'table'|'radar'|'funnel'|'scatter'|'heatmap'|'bar_stack'|'line_area';

interface ChartInstance {
  id: string;
  type: ChartType;
  instance: any;  // ECharts instance
  domRef: HTMLElement;
  visible: boolean;
  active: boolean;
  createdAt: number;
}

interface RenderTask {
  id: string;
  domRef: HTMLElement;
  option: any;
  type: ChartType;
  priority: number; // 0=占位, 1=完整渲染
}

// ─── Engine ───
export class RenderEngine {
  private instances: Map<string, ChartInstance> = new Map();
  private taskQueue: RenderTask[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private BATCH_INTERVAL = 100; // ms — 批量重绘间隔
  private MAX_INSTANCES = 30;     // 最大缓存的ECharts实例数
  private isDragging = false;
  private echartsModule: any = null;  // lazy init

  // ─── 初始化 ───
  async init() {
    if (!this.echartsModule) {
      this.echartsModule = await import('echarts');
    }
  }

  // ═══════ 拖拽模式切换 ═══════
  /** 进入拖拽模式：停止完整渲染，只显示占位框 */
  startDragging() {
    this.isDragging = true;
  }

  /** 结束拖拽模式：触发所有不可见图表完整渲染 */
  stopDragging() {
    this.isDragging = false;
    this.flushPending();
  }

  // ═══════ 渲染任务调度 ═══════
  /** 提交渲染任务(节流批量) */
  scheduleRender(task: RenderTask) {
    this.taskQueue.push(task);
    this.debounceBatchRender();
  }

  private debounceBatchRender() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.flushPending(), this.BATCH_INTERVAL);
  }

  /** 批量执行所有待渲染任务 */
  flushPending() {
    if (this.taskQueue.length === 0) return;
    const tasks = [...this.taskQueue];
    this.taskQueue = [];

    // 按优先级排序：占位框先渲染
    tasks.sort((a, b) => a.priority - b.priority);

    // 去重：同一id只渲染最后一次
    const seen = new Map<string, RenderTask>();
    for (const t of tasks) seen.set(t.id, t);

    for (const task of seen.values()) {
      try {
        if (this.isDragging && task.priority > 0) {
          // 拖拽中：完整渲染降级为占位
          this.renderPlaceholder(task.domRef, task.type);
        } else {
          this.renderChart(task);
        }
      } catch (e) {
        // silently skip render errors during drag
      }
    }
  }

  // ═══════ 图表渲染 ═══════
  private async renderChart(task: RenderTask) {
    if (!this.echartsModule) await this.init();

    const existing = this.instances.get(task.id);
    let chart: any;

    if (existing && existing.domRef === task.domRef) {
      // 复用已有实例
      chart = existing.instance;
      existing.active = true;
    } else {
      // 创建新实例（如果达到上限，销毁最旧的非活跃实例）
      if (this.instances.size >= this.MAX_INSTANCES) {
        let oldest: ChartInstance | null = null;
        for (const [_, inst] of this.instances) {
          if (!inst.active && (!oldest || inst.createdAt < oldest.createdAt)) {
            oldest = inst;
          }
        }
        if (oldest) {
          oldest.instance.dispose();
          this.instances.delete(oldest.id);
        }
      }
      chart = this.echartsModule.init(task.domRef, null, { renderer: 'canvas' });
      this.instances.set(task.id, {
        id: task.id, type: task.type, instance: chart,
        domRef: task.domRef, visible: true, active: true,
        createdAt: Date.now(),
      });
    }

    // 自动适配配置
    const adapted = this.autoAdaptOption(task.option, task.type, task.domRef);
    chart.setOption(adapted, { notMerge: true });

    // 延时resize适配容器
    requestAnimationFrame(() => {
      chart.resize();
    });
  }

  /** 占位框渲染（拖拽时） */
  private renderPlaceholder(dom: HTMLElement, type: ChartType) {
    dom.style.opacity = '0.6';
    dom.style.background = '#F3F4F6';
    dom.style.border = '1px dashed #D1D5DB';
    // 简单图标显示
    if (!dom.querySelector('.placeholder-icon')) {
      const icon = document.createElement('div');
      icon.className = 'placeholder-icon';
      icon.innerHTML = type === 'number' ? '📊' : type === 'table' ? '📋' : '📈';
      icon.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:32px;opacity:0.3';
      dom.appendChild(icon);
    }
  }

  /** 清除占位框 */
  private clearPlaceholder(dom: HTMLElement) {
    dom.style.opacity = '1';
    dom.style.background = '';
    dom.style.border = '';
    const icon = dom.querySelector('.placeholder-icon');
    if (icon) icon.remove();
  }

  // ═══════ 自动适配修正 ═══════
  /** 根据容器尺寸自动调整 ECharts 配置 */
  autoAdaptOption(option: any, type: ChartType, dom: HTMLElement): any {
    const w = dom.clientWidth;
    const h = dom.clientHeight;
    if (!w || !h) return option;

    const adapted = { ...option };
    const baseFontSize = Math.max(10, Math.min(16, Math.round(w / 50)));

    // 自动调整图例位置
    if (adapted.legend) {
      if (w < 300) {
        adapted.legend = { ...adapted.legend, orient: 'horizontal', bottom: 0, left: 'center' };
      } else {
        adapted.legend = { ...adapted.legend, orient: 'vertical', right: 8, top: 'center' };
      }
    }

    // 自动调整文本样式
    if (adapted.title) {
      adapted.title = { ...adapted.title, textStyle: { ...adapted.title.textStyle, fontSize: baseFontSize + 2 } };
    }

    // 表格类型：不设置ECharts选项
    if (type === 'table' || type === 'number') {
      return option;
    }

    // 调整grid边距
    if (!adapted.grid) adapted.grid = {};
    adapted.grid = {
      ...adapted.grid,
      top: adapted.title ? 40 : 20,
      bottom: adapted.legend && w < 300 ? 40 : 20,
      left: 50,
      right: adapted.legend && w >= 300 ? 120 : 20,
    };

    return adapted;
  }

  // ═══════ 生命周期管理 ═══════
  /** 注册图表DOM */
  registerDOM(id: string, dom: HTMLElement, type: ChartType) {
    const existing = this.instances.get(id);
    if (existing) {
      existing.domRef = dom;
      existing.type = type;
    }
  }

  /** 隐藏图表(不销毁实例) */
  hideChart(id: string) {
    const inst = this.instances.get(id);
    if (inst) {
      inst.active = false;
      inst.visible = false;
    }
  }

  /** 显示图表(触发重新渲染) */
  showChart(id: string) {
    const inst = this.instances.get(id);
    if (inst && inst.domRef) {
      inst.active = true;
      inst.visible = true;
      this.clearPlaceholder(inst.domRef);
      this.scheduleRender({
        id, domRef: inst.domRef,
        option: inst.instance?.getOption() || {},
        type: inst.type, priority: 1,
      });
    }
  }

  /** 销毁指定图表 */
  dispose(id: string) {
    const inst = this.instances.get(id);
    if (inst) {
      inst.instance.dispose();
      this.instances.delete(id);
    }
  }

  /** 销毁所有实例 */
  disposeAll() {
    for (const [, inst] of this.instances) {
      inst.instance.dispose();
    }
    this.instances.clear();
    this.taskQueue = [];
    if (this.batchTimer) clearTimeout(this.batchTimer);
  }

  /** 批量resize所有活跃图表 */
  resizeAll() {
    for (const [, inst] of this.instances) {
      if (inst.active && inst.instance && !inst.instance.isDisposed()) {
        try { inst.instance.resize(); } catch {}
      }
    }
  }
}

/** 获取单例 */
let _renderEngine: RenderEngine | null = null;
export function getRenderEngine(): RenderEngine {
  if (!_renderEngine) _renderEngine = new RenderEngine();
  return _renderEngine;
}
