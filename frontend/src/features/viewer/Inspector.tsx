/** 业务看板页 —— 页面元素 + 组件实例 + 参数筛选 + 动作浮层 + 就地编辑（类原型工具） */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, IconButton, Menu, MenuItem, Select, Snackbar, Tab, Tabs, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import {
  ArrowDownward, ArrowUpward, BookmarkBorder, Close, Delete, Edit, FileDownload, HorizontalRule,
  Save, TextFields, Title as TitleIcon, Tune, ViewQuilt,
} from "@mui/icons-material";
import client from "../../api/client";
import { useAuth } from "../auth/useAuth";
import { useWatermarkText } from "../../hooks/useWatermarkText";
import WatermarkOverlay from "../../components/WatermarkOverlay";
import { CanvasDetailContext, asCanvasItem, boardOf, type BoardArea } from "../components/board/canvasDetail";
import { ACCENTS } from "../components/palette";
import { RENDERERS, KIND_LABEL, KIND_ROLE, ROLE_LABEL } from "../components/registry";
import ShapeView, { shapeOf } from "../components/shapes";
import { navHomePage } from "../components/navHome";
import FilterBar from "../components/renderers/FilterBar";
import NavCard, { type NavPayload, type NavUi } from "../components/renderers/NavCard";
import { useDatasetFields } from "../components/board/useDatasetFields";
import TopListDialog from "../components/board/TopListDialog";
import type {
  Accent, ComponentItem, ComponentSpec, DashboardDoc, DashboardRender, DashboardSummary,
  DatasetBrief, DocAction, DocItem, FilterFieldSpec, RenderPayload, UiSpec,
} from "../components/types";

import { GRID_GAP, DESIGN_W, toCsvText, downloadCsv, PAGE_X, DEFAULT_UI, FLOAT_BTN_SX, cellText, NUMERAL, ICONS, ACCENT_KEYS, readParamQuery, buildSearch } from "./utils";

