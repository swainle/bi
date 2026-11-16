/** 筛选栏卡片（组件库预览用）—— 交互在页面层由 DashboardView 接管 */

import { useState } from "react";
import FilterBar from "./FilterBar";
import type { RenderPayload, UiSpec } from "../types";

export default function FilterCard({ payload, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  return (
    <FilterBar
      fields={payload.fields ?? []}
      values={values}
      onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
      compact={compact}
    />
  );
}
