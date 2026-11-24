/** 画布合并：把「别人刚保存的那一页」按元素 key 合进本地版面.
 *
 * 纯函数，页面只负责传数据。规则：
 *   · 远端有的元素 → 以远端为准（新增的加上、改过的替换）；
 *   · 本地独有的元素 → 视为「远端已删除」，移除；
 *   · 顺序以远端为准（列顺序 / 层级都跟着远端）；
 *   · 元素内容一致就不动（返回 changed=false，避免无谓重渲染和撤销栈抖动）。
 */

import type { CanvasItem } from "../components/boardTypes";
import type { DocItem, DocView } from "../components/types";

export interface MergeResult {
  items: CanvasItem[];
  changed: boolean;
  added: number;
  updated: number;
  removed: number;
  /** 只有层级/顺序变了（元素内容都没变） */
  reordered: boolean;
}

/** 元素内容指纹：用于判断「这条到底变没变」 */
export function itemFingerprint(item: CanvasItem | DocItem): string {
  return JSON.stringify(item);
}

/**
 * 当前平台实际展示的元素：单套版面 = view.items；
 * 分套版面（items_map）= 共用那套（筛选栏）+ 该平台那套，与后端 `view_items_for` 同口径。
 */
export function remoteItemsFor(view: DocView, platform?: string | null): DocItem[] {
  const shared = view.items ?? [];
  if (!platform) return shared;
  const bucket = view.items_map?.[platform];
  if (!bucket) return shared;
  return [...shared, ...bucket];
}

/**
 * 把远端那一页按元素 key 合进本地版面.
 *
 * `pinned` = 本地正在动 / 有未保存改动的元素 key：这些元素**保留本地**，其余以远端为准。
 * 为什么需要它：拖动时元素还没写回 items，若整页以远端为准，快速拖动松手就会被别人的旧版面盖回去；
 * 若干脆整份丢弃，自己接下来的保存又会把别人对这些页的改动覆盖掉 —— 所以按元素钉住是最小代价的正确解。
 */
export function mergeItems(
  local: CanvasItem[],
  remote: CanvasItem[],
  pinned?: Iterable<string>,
): MergeResult {
  const pinnedKeys = new Set(pinned ?? []);
  const localByKey = new Map(local.map((item) => [item.key, item]));
  const remoteKeys = new Set(remote.map((item) => item.key));
  const items: CanvasItem[] = [];
  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const next of remote) {
    const current = localByKey.get(next.key);
    if (!current) {
      added += 1;
      items.push(next);
      continue;
    }
    if (pinnedKeys.has(next.key)) {
      /* 本地正在拖 / 还没保存：这一条用本地的，其余照常跟随远端 */
      items.push(current);
      continue;
    }
    if (itemFingerprint(current) === itemFingerprint(next)) {
      items.push(current);
      continue;
    }
    updated += 1;
    items.push(next);
  }
  for (const current of local) {
    if (!remoteKeys.has(current.key) && !pinnedKeys.has(current.key)) removed += 1;
  }

  /* 顺序也算变化：画布的层级就是元素顺序，别人「上移一层」必须同步过来 */
  const reordered = items.length !== local.length
    || items.some((item, index) => item.key !== local[index]?.key);

  return {
    items,
    changed: added + updated + removed > 0 || reordered,
    added, updated, removed, reordered,
  };
}
