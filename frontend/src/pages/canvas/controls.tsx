/** 画布编辑器 · 三栏分栏 / 收起条 / 对齐图标（与页面状态无关的 UI 件） */

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { ChevronLeft, ChevronRight } from "@mui/icons-material";

export function DistributeIcon({ axis }: { axis: "x" | "y" }) {
  const stops = [2.5, 8, 13.5];
  return (
    <Box component="svg" viewBox="0 0 18 18" sx={{ width: 17, height: 17, display: "block" }}>
      {stops.map((p, i) => (axis === "x"
        ? <rect key={i} x={p} y={2.5} width={2} height={13} rx={1} fill="currentColor" />
        : <rect key={i} x={2.5} y={p} width={13} height={2} rx={1} fill="currentColor" />))}
    </Box>
  );
}


export const paneDragging = { active: false };
/** 折叠/展开动画进行中：期间不重算画布，动画结束补一次，避免每帧重渲染 */
export const paneAnimating = { active: false };

/** PS 式拖拽分栏：拖拽中直接改 CSS 变量（零 React 重渲染），松手才落 state / localStorage */
export function useResizableWidth(
  key: string, initial: number, min: number, max: number,
  dir: 1 | -1 = 1, onResizeEnd?: () => void,
) {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(key) ?? localStorage.getItem(key.replace(/^mcbi\./, "mzbi.")));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : initial;
  });
  const paneRef = useRef<HTMLDivElement | null>(null);

  // 初值与拖拽结束都走这里写变量；sx 里只引用变量，重渲染不会覆盖拖拽结果
  useEffect(() => {
    const el = paneRef.current;
    if (el) el.style.setProperty("--pane-w", `${width}px`);
  }, [width]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el = paneRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startW = el.getBoundingClientRect().width;
    let latest = startW;
    let raf = 0;
    paneDragging.active = true;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const apply = () => { raf = 0; el.style.setProperty("--pane-w", `${latest}px`); };
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(max, Math.max(min, startW + (ev.clientX - startX) * dir));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      el.style.setProperty("--pane-w", `${latest}px`);
      const rounded = Math.round(latest);
      localStorage.setItem(key, String(rounded));
      paneDragging.active = false;
      setWidth(rounded);
      onResizeEnd?.();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [key, min, max, dir, onResizeEnd]);

  return { width, onDragStart, paneRef };
}

/** 折叠后的窄条：竖排标题，点击展开（PS 式收起面板） */
export function CollapseStrip({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      title={`展开${label}`}
      sx={{
        width: 24, flexShrink: 0, bgcolor: "#fff", cursor: "pointer",
        borderRight: side === "left" ? "1px solid #EEF3FB" : "none",
        borderLeft: side === "right" ? "1px solid #EEF3FB" : "none",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
        transition: "background-color .12s ease",
        animation: "mz-strip-in .18s ease both",
        "&:hover": { bgcolor: "rgba(79,70,229,0.05)" },
      }}
    >
      {side === "left"
        ? <ChevronRight sx={{ fontSize: 16, color: "#94A3B8" }} />
        : <ChevronLeft sx={{ fontSize: 16, color: "#94A3B8" }} />}
      <Typography sx={{ fontSize: 10.5, color: "#94A3B8", writingMode: "vertical-rl", letterSpacing: 1.5 }}>
        {label}
      </Typography>
    </Box>
  );
}

/** 面板内的折叠按钮（hover 才明显，保持界面干净） */
export function CollapseButton({ dir, title, onClick }: { dir: "left" | "right"; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <IconButton
      size="small" onClick={onClick} title={title}
      sx={{
        position: "absolute", top: 6, right: 4, zIndex: 7, width: 22, height: 22,
        color: "#94A3B8", opacity: 0.55, transition: "opacity .12s ease, color .12s ease",
        "&:hover": { opacity: 1, color: "#4F46E5", bgcolor: "rgba(79,70,229,0.08)" },
        "& .MuiSvgIcon-root": { fontSize: 16 },
      }}
    >
      {dir === "left" ? <ChevronLeft /> : <ChevronRight />}
    </IconButton>
  );
}

/** 分栏手柄：1px 分隔线，hover 变紫并加宽，光标 col-resize */
export function Splitter({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <Box
      onMouseDown={onMouseDown}
      sx={{
        width: 5, flexShrink: 0, cursor: "col-resize", position: "relative", zIndex: 3,
        "&::after": {
          content: '""', position: "absolute", top: 0, bottom: 0, left: 2, width: 1,
          bgcolor: "#EEF3FB", transition: "background-color .12s ease",
        },
        "&:hover::after, &:active::after": { bgcolor: "#4F46E5", width: 2, left: 1.5 },
      }}
    />
  );
}
