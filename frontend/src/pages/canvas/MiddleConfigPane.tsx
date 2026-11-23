/** 画布编辑器 · 中栏（选中元素的配置：图表 / 筛选栏 / 画板 / 文字与形状） */

import type { Dispatch, SetStateAction } from "react";
import { Box, Button, MenuItem, TextField } from "@mui/material";

import QueryPanel from "../../features/components/editor/QueryPanel";
import OverlayScrollbar from "../../features/components/editor/OverlayScrollbar";
import type { FieldGroup } from "../../features/components/editor/FieldPanel";
import type { CanvasItem } from "../../features/components/boardTypes";
import type {
  ComponentKind, ComponentSpec, DashboardDoc, DatasetBrief, RenderPayload,
} from "../../features/components/types";
import { CollapseButton, CollapseStrip, type useResizableWidth } from "./controls";
import { ElementForm, FilterFieldsEditor, Hint, IdChip } from "./panels";
import type { ToastState } from "./CanvasDialogs";
import type { PaneCollapsed } from "./types";

export default function MiddleConfigPane({
  collapsed, togglePane, midW, view, setToast,
  selectedItem, selectedKeys, patchItem, datasets,
  detailCard, setDetailCardKey, doc, pageDatasets, groups, patchDetailCard,
  isChart, cards, applySpec, components, boardOptions, detailCardKey, enterDetailEdit,
  isFilterItem, activePlatform, fieldDatasetId, removeItems,
}: {
  collapsed: PaneCollapsed;
  togglePane: (key: "left" | "mid" | "right") => void;
  midW: ReturnType<typeof useResizableWidth>;
  view: string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  selectedItem: CanvasItem | null;
  selectedKeys: string[];
  patchItem: (key: string, patch: Partial<CanvasItem>) => void;
  datasets: DatasetBrief[];
  detailCard: { kind?: string; spec: ComponentSpec } | null;
  setDetailCardKey: (v: string) => void;
  doc: DashboardDoc | null;
  pageDatasets: React.ComponentProps<typeof QueryPanel>["pageDatasets"];
  groups: FieldGroup;
  patchDetailCard: (next: ComponentSpec) => void;
  isChart: boolean;
  cards: Record<string, RenderPayload>;
  applySpec: (key: string, next: ComponentSpec) => void;
  components: React.ComponentProps<typeof QueryPanel>["components"];
  boardOptions: React.ComponentProps<typeof QueryPanel>["boards"];
  detailCardKey: string;
  enterDetailEdit: (tableKey: string) => void;
  isFilterItem: boolean;
  activePlatform: string;
  fieldDatasetId: number | null;
  removeItems: (keys: string[]) => void;
}) {
  return (
    <>
        {collapsed.mid && <CollapseStrip side="left" label="配置" onClick={() => togglePane("mid")} />}

        {/* 中：当前元素的配置 */}
        <Box ref={midW.paneRef} data-pane="mid" sx={{
          width: collapsed.mid ? 0 : "var(--pane-w, 336px)", flexShrink: 0, bgcolor: "#fff", minHeight: 0,
          display: "block",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.mid ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={midW.paneRef} />
          <CollapseButton dir="left" title="收起配置面板" onClick={() => togglePane("mid")} />
          {/* 页面 / 元素 ID：编辑在哪个页面就属于哪个页面，ID 精确到「这一页的这一个元素」 */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", pl: 2, pr: 5, pt: 1.5, pb: 1 }}>
            <IdChip label="页面" value={view} onCopied={(what) => setToast({ open: true, msg: `已复制${what} ID`, severity: "success" })} />
            {selectedItem && (
              <IdChip label="元素" value={selectedItem.key} onCopied={(what) => setToast({ open: true, msg: `已复制${what} ID`, severity: "success" })} />
            )}
          </Box>
          {!selectedItem ? (
            <Hint text={selectedKeys.length > 1 ? `已选 ${selectedKeys.length} 个元素` : "未选中元素"} />
          ) : selectedItem.type === "board" ? (
            <Box sx={{ px: 2, pt: 1, display: "flex", flexDirection: "column", gap: 1.5 }}>
              <TextField
                size="small" label="名称" value={selectedItem.text ?? "画板"}
                onChange={(e) => patchItem(selectedItem.key, { text: e.target.value })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
              />
              <TextField
                select size="small" label="数据集"
                value={(selectedItem.spec?.binding as { dataset_id?: number | null } | undefined)?.dataset_id ?? ""}
                onChange={(e) => {
                  const datasetId = e.target.value === "" ? null : Number(e.target.value);
                  patchItem(selectedItem.key, {
                    spec: {
                      ...selectedItem.spec,
                      binding: { ...(selectedItem.spec.binding as unknown as Record<string, unknown>), dataset_id: datasetId } as unknown as typeof selectedItem.spec.binding,
                    },
                  });
                }}
                helperText="拖进画板的组件默认用这个数据集"
                FormHelperTextProps={{ sx: { fontSize: 10.5, mx: 0, mt: 0.5 } }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
              >
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不绑定</MenuItem>
                {datasets.map((d) => (
                  <MenuItem key={d.id} value={d.id} sx={{ fontSize: 12.5 }}>{d.name}</MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: "flex", gap: 1.25 }}>
                <TextField
                  size="small" label="宽度" type="number" value={Math.round(selectedItem.w)}
                  onChange={(e) => patchItem(selectedItem.key, { w: Math.max(160, Number(e.target.value) || 160) })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
                />
                <TextField
                  size="small" label="高度" type="number" value={Math.round(selectedItem.h)}
                  onChange={(e) => patchItem(selectedItem.key, { h: Math.max(160, Number(e.target.value) || 160) })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}
                />
              </Box>
              {/* 按当前屏幕真实可视高度给两档参考尺寸：满屏不会超过屏幕（超出部分靠弹窗滚动） */}
              <Box sx={{ display: "flex", gap: 0.75 }}>
                {([
                  { label: "半屏", h: Math.round(Math.max(360, (typeof window === "undefined" ? 900 : window.innerHeight) - 96) / 2) },
                  { label: "满屏", h: Math.round(Math.max(360, (typeof window === "undefined" ? 900 : window.innerHeight) - 96)) },
                ]).map((preset) => (
                  <Button
                    key={preset.label}
                    size="small"
                    onClick={() => patchItem(selectedItem.key, { h: preset.h })}
                    sx={{
                      flex: 1, minWidth: 0, py: 0.4, borderRadius: 1.5, textTransform: "none", fontSize: 11.5,
                      color: Math.round(selectedItem.h) === preset.h ? "#4F46E5" : "#475569",
                      border: "1px solid",
                      borderColor: Math.round(selectedItem.h) === preset.h ? "rgba(79,70,229,0.35)" : "#D8E2F5",
                      bgcolor: Math.round(selectedItem.h) === preset.h ? "rgba(79,70,229,0.06)" : "transparent",
                      "&:hover": { bgcolor: "rgba(15,23,42,0.03)" },
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </Box>
            </Box>
          ) : detailCard ? (
            <>
              <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
                <Box
                  role="button"
                  onClick={() => setDetailCardKey("")}
                  sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontSize: 11.5, color: "#4F46E5", cursor: "pointer" }}
                >
                  ← 返回明细表
                </Box>
              </Box>
              <QueryPanel
                kind={detailCard.kind as ComponentKind}
                spec={detailCard.spec}
                pages={(doc?.views ?? []).map((v) => ({ key: v.key, title: v.title || v.key }))}
                pageDatasets={pageDatasets}
                metricOptions={groups.metrics}
                dimensionOptions={groups.dimensions}
                identifierOptions={groups.identifiers}
                onChange={patchDetailCard}
              />
            </>
          ) : isChart ? (
            <QueryPanel
              kind={selectedItem.kind}
              spec={selectedItem.spec}
              pages={(doc?.views ?? []).map((v) => ({ key: v.key, title: v.title || v.key }))}
              pageDatasets={pageDatasets}
              metricOptions={groups.metrics}
              dimensionOptions={groups.dimensions}
              identifierOptions={groups.identifiers}
              payload={cards[selectedItem.key] ?? null}
              height={selectedItem.h}
              onResize={(h: number) => patchItem(selectedItem.key, { h: Math.max(60, Math.round(h)) })}
              onChange={(next: ComponentSpec) => applySpec(selectedItem.key, next)}
              components={components}
              boards={boardOptions}
              tables={(doc?.views ?? []).flatMap((v) => v.items ?? [])
                .filter((item) => item.component === "base.table")
                .map((item) => {
                  /* 排序列候选 = 这张明细表实际渲染出来的列（优先用看板渲染结果，
                     拿不到再退回配置里的维度 + 自定义列） */
                  const rendered = (cards[item.key]?.columns ?? [])
                    .map((column) => ({ key: String(column.key), label: String(column.label || column.key) }))
                    .filter((column) => column.key);
                  return { key: item.key, label: String(item.spec?.title || "明细表"), columns: rendered };
                })}
              detailCardKey={detailCardKey}
              onEditDetailCard={setDetailCardKey}
              onEditDetailPanel={() => enterDetailEdit(selectedItem.key)}
            />
          ) : isFilterItem ? (
            <FilterFieldsEditor
              item={selectedItem}
              platform={activePlatform}
              pageComponents={(doc?.views ?? [])
                .filter((v) => v.key === view)
                .flatMap((v) => [...(v.items ?? []), ...Object.values(v.items_map ?? {}).flat()])
                .filter((item) => item.type === "chart")
                .map((item) => ({ key: item.key, label: String(item.spec?.title || item.key) }))}
              columns={[...groups.dimensions, ...groups.metrics, ...groups.identifiers].map((f) => f.name)}
              fieldOptions={[...groups.dimensions, ...groups.metrics, ...groups.identifiers]
                .map((f) => ({ name: f.name, role: f.role }))}
              datasetId={fieldDatasetId}
              onDatasetChange={(id: number) => patchItem(selectedItem.key, {
                spec: {
                  ...selectedItem.spec,
                  binding: { ...selectedItem.spec.binding, dataset_id: id },
                },
              })}
              onChange={(spec) => patchItem(selectedItem.key, { spec })}
              onEmpty={() => {
                /* 一个字段都不剩：这个筛选栏没有任何作用，跟着组件一起删掉，别留个空框 */
                removeItems([selectedItem.key]);
                setToast({ open: true, msg: "筛选栏的字段都删完了，组件一起移除了", severity: "success" });
              }}
            />
          ) : (
            <ElementForm item={selectedItem} onChange={(patch) => patchItem(selectedItem.key, patch)} />
          )}
        </Box>
    </>
  );
}
