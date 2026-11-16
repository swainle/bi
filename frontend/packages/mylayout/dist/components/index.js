'use strict';

var React = require('react');
var jsxRuntime = require('react/jsx-runtime');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var React__default = /*#__PURE__*/_interopDefault(React);

// src/components/DroppableCanvas.tsx

// src/utils/constants.ts
var DEFAULT_CONFIG = {
  columns: 12,
  rowHeight: 80,
  cellPadding: 8,
  snapThreshold: 5,
  grid: 10
};
var DraggableCard = React__default.default.memo(function DraggableCard2({
  card,
  isSelected,
  isDragging,
  isLocked,
  zIndex = 1,
  dragProps,
  onClick,
  resizeHandles
}) {
  const divRef = React.useRef(null);
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
  return /* @__PURE__ */ jsxRuntime.jsxs(
    "div",
    {
      ref: divRef,
      style,
      onClick: handleClick,
      ...dragProps || {},
      "data-card-id": card.id,
      children: [
        /* @__PURE__ */ jsxRuntime.jsx("div", { style: {
          padding: "6px 10px",
          borderBottom: "1px solid #F3F4F6",
          fontSize: 11,
          fontWeight: 600,
          color: isSelected ? "#6366F1" : "#6B7280",
          background: isSelected ? "rgba(99,102,241,0.04)" : "transparent",
          flexShrink: 0
        }, children: card.id }),
        /* @__PURE__ */ jsxRuntime.jsxs("div", { style: {
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
var PlaceholderOverlay = React__default.default.memo(function PlaceholderOverlay2({
  cards,
  activeId
}) {
  return /* @__PURE__ */ jsxRuntime.jsx("div", { style: { position: "absolute", inset: 0, pointerEvents: "none", zIndex: 999 }, children: cards.map((card) => {
    const isActive = card.id === activeId;
    return /* @__PURE__ */ jsxRuntime.jsx(
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
var DroppableCanvas = React__default.default.forwardRef(
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
    const innerRef = React.useRef(null);
    React.useEffect(() => {
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
    const handleMouseDown = React.useCallback((e) => {
      if (e.target === e.currentTarget) {
        onCanvasClick?.();
      }
      onCanvasMouseDown?.(e);
    }, [onCanvasClick, onCanvasMouseDown]);
    return /* @__PURE__ */ jsxRuntime.jsxs("div", { ref: innerRef, style: containerStyle, onMouseDown: handleMouseDown, children: [
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
        return /* @__PURE__ */ jsxRuntime.jsx(
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
      placeholderCards && /* @__PURE__ */ jsxRuntime.jsx(
        PlaceholderOverlay,
        {
          cards: placeholderCards,
          activeId: draggingId
        }
      ),
      snapGuides?.map((g, i) => /* @__PURE__ */ jsxRuntime.jsx("div", { style: {
        position: "absolute",
        ...g.type === "x" ? { left: g.pos, top: g.from, width: 1, height: g.to - g.from || "100%" } : { top: g.pos, left: g.from, height: 1, width: g.to - g.from || "100%" },
        background: "#6366F1",
        zIndex: 9999,
        pointerEvents: "none"
      } }, i))
    ] });
  }
);

exports.DraggableCard = DraggableCard;
exports.DroppableCanvas = DroppableCanvas;
exports.PlaceholderOverlay = PlaceholderOverlay;
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map