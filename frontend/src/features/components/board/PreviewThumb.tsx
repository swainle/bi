/** 组件库卡片预览 —— 完整卡片（标题 + 徽标 + 图 + 注释），与看板上的样子一致 */

import { Box } from "@mui/material";
import { RENDERERS } from "../registry";
import { sectionPayload } from "./sectionPayload";
import type { ComponentKind, ComponentItem, RenderPayload } from "../types";

interface Props {
  item: ComponentItem;
  payload?: RenderPayload | null;
  height?: number;
  /** 缩放比：卡片墙用 0.82 缩略；放大查看传 1，按实际尺寸铺满 */
  scale?: number;
  /** 放大查看时传 true：词云 / 表格不裁条数，显示完整数据 */
  full?: boolean;
  /** 等比放大查看：给原始宽高和可用区域，内部整体缩放，不改变组件比例 */
  fit?: { w: number; h: number; maxW: number; maxH: number };
}

export default function PreviewThumb({ item, payload, height = 178, scale = 0.82, full = false, fit }: Props) {
  const Renderer = RENDERERS[item.kind as ComponentKind] ?? RENDERERS.kpi;

  if (item.kind === "section") payload = { ...payload, ...sectionPayload(item.spec) };

  if (!payload) {
    return (
      <Box sx={{
        height, width: "100%", display: "grid", placeItems: "center",
        bgcolor: "#FBFCFE", borderRadius: "14px",
      }}>
        <Box sx={{ width: "55%", height: 8, borderRadius: 4, bgcolor: "#EEF3FB" }} />
      </Box>
    );
  }

  // 缩略图裁到前若干条，避免溢出；放大查看时给全量
  const shown = !full && payload.series
    ? { ...payload, series: payload.series.slice(0, item.kind === "wordcloud" ? 22 : payload.series.length) }
    : payload;
  const trimmed = !full && payload.rows && item.kind === "table"
    ? { ...shown, rows: payload.rows.slice(0, 6) }
    : shown;

  // 等比放大：按原始尺寸完整渲染，再整体 scale，版式/字号与画布上一模一样
  if (fit) {
    const s = Math.min(fit.maxW / fit.w, fit.maxH / fit.h);
    return (
      <Box sx={{
        width: fit.w * s, height: fit.h * s, mx: "auto",
        position: "relative", overflow: "hidden", borderRadius: "14px",
      }}>
        <Box sx={{
          position: "absolute", top: 0, left: 0, width: fit.w, height: fit.h,
          transform: `scale(${s})`, transformOrigin: "top left",
        }}>
          <Renderer
            payload={trimmed}
            ui={{ ...(payload.ui ?? item.spec.ui), min_height: fit.h, animate: false }}
          />
        </Box>
      </Box>
    );
  }

  if (scale === 1) {
    return (
      <Box sx={{ height, width: "100%", position: "relative", overflow: "hidden", borderRadius: "14px" }}>
        <Renderer
          payload={trimmed}
          ui={{ ...(payload.ui ?? item.spec.ui), min_height: height, animate: false }}
        />
      </Box>
    );
  }

  return (
    <Box sx={{ height, width: "100%", position: "relative", overflow: "hidden", borderRadius: "14px" }}>
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${100 / scale}%`,
          height: `${height / scale}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <Renderer
          payload={trimmed}
          ui={{ ...(payload.ui ?? item.spec.ui), min_height: Math.round(height / scale), animate: false }}
        />
      </Box>
    </Box>
  );
}
