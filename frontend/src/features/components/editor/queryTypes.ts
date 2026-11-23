/** 查询面板 · Props 契约 */

import type { ComponentItem, ComponentKind, ComponentSpec, FieldOption, RenderPayload } from "../types";

export interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  payload?: RenderPayload | null;
  metricOptions: FieldOption[];
  dimensionOptions: FieldOption[];
  identifierOptions?: FieldOption[];
  onChange: (next: ComponentSpec) => void;
  /** 卡片高度与改高度回调（把「高度」真正落到版面） */
  height?: number;
  onResize?: (height: number) => void;
  /** 当前看板的页面列表（导航卡挂载跳页用） */
  pages?: { key: string; title: string }[];
  /** 组件库（明细表「行详情」添加卡片用） */
  components?: ComponentItem[];
  /** 页面上的画板（明细表「弹窗」选目标用） */
  boards?: { key: string; label: string }[];
  /** 页面上的明细表元素（指标卡「徽标弹窗」选目标用） */
  tables?: { key: string; label: string }[];
  /** 正在编辑的详情卡片 key */
  detailCardKey?: string | null;
  onEditDetailCard?: (key: string) => void;
  /** 进入「详情画布」编辑行详情面板 */
  onEditDetailPanel?: () => void;
  /** 当前页用到的数据集（导航卡「导出范围」用） */
  pageDatasets?: { id: number; name: string; count: number }[];
}
