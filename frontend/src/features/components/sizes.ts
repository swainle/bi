/** 组件落版尺寸 —— 画布新增组件与组件库「放大查看」共用同一份，保证看到的就是真实比例 */

import type { ComponentKind } from "./types";

/** 版面宽度 */
export const DESIGN_W = 1440;

/** 各类组件的默认落版尺寸（头标卡整版宽、筛选栏通栏、指标卡单块） */
export const COMPONENT_SIZE: Partial<Record<ComponentKind, { w: number; h: number }>> = {
  banner: { w: DESIGN_W, h: 200 },
  nav: { w: DESIGN_W, h: 64 },
  filter: { w: DESIGN_W, h: 56 },
  /* 明细表也是整版块：贴左铺满 1440，默认高 560（10 行 + 表头 + 页脚分页条） */
  table: { w: DESIGN_W, h: 560 },
  section: { w: 1200, h: 56 },
  insight: { w: 420, h: 220 },
  /* 地图：一排 2 张 —— (1440 − 16) / 2 = 712，高度按中国地图比例留足 */
  map: { w: 712, h: 440 },
  /* 推荐列表：一排 2 张（712），高 460 = 标题 + 10 行 × 42 */
  reco_list: { w: 712, h: 460 },
  /* 版面 1440 一排 6 张：6×224 + 5×16 间距 = 1424，留 16 余量不溢出 */
  kpi: { w: 224, h: 104 },
};

/** 没登记的 kind 用这个兜底 */
export const DEFAULT_COMPONENT_SIZE = { w: 420, h: 300 };

export function sizeOfKind(kind: ComponentKind): { w: number; h: number } {
  return COMPONENT_SIZE[kind] ?? DEFAULT_COMPONENT_SIZE;
}
