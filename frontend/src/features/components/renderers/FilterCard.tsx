/** 筛选栏卡片（组件库预览用）—— 交互在页面层由 DashboardView 接管 */

import { useState } from "react";
import { Box } from "@mui/material";
import FilterBar from "./FilterBar";
import { useBoxSize } from "../skin/useBoxSize";
import type { RenderPayload, UiSpec } from "../types";

/** 一个筛选控件（含标签）大约占这么高，用来算容器放得下几行 */
const ROW_HEIGHT = 46;

export default function FilterCard({ payload, compact }: { payload: RenderPayload; ui: UiSpec; compact?: boolean }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [boxRef, box] = useBoxSize<HTMLDivElement>();

  const fields = payload.fields ?? [];
  // 缩略图 / 窄卡放不下整条筛选栏：按实测容器算出能放几个控件，多余的裁掉。
  // 不这么做的话控件会按 flexWrap 往下堆，串到卡片外面压住相邻卡片
  const rows = box.h > 0 ? Math.max(1, Math.floor((box.h + 8) / ROW_HEIGHT)) : fields.length;
  const perRow = box.w > 0 && box.w < 300 ? 1 : box.w > 0 && box.w < 520 ? 2 : fields.length;
  const limit = compact ? 2 : Math.max(1, Math.min(fields.length, rows * perRow));
  const visible = fields.slice(0, limit);

  return (
    <Box ref={boxRef} sx={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <FilterBar
        fields={visible}
        values={values}
        onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
        compact={compact}
      />
    </Box>
  );
}
