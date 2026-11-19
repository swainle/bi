import type { CanvasItem } from "../../features/components/boardTypes";
import { boardAt } from "./boardResize";

export interface LayerNode { item: CanvasItem; children: LayerNode[] }

export function layerTree(items: CanvasItem[]): LayerNode[] {
  const nodes = new Map(items.map((item) => [item.key, { item, children: [] } as LayerNode]));
  const roots: LayerNode[] = [];
  // 后绘制的组件在前景，树中按从前到后显示；归属沿用画板中心点判定。
  [...items].reverse().forEach((item) => {
    const board = item.type === "board" ? undefined : boardAt(items, item.x + item.w / 2, item.y + item.h / 2);
    const node = nodes.get(item.key)!;
    if (board) nodes.get(board.key)!.children.push(node);
    else roots.push(node);
  });
  return roots;
}

export function reorderLayers(items: CanvasItem[], parent: string | null, from: number, to: number) {
  const roots = layerTree(items);
  const siblings = parent === null ? roots : roots.find((node) => node.item.key === parent)?.children;
  if (!siblings || from === to || from < 0 || to < 0 || from >= siblings.length || to >= siblings.length) return items;
  siblings.splice(to, 0, siblings.splice(from, 1)[0]);
  return roots.flatMap((node) => [...node.children.map((child) => child.item), node.item]).reverse();
}

export const clampLayerSplit = (value: number) => Math.min(80, Math.max(20, value));
