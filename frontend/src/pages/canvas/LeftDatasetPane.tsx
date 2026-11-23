/** 画布编辑器 · 左栏（数据集切换 + 字段清单） */

import { Autocomplete, Box, MenuItem, TextField, Typography } from "@mui/material";

import FieldPanel, { type FieldGroup, type FieldGroupKey } from "../../features/components/editor/FieldPanel";
import OverlayScrollbar from "../../features/components/editor/OverlayScrollbar";
import type { CanvasItem } from "../../features/components/boardTypes";
import type { DatasetBrief } from "../../features/components/types";
import { CollapseButton, CollapseStrip, type useResizableWidth } from "./controls";
import { Hint } from "./panels";
import type { PaneCollapsed } from "./types";

export default function LeftDatasetPane({
  datasets, fieldDatasetId, setActiveDatasetId, selectedItem, patchItem,
  datasetUsage, datasetName, groups, usedKeys, handlePick,
  collapsed, togglePane, leftW,
}: {
  datasets: DatasetBrief[];
  fieldDatasetId: number | null;
  setActiveDatasetId: (id: number) => void;
  selectedItem: CanvasItem | null;
  patchItem: (key: string, patch: Partial<CanvasItem>) => void;
  datasetUsage: number;
  datasetName: string;
  groups: FieldGroup;
  usedKeys: string[];
  handlePick: (field: { name: string }, group: FieldGroupKey) => void;
  collapsed: PaneCollapsed;
  togglePane: (key: "left" | "mid" | "right") => void;
  leftW: ReturnType<typeof useResizableWidth>;
}) {
  return (
    <>
        {collapsed.left && <CollapseStrip side="left" label="数据集" onClick={() => togglePane("left")} />}
        <Box ref={leftW.paneRef} data-pane="left" sx={{
          width: collapsed.left ? 0 : "var(--pane-w, 232px)", flexShrink: 0, bgcolor: "#fff",
          minHeight: 0, display: "flex", flexDirection: "column",
          position: "relative", overflowY: "auto", overflowX: "hidden",
          opacity: collapsed.left ? 0 : 1,
          transition: "width .24s cubic-bezier(.4,0,.2,1), opacity .16s ease",
          willChange: "width",
          scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
        }}>
          <OverlayScrollbar targetRef={leftW.paneRef} />
          <CollapseButton dir="left" title="收起数据集" onClick={() => togglePane("left")} />
          <Box sx={{ px: 1.25, py: 1, borderBottom: "1px solid #F1F5FC", flexShrink: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 10.5, color: "#94A3B8", flexShrink: 0 }}>数据集</Typography>
              <Autocomplete
                size="small"
                options={datasets}
                getOptionLabel={(d) => d.name}
                value={datasets.find((d) => d.id === fieldDatasetId) || null}
                onChange={(_, d) => {
                  if (!d) return;
                  const id = d.id;
                  setActiveDatasetId(id);
                  if (selectedItem && (selectedItem.type || "chart") === "chart") {
                    patchItem(selectedItem.key, {
                      spec: {
                        ...selectedItem.spec,
                        binding: {
                          ...selectedItem.spec.binding,
                          dataset_id: id, dimension: null, metric: null, series: null, split: null,
                        },
                      },
                    });
                  }
                }}
                renderInput={(params) => (
                  <TextField {...params} size="small" placeholder="（选择数据集）" sx={{ "& .MuiInputBase-input": { fontSize: 12 } }} />
                )}
                sx={{ flex: 1, minWidth: 0 }}
              />
            </Box>
            {datasetUsage > 0 && (
              <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mt: 0.75 }}>
                本看板 {datasetUsage} 个元素在用
              </Typography>
            )}
          </Box>
          <Box sx={{ flex: 1, minHeight: 0 }}>
            {fieldDatasetId ? (
              <FieldPanel datasetName={datasetName} groups={groups} usedKeys={usedKeys} onPick={handlePick} />
            ) : (
              <Hint text="先在上方选择数据集" />
            )}
          </Box>
        </Box>
    </>
  );
}
