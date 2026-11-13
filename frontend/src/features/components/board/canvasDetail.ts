/** 画布内的行详情面板：编辑器里点明细表行时，不进全屏抽屉，而是在画布区域内右侧弹出 */

import { createContext } from "react";
import type { DetailConfig } from "../types";
import type { CanvasItem } from "../boardTypes";

export interface BoardArea {
  key: string;
  /** 画板在页面上的位置与尺寸（弹窗大小 = 这个尺寸） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 画板区域内的组件（已在页面坐标系里） */
  items: CanvasItem[];
}

export interface InlineDetailPayload {
  detail: DetailConfig;
  row: Record<string, unknown>;
  /** 所属明细表元素 key（面板里改动要写回它的 spec） */
  tableKey: string;
  /** 目标画板：内容与尺寸 */
  board?: BoardArea | null;
}

/** 文档里的元素（ItemDef）转画布元素：补 kind（DocItem 没有）、把 layout 坐标摊到顶层 */
export function asCanvasItem(raw: unknown): CanvasItem {
  const it = raw as Record<string, unknown> & {
    kind?: string; component?: string; type?: string;
    x?: number; y?: number; w?: number; h?: number;
    layout?: { x?: number; y?: number; w?: number; h?: number };
  };
  const l = it.layout ?? {};
  const kind = it.kind
    || (it.component ? String(it.component).replace(/^base\./, "") : (it.type === "chart" ? "kpi" : "section"));
  /* layout 才是画布真正渲染用的几何（顶层 h 可能是历史遗留的旧值，别拿它算画板范围） */
  return {
    ...it,
    kind,
    x: l.x ?? it.x ?? 0,
    y: l.y ?? it.y ?? 0,
    w: l.w ?? it.w ?? 400,
    h: l.h ?? it.h ?? 260,
  } as CanvasItem;
}

export interface BoardLookup {
  (key: string | undefined): BoardArea | null;
}

export const CanvasDetailContext = createContext<{
  /** 编辑器：弹窗改在画布右侧面板里显示 */
  open?: (payload: InlineDetailPayload) => void;
  /** 当前页面的元素（明细表据此找自己的画板） */
  items?: CanvasItem[];
  /** 按 key 找画板（跨页面也能找到：画板可能在别的页面） */
  findBoard?: BoardLookup;
}>({});

/** 元素的画布几何：编辑器里的 CanvasItem 在顶层，文档里的 ItemDef 在 layout 里 */
function geomOf(it: CanvasItem): { x: number; y: number; w: number; h: number } {
  const raw = it as unknown as {
    x?: number; y?: number; w?: number; h?: number;
    layout?: { x?: number; y?: number; w?: number; h?: number };
  };
  return {
    x: raw.layout?.x ?? raw.x ?? 0,
    y: raw.layout?.y ?? raw.y ?? 0,
    w: raw.layout?.w ?? raw.w ?? 400,
    h: raw.layout?.h ?? raw.h ?? 260,
  };
}

/** 取画板区域内的组件：中心点落在画板矩形里的元素算这个画板的 */
export function boardOf(items: CanvasItem[] | undefined, boardKey: string | undefined): BoardArea | null {
  if (!items || !boardKey) return null;
  const board = items.find((it) => it.key === boardKey && it.type === "board");
  if (!board) return null;
  const box = geomOf(board);
  const inside = items.filter((it) => {
    if (it.key === board.key || it.type === "board") return false;
    const g = geomOf(it);
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
  }).map((it) => ({ ...it, ...geomOf(it) }));
  return { key: board.key, ...box, items: inside };
}

/** 把当前行的识别列注入到组件过滤条件里（弹窗里只取这一行） */
export function injectRowFilter<T extends { binding?: unknown }>(spec: T, column: string, value: unknown): T {
  if (!spec || !column || value === undefined || value === null || value === "") return spec;
  const binding = (spec.binding || {}) as unknown as Record<string, unknown>;
  const filters = Array.isArray(binding.filters) ? [...(binding.filters as { column?: string }[])] : [];
  const rest = filters.filter((f) => f && f.column !== column);
  return { ...spec, binding: { ...binding, filters: [...rest, { column, op: "=", value }] } } as unknown as T;
}

/** 画板内组件平移到以画板左上角为原点，并按当前行过滤 */
export function boardViewItems(board: BoardArea, keyField: string, rowValue: unknown): CanvasItem[] {
  const value = keyField ? rowValue : undefined;
  return board.items.map((item) => ({
    ...item,
    x: item.x - board.x,
    y: item.y - board.y,
    spec: injectRowFilter(item.spec, keyField, value),
  }));
}

/** 行标识列的兜底：老看板/误清空时按行取数不能失效 —— 先从当前行里挑一个 ID 类型的列 */
const AUTO_KEY_HINTS = ["链接id", "商品id", "产品id", "sku_id", "product_id", "item_id", "id", "编号"];
export function autoKeyFieldOf(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  const keys = Object.keys(row);
  const lower = keys.map((k) => k.toLowerCase());
  for (const hint of AUTO_KEY_HINTS) {
    const exact = lower.indexOf(hint.toLowerCase());
    if (exact >= 0) return keys[exact];
  }
  for (const hint of AUTO_KEY_HINTS) {
    const fuzzy = lower.findIndex((k) => k.includes(hint.toLowerCase()));
    if (fuzzy >= 0) return keys[fuzzy];
  }
  return "";
}
