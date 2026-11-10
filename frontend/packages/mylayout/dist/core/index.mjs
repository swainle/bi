// src/utils/collision.ts
var SpatialHash = class {
  constructor(cellSize = 50) {
    this.cells = /* @__PURE__ */ new Map();
    this.cellSize = cellSize;
  }
  /** 清空所有格网 */
  clear() {
    this.cells.clear();
  }
  /** 从卡片数组构建格网 */
  build(rects) {
    this.clear();
    for (const { id, rect } of rects) {
      this.insert(id, rect);
    }
  }
  /** 插入单个卡片 */
  insert(id, rect) {
    const keys = this.getKeys(rect);
    for (const key of keys) {
      const list = this.cells.get(key);
      if (list) {
        list.push(id);
      } else {
        this.cells.set(key, [id]);
      }
    }
  }
  /** 查询与指定矩形可能碰撞的卡片 */
  query(rect) {
    const keys = this.getKeys(rect);
    const seen = /* @__PURE__ */ new Set();
    for (const key of keys) {
      const list = this.cells.get(key);
      if (list) {
        for (const id of list) seen.add(id);
      }
    }
    return Array.from(seen);
  }
  /** 检测所有两两碰撞 */
  detectAll(ids, getRect) {
    const collisions = [];
    const checked = /* @__PURE__ */ new Set();
    for (const id of ids) {
      const rect = getRect(id);
      const candidates = this.query(rect);
      for (const otherId of candidates) {
        if (id === otherId) continue;
        const pairKey = [id, otherId].sort().join("::");
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);
        const otherRect = getRect(otherId);
        const overlap = rectIntersection(rect, otherRect);
        if (overlap) {
          collisions.push({ id1: id, id2: otherId, overlap });
        }
      }
    }
    return collisions;
  }
  /** 检查两个矩形是否碰撞 */
  static intersects(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }
  /** 获取覆盖指定矩形的格网 key 列表 */
  getKeys(rect) {
    const keys = [];
    const x0 = Math.floor(rect.x / this.cellSize);
    const y0 = Math.floor(rect.y / this.cellSize);
    const x1 = Math.floor((rect.x + rect.w) / this.cellSize);
    const y1 = Math.floor((rect.y + rect.h) / this.cellSize);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
};
function rectIntersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const h = Math.min(a.y + a.h, b.y + b.h) - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}
function rectContains(rect, px, py) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// src/utils/constants.ts
var DEFAULT_CONFIG = {
  columns: 12,
  rowHeight: 80,
  cellPadding: 8,
  snapThreshold: 5,
  grid: 10
};

