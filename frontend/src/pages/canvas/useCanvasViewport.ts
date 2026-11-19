import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const clampZoom = (scale: number) => Math.min(2, Math.max(0.25, scale));

export function canvasPoint(point: { x: number; y: number }, origin: { x: number; y: number }, scale: number) {
  return { x: (point.x - origin.x) / scale, y: (point.y - origin.y) / scale };
}

export function zoomOrigin(point: { x: number; y: number }, origin: { x: number; y: number }, scale: number, nextScale: number) {
  const anchor = canvasPoint(point, origin, scale);
  return { x: point.x - anchor.x * nextScale, y: point.y - anchor.y * nextScale };
}

export function canvasPanForOrigin(origin: { x: number; y: number }, scale: number, width: number, designWidth: number) {
  return { x: origin.x - Math.max(0, Math.round((width - designWidth * scale) / 2)), y: origin.y - 24 };
}

export const isViewportInput = (target: EventTarget | null) =>
  target instanceof HTMLElement && !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']");

export function useCanvasViewport(canvasRef: RefObject<HTMLDivElement>, fitScale: number, width: number, designWidth: number) {
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const scale = manualScale ?? clampZoom(fitScale);
  const centeredX = (nextScale: number) => Math.max(0, Math.round((width - designWidth * nextScale) / 2));
  const offsetX = centeredX(scale) + pan.x;
  const offsetY = 24 + pan.y;
  const geometry = useRef({ designWidth, scale, offsetX, offsetY });
  useLayoutEffect(() => {
    const previous = geometry.current;
    geometry.current = { designWidth, scale, offsetX, offsetY };
    // 改实际宽度时固定原点和查看比例，避免自动适宽把左上角一起挪走。
    if (previous.designWidth !== designWidth) {
      setManualScale(previous.scale);
      setPan(canvasPanForOrigin({ x: previous.offsetX, y: previous.offsetY }, previous.scale, width, designWidth));
    }
  });
  const zoomTo = (next: number | null, point?: { x: number; y: number }) => {
    if (next === null) {
      setManualScale(null);
      setPan({ x: 0, y: 0 });
      return;
    }
    const el = canvasRef.current;
    const nextScale = clampZoom(next);
    if (el) {
      const origin = zoomOrigin(point ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 }, { x: offsetX, y: offsetY }, scale, nextScale);
      setPan(canvasPanForOrigin(origin, nextScale, width, designWidth));
    }
    setManualScale(nextScale);
  };
  const current = useRef({ scale, pan, zoomTo });
  current.current = { scale, pan, zoomTo };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let space = false;
    let dragged = false;
    let frame = 0;
    let nextPan: { x: number; y: number } | null = null;
    let drag: { x: number; y: number; pan: { x: number; y: number }; pointerId: number } | null = null;
    const flush = () => {
      frame = 0;
      if (nextPan) { setPan(nextPan); nextPan = null; }
    };
    const schedule = (next: { x: number; y: number }) => {
      nextPan = next;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const cursor = () => {
      if (drag || space) el.dataset.pan = drag ? "dragging" : "ready";
      else delete el.dataset.pan;
    };
    const stop = () => {
      if (drag && el.hasPointerCapture(drag.pointerId)) el.releasePointerCapture(drag.pointerId);
      drag = null;
      if (frame) cancelAnimationFrame(frame);
      flush();
      cursor();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isViewportInput(event.target)) return;
      if (event.code === "Space" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault(); space = true; cursor();
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        current.current.zoomTo(event.key === "0" ? 1 : current.current.scale + (event.key === "-" ? -0.1 : 0.1));
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") { space = false; cursor(); }
    };
    const blur = () => { space = false; stop(); };
    const down = (event: PointerEvent) => {
      if (!(event.button === 1 || (space && event.button === 0)) || isViewportInput(event.target)) return;
      event.preventDefault(); event.stopPropagation();
      dragged = false;
      drag = { x: event.clientX, y: event.clientY, pan: current.current.pan, pointerId: event.pointerId };
      el.setPointerCapture(event.pointerId); cursor();
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopPropagation();
      dragged = true;
      schedule({ x: drag.pan.x + event.clientX - drag.x, y: drag.pan.y + event.clientY - drag.y });
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      event.preventDefault(); event.stopPropagation(); stop();
    };
    const wheel = (event: WheelEvent) => {
      if (isViewportInput(event.target)) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        current.current.zoomTo(current.current.scale + (event.deltaY > 0 ? -0.1 : event.deltaY < 0 ? 0.1 : 0), {
          x: event.clientX - rect.left, y: event.clientY - rect.top,
        });
      } else {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1;
        const deltaX = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const deltaY = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        const base = nextPan ?? current.current.pan;
        schedule({ x: base.x - deltaX * unit, y: base.y - deltaY * unit });
      }
    };
    const click = (event: MouseEvent) => {
      if (space || dragged || event.button === 1) { event.preventDefault(); event.stopPropagation(); dragged = false; }
    };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("pointerdown", down, true);
    el.addEventListener("pointermove", move, true);
    el.addEventListener("pointerup", up, true);
    el.addEventListener("pointercancel", up, true);
    el.addEventListener("click", click, true);
    el.addEventListener("auxclick", click, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      nextPan = null;
      space = false; stop();
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("pointermove", move, true);
      el.removeEventListener("pointerup", up, true);
      el.removeEventListener("pointercancel", up, true);
      el.removeEventListener("click", click, true);
      el.removeEventListener("auxclick", click, true);
    };
  }, [canvasRef]);

  return { scale, offsetX, offsetY, zoomTo };
}
