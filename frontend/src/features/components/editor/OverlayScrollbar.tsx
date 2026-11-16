/** 细滚动条覆盖层：原生滚动条隐藏，hover 才显示、长度有上限、可拖动
 *
 *  用法：父容器 position: relative + overflowY: auto + 隐藏原生滚动条，
 *  本组件 targetRef 指向那个滚动容器。
 */

import { useEffect, useRef } from "react";
import { Box } from "@mui/material";

/** 滑块最长不超过容器高度的这个比例（原生滑块会按内容比例拉满，观感太长） */
const MAX_RATIO = 0.38;
const MIN_H = 28;

interface Props {
  targetRef: React.RefObject<HTMLElement | null>;
}

export default function OverlayScrollbar({ targetRef }: Props) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = targetRef.current;
    const bar = barRef.current;
    if (!el || !bar) return;

    let raf = 0;
    let dragging = false;

    const metrics = () => {
      const ch = el.clientHeight;
      const sh = el.scrollHeight;
      const h = Math.min(Math.round(ch * MAX_RATIO), Math.max(MIN_H, (ch * ch) / Math.max(1, sh)));
      return { ch, sh, h, track: ch - h, max: Math.max(0, sh - ch) };
    };

    const render = () => {
      raf = 0;
      const { ch, sh, h, track, max } = metrics();
      const scrollable = sh > ch + 1;
      bar.style.height = `${h}px`;
      bar.style.transform = `translateY(${max > 0 ? Math.round((el.scrollTop / max) * track) : 0}px)`;
      bar.style.opacity = dragging || (scrollable && el.matches(":hover")) ? "1" : "0";
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(render); };

    const onScroll = () => schedule();
    const onEnter = () => schedule();
    const onLeave = () => { if (!dragging) schedule(); };

    const onBarDown = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const { track, max } = metrics();
      if (track <= 0) return;
      dragging = true;
      bar.style.opacity = "1";
      const startY = e.clientY;
      const startTop = el.scrollTop;
      const move = (ev: MouseEvent) => {
        el.scrollTop = startTop + ((ev.clientY - startY) / track) * max;
        schedule();
      };
      const up = () => {
        dragging = false;
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        schedule();
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    bar.addEventListener("mousedown", onBarDown);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      bar.removeEventListener("mousedown", onBarDown);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [targetRef]);

  return (
    <Box
      ref={barRef}
      data-overlay-scroll="1"
      sx={{
        position: "absolute", top: 0, right: 3, width: 4, borderRadius: 999,
        bgcolor: "rgba(148,163,184,0.45)", opacity: 0, zIndex: 6,
        transition: "opacity .12s ease", cursor: "pointer", pointerEvents: "auto",
      }}
    />
  );
}
