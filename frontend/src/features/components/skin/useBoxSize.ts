/** 容器实测尺寸 —— 图表的轴标签 / 数据标签要不要抽稀，全靠它判断 */

import { useLayoutEffect, useRef, useState } from "react";

export interface BoxSize {
  w: number;
  h: number;
}

/**
 * 读容器布局尺寸（CSS px）。
 *
 * 必须用 clientWidth / clientHeight 而不是 getBoundingClientRect：
 * 组件库缩略图外层有 transform: scale()，rect 拿到的是缩放后的值，
 * 拿它去做字号/抽稀判断会整体偏小（词云卡踩过这个坑）。
 *
 * 首次渲染返回 { w: 0, h: 0 }，挂载后同步一次；未测量时调用方应按「宽松」处理，
 * 避免先抽稀再恢复造成闪烁。
 */
export function useBoxSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<BoxSize>({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 高频回调：先比较再 setState，避免无意义的整棵树重渲染
    const read = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    read();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    observer?.observe(el);
    return () => observer?.disconnect();
  }, []);

  return [ref, size] as const;
}