export function Inspector({ open, item, datasets, onClose, onChange, onSpecChange, onDelete }: {
  open: boolean;
  item: DocItem | null;
  datasets: DatasetBrief[];
  onClose: () => void;
  onChange: (patch: Partial<DocItem>, debounce?: boolean) => void;
  onSpecChange: (spec: ComponentSpec, debounce?: boolean) => void;
  onDelete: () => void;
}) {
  const spec = item?.spec;
  const ui = spec?.ui ?? DEFAULT_UI;
  const { groups } = useDatasetFields(spec?.binding?.dataset_id ?? null);
  if (!item) return null;
  const type = item.type || "chart";
  const kind = ((item.component || "").replace("base.", "") || "") as keyof typeof KIND_LABEL;

  const patchSpec = (patch: Partial<ComponentSpec>) => {
    if (!spec) return;
    onSpecChange({ ...spec, ...patch });
  };
  const patchBinding = (patch: Partial<ComponentSpec["binding"]>) => {
    if (!spec) return;
    onSpecChange({ ...spec, binding: { ...spec.binding, ...patch } });
  };
  const patchCompute = (patch: Partial<ComponentSpec["compute"]>) => {
    if (!spec) return;
    onSpecChange({ ...spec, compute: { ...spec.compute, ...patch } });
  };
  const patchUi = (patch: Partial<ComponentSpec["ui"]>) => {
    if (!spec) return;
    onSpecChange({ ...spec, ui: { ...ui, ...patch } });
  };

  if (!open) return null;

  return (
    <Box
      role="complementary"
      aria-label="元素属性"
      sx={{
        position: "fixed", top: 56, right: 0, bottom: 0, width: 344, maxWidth: "94vw",
        bgcolor: "#fff", borderLeft: "1px solid #EEF3FB", zIndex: 1200,
        boxShadow: "-12px 0 30px -26px rgba(15,23,42,0.5)",
        display: "flex", flexDirection: "column", overflowY: "auto",
      }}>
      <Box sx={{ px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, borderBottom: "1px solid #EEF3FB", position: "sticky", top: 0, bgcolor: "#fff", zIndex: 1 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: "#0F172A", flex: 1 }}>
          {type === "heading" ? "标题元素" : type === "text" ? "文字元素"
            : type === "divider" ? "分割线" : (KIND_LABEL[kind] || "组件")}
        </Typography>
        <IconButton size="small" onClick={onDelete}><Delete sx={{ fontSize: 15 }} /></IconButton>
        <IconButton size="small" onClick={onClose}><Close sx={{ fontSize: 16 }} /></IconButton>
      </Box>

      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
        {type === "heading" && (
          <>
            <TextField size="small" label="标题" value={item.text || ""}
              onChange={(e) => onChange({ text: e.target.value }, true)} />
            <TextField size="small" label="说明" value={item.note || ""}
              onChange={(e) => onChange({ note: e.target.value }, true)} />
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField size="small" label="编号" value={item.index || ""}
                onChange={(e) => onChange({ index: e.target.value.slice(0, 4) }, true)} sx={{ width: 100 }} />
              <Select size="small" value={item.icon || "grid"}
                onChange={(e) => onChange({ icon: e.target.value })} sx={{ flex: 1, fontSize: 12.5 }}>
                {ICONS.map((icon) => <MenuItem key={icon} value={icon} sx={{ fontSize: 12.5 }}>{icon}</MenuItem>)}
              </Select>
            </Box>
          </>
        )}

        {type === "text" && (
          <>
            <TextField size="small" label="文字" value={item.text || ""} multiline minRows={4}
              onChange={(e) => onChange({ text: e.target.value }, true)} />
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField size="small" type="number" label="字号" value={item.size ?? 13}
                onChange={(e) => onChange({ size: Number(e.target.value) }, true)} sx={{ width: 96 }} />
              <Select size="small" value={item.weight ?? 400}
                onChange={(e) => onChange({ weight: Number(e.target.value) })} sx={{ width: 110, fontSize: 12.5 }}>
                {[400, 500, 600, 700].map((weight) => (
                  <MenuItem key={weight} value={weight} sx={{ fontSize: 12.5 }}>{weight}</MenuItem>
                ))}
              </Select>
            </Box>
            <ToggleButtonGroup exclusive size="small" value={item.align || "left"}
              onChange={(_, next) => next && onChange({ align: next })}>
              {(["left", "center", "right"] as const).map((align) => (
                <ToggleButton key={align} value={align} sx={{ px: 1.5, fontSize: 11.5 }}>{align}</ToggleButton>
              ))}
            </ToggleButtonGroup>
          </>
        )}

        {type === "divider" && (
          <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>分割线只影响布局，没有可配置项。</Typography>
        )}

        {(type === "chart" || type === "filter") && spec && (
          <>
            <TextField size="small" label="标题" value={spec.title}
              onChange={(e) => patchSpec({ title: e.target.value })} />
            <TextField size="small" label="副标题" value={spec.subtitle}
              onChange={(e) => patchSpec({ subtitle: e.target.value })} />

            {type === "chart" && (
              <>
                <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mt: 0.5 }}>数据</Typography>
                <Select size="small" displayEmpty value={spec.binding.dataset_id ?? ""}
                  onChange={(e) => patchBinding({ dataset_id: e.target.value ? Number(e.target.value) : null })}
                  sx={{ fontSize: 12.5 }}>
                  <MenuItem value="" sx={{ fontSize: 12.5 }}>选择数据集</MenuItem>
                  {datasets.map((dataset) => (
                    <MenuItem key={dataset.id} value={dataset.id} sx={{ fontSize: 12.5 }}>{dataset.name}</MenuItem>
                  ))}
                </Select>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Select size="small" displayEmpty value={spec.binding.dimension ?? ""}
                    onChange={(e) => patchBinding({ dimension: e.target.value || null })} sx={{ flex: 1, fontSize: 12.5 }}>
                    <MenuItem value="" sx={{ fontSize: 12.5 }}>维度</MenuItem>
                    {groups.dimensions.map((field) => (
                      <MenuItem key={field.name} value={field.name} sx={{ fontSize: 12.5 }}>{field.name}</MenuItem>
                    ))}
                  </Select>
                  <Select size="small" displayEmpty value={spec.binding.metric ?? ""}
                    onChange={(e) => patchBinding({ metric: e.target.value || null })} sx={{ flex: 1, fontSize: 12.5 }}>
                    <MenuItem value="" sx={{ fontSize: 12.5 }}>指标</MenuItem>
                    {groups.metrics.map((field) => (
                      <MenuItem key={field.name} value={field.name} sx={{ fontSize: 12.5 }}>{field.name}</MenuItem>
                    ))}
                  </Select>
                </Box>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Select size="small" value={spec.binding.agg}
                    onChange={(e) => patchBinding({ agg: e.target.value })} sx={{ width: 104, fontSize: 12.5 }}>
                    {["SUM", "AVG", "MAX", "MIN", "COUNT", "COUNT_DISTINCT"].map((agg) => (
                      <MenuItem key={agg} value={agg} sx={{ fontSize: 12.5 }}>{agg}</MenuItem>
                    ))}
                  </Select>
                  <TextField size="small" type="number" label="前 N" value={spec.binding.top_n}
                    onChange={(e) => patchBinding({ top_n: Number(e.target.value) })} sx={{ width: 90 }} />
                  <Select size="small" value={spec.binding.sort}
                    onChange={(e) => patchBinding({ sort: e.target.value as "desc" | "asc" })} sx={{ flex: 1, fontSize: 12.5 }}>
                    <MenuItem value="desc" sx={{ fontSize: 12.5 }}>降序</MenuItem>
                    <MenuItem value="asc" sx={{ fontSize: 12.5 }}>升序</MenuItem>
                  </Select>
                </Box>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Select size="small" value={spec.compute.format}
                    onChange={(e) => patchCompute({ format: e.target.value as ComponentSpec["compute"]["format"] })}
                    sx={{ flex: 1, fontSize: 12.5 }}>
                    {[["int", "整数"], ["w", "万"], ["pct", "百分比"], ["money", "金额"], ["date", "日期"], ["text", "文本"]].map(([value, label]) => (
                      <MenuItem key={value} value={value} sx={{ fontSize: 12.5 }}>{label}</MenuItem>
                    ))}
                  </Select>
                  <TextField size="small" type="number" label="小数位" value={spec.compute.decimals}
                    onChange={(e) => patchCompute({ decimals: Number(e.target.value) })} sx={{ width: 94 }} />
                </Box>
                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mt: 0.5 }}>
                  {ACCENT_KEYS.map((key) => (
                    <Box key={key} onClick={() => patchUi({ accent: key })}
                      sx={{
                        width: 20, height: 20, borderRadius: "50%", cursor: "pointer",
                        bgcolor: ACCENTS[key].main,
                        outline: ui.accent === key ? `2px solid ${ACCENTS[key].main}` : "none",
                        outlineOffset: 2,
                      }} />
                  ))}
                </Box>
              </>
            )}

            {type === "filter" && (
              <Typography sx={{ fontSize: 11, color: "#94A3B8", lineHeight: 1.7 }}>
                筛选字段在「组件库 → 筛选栏」里维护；这里只控制实例的标题与位置。
              </Typography>
            )}

            <Typography sx={{ fontSize: 10.5, color: "#94A3B8" }}>
              组件类型：{KIND_LABEL[kind] || "—"}
            </Typography>
          </>
        )}

        {type === "chart" && !spec && (
          <Typography sx={{ fontSize: 12, color: "#94A3B8" }}>这个元素还没有配置组件</Typography>
        )}
      </Box>
    </Box>
  );
}

/** 浮层宿主 —— 弹窗 / 抽屉复用同一套渲染器 */
