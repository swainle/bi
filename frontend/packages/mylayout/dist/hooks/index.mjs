import { useState, useRef, useCallback } from 'react';

// src/hooks/useDrag.ts

// src/utils/constants.ts
var DEFAULT_CONFIG = {
  snapThreshold: 5};

// src/hooks/useDrag.ts
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

export { useDrag, useResize };
//# sourceMappingURL=index.mjs.map
//# sourceMappingURL=index.mjs.map