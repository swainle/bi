import React, { useRef, useEffect, useCallback, useState } from 'react';
import { jsxs, jsx } from 'react/jsx-runtime';

// src/utils/constants.ts
var DEFAULT_CONFIG = {
  columns: 12,
  rowHeight: 80,
  cellPadding: 8,
  snapThreshold: 5,
  grid: 10
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
function toPixelCard(card, canvasWidth, config = {}) {
  const c = { ...DEFAULT_CONFIG, ...config };
  const colW = (canvasWidth - c.cellPadding) / c.columns - c.cellPadding;
  return {
    ...card,
    px: card.x * (colW + c.cellPadding) + c.cellPadding,
    py: card.y * c.rowHeight + (card.y + 1) * c.cellPadding,
    pw: card.w * (colW + c.cellPadding) - c.cellPadding,
    ph: card.h * c.rowHeight + (card.h - 1) * c.cellPadding
  };
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
function useDrag(options = {}) {
  const {
    onDragStart,
    onDragEnd,
    snapThreshold = DEFAULT_CONFIG.snapThreshold,
    onSnapGuides
  } = options;
  const [dragState, setDragState] = useState({
    activeId: null,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false
  });
  const rafRef = useRef(0);
  const lastMoveRef = useRef({ x: 0, y: 0 });
  const hasMovedRef = useRef(false);
  const threshold = 5;
  const handlePointerDown = useCallback((id, e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragState({
      activeId: id,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: 0,
      offsetY: 0,
      isDragging: false
    });
    lastMoveRef.current = { x: e.clientX, y: e.clientY };
    hasMovedRef.current = false;
    onDragStart?.(id, e.clientX, e.clientY);
  }, [onDragStart]);
  const handlePointerMove = useCallback((e) => {
    if (!dragState.activeId) return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (!hasMovedRef.current && Math.abs(dx) + Math.abs(dy) < threshold) return;
    hasMovedRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setDragState((prev) => ({
        ...prev,
        offsetX: e.clientX - prev.startX,
        offsetY: e.clientY - prev.startY,
        isDragging: true
      }));
      lastMoveRef.current = { x: e.clientX, y: e.clientY };
    });
  }, [dragState.activeId, dragState.startX, dragState.startY]);
  const handlePointerUp = useCallback((e) => {
    if (!dragState.activeId) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const el = e.currentTarget;
    el.releasePointerCapture(e.pointerId);
    const finalDx = lastMoveRef.current.x - dragState.startX;
    const finalDy = lastMoveRef.current.y - dragState.startY;
    const snappedDx = Math.round(finalDx / snapThreshold) * snapThreshold;
    const snappedDy = Math.round(finalDy / snapThreshold) * snapThreshold;
    onDragEnd?.(dragState.activeId, snappedDx, snappedDy);
    setDragState({
      activeId: null,
      startX: 0,
      startY: 0,
      offsetX: 0,
      offsetY: 0,
      isDragging: false
    });
  }, [dragState.activeId, dragState.startX, dragState.startY, snapThreshold, onDragEnd]);
  return {
    dragState,
    /** 绑定到可拖拽元素的 props */
    bindDrag: (id) => ({
      onPointerDown: (e) => handlePointerDown(id, e),
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
      style: dragState.activeId === id && dragState.isDragging ? {
        transform: `translate3d(${dragState.offsetX}px, ${dragState.offsetY}px, 0)`,
        opacity: 0.4,
        zIndex: 1e3,
        cursor: "grabbing",
        touchAction: "none"
      } : { cursor: "grab", touchAction: "none" }
    })
  };
}
function useResize(options = {}) {
  const { minW = 60, minH = 40, onResizeEnd } = options;
  const [resizeState, setResizeState] = useState({
    activeId: null,
    direction: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
    isResizing: false
  });
  const rafRef = useRef(0);
  const handleResizeStart = useCallback((id, direction, e) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setResizeState({
      activeId: id,
      direction,
      startX: e.clientX,
      startY: e.clientY,
      deltaX: 0,
      deltaY: 0,
      isResizing: false
    });
  }, []);
  const handleResizeMove = useCallback((e) => {
    if (!resizeState.activeId) return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setResizeState((prev) => ({
        ...prev,
        deltaX: e.clientX - prev.startX,
        deltaY: e.clientY - prev.startY,
        isResizing: true
      }));
    });
  }, [resizeState.activeId]);
  const handleResizeEnd = useCallback((e) => {
    if (!resizeState.activeId || !resizeState.direction) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const el = e.currentTarget;
    el.releasePointerCapture(e.pointerId);
    onResizeEnd?.(
      resizeState.activeId,
      resizeState.direction,
      resizeState.deltaX,
      resizeState.deltaY
    );
    setResizeState({
      activeId: null,
      direction: null,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0,
      isResizing: false
    });
  }, [resizeState.activeId, resizeState.direction, resizeState.deltaX, resizeState.deltaY, onResizeEnd]);
  const getHandleStyle = (dir) => {
    const cursorMap = {
      se: "nwse-resize",
      e: "ew-resize",
      s: "ns-resize",
      nw: "nwse-resize",
      ne: "nesw-resize",
      sw: "nesw-resize",
      n: "ns-resize",
      w: "ew-resize"
    };
    const posMap = {
      se: { right: -4, bottom: -4 },
      e: { right: -4, top: "50%", marginTop: -4 },
      s: { bottom: -4, left: "50%", marginLeft: -4 },
      nw: { left: -4, top: -4 },
      ne: { right: -4, top: -4 },
      sw: { left: -4, bottom: -4 },
      n: { top: -4, left: "50%", marginLeft: -4 },
      w: { left: -4, top: "50%", marginTop: -4 }
    };
    return {
      position: "absolute",
      width: 8,
      height: 8,
      cursor: cursorMap[dir],
      zIndex: 20,
      ...posMap[dir]
    };
  };
  const dotStyle = {
    position: "absolute",
    width: 6,
    height: 6,
    background: "#6366F1",
    borderRadius: "50%",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)"
  };
  return {
    resizeState,
    minW,
    minH,
    /** 绑定缩放手柄的 props */
    bindResizeHandle: (id, dir) => ({
      style: getHandleStyle(dir),
      onPointerDown: (e) => handleResizeStart(id, dir, e),
      onPointerMove: handleResizeMove,
      onPointerUp: handleResizeEnd,
      onPointerCancel: handleResizeEnd
    }),
    /** 缩放手柄内部指示点 */
    dotStyle
  };
}
var DraggableCard = React.memo(function DraggableCard2({
  card,
  isSelected,
  isDragging,
  isLocked,
  zIndex = 1,
  dragProps,
  onClick,
  resizeHandles
}) {
  const divRef = useRef(null);
  const style = {
    position: "absolute",
    left: card.px,
    top: card.py,
    width: card.pw,
    height: card.ph,
    zIndex: isDragging ? 1e3 : zIndex,
    opacity: isDragging ? 0.4 : isLocked ? 0.8 : 1,
    cursor: isLocked ? "not-allowed" : isDragging ? "grabbing" : "grab",
    transition: isDragging ? "none" : "box-shadow 0.1s",
    touchAction: isLocked ? "auto" : "none",
    borderRadius: 8,
    background: "#fff",
    border: isSelected ? "2px solid #6366F1" : "1px solid #E5E7EB",
    boxShadow: isSelected ? "0 0 0 2px rgba(99,102,241,0.15), 0 2px 8px rgba(0,0,0,0.08)" : "0 1px 3px rgba(0,0,0,0.06)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column"
  };
  if (dragProps) {
    Object.assign(style, dragProps.style || {});
  }
  const handleClick = (e) => {
    e.stopPropagation();
    onClick?.(e.shiftKey);
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      ref: divRef,
      style,
      onClick: handleClick,
      ...dragProps || {},
      "data-card-id": card.id,
      children: [
        /* @__PURE__ */ jsx("div", { style: {
          padding: "6px 10px",
          borderBottom: "1px solid #F3F4F6",
          fontSize: 11,
          fontWeight: 600,
          color: isSelected ? "#6366F1" : "#6B7280",
          background: isSelected ? "rgba(99,102,241,0.04)" : "transparent",
          flexShrink: 0
        }, children: card.id }),
        /* @__PURE__ */ jsxs("div", { style: {
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#9CA3AF",
          fontSize: 12,
          padding: 8
        }, children: [
          card.ph,
          "\xD7",
          card.pw
        ] }),
        !isLocked && isSelected && resizeHandles
      ]
    }
  );
});
var PlaceholderOverlay = React.memo(function PlaceholderOverlay2({
  cards,
  activeId
}) {
  return /* @__PURE__ */ jsx("div", { style: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 999 }, children: cards.map((card) => {
    const isActive = card.id === activeId;
    return /* @__PURE__ */ jsx(
      "div",
      {
        style: {
          position: "absolute",
          left: card.px,
          top: card.py,
          width: card.pw,
          height: card.ph,
          borderRadius: 8,
          border: isActive ? "2px dashed #6366F1" : "1px dashed #D1D5DB",
          background: isActive ? "rgba(99,102,241,0.06)" : "rgba(0,0,0,0.02)",
          transition: "all 0.1s ease"
        }
      },
      `ph-${card.id}`
    );
  }) });
});
var DroppableCanvas = React.forwardRef(
  function DroppableCanvas2(props, ref) {
    const {
      cards,
      canvasWidth,
      selectedIds = [],
      draggingId,
      dragOffset,
      resizeState,
      layoutConfig,
      background = "dots",
      placeholderCards,
      snapGuides,
      onSelect,
      onCanvasClick,
      onCanvasMouseDown,
      getDragProps,
      renderResizeHandles
    } = props;
    const { grid } = { ...DEFAULT_CONFIG, ...layoutConfig };
    const innerRef = useRef(null);
    useEffect(() => {
      if (!ref) return;
      if (typeof ref === "function") {
        ref(innerRef.current);
      } else {
        ref.current = innerRef.current;
      }
    }, [ref]);
    const maxBottom = cards.length > 0 ? Math.max(...cards.map((c) => c.py + c.ph)) : 600;
    const containerStyle = {
      width: canvasWidth || "100%",
      minHeight: Math.max(600, maxBottom + 200),
      position: "relative",
      userSelect: "none",
      overflow: "hidden"
    };
    if (background === "dots") {
      containerStyle.backgroundImage = `radial-gradient(circle, rgba(0,0,0,0.05) 1px, transparent 1px)`;
      containerStyle.backgroundSize = `${grid}px ${grid}px`;
    } else if (background === "lines") {
      containerStyle.background = "#FFFFFF";
      containerStyle.backgroundImage = `linear-gradient(rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.05) 1px, transparent 1px)`;
      containerStyle.backgroundSize = `${grid}px ${grid}px`;
    } else {
      containerStyle.background = "#FFFFFF";
    }
    const handleMouseDown = useCallback((e) => {
      if (e.target === e.currentTarget) {
        onCanvasClick?.();
      }
      onCanvasMouseDown?.(e);
    }, [onCanvasClick, onCanvasMouseDown]);
    return /* @__PURE__ */ jsxs("div", { ref: innerRef, style: containerStyle, onMouseDown: handleMouseDown, children: [
      cards.map((card) => {
        const isSelected = selectedIds.includes(card.id);
        const isDragging = draggingId === card.id;
        let displayCard = card;
        if (isDragging && dragOffset) {
          displayCard = {
            ...card,
            px: card.px + dragOffset.x,
            py: card.py + dragOffset.y
          };
        }
        let resizeAdjusted = displayCard;
        if (resizeState?.activeId === card.id && resizeState.isResizing) {
          const dir = resizeState.direction;
          const dx = resizeState.deltaX;
          const dy = resizeState.deltaY;
          resizeAdjusted = { ...displayCard };
          if (dir?.includes("e") || dir?.includes("se") || dir?.includes("ne")) {
            resizeAdjusted.pw = Math.max(60, displayCard.pw + dx);
          }
          if (dir?.includes("s") || dir?.includes("se") || dir?.includes("sw")) {
            resizeAdjusted.ph = Math.max(40, displayCard.ph + dy);
          }
          if (dir?.includes("w") || dir?.includes("nw") || dir?.includes("sw")) {
            resizeAdjusted.px = displayCard.px + Math.min(dx, displayCard.pw - 60);
            resizeAdjusted.pw = Math.max(60, displayCard.pw - dx);
          }
          if (dir?.includes("n") || dir?.includes("nw") || dir?.includes("ne")) {
            resizeAdjusted.py = displayCard.py + Math.min(dy, displayCard.ph - 40);
            resizeAdjusted.ph = Math.max(40, displayCard.ph - dy);
          }
        }
        return /* @__PURE__ */ jsx(
          DraggableCard,
          {
            card: resizeAdjusted,
            isSelected,
            isDragging,
            isLocked: card.locked,
            zIndex: isDragging ? 1e3 : card.zIndex || 1,
            dragProps: getDragProps?.(card.id),
            onClick: (shift) => onSelect?.(card.id, shift),
            resizeHandles: renderResizeHandles?.(card.id)
          },
          card.id
        );
      }),
      placeholderCards && /* @__PURE__ */ jsx(
        PlaceholderOverlay,
        {
          cards: placeholderCards,
          activeId: draggingId
        }
      ),
      snapGuides?.map((g, i) => /* @__PURE__ */ jsx("div", { style: {
        position: "absolute",
        ...g.type === "x" ? { left: g.pos, top: g.from, width: 1, height: g.to - g.from || "100%" } : { top: g.pos, left: g.from, height: 1, width: g.to - g.from || "100%" },
        background: "#6366F1",
        zIndex: 9999,
        pointerEvents: "none"
      } }, i))
    ] });
  }
);

export { BatchMoveCommand, DEFAULT_CONFIG, DraggableCard, DroppableCanvas, GridSystem, HistoryManager, MoveCommand, PlaceholderOverlay, SpatialHash, computeSnap, gridHToPx, gridWToPx, gridXToPx, gridYToPx, pxToGridX, pxToGridY, rectContains, rectIntersection, toPixelCard, useDrag, useResize };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map