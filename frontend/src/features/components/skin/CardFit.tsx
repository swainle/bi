/** 图表自适应 —— 按「图体」实测尺寸收敛刻度与图例，杜绝望向压叠
 *
 * 背景（2026-11-15 全类型验收页暴露）：
 *   224×104 的卡去掉内边距和标题后，图体只剩约 39px 高，但多数卡片的
 *   grid.top 固定 26px、刻度数固定，结果轴标签全挤进 9px 里叠成一团。
 *
 * 口径（全站一致，不要在单个卡片里另定阈值）：
 *   图体高 < 56  → tight：轴、图例、数值标签全部不画，只留图形（迷你图）
 *   图体宽 < 320 → narrow：只做防重叠，图例和数值标签按剩余空间收敛
 */

import type { BoxSize } from "./useBoxSize";

export const TIGHT_HEIGHT = 56;
export const NARROW_WIDTH = 320;

export interface CardFit {
  /** 图体太矮：只画图形，不画任何文字 */
  tight: boolean;
  /** 卡片偏窄：需要抽稀类目标签、收敛图例 */
  narrow: boolean;
  /** 每个类目分到的宽度（px）；没测量出来时给 999，按「宽松」处理避免闪烁 */
  slot: (count: number) => number;
}

export function cardFit(box: BoxSize): CardFit {
  return {
    tight: box.h > 0 && box.h < TIGHT_HEIGHT,
    narrow: box.w > 0 && box.w < NARROW_WIDTH,
    slot: (count: number) => (box.w > 0 ? (box.w - 20) / Math.max(1, count) : 999),
  };
}

type AnyOption = Record<string, any>;

function stripAxis(axis: any, tight: boolean): any {
  if (!axis) return axis;
  if (Array.isArray(axis)) return axis.map((one) => stripAxis(one, tight));
  const next: AnyOption = { ...axis };
  next.axisLabel = { ...(axis.axisLabel ?? {}), show: false };
  next.axisLine = { ...(axis.axisLine ?? {}), show: false };
  next.axisTick = { show: false };
  next.splitLine = { ...(axis.splitLine ?? {}), show: false };
  next.axisPointer = { ...(axis.axisPointer ?? {}), show: false };
  next.name = "";
  return next;
}

/**
 * 按图体尺寸收敛一份 ECharts option。
 *
 * 只处理「会压字」的几处：坐标轴、图例、数据标签、网格边距。
 * 宽松尺寸原样返回（不做任何改动），保证大卡的观感与既有一致。
 */
export function fitChart<T extends AnyOption>(option: T, box: BoxSize): T {
  const { tight, narrow } = cardFit(box);
  if (!tight && !narrow) return option;

  const out: AnyOption = { ...option };

  if (tight) {
    if (out.xAxis) out.xAxis = stripAxis(out.xAxis, true);
    if (out.yAxis) out.yAxis = stripAxis(out.yAxis, true);
    if (out.legend) out.legend = { ...(out.legend ?? {}), show: false };
    if (out.grid) {
      out.grid = { ...out.grid, top: 4, bottom: 4, left: 4, right: 8 };
    }
    if (out.visualMap && !Array.isArray(out.visualMap)) {
      out.visualMap = { ...out.visualMap, show: false };
    }
  } else if (narrow) {
    // 窄但不矮：类目标签仍然要，只保证不互相压叠
    if (out.xAxis) out.xAxis = ensureHideOverlap(out.xAxis);
    if (out.yAxis) out.yAxis = ensureHideOverlap(out.yAxis);
  }

  // 数据标签（柱顶数值 / 折线点值）：图体矮或每格太挤就不画，否则必叠
  if (out.series) {
    const list: any[] = Array.isArray(out.series) ? out.series : [out.series];
    const mapped = list.map((one) => {
      if (!one || !one.label) return one;
      const label = one.label;
      if (label.show === false) return one;
      const dataLen = Array.isArray(one.data) ? one.data.length : 0;
      const perSlot = cardFit(box).slot(dataLen);
      const hide = tight || (narrow && perSlot < 52);
      return hide ? { ...one, label: { ...label, show: false } } : one;
    });
    out.series = Array.isArray(out.series) ? mapped : mapped[0];
  }

  return out as T;
}

function ensureHideOverlap(axis: any): any {
  if (!axis) return axis;
  if (Array.isArray(axis)) return axis.map(ensureHideOverlap);
  return { ...axis, axisLabel: { ...(axis.axisLabel ?? {}), hideOverlap: true } };
}