// src/utils/snap.ts
function computeSnap(movingCard, allCards, hash, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  const threshold = c.snapThreshold;
  const guides = [];
  const candidates = hash.query(movingCard.rect);
  const m = movingCard.rect;
  const mcx = m.x + m.w / 2;
  const mcy = m.y + m.h / 2;
  const lefts = [];
  const rights = [];
  const tops = [];
  const bottoms = [];
  const hcenters = [];
  const vcenters = [];
  for (const id of candidates) {
    if (id === movingCard.id) continue;
    const card = allCards.find((d) => d.id === id);
    if (!card) continue;
    const r = card.rect;
    lefts.push(r.x);
    rights.push(r.x + r.w);
    tops.push(r.y);
    bottoms.push(r.y + r.h);
    hcenters.push(r.x + r.w / 2);
    vcenters.push(r.y + r.h / 2);
  }
  const leftSnap = nearestWithin(m.x, lefts, threshold);
  if (leftSnap !== null) {
    guides.push(createLine("x", leftSnap, m.y, m.y + m.h));
  }
  const rightSnap = nearestWithin(m.x + m.w, rights, threshold);
  if (rightSnap !== null) {
    guides.push(createLine("x", rightSnap, m.y, m.y + m.h));
  }
  const topSnap = nearestWithin(m.y, tops, threshold);
  if (topSnap !== null) {
    guides.push(createLine("y", topSnap, m.x, m.x + m.w));
  }
  const bottomSnap = nearestWithin(m.y + m.h, bottoms, threshold);
  if (bottomSnap !== null) {
    guides.push(createLine("y", bottomSnap, m.x, m.x + m.w));
  }
  const hcenterSnap = nearestWithin(mcx, hcenters, threshold);
  if (hcenterSnap !== null) {
    guides.push(createLine("x", hcenterSnap, m.y, m.y + m.h));
  }
  const vcenterSnap = nearestWithin(mcy, vcenters, threshold);
  if (vcenterSnap !== null) {
    guides.push(createLine("y", vcenterSnap, m.x, m.x + m.w));
  }
  const hGapSnap = detectEqualGap(movingCard, allCards, "h", threshold);
  guides.push(...hGapSnap);
  const vGapSnap = detectEqualGap(movingCard, allCards, "v", threshold);
  guides.push(...vGapSnap);
  return deduplicateGuides(guides);
}
function nearestWithin(value, targets, threshold) {
  let best = null;
  let bestDist = Infinity;
  for (const t of targets) {
    const dist = Math.abs(value - t);
    if (dist <= threshold && dist < bestDist) {
      best = t;
      bestDist = dist;
    }
  }
  return best;
}
function detectEqualGap(moving, allCards, direction, threshold) {
  const guides = [];
  const isH = direction === "h";
  for (const a of allCards) {
    for (const b of allCards) {
      if (a.id === b.id || a.id === moving.id || b.id === moving.id) continue;
      const aEdge = isH ? a.rect.x : a.rect.y;
      const bEdge = isH ? b.rect.x : b.rect.y;
      const abGap = Math.abs(aEdge - bEdge);
      const mAEdge = isH ? a.rect.x : a.rect.y;
      const mMEdge = isH ? moving.rect.x : moving.rect.y;
      const amGap = Math.abs(mAEdge - mMEdge);
      if (Math.abs(abGap - amGap) <= threshold && abGap > threshold) {
        const pos = (mAEdge + mMEdge) / 2;
        guides.push(createLine(isH ? "x" : "y", pos, 0, 0));
      }
    }
  }
  return guides;
}
function createLine(type, pos, from, to) {
  return { type, pos, from, to };
}
function deduplicateGuides(guides) {
  const seen = /* @__PURE__ */ new Map();
  for (const g of guides) {
    const key = `${g.type}:${Math.round(g.pos)}`;
    const existing = seen.get(key);
    if (existing) {
      existing.from = Math.min(existing.from, g.from);
      existing.to = Math.max(existing.to, g.to);
    } else {
      seen.set(key, { ...g });
    }
  }
  return Array.from(seen.values());
}

// src/core/history.ts
var HistoryManager = class {
  constructor(maxSize = 50) {
    this.undoStack = [];
    this.redoStack = [];
    this.maxSize = maxSize;
  }
  /** 执行一个命令并推入历史 */
  execute(command) {
    command.execute();
    this.undoStack.push(command);
    this.redoStack = [];
    this.trim();
  }
  /** 撤销 */
  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.undo();
    this.redoStack.push(cmd);
    this.trim();
    return true;
  }
  /** 重做 */
  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.execute();
    this.undoStack.push(cmd);
    this.trim();
    return true;
  }
  /** 能否撤销 */
  get canUndo() {
    return this.undoStack.length > 0;
  }
  /** 能否重做 */
  get canRedo() {
    return this.redoStack.length > 0;
  }
  /** 历史深度 */
  get undoDepth() {
    return this.undoStack.length;
  }
  get redoDepth() {
    return this.redoStack.length;
  }
  /** 清空历史 */
  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
  trim() {
    while (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
    while (this.redoStack.length > this.maxSize) {
      this.redoStack.shift();
    }
  }
};
var MoveCommand = class {
  constructor(cardId, from, to, setPosition) {
    this.cardId = cardId;
    this.from = from;
    this.to = to;
    this.setPosition = setPosition;
    this.label = "\u79FB\u52A8";
  }
  execute() {
    this.setPosition(this.cardId, this.to.x, this.to.y);
  }
  undo() {
    this.setPosition(this.cardId, this.from.x, this.from.y);
  }
};
var BatchMoveCommand = class {
  constructor(from, to, setPosition) {
    this.from = from;
    this.to = to;
    this.setPosition = setPosition;
    this.label = "\u6279\u91CF\u79FB\u52A8";
  }
  execute() {
    for (const [id, pos] of this.to) {
      this.setPosition(id, pos.x, pos.y);
    }
  }
  undo() {
    for (const [id, pos] of this.from) {
      this.setPosition(id, pos.x, pos.y);
    }
  }
};

