/** 画布编辑器 · 复制 / 粘贴 / ⌥拖复制（页内剪贴板 + 系统剪贴板） */

import type { Dispatch, SetStateAction } from "react";
import { useCallback, useRef } from "react";

import type { CanvasItem } from "../../features/components/boardTypes";
import type { DocItem } from "../../features/components/types";
import type { ToastState } from "./CanvasDialogs";
import { newKey, toCanvasItem, toDocItem } from "./spec";

export function useCanvasClipboard({
  items, selectedKeys, setItems, setSelectedKeys, setDirty, setToast,
}: {
  items: CanvasItem[];
  selectedKeys: string[];
  setItems: Dispatch<SetStateAction<CanvasItem[]>>;
  setSelectedKeys: Dispatch<SetStateAction<string[]>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setToast: Dispatch<SetStateAction<ToastState>>;
}) {
  /** 页内剪贴板：切页面、切平台都不丢；同时写进系统剪贴板，跨看板也能粘 */
  const clipboardRef = useRef<DocItem[] | null>(null);
  const pasteTimes = useRef(0);

  const keyPrefixFor = (item: DocItem) => {
    if (item.type === "filter") return "f";
    if (item.type === "heading") return "h";
    if (item.type === "text") return "t";
    if (item.type === "divider") return "s";
    return "c";
  };

  /** 深拷贝一份元素（新 ID），位置可偏移 */
  const cloneDocItem = (item: DocItem, dx = 0, dy = 0): DocItem => {
    const copy: DocItem = JSON.parse(JSON.stringify(item));
    copy.key = newKey(keyPrefixFor(item));
    const layout = copy.layout ?? { x: 0, y: 0, w: 400, h: 240 };
    copy.layout = {
      x: Math.max(0, Math.round((layout.x ?? 0) + dx)),
      y: Math.max(0, Math.round((layout.y ?? 0) + dy)),
      w: layout.w ?? 400,
      h: layout.h ?? 240,
    };
    return copy;
  };

  const insertCopies = (sources: DocItem[], dx: number, dy: number) => {
    if (!sources.length) return;
    const copies = sources.map((item) => cloneDocItem(item, dx, dy));
    setItems((prev) => [...prev, ...copies.map(toCanvasItem)]);
    setSelectedKeys(copies.map((c) => c.key));
    setDirty(true);
    setToast({ open: true, msg: `已粘贴 ${copies.length} 个元素`, severity: "success" });
  };

  /** ⌘C：把选中的元素放进剪贴板（同时写系统剪贴板，便于跨看板） */
  const copySelection = () => {
    const chosen = items.filter((i) => selectedKeys.includes(i.key));
    if (!chosen.length) return;
    const docs = chosen.map(toDocItem);
    clipboardRef.current = docs;
    pasteTimes.current = 0;
    try {
      void navigator.clipboard?.writeText(JSON.stringify({ mingcebi: 1, items: docs }));
    } catch { /* 剪贴板不可用就只留页内那份 */ }
    setToast({ open: true, msg: `已复制 ${docs.length} 个元素`, severity: "success" });
  };

  /** ⌘V：粘到当前页面（同一看板换页也能粘；反复粘贴会阶梯错开） */
  const pasteSelection = async () => {
    let docs = clipboardRef.current;
    try {
      const text = await navigator.clipboard?.readText();
      if (text) {
        const parsed = JSON.parse(text) as { mingcebi?: number; mingzebi?: number; items?: DocItem[] };
        // 旧名 MingzeBI 时期复制到系统剪贴板的元素仍可粘贴一次
        if ((parsed?.mingcebi === 1 || parsed?.mingzebi === 1) && Array.isArray(parsed.items) && parsed.items.length) docs = parsed.items;
      }
    } catch { /* 没权限就退回页内剪贴板 */ }
    if (!docs?.length) {
      setToast({ open: true, msg: "剪贴板里没有可粘贴的元素", severity: "error" });
      return;
    }
    pasteTimes.current += 1;
    const step = 24 * pasteTimes.current;
    insertCopies(docs, step, step);
  };

  /** ⌥ + 拖动：先在原位复制一份（原元素继续被拖走），像 PS 的「按住 Alt 拖动 = 复制」 */
  const duplicateForDrag = useCallback((key: string) => {
    const keys = selectedKeys.includes(key) ? selectedKeys : [key];
    const chosen = items.filter((i) => keys.includes(i.key));
    if (!chosen.length) return;
    const copies = chosen.map((item) => toCanvasItem(cloneDocItem(toDocItem(item))));
    setItems((prev) => [...prev, ...copies]);
    setDirty(true);
    // 选中的仍是「被拖走的那一份」，复制出来的留在原位
  }, [items, selectedKeys]);

  return { copySelection, pasteSelection, duplicateForDrag };
}
