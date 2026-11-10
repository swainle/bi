/**
 * 明策BI — 画布状态事务引擎
 *
 * 核心能力：
 *   1. 操作快照栈(撤销/重做) — 最多50步
 *   2. 乐观锁事务控制器 — 携带version防覆盖
 *   3. 批量操作事务打包 — 多选拖动打包一次事务
 *   4. IndexedDB本地缓存 — 刷新恢复未保存布局
 */

export interface EditorSnapshot {
  cards: any[];     // 完整卡片数据
  layout: any[];    // 布局坐标
  chartConfig: any; // 图表配置快照
  timestamp: number;
  version: number;
}

interface DraftState {
  cards: any[];
  layout: any[];
  lastSaved: number;
  dashboardId: string | null;
}

// ─── Engine ───
export class StateEngine {
  // 撤销栈
  private undoStack: EditorSnapshot[] = [];
  private redoStack: EditorSnapshot[] = [];
  private maxSteps = 50;

  // 乐观锁
  private currentVersion = 0;

  // 事务打包
  private batchedOps: Array<() => void> = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private BATCH_DELAY = 200; // ms

  // IndexedDB 本地缓存
  private dbName = 'bi-editor-drafts';
  private db: IDBDatabase | null = null;
  private draftKey = 'current_draft';

  // ─── 初始化 ───
  async init() {
    await this.openDB();
    const draft = await this.loadDraft();
    if (draft && Date.now() - draft.lastSaved < 3600000) {
      return draft; // 1小时内的草稿自动恢复
    }
    return null;
  }

  // ═══════ 撤销/重做 ═══════
  pushSnapshot(snapshot: EditorSnapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) {
      this.undoStack.shift();
    }
    this.redoStack = []; // 新操作清空重做栈
    this.currentVersion = snapshot.version;
  }

  undo(): EditorSnapshot | null {
    const current = this.undoStack.pop();
    if (!current) return null;
    this.redoStack.push(current);
    return this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1] : null;
  }

  redo(): EditorSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(next);
    return next;
  }

  get canUndo(): boolean { return this.undoStack.length > 1; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoDepth(): number { return this.undoStack.length; }

  // ═══════ 乐观锁 ═══════
  /** 获取当前版本号 */
  getVersion(): number { return this.currentVersion; }

  /** 递增版本号 */
  bumpVersion(): number { return ++this.currentVersion; }

  /** 检查版本冲突 */
  checkConflict(serverVersion: number): boolean {
    return serverVersion !== this.currentVersion;
  }

  // ═══════ 批量事务打包 ═══════
  /** 将操作加入事务包 */
  batch(operation: () => void) {
    this.batchedOps.push(operation);
    this.scheduleBatchCommit();
  }

  private scheduleBatchCommit() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.batchTimer = setTimeout(() => this.commitBatch(), this.BATCH_DELAY);
  }

  /** 提交批量事务 */
  commitBatch() {
    if (this.batchedOps.length === 0) return;
    const snapshot = this.createSnapshot();
    for (const op of this.batchedOps) {
      try { op(); } catch {}
    }
    this.batchedOps = [];
    this.pushSnapshot(snapshot);
    this.saveDraft();
  }

  forceCommit() {
    if (this.batchTimer) clearTimeout(this.batchTimer);
    this.commitBatch();
  }

  // ═══════ 快照 ═══════
  /** 创建当前状态快照 */
  createSnapshot(): EditorSnapshot {
    return {
      cards: [],
      layout: [],
      chartConfig: {},
      timestamp: Date.now(),
      version: this.currentVersion,
    };
  }

  /** 记录完整快照 */
  recordState(cards: any[], layout: any[], chartConfig?: any) {
    const snapshot: EditorSnapshot = {
      cards: JSON.parse(JSON.stringify(cards)),
      layout: JSON.parse(JSON.stringify(layout)),
      chartConfig: chartConfig ? JSON.parse(JSON.stringify(chartConfig)) : {},
      timestamp: Date.now(),
      version: this.bumpVersion(),
    };
    this.pushSnapshot(snapshot);
    this.saveDraft();
  }

  // ═══════ IndexedDB 本地缓存 ═══════
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async loadDraft(): Promise<DraftState | null> {
    if (!this.db) await this.openDB();
    return new Promise(resolve => {
      const txn = this.db!.transaction('drafts', 'readonly');
      const store = txn.objectStore('drafts');
      const request = store.get(this.draftKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  }

  private async saveDraft() {
    if (!this.db) await this.openDB();
    return new Promise<void>(resolve => {
      const txn = this.db!.transaction('drafts', 'readwrite');
      const store = txn.objectStore('drafts');
      store.put({
        cards: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].cards : [],
        layout: this.undoStack.length > 0 ? this.undoStack[this.undoStack.length - 1].layout : [],
        lastSaved: Date.now(),
        dashboardId: null,
      }, this.draftKey);
      txn.oncomplete = () => resolve();
    });
  }

  /** 清除草稿 */
  async clearDraft() {
    if (!this.db) await this.openDB();
    return new Promise<void>(resolve => {
      const txn = this.db!.transaction('drafts', 'readwrite');
      txn.objectStore('drafts').delete(this.draftKey);
      txn.oncomplete = () => resolve();
    });
  }

  // ─── 清理 ───
  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.batchedOps = [];
    this.currentVersion = 0;
    if (this.batchTimer) clearTimeout(this.batchTimer);
  }
}

let _stateEngine: StateEngine | null = null;
export function getStateEngine(): StateEngine {
  if (!_stateEngine) _stateEngine = new StateEngine();
  return _stateEngine;
}
