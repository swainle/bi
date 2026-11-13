/** 画布元素 —— 与后端 app/dashboards/models.py 的 ItemDef 对齐（自由坐标） */

import type { ComponentKind, ComponentSpec, DocAction, ElementType } from "./types";

export interface CanvasItem {
  key: string;
  kind: ComponentKind;
  spec: ComponentSpec;
  x: number;
  y: number;
  w: number;
  h: number;
  /** v2.2：页面元素类型（标题 / 文字 / 分割线 / 筛选栏） */
  type?: ElementType;
  text?: string;
  note?: string;
  index?: string;
  icon?: string;
  size?: number;
  weight?: number;
  align?: "left" | "center" | "right";
  action?: DocAction;
  row_action?: DocAction;
  /** 来自组件库的哪个组件（base.filter 等）：记录来源，便于回查/同步 */
  component?: string;
  /** 原始文档元素（保存时保留 spec/action 等） */
  raw?: Record<string, unknown>;
}

export interface CanvasDoc {
  id: number;
  name: string;
  items: CanvasItem[];
}
