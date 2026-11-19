import type { ComponentSpec } from "../types";

/** 分节内容直接取当前配置，避免等待数据查询或沿用旧载荷。 */
export function sectionPayload(spec: Pick<ComponentSpec, "title" | "subtitle" | "content">) {
  return {
    title: spec.title,
    index: spec.content.index,
    icon: spec.content.icon,
    note: spec.subtitle,
  };
}
