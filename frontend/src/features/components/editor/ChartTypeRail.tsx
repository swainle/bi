/** 图表类型栏（编辑页最右侧）—— 列表来自「组件库」，库里加卡这里就多一项，点选即切换/新增 */

import { Box, Typography } from "@mui/material";
import ChartThumb from "../ChartThumb";
import type { ComponentItem, ComponentKind } from "../types";

/** 分类展示顺序：页面模块 → 常用数据卡 → 其余图形 → 内容块 */
const CATEGORY_ORDER = [
  "页面模块", "指标卡", "明细表", "分布", "占比", "时间序列", "排名",
  "关系", "矩阵", "组合", "词频", "内容",
];

/** 个别卡片在分类里的顺序（页面从上到下：头标卡 → 筛选栏）；其余保持库里的顺序 */
const CODE_RANK: Record<string, number> = { "base.banner": 0, "base.section": 1, "base.filter": 2 };

/** 库里的组件按分类分组；未知分类排在最后但仍然显示（新加的卡不会丢） */
export function groupComponents(components: ComponentItem[]) {
  const rank = (category: string) => {
    const index = CATEGORY_ORDER.indexOf(category);
    return index < 0 ? CATEGORY_ORDER.length : index;
  };
  const groups = new Map<string, ComponentItem[]>();
  components.forEach((component) => {
    const key = component.category || "其它";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(component);
  });
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => (CODE_RANK[a.code] ?? 50) - (CODE_RANK[b.code] ?? 50)),
    }));
}

interface Props {
  /** 组件库卡片（接口取，画布与库同一份数据） */
  components: ComponentItem[];
  kind: ComponentKind;
  onPick: (component: ComponentItem) => void;
  /** 拖到画布：按下就开始跟手的落位预览（不再用浏览器原生拖放） */
  onDragInsert?: (component: ComponentItem, event: React.PointerEvent) => void;
  loading?: boolean;
}

export default function ChartTypeRail({ components, kind, onPick, onDragInsert, loading }: Props) {
  const groups = groupComponents(components);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{ px: 1.75, py: 1.5, borderBottom: "1px solid #EEF3FB" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A" }}>
          图表类型
        </Typography>
      </Box>

      <Box sx={{ flex: 1, px: 1, py: 1 }}>
        {loading && !components.length ? (
          <Typography sx={{ fontSize: 11, color: "#94A3B8", px: 1, py: 2 }}>加载组件库…</Typography>
        ) : null}

        {groups.map((group) => (
          <Box key={group.category} sx={{ mb: 0.75 }}>
            <Typography sx={{ fontSize: 10, color: "#94A3B8", px: 1, pt: 0.5, pb: 0.25, letterSpacing: 0.4 }}>
              {group.category}
            </Typography>
            {group.items.map((component) => {
              const active = component.kind === kind;
              return (
                <Box
                  key={component.code}
                  onPointerDown={(e) => onDragInsert?.(component, e)}
                  onClick={() => onPick(component)}
                  sx={{
                    display: "flex", alignItems: "center", gap: 1,
                    px: 1, py: 0.75, mb: 0.25, borderRadius: 1.5,
                    cursor: "grab", "&:active": { cursor: "grabbing" },
                    bgcolor: active ? "rgba(99,102,241,0.09)" : "transparent",
                    border: "1px solid",
                    borderColor: active ? "rgba(99,102,241,0.3)" : "transparent",
                    transition: "all .14s",
                    "&:hover": { bgcolor: active ? "rgba(99,102,241,0.09)" : "rgba(15,23,42,0.03)" },
                  }}
                >
                  <Box sx={{ width: 26, height: 26, display: "grid", placeItems: "center", flexShrink: 0 }}>
                    <ChartThumb kind={component.kind} size={24} />
                  </Box>
                  <Typography sx={{
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    color: active ? "#4F46E5" : "#475569",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {component.name}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
