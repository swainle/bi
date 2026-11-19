/** 画布编辑器 · 撤销 / 重做（版面快照栈 + 拖拽按一次交互记一步 + ⌘Z 快捷键） */

import type { Dispatch, RefObject, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CanvasItem } from "../../features/components/boardTypes";
import type { CanvasSize, DocItem, Guide } from "../../features/components/types";
import { toCanvasItem, toDocItem } from "./spec";

export function useCanvasHistory({
  items, guides, setItems, setGuides, setDirty, canvasRef, canvasSize, setCanvasSize,
}: {
  items: CanvasItem[];
  guides: Guide[];
  setItems: Dispatch<SetStateAction<CanvasItem[]>>;
  setGuides: Dispatch<SetStateAction<Guide[]>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  canvasRef: RefObject<HTMLDivElement>;
  canvasSize: CanvasSize | null;
  setCanvasSize: Dispatch<SetStateAction<CanvasSize | null>>;
}) {
  const historyRef = useRef<{ past: string[]; future: string[] }>({ past: [], future: [] });
  const prevSnap = useRef("");
  const lastPushAt = useRef(0);
  const interactionSnap = useRef<string | null>(null);
  const itemsRef = useRef<CanvasItem[]>([]);
  const guidesRef = useRef<Guide[]>([]);
  const canvasSizeRef = useRef(canvasSize);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const snapOf = useCallback((nextItems: CanvasItem[], nextGuides: Guide[], size = canvasSizeRef.current) => JSON.stringify({
    items: nextItems.map(toDocItem), guides: nextGuides, canvas: size,
  }), []);

  const pushHistory = useCallback((snap: string) => {
    const h = historyRef.current;
    if (!snap) return;
    h.past.push(snap);
    if (h.past.length > 80) h.past.shift();
    h.future = [];
    lastPushAt.current = Date.now();
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const applySnapshot = useCallback((snap: string) => {
    const parsed = JSON.parse(snap) as { items: DocItem[]; guides?: Guide[]; canvas?: CanvasSize | null };
    setItems((parsed.items ?? []).map(toCanvasItem));
    setGuides(parsed.guides ?? []);
    canvasSizeRef.current = parsed.canvas ?? null;
    setCanvasSize(canvasSizeRef.current);
    prevSnap.current = snap;
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const target = h.past.pop();
    if (!target) return;
    const current = snapOf(itemsRef.current, guidesRef.current);
    h.future.push(current);
    applySnapshot(target);
    setCanUndo(h.past.length > 0);
    setCanRedo(true);
  }, [applySnapshot, snapOf]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const target = h.future.pop();
    if (!target) return;
    const current = snapOf(itemsRef.current, guidesRef.current);
    h.past.push(current);
    applySnapshot(target);
    setCanUndo(true);
    setCanRedo(h.future.length > 0);
  }, [applySnapshot, snapOf]);

  const resetHistory = useCallback((nextItems: CanvasItem[], nextGuides: Guide[], size = canvasSizeRef.current) => {
    canvasSizeRef.current = size;
    setCanvasSize(size);
    historyRef.current = { past: [], future: [] };
    prevSnap.current = snapOf(nextItems, nextGuides);
    lastPushAt.current = 0;
    interactionSnap.current = null;
    setCanUndo(false);
    setCanRedo(false);
  }, [snapOf]);

  /* 面板里改属性 / 点按钮添加删除 → 静默 500ms 合并成一步 */
  useEffect(() => {
    itemsRef.current = items;
    guidesRef.current = guides;
    canvasSizeRef.current = canvasSize;
    const snap = snapOf(items, guides);
    if (!prevSnap.current) { prevSnap.current = snap; return; }
    if (snap === prevSnap.current) return;
    const previous = prevSnap.current;
    prevSnap.current = snap;
    if (interactionSnap.current !== null) return;   // 拖拽中不记，松手时记一步
    if (Date.now() - lastPushAt.current < 500) return;
    pushHistory(previous);
  }, [items, guides, canvasSize, snapOf, pushHistory]);

  /* 画布内一次按下-松开 = 一步（拖元素 / 拉尺寸 / 拖动即一次） */
  useEffect(() => {
    const down = (event: PointerEvent) => {
      const el = canvasRef.current;
      if (!el || !el.contains(event.target as Node)) return;
      interactionSnap.current = prevSnap.current || snapOf(itemsRef.current, guidesRef.current);
    };
    const up = () => {
      if (interactionSnap.current === null) return;
      const before = interactionSnap.current;
      interactionSnap.current = null;
      const now = snapOf(itemsRef.current, guidesRef.current);
      if (before && before !== now) pushHistory(before);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
    };
  }, [pushHistory, snapOf]);

  /* ⌘Z / ⇧⌘Z（输入框里不拦） */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return {
    canUndo, canRedo, undo, redo, pushHistory, resetHistory, snapOf,
    prevSnap, itemsRef, guidesRef,
  };
}