// src/utils/transform.ts
function gridXToPx(col, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  return col * (c.rowHeight || 80) + (col + 1) * c.cellPadding;
}
function gridYToPx(row, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  return row * c.rowHeight + (row + 1) * c.cellPadding;
}
function gridWToPx(cols, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  return cols * c.rowHeight + (cols - 1) * c.cellPadding;
}
function gridHToPx(rows, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  return rows * c.rowHeight + (rows - 1) * c.cellPadding;
}
function pxToGridX(px, canvasWidth, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  const colW = (canvasWidth - c.cellPadding) / c.columns - c.cellPadding;
  return Math.round((px - c.cellPadding) / (colW + c.cellPadding));
}
function pxToGridY(py, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  return Math.round((py - c.cellPadding) / c.rowHeight);
}

// src/core/grid.ts
var GridSystem = class {
  constructor(canvasWidth, config = {}) {
    this.canvasWidth = canvasWidth;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.history = new HistoryManager();
    this.hash = new SpatialHash(this.config.cellPadding * 4);
  }
  updateCanvasWidth(w) {
    this.canvasWidth = w;
  }
  // ═══════ Grid ↔ Pixel 转换 ═══════
  gridToPixel(card) {
    return {
      x: gridXToPx(card.x, this.config),
      y: gridYToPx(card.y, this.config),
      w: gridWToPx(card.w, this.config),
      h: gridHToPx(card.h, this.config)
    };
  }
  pixelToGrid(px, py) {
    return {
      x: pxToGridX(px, this.canvasWidth, this.config),
      y: pxToGridY(py, this.config)
    };
  }
  // ═══════ 碰撞检测 ═══════
  /** 重建空间哈希索引 */
  buildIndex(cards) {
    const rects = cards.map((c) => ({
      id: c.id,
      rect: this.cardToRect(c)
    }));
    this.hash.build(rects);
  }
  /** 检测拖拽移动后的碰撞 */
  detectCollisions(movingId, movingRect, allCards) {
    const cards = allCards.filter((c) => c.id !== movingId).map((c) => ({ id: c.id, rect: this.cardToRect(c) }));
    this.hash.build([...cards, { id: movingId, rect: movingRect }]);
    const collisions = this.hash.query(movingRect);
    return collisions.filter((id) => id !== movingId);
  }
  // ═══════ 吸附 ═══════
  /** 计算拖拽中的吸附引导线 */
  computeSnapGuides(movingId, movingRect, allCards) {
    const cards = allCards.filter((c) => c.id !== movingId).map((c) => ({ id: c.id, rect: this.cardToRect(c) }));
    this.hash.build(cards.map((c) => ({ id: c.id, rect: c.rect })));
    return computeSnap(
      { id: movingId, rect: movingRect },
      cards,
      this.hash,
      this.config
    );
  }
  // ═══════ 占位符 ═══════
  /**
   * 计算拖拽占位：在 targetRect 位置插入卡片，向下推移被碰撞的卡片
   * 返回更新后的卡片位置（不修改原状态）
   */
  computePlaceholder(movingId, targetRect, cards) {
    const result = [...cards];
    const target = this.pixelToGrid(targetRect.x, targetRect.y);
    for (const card of result) {
      if (card.id === movingId) {
        card.x = target.x;
        card.y = target.y;
        break;
      }
    }
    for (const card of result) {
      if (card.id === movingId || card.locked) continue;
      const cardRect = this.cardToRect(card);
      if (SpatialHash.intersects(cardRect, targetRect)) {
        card.y += 1;
      }
    }
    return result;
  }
  // ═══════ 工具方法 ═══════
  cardToRect(card) {
    const px = gridXToPx(card.x, this.config);
    const py = gridYToPx(card.y, this.config);
    const pw = gridWToPx(card.w, this.config);
    const ph = gridHToPx(card.h, this.config);
    return { x: px, y: py, w: pw, h: ph };
  }
  /** 将像素偏移转换为网格偏移 */
  deltaToGrid(dx, dy) {
    const colW = (this.canvasWidth - this.config.cellPadding) / this.config.columns - this.config.cellPadding;
    return {
      dx: Math.round(dx / (colW + this.config.cellPadding)),
      dy: Math.round(dy / (this.config.rowHeight + this.config.cellPadding))
    };
  }
};

export { BatchMoveCommand, GridSystem, HistoryManager, MoveCommand, SpatialHash, computeSnap, rectContains, rectIntersection };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map