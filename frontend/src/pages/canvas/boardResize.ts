import type { CanvasItem } from "../../features/components/boardTypes";

export function boardAt(items: CanvasItem[], x: number, y: number) {
  return items.filter((item) => item.type === "board"
    && x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h)
    .sort((a, b) => a.w * a.h - b.w * b.h || a.key.localeCompare(b.key))[0];
}

export function validBoardSize(value: string) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size >= 160;
}
