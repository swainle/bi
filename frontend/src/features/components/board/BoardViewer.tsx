/** 看板查看器（只读）—— 渲染画布发布出来的多卡页面 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import client from "../../../api/client";
import { RENDERERS } from "../registry";
import type { ComponentKind, RenderPayload } from "../types";
import type { CanvasItem } from "../boardTypes";
import { ElementBody } from "./BoardCard";
import { CanvasDetailContext } from "./canvasDetail";
import { sectionPayload } from "./sectionPayload";

interface Props {
  items: CanvasItem[];
  /** 看板 id：表格「查看更多」要按它拉全量行 */
  docId?: number;
  /** 嵌在抽屉/面板里用：去掉点阵背景与画布边框，宽度按可用空间排 */
  plain?: boolean;
  /** 可用宽度：数字 = 给定像素；"container" = 自己量父容器（滚动条出现也不受影响） */
  fitWidth?: number | "container";
  /** 画板尺寸：给了就按画布上的真实尺寸 1:1 还原（组件宽度/断点都不变），放不下就滚动 */
  frameW?: number;
  frameH?: number;
}

export default function BoardViewer({ items, docId, plain, fitWidth, frameW, frameH }: Props) {
  const [cards, setCards] = useState<Record<string, RenderPayload>>({});
  const [loading, setLoading] = useState(true);
  /** fitWidth="container" 时自己量宽度：滚动条占位、面板缩放都能实时跟上 */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    if (fitWidth !== "container" && !(frameW && frameW > 0)) return;
    const el = boxRef.current;
    if (!el) return;
    const read = (w: number) => setContainerW((cur) => (Math.abs(cur - w) > 1 ? Math.round(w) : cur));
    read(el.clientWidth);
    const ro = new ResizeObserver((entries) => read(entries[0]?.contentRect.width ?? el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
    /* loading 也要进依赖：首帧是转圈（容器还没渲染），不重跑就永远量不到宽度 → 缩放失效 */
  }, [fitWidth, frameW, loading]);

  /* 页面元素（标题 / 文字 / 形状 / 画板）不查数据，前端直接画 */
  const isPageElement = (item: CanvasItem) => !!item.type && item.type !== "chart" && item.type !== "filter";

  /* 成品页：画板本身和「画板区域内的组件」都不直接铺在页面上，它们只作为弹窗内容 */
  const hidden = useMemo(() => {
    const boards = items.filter((it) => it.type === "board");
    const keys = new Set<string>(boards.map((b) => b.key));
    items.forEach((it) => {
      if (it.type === "board") return;
      const cx = it.x + it.w / 2;
      const cy = it.y + it.h / 2;
      if (boards.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h)) keys.add(it.key);
    });
    return keys;
  }, [items]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all(
      items.filter((item) => !hidden.has(item.key) && !isPageElement(item)).map((item) =>
        client.post("/bi/components/preview", { kind: item.kind, spec: item.spec })
          .then((res) => [item.key, res.data] as const)
          .catch(() => [item.key, null] as const),
      ),
    ).then((pairs) => {
      if (!alive) return;
      const map: Record<string, RenderPayload> = {};
      pairs.forEach(([key, payload]) => { if (payload) map[key] = payload as RenderPayload; });
      setCards(map);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [items]);

  const shown = items.filter((i) => !hidden.has(i.key));
  /** 画板模式：按画布上的真实尺寸 1:1 还原，组件宽度/断点跟画布完全一致（放不下就滚动，不缩放） */
  const frameMode = !!frameW && frameW > 0;
  /** 内容真实占位（没有画板尺寸时用）：卡片可能比画板还宽，按内容算才不会截断 */
  /* 画板坐标系里组件的真实外接框（不额外加留白，宽度就是画板宽度，和画布一一对应） */
  const bboxW = Math.max(160, ...shown.map((i) => i.x + i.w));
  const bboxH = Math.max(160, ...shown.map((i) => i.y + i.h + 16));
  /* 画板框也兜一层：文档里画板尺寸比里面的组件小时（历史数据），按内容放宽，别把组件切掉 */
  const contentW = frameMode ? Math.max(frameW, bboxW) : bboxW;
  const contentH = frameMode ? Math.max(frameH && frameH > 0 ? frameH : 0, bboxH) : bboxH;
  /** 放得下就 1:1（组件宽度、断点跟画布完全一致）；容器真的比画板窄时才等比缩一点点 —— 宁可略小，绝不裁切 */
  const availW = fitWidth === "container" || frameMode
    ? (containerW > 0 ? containerW : contentW)
    : fitWidth;
  const scale = availW ? Math.min(1, availW / contentW) : 1;
  const innerW = contentW;
  const innerH = contentH;
  const width = fitWidth === "container" || frameMode ? "100%" : innerW * scale;
  const height = innerH * scale;

  if (loading) {
    return (
      <Box sx={{ py: 12, display: "grid", placeItems: "center" }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  return (
    <CanvasDetailContext.Provider value={{ items }}>
    <Box sx={{ p: plain ? 0 : 2, overflow: "auto" }}>
      <Box
        ref={boxRef}
        sx={{
          position: "relative", width, height, mx: "auto",
          /* 缩放后视觉上刚好放下，但布局宽度还是原尺寸 —— 裁掉这点溢出，别让外层多出横向滚动条 */
          overflow: fitWidth || frameMode ? "hidden" : "visible",
          backgroundColor: plain ? "transparent" : "#FCFDFF",
          borderRadius: plain ? 0 : 3,
          border: plain ? "none" : "1px solid #EEF3FB",
          backgroundImage: plain
            ? "none"
            : "radial-gradient(circle at 1px 1px, #E2E8F0 1px, transparent 0)",
          backgroundSize: "16px 16px",
        }}
      >
        <Box sx={{
          position: "absolute", top: 0, left: 0, width: innerW, height: innerH,
          transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left",
        }}>
        {items.map((item, index) => {
          const payload = item.kind === "section"
            ? { ...cards[item.key], ...sectionPayload(item.spec) }
            : cards[item.key];
          const Renderer = RENDERERS[item.kind as ComponentKind] ?? RENDERERS.kpi;
          return (
            <Box key={item.key} sx={{ position: "absolute", zIndex: index, left: item.x, top: item.y, width: item.w, height: item.h }}>
              {isPageElement(item) ? (
                <ElementBody item={item} />
              ) : payload ? (
                <Renderer
                  payload={payload}
                  ui={item.spec.ui}
                  onLoadAll={docId ? async () => {
                    const res = await client.post(`/bi/dashboards/${docId}/rows`, {
                      view: null, params: {}, item_key: item.key,
                    });
                    return { rows: res.data?.rows ?? [], columns: res.data?.columns ?? [] };
                  } : undefined}
                />
              ) : (
                <Box sx={{
                  height: "100%", bgcolor: "#fff", border: "1px dashed #E2E8F0", borderRadius: 2.5,
                  display: "grid", placeItems: "center", fontSize: 11.5, color: "#94A3B8",
                }}>
                  暂无数据
                </Box>
              )}
            </Box>
          );
        })}
        </Box>
      </Box>
    </Box>
    </CanvasDetailContext.Provider>
  );
}
