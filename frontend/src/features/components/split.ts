/** 「分套」判定 —— 一个筛选字段是否是「分套依据」
 *
 *  旧语义：字段配了 dataset_map（每个值绑一张数据集）才算切换器；
 *  新语义：字段显式勾了「分套」开关即可（分类名不必是「平台」）。
 *  两者并存：dataset_map 非空仍视为分套，保证历史看板行为不变。
 */

import type { FilterFieldSpec, FilterSpec } from "./types";

export function isSplitField(field: FilterFieldSpec | undefined | null): boolean {
  if (!field) return false;
  if (field.split) return true;
  return Boolean(field.dataset_map && Object.keys(field.dataset_map).length);
}

/** 分套的取值清单（= items_map 的 key）：优先 dataset_map 的键，否则用字段选项值 */
export function splitKeysOf(field: FilterFieldSpec | undefined | null): string[] {
  if (!field) return [];
  const mapped = Object.keys(field.dataset_map || {});
  if (mapped.length) return mapped;
  return (field.options ?? []).map((option) => option.v).filter(Boolean);
}

export function findSplitField(fields: FilterFieldSpec[] | undefined | null): FilterFieldSpec | null {
  return (fields ?? []).find(isSplitField) ?? null;
}

/** 改筛选字段时顺带收尾：把「分套依据」删掉了 → 平台专套（fields_map）没有依据了，一起清掉，
 *  否则以后再加一个分套字段，旧平台那套会突然复活。 */
export function filterWithFields(filter: FilterSpec | undefined, fields: FilterFieldSpec[]): FilterSpec {
  const base: FilterSpec = filter ?? { fields: [], inline: true };
  const hadSplit = (base.fields ?? []).some(isSplitField);
  const lostSplit = hadSplit && !fields.some(isSplitField);
  return { ...base, fields, ...(lostSplit ? { fields_map: {} } : {}) };
}
