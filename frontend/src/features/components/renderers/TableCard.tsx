/** 明细表格卡 —— 列类型 / 排序 / 分页 / 查看更多 / 行点击（沿用页面表格规范） */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Box, Button, CircularProgress, Dialog, Drawer, IconButton, Typography,
} from "@mui/material";
import { Close as CloseIcon, Download as DownloadIcon, QrCode2 } from "@mui/icons-material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import QrCodeDialog from "../board/QrCodeDialog";
import BoardViewer from "../board/BoardViewer";
import { CanvasDetailContext, autoKeyFieldOf, boardOf, boardViewItems, type BoardArea } from "../board/canvasDetail";
import type { DetailConfig } from "../types";
import type { ComponentSpec, RenderPayload, TableColumn, UiSpec } from "../types";
import type { CanvasItem } from "../boardTypes";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  onMore?: () => void;
  /** 拉取该表格的全量行（弹窗「查看更多」用） */
  onLoadAll?: () => Promise<{ rows: Record<string, unknown>[]; columns?: TableColumn[] }>;
  /** 导出这张表的数据集（成品页才有） */
  onExport?: () => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}

const PLATFORM_TONE: Record<string, { color: string; bg: string }> = {
  拼多多: { color: "#E23A3A", bg: "rgba(226,58,58,0.08)" },
  天猫: { color: "#E4393C", bg: "rgba(228,57,60,0.08)" },
  京东: { color: "#D9232E", bg: "rgba(217,35,46,0.08)" },
  抖音: { color: "#161823", bg: "rgba(22,24,35,0.06)" },
};

const NUMBER_TYPES = new Set(["number", "percent", "money"]);

function isNumeric(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && /^-?[\d,.]+$/.test(value));
}

function deriveColumns(rows: Record<string, unknown>[]): TableColumn[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]).map((key) => ({
    key,
    label: key,
    type: (key.includes("率") || key.includes("占比") ? "percent" : isNumeric(rows[0][key]) ? "number" : "text") as TableColumn["type"],
    align: (isNumeric(rows[0][key]) ? "right" : "left") as TableColumn["align"],
    width: 0,
  }));
}

/** 自绘滚动条：系统条隐藏，悬停容器时露一条 4px 淡拇指，可拖 */
function useSlimScrollbar() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [bar, setBar] = useState({ top: 0, height: 0, visible: false });

  useEffect(() => {
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const need = scrollHeight - clientHeight > 1;
      if (!need) { setBar({ top: 0, height: 0, visible: false }); return; }
      const height = Math.max(26, (clientHeight * clientHeight) / scrollHeight);
      const max = scrollHeight - clientHeight;
      const top = max > 0 ? (scrollTop / max) * (clientHeight - height) : 0;
      setBar({ top, height, visible: true });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    return () => { el.removeEventListener("scroll", update); observer?.disconnect(); };
  }, [el]);

  /** 拖拇指滚动 */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!el) return;
    event.preventDefault();
    const startY = event.clientY;
    const startTop = el.scrollTop;
    const ratio = el.scrollHeight / Math.max(1, el.clientHeight);
    const move = (e: PointerEvent) => { el.scrollTop = startTop + (e.clientY - startY) * ratio; };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return { setEl, bar, startDrag };
}

/** 量一个容器的可用宽度（表格列宽按 px 算，calc 混合单位在 table 里不生效） */
function useMeasuredWidth(dep?: unknown) {
  // callback ref：元素挂载（含 Dialog 打开时才渲染的情况）就触发一次测量
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const update = () => setWidth((prev) => (Math.abs(prev - el.clientWidth) > 1 ? el.clientWidth : prev));
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [el, dep]);
  return [setEl, width] as const;
}

/** 文字宽度粗估（中文 13px/字，英文数字 7px） */
function textPx(text: string): number {
  return [...text].reduce((sum, ch) => sum + (/[\u4e00-\u9fa5]/.test(ch) ? 13 : 7), 0);
}

/** 文本列最多展示 12 个字（再多就省略号），列宽也按这个上限算 */
const TEXT_PREVIEW_CHARS = 12;

/** 列宽权重：按表头 + 前几行内容的平均长度，长文本列宽一点，短列窄一点 */
function columnWeight(column: TableColumn, rows: Record<string, unknown>[]): number {
  if (column.width) return column.width;
  const header = textPx(column.label || column.key);
  const samples = rows.slice(0, 8).map((row) => (
    textPx(String(row[column.key] ?? "").slice(0, TEXT_PREVIEW_CHARS))
  ));
  const avg = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : 0;
  const cap = TEXT_PREVIEW_CHARS * 13;   // 12 个中文字的宽度
  return Math.max(44, header, Math.min(avg, cap)) + 40;   // +左右内边距（各 20px）
}

function rankTone(rank: number): { color: string; bg: string } {
  if (rank <= 3) return { color: "#B45309", bg: "rgba(245,158,11,0.12)" };
  if (rank <= 10) return { color: "#1D4ED8", bg: "rgba(59,130,246,0.1)" };
  if (rank <= 20) return { color: "#0F766E", bg: "rgba(20,184,166,0.1)" };
  return { color: "#64748B", bg: "#F1F5F9" };
}

export default function TableCard({ payload, ui, compact, onMore, onLoadAll, onRowClick, onExport }: Props) {
  const token = accentOf(ui.accent);
  const rows = payload.rows ?? [];
  const columns = payload.columns?.length ? payload.columns : deriveColumns(rows);
  const pageSize = payload.page_size ?? 10;
  /** 行详情面板配置（明细表配置里开启） */
  const detail = (payload as unknown as { detail?: DetailConfig }).detail;
  const detailInline = useContext(CanvasDetailContext);

  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(null);
  /** 链接列点「打开」→ 弹二维码 */
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  /** 行详情弹窗：点一行后按配置弹出（row + 目标画板） */
  const [detailRow, setDetailRow] = useState<{ row: Record<string, unknown>; board: BoardArea } | null>(null);
  const [page, setPage] = useState(1);
  /** 查看更多弹窗 */
  const [allOpen, setAllOpen] = useState(false);
  const [previewSrc, setPreviewSrc] = useState("");
  /** 关闭动画里保留最后一张图，避免弹窗先变空白框 */
  const [previewShown, setPreviewShown] = useState("");
  useEffect(() => { if (previewSrc) setPreviewShown(previewSrc); }, [previewSrc]);
  const [allRows, setAllRows] = useState<Record<string, unknown>[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);

  const openAll = async () => {
    setAllOpen(true);
    if (allRows || !onLoadAll) return;
    setLoadingAll(true);
    try {
      const data = await onLoadAll();
      setAllRows(data?.rows ?? []);
    } catch {
      setAllRows([]);
    } finally {
      setLoadingAll(false);
    }
  };

  const compute = payload.compute ?? { format: "int", decimals: 0, scale: 1, offset: 0, prefix: "", suffix: "", transform: "raw" };
  const transform = compute.transform ?? "raw";

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const list = [...rows];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (isNumeric(av) && isNumeric(bv)) {
        return sort.desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
      }
      return sort.desc
        ? String(bv ?? "").localeCompare(String(av ?? ""), "zh-CN")
        : String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN");
    });
    return list;
  }, [rows, sort]);

  /** 「运算」按列作用在显示顺序上：占比 / 指数化 / 环比差值 / 累计值 */
  const transformed = useMemo(() => {
    if (transform === "raw" || !sorted.length) return sorted;
    const out = sorted.map((row) => ({ ...row }));
    columns.forEach((column) => {
      if (!NUMBER_TYPES.has(column.type)) return;
      const values = sorted.map((row) => Number(row[column.key]));
      if (transform === "share") {
        const sum = values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0) || 1;
        out.forEach((row, index) => { row[column.key] = (Number.isFinite(values[index]) ? values[index] : 0) / sum; });
      } else if (transform === "index") {
        const base = values.find((value) => Number.isFinite(value)) || 1;
        out.forEach((row, index) => { row[column.key] = ((Number.isFinite(values[index]) ? values[index] : 0) / base) * 100; });
      } else if (transform === "delta") {
        out.forEach((row, index) => {
          const current = Number.isFinite(values[index]) ? values[index] : 0;
          const previous = index > 0 && Number.isFinite(values[index - 1]) ? values[index - 1] : 0;
          row[column.key] = index === 0 ? 0 : current - previous;
        });
      } else if (transform === "cumsum") {
        let acc = 0;
        out.forEach((row, index) => {
          acc += Number.isFinite(values[index]) ? values[index] : 0;
          row[column.key] = acc;
        });
      }
    });
    return out;
  }, [sorted, columns, transform]);

  const total = payload.count ?? sorted.length;
  const canMore = Boolean(payload.more !== false && total > rows.length);
  /** 行首缩略图：图来自 thumb_key 列的图片地址（不是图片地址就显示占位框） */
  const thumbKey = payload.thumb ? (payload.thumb_key ?? "") : "";
  const IMAGE_SRC = /^(data:image\/|\/uploads\/|https?:\/\/(?:[^?#]*\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)|[^?#]*(?:image|img|pic|photo|thumb)))/i;
  /** ID 形式的图片字段：值是文件夹名，后端取文件夹里序号最小的第一张 */
  const ID_VALUE = /^[-\w\u4e00-\u9fa5]{1,120}$/;
  /** 缩略图候选地址：① 图片字段的值 ② 商品链接里的 {链接id}_main（软链命名规则）；按顺序回退 */
  const thumbSources = (row: Record<string, unknown>): string[] => {
    const out: string[] = [];
    const raw = String(row[thumbKey] ?? "").trim();
    if (raw) {
      if (IMAGE_SRC.test(raw)) out.push(raw);
      else if (ID_VALUE.test(raw)) out.push(`/api/bi/images/${encodeURIComponent(raw)}`);
    }
    for (const value of Object.values(row)) {
      const match = /goods_id=(\d{6,})/.exec(String(value ?? ""));
      if (match) {
        const url = `/api/bi/images/${match[1]}_main`;
        if (!out.includes(url)) out.push(url);
        break;
      }
    }
    return out;
  };
  const thumbsVisible = Boolean(payload.thumb) && Boolean(thumbKey);
  /** 缩略图字段不重复当普通列显示 */
  const bodyColumns = thumbsVisible ? columns.filter((column) => column.key !== thumbKey) : columns;

  /** 固定宽的两列（序号 / 缩略图）先从总宽里扣掉 */
  const fixedPx = (payload.index_column !== false ? 44 : 0) + (thumbsVisible ? 60 : 0);
  const weights = bodyColumns.map((column) => columnWeight(column, payload.rows ?? []));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const [bodySetEl, bodyWidth] = useMeasuredWidth();
  const [hoverBar, setHoverBar] = useState(false);
  const bodyScroll = useSlimScrollbar();
  const [dialogSetEl, dialogBodyWidth] = useMeasuredWidth(allOpen);
  const [hoverBarDlg, setHoverBarDlg] = useState(false);
  const dialogScroll = useSlimScrollbar();

  /** 文本列最多 12 个字，数值列给到 150；剩余宽度迭代分给还没到上限的列 */
  // 12 个字 + 省略号本身也要占位，所以留一个字宽
  const TEXT_CAP = (TEXT_PREVIEW_CHARS + 1) * 13 + 40;
  const NUM_CAP = 164;
  const layoutWidths = (available: number): number[] => {
    // 窄容器（组件库缩略预览）里单列别占太宽，保证每列都看得见
    const narrowCap = Math.max(72, Math.round(available * 0.62));
    const caps = bodyColumns.map((column) => {
      const base = NUMBER_TYPES.has(column.type) ? NUM_CAP : TEXT_CAP;
      return Math.min(base, narrowCap);
    });
    const total = weightSum || 1;
    let widths = weights.map((weight, index) => Math.min(caps[index], (available * weight) / total));
    const sum = () => widths.reduce((a, b) => a + b, 0);
    if (sum() > available) {
      const scale = available / (sum() || 1);
      widths = widths.map((w) => w * scale);
    }
    for (let round = 0; round < 3; round += 1) {
      const extra = available - sum();
      if (extra < 1) break;
      const flex = widths.map((w, i) => i).filter((i) => widths[i] < caps[i] - 0.5);
      if (!flex.length) break;
      const flexTotal = flex.reduce((a, i) => a + widths[i], 0) || flex.length;
      flex.forEach((i) => {
        widths[i] = Math.min(caps[i], widths[i] + (extra * widths[i]) / flexTotal);
      });
    }
    return widths.map((w) => Math.max(64, Math.round(w)));
  };

  const cardWidths = bodyWidth ? layoutWidths(Math.max(240, bodyWidth - fixedPx)) : null;
  const dialogWidths = dialogBodyWidth
    ? layoutWidths(Math.max(240, dialogBodyWidth - ((payload.index_column !== false ? 56 : 0) + (thumbsVisible ? 84 : 0))))
    : null;

  /** 列宽：自定义宽度优先，其次用分配结果 */
  const widthOf = (column: TableColumn, index: number): number | undefined => (
    column.width || cardWidths?.[index]
  );

  /** 排名 / 序号这类小整数居中，别右对齐贴着下一列 */
  const alignFor = (column: TableColumn) => (
    /排名|序号|No\.?/i.test(column.label || column.key) ? "center" : column.align
  );
  const dialogWidthOf = (column: TableColumn, index: number): number | undefined => (
    column.width || dialogWidths?.[index]
  );

  const pageRows = canMore ? transformed.slice(0, pageSize) : transformed.slice((page - 1) * pageSize, page * pageSize);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));

  if (!rows.length) {
    return (
      <CardShell compact={compact} title={payload.title || "明细"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>
          当前筛选下没有数据
        </Box>
      </CardShell>
    );
  }

  const badge = (column: TableColumn, row: Record<string, unknown>) => {
    const raw = String(row[column.key] ?? "");
    const tone = PLATFORM_TONE[raw] ?? { color: "#475569", bg: "#F1F5F9" };
    return (
      <Box component="span" sx={{
        display: "inline-flex", alignItems: "center", gap: 0.4,
        px: 0.7, height: 20, borderRadius: 1.25,
        bgcolor: tone.bg, color: tone.color, fontSize: 10.5, fontWeight: 600,
      }}>
        <Box component="span" sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: tone.color }} />
        {raw || "—"}
      </Box>
    );
  };

  const scale = Number(compute.scale ?? 1) || 1;
  const offset = Number(compute.offset ?? 0) || 0;
  const decimals = Math.max(0, Number(compute.decimals ?? 0) || 0);

  /** 数值列先按「运算」换算，再按「数字格式」显示，最后补前后缀 */
  const formatNumeric = (raw: unknown, column: TableColumn): string => {
    const num = Number(raw);
    // 日期 / 文本落到数值列时原样显示，别变成「—」
    if (!Number.isFinite(num)) return String(raw ?? "—");
    const value = num * scale + offset;
    const format = transform === "share" ? "pct" : (compute.format ?? "int");
    let text: string;
    switch (format) {
      case "w":
        text = `${(value / 10000).toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}万`;
        break;
      case "pct":
        text = `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(decimals || 1)}%`;
        break;
      case "money":
        text = `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
        break;
      case "date":
      case "text":
        text = String(raw ?? "—");
        break;
      default:
        text = value.toLocaleString("zh-CN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    return `${compute.prefix ?? ""}${text}${compute.suffix ?? ""}`;
  };

  const cell = (column: TableColumn, row: Record<string, unknown>) => {
    const raw = row[column.key];
    if (NUMBER_TYPES.has(column.type)) return formatNumeric(raw, column);
    switch (column.type) {
      case "rank": {
        const rank = Number(raw);
        const tone = rankTone(rank);
        return (
          <Box component="span" sx={{
            display: "inline-block", px: 0.7, height: 20, lineHeight: "20px",
            borderRadius: 1.25, bgcolor: tone.bg, color: tone.color,
            fontSize: 10.5, fontWeight: 700, fontVariantNumeric: "tabular-nums",
          }}>
            No.{Number.isFinite(rank) ? rank : "—"}
          </Box>
        );
      }
      case "badge":
        return badge(column, row);
      case "tag": {
        const text = String(raw ?? "");
        if (!text) return "—";
        const parts = text.split(column.tag_split || "·").filter(Boolean);
        return (
          <Box sx={{ display: "inline-flex", gap: 0.4 }}>
            {parts.map((part) => (
              <Box key={part} component="span" sx={{
                px: 0.55, height: 18, lineHeight: "18px", borderRadius: 1,
                bgcolor: "#F1F5F9", color: "#64748B", fontSize: 10,
              }}>{part}</Box>
            ))}
          </Box>
        );
      }
      case "dual":
        return (
          <Box>
            <Box sx={{ fontSize: 12, color: "#334155" }}>{String(raw ?? "—")}</Box>
            {column.sub_key ? (
              <Box sx={{ fontSize: 10, color: "#94A3B8" }}>{String(row[column.sub_key] ?? "")}</Box>
            ) : null}
          </Box>
        );
      case "image":
        return raw ? <Box component="img" src={String(raw)} alt="" sx={{ width: 34, height: 34, borderRadius: 1.5, objectFit: "cover" }} /> : "—";
      default: {
        const text = String(raw ?? "");
        // 链接 / 网址列：不铺一整串 URL，给一个「打开」按钮，点了转二维码
        if (/^https?:\/\/\S+$/i.test(text)) {
          return (
            <Box
              component="span"
              role="button"
              title={text}
              onClick={(event: React.MouseEvent) => { event.stopPropagation(); setQrUrl(text); }}
              sx={{
                display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, height: 22,
                borderRadius: "6px", bgcolor: "rgba(79,70,229,0.07)", color: "#4F46E5",
                fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                transition: "background-color .12s ease",
                "&:hover": { bgcolor: "rgba(79,70,229,0.14)" },
              }}
            >
              打开
              <QrCode2 sx={{ fontSize: 13 }} />
            </Box>
          );
        }
        return text || "—";
      }
    }
  };

  return (
    <CardShell
      compact={compact}
      title={payload.title || "明细"}
      accent={token.main}
      meta={compact || payload.chart?.show_meta === false ? undefined : (payload.subtitle ? payload.subtitle : (
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
          共 {total} 条
          {onExport && (
            <Box
              component="span"
              role="button"
              title="导出这张表的数据集"
              onClick={(event: React.MouseEvent) => { event.stopPropagation(); onExport(); }}
              sx={{
                display: "inline-flex", alignItems: "center", cursor: "pointer",
                color: "#94A3B8", transition: "color .14s",
                "&:hover": { color: token.main },
              }}
            >
              <DownloadIcon sx={{ fontSize: 14 }} />
            </Box>
          )}
        </Box>
      ))}
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Box
          onMouseEnter={() => setHoverBar(true)}
          onMouseLeave={() => setHoverBar(false)}
          sx={{ flex: 1, minHeight: 0, position: "relative", mx: -0.5, minWidth: 0 }}
        >
        <Box ref={(node: HTMLDivElement | null) => { bodySetEl(node); bodyScroll.setEl(node); }} sx={{
          height: "100%", overflow: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}>
          <table style={{
            // 列宽按字段自己的宽度排、紧贴左边；列多了就横向滚动，不把少字段的表格拉成半屏大列
            width: "100%",
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
            // 卡片很窄（组件库缩略预览）时不设最小宽，避免横向溢出
            minWidth: bodyWidth && bodyWidth < 420
              ? 0
              : (payload.index_column !== false ? 44 : 0)
                + (thumbsVisible ? 60 : 0)
                + bodyColumns.length * 112,
          }}>
            <thead>
              <tr>
                {payload.index_column !== false && (
                  <th style={{ ...headStyle("center", 44), padding: "8px 4px" }} />
                )}
                {thumbsVisible && <th style={{ ...headStyle("center", 60), padding: "8px 8px" }}>{""}</th>}
                {bodyColumns.map((column) => {
                  const active = sort?.key === column.key;
                  return (
                    <th
                      key={column.key}
                      style={{
                        // 列宽按内容比例分，长文本列宽、短列窄，间距才均匀
                        ...headStyle(alignFor(column)),

                        width: widthOf(column, bodyColumns.indexOf(column)),
                        minWidth: undefined,
                        cursor: payload.more || payload.sortable ? "pointer" : "default",
                        color: active ? token.main : "#64748B",
                      }}
                      onClick={() => {
                        if (!payload.sortable && !payload.more) return;
                        setSort((prev) =>
                          prev?.key === column.key ? { key: column.key, desc: !prev.desc } : { key: column.key, desc: true });
                      }}
                    >
                      {column.label}
                      {active ? (sort?.desc ? " ↓" : " ↑") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr
                  key={index}
                  onClick={() => {
                    if (detail?.enabled) {
                      // 先按 key 跨页面找，再退回当前页面
                      const board = detailInline?.findBoard?.(detail.board_key) ?? boardOf(detailInline?.items, detail.board_key);
                      if (!board) return;
                      // 编辑器画布内 → 交给画布右侧面板；成品页 → 按配置弹窗
                      if (detailInline?.open) {
                        detailInline.open({
                          detail, row, board,
                          tableKey: String((payload as unknown as { detailBoardKey?: string }).detailBoardKey || ""),
                        });
                      } else { setDetailRow({ row, board }); }
                      return;
                    }
                    onRowClick?.(row);
                  }}
                  style={{ cursor: onRowClick || detail?.enabled ? "pointer" : "default" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#F8FBFF"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                >
                  {payload.index_column !== false && (
                    <td style={{ ...cellStyle("center"), padding: "8px 4px" }}>
                      <span style={{ color: "#A8B7CC", fontWeight: 700, fontSize: 11.5 }}>
                        {(page - 1) * pageSize + index + 1}
                      </span>
                    </td>
                  )}
                  {thumbsVisible && (
                    <td style={{ ...cellStyle("center"), padding: "8px 8px", width: 60 }}>
                      <Thumb sources={thumbSources(row)} onOpen={setPreviewSrc} />
                    </td>
                  )}
                  {bodyColumns.map((column) => (
                    <td key={column.key} style={cellStyle(alignFor(column), NUMBER_TYPES.has(column.type))}>
                      {cell(column, row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        {bodyScroll.bar.visible && (
          <Box
            onPointerDown={bodyScroll.startDrag}
            sx={{
              position: "absolute", right: 2, width: 4, borderRadius: 999,
              top: bodyScroll.bar.top, height: bodyScroll.bar.height,
              bgcolor: "rgba(15,23,42,0.14)",
              opacity: hoverBar ? 1 : 0,
              transition: "opacity .18s",
              cursor: "pointer",
              "&:hover": { bgcolor: "rgba(15,23,42,0.35)", width: 6, right: 1 },
            }}
          />
        )}
        </Box>

        {(canMore || pages > 1) && (
          <Box sx={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            pt: 1, mt: 0.5, borderTop: "1px solid #F4F7FC", flexShrink: 0,
          }}>
            <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>
              共 {total} 条{canMore ? ` · 当前显示 ${Math.min(pageSize, total)} 条` : ""}
            </Typography>
            {canMore ? (
              <Button
                size="small"
                onClick={() => { void openAll(); onMore?.(); }}
                sx={{ textTransform: "none", fontSize: 11.5, color: token.main, minWidth: 0, px: 1 }}
              >
                {payload.more_label || "查看更多"} →
              </Button>
            ) : (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Button size="small" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}
                  sx={{ minWidth: 0, px: 0.75, fontSize: 11.5, textTransform: "none" }}>上一页</Button>
                <Typography sx={{ fontSize: 11.5, color: "#64748B" }}>{page} / {pages}</Typography>
                <Button size="small" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  sx={{ minWidth: 0, px: 0.75, fontSize: 11.5, textTransform: "none" }}>下一页</Button>
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* 点缩略图看大图 */}
      <Dialog
        open={Boolean(previewSrc)} onClose={() => setPreviewSrc("")} maxWidth={false}
        TransitionProps={{ onExited: () => setPreviewShown("") }}
        PaperProps={{ sx: { bgcolor: "transparent", boxShadow: "none", overflow: "visible" } }}
      >
        {previewShown ? <Box
          component="img" src={previewShown} alt=""
          onClick={() => setPreviewSrc("")}
          sx={{
            maxWidth: "82vw", maxHeight: "82vh", borderRadius: 2.5, display: "block",
            boxShadow: "0 24px 64px rgba(15,23,42,0.35)", cursor: "zoom-out", bgcolor: "#fff",
          }}
        /> : null}
      </Dialog>

      {/* 查看更多：整表弹窗（大表格样式，参考明细页） */}
      <Dialog
        open={allOpen} onClose={() => setAllOpen(false)} maxWidth={false}
        PaperProps={{ sx: { width: "92vw", maxWidth: 1360, borderRadius: 3, overflow: "hidden" } }}
      >
        <Box sx={{
          display: "flex", alignItems: "center", gap: 1.5,
          px: 3, py: 2, borderBottom: "1px solid #EEF3FB", bgcolor: "#fff",
        }}>
          <Box sx={{ width: 3, height: 16, borderRadius: 1, bgcolor: token.main }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: "#0F172A" }}>
            {payload.title || "明细"}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11.5, color: "#94A3B8" }}>
            共 {allRows?.length ?? total} 条
          </Typography>
          <IconButton size="small" onClick={() => setAllOpen(false)} sx={{ color: "#94A3B8", "&:hover": { color: "#0F172A" } }}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>

        <Box
          onMouseEnter={() => setHoverBarDlg(true)}
          onMouseLeave={() => setHoverBarDlg(false)}
          sx={{ position: "relative", bgcolor: "#fff" }}
        >
        <Box ref={(node: HTMLDivElement | null) => { dialogSetEl(node); dialogScroll.setEl(node); }} sx={{
          maxHeight: "72vh", overflow: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}>
          {loadingAll ? (
            <Box sx={{ py: 10, display: "grid", placeItems: "center" }}>
              <CircularProgress size={22} />
            </Box>
          ) : (
            <table style={{
              width: "100%", tableLayout: "fixed", borderCollapse: "separate", borderSpacing: 0,
              minWidth: (payload.index_column !== false ? 56 : 0)
                + (thumbsVisible ? 84 : 0)
                + bodyColumns.length * 120,
            }}>
              <thead>
                <tr>
                  {payload.index_column !== false && <th style={{ ...bigHead("center", 56), padding: "12px 6px" }} />}
                  {thumbsVisible && <th style={{ ...bigHead("center", 84), padding: "12px 8px" }}>产品图</th>}
                  {bodyColumns.map((column) => {
                    const active = sort?.key === column.key;
                    const clickable = payload.sortable || payload.more;
                    return (
                      <th
                        key={column.key}
                        style={{
                          ...bigHead(alignFor(column)),
  
                          width: dialogWidthOf(column, bodyColumns.indexOf(column)),
                          minWidth: undefined,
                          cursor: clickable ? "pointer" : "default",
                          color: active ? token.main : "#475569",
                        }}
                        onClick={() => {
                          if (!clickable) return;
                          setSort((prev) => (
                            prev?.key === column.key ? { key: column.key, desc: !prev.desc } : { key: column.key, desc: true }
                          ));
                        }}
                      >
                        {column.label}
                        {active ? (sort?.desc ? " ↓" : " ↑") : ""}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(allRows ?? []).map((row, index) => (
                  <tr
                    key={index}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#F8FBFF"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                  >
                    {payload.index_column !== false && (
                      <td style={{ ...bigCell("center"), padding: "9px 6px" }}>
                        <span style={{ color: "#A8B7CC", fontWeight: 700, fontSize: 12 }}>{index + 1}</span>
                      </td>
                    )}
                    {thumbsVisible && (
                      <td style={{ ...bigCell("left"), padding: "9px 8px", width: 84 }}>
                        <Thumb sources={thumbSources(row)} onOpen={setPreviewSrc} />
                      </td>
                    )}
                    {bodyColumns.map((column) => (
                      <td
                        key={column.key}
                        style={{
                          ...bigCell(alignFor(column)),
  
                          fontSize: 13,
                          color: "#1F2937",
                          fontVariantNumeric: NUMBER_TYPES.has(column.type) ? "tabular-nums" : undefined,
                        }}
                      >
                        {cell(column, row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
        {dialogScroll.bar.visible && (
          <Box
            onPointerDown={dialogScroll.startDrag}
            sx={{
              position: "absolute", right: 2, width: 4, borderRadius: 999,
              top: dialogScroll.bar.top, height: dialogScroll.bar.height,
              bgcolor: "rgba(15,23,42,0.14)",
              opacity: hoverBarDlg ? 1 : 0,
              transition: "opacity .18s",
              cursor: "pointer",
              "&:hover": { bgcolor: "rgba(15,23,42,0.3)", width: 6, right: 1 },
            }}
          />
        )}
        </Box>
      </Dialog>

      <BoardPopup detail={detail ?? null} popup={detailRow} onClose={() => setDetailRow(null)} />

      <QrCodeDialog url={qrUrl} onClose={() => setQrUrl(null)} />

    </CardShell>
  );
}

/** 缩略图：地址取不到就显示占位框，不留裂图 */
function Thumb({ sources, onOpen }: { sources: string[]; onOpen?: (src: string) => void }) {
  const [index, setIndex] = useState(0);
  const key = sources.join("|");
  useEffect(() => { setIndex(0); }, [key]);

  const src = sources[index] ?? "";
  if (!src) {
    return <Box sx={{ width: 40, height: 40, borderRadius: 1.25, mx: "auto", bgcolor: "#F6F8FC", border: "1px dashed #E5EAF3" }} />;
  }
  return (
    <Box
      component="img" src={src} alt="" loading="lazy"
      onError={() => setIndex((i) => i + 1)}
      onClick={() => onOpen?.(src)}
      sx={{
        width: 40, height: 40, borderRadius: 1.25, objectFit: "cover",
        border: "1px solid #EEF3FB", display: "block", mx: "auto",
        cursor: onOpen ? "zoom-in" : "default",
        transition: "box-shadow .14s, transform .14s",
        "&:hover": onOpen ? { boxShadow: "0 0 0 2px rgba(79,70,229,0.45)", transform: "scale(1.04)" } : undefined,
      }}
    />
  );
}

/** 弹窗里的大表格：表头浅蓝、行高更松，和明细页观感一致 */
function bigHead(align: string, width = 0): React.CSSProperties {
  return {
    position: "sticky", top: 0, zIndex: 1,
    background: "#F7FAFF", color: "#475569",
    fontSize: 12, fontWeight: 600, letterSpacing: 0.2,
    textAlign: align as React.CSSProperties["textAlign"],
    padding: "12px 20px",
    borderBottom: "1px solid #EAF0FA",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    width: width || undefined,
    minWidth: width || undefined,
  };
}

function bigCell(align: string): React.CSSProperties {
  return {
    padding: "9px 20px",
    fontSize: 12.5,
    color: "#475569",
    textAlign: align as React.CSSProperties["textAlign"],
    borderBottom: "1px solid #F2F6FC",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

function headStyle(align: string, width = 0): React.CSSProperties {
  return {
    position: "sticky", top: 0, zIndex: 1,
    background: "#F8FAFD", color: "#64748B",
    fontSize: 11.5, fontWeight: 600,
    textAlign: align as React.CSSProperties["textAlign"],
    padding: "8px 20px",
    borderBottom: "1px solid #EEF3FB",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    width: width || undefined,
    minWidth: width || undefined,
  };
}

function cellStyle(align: string, numeric = false): React.CSSProperties {
  return {
    padding: "8px 20px",
    fontSize: 12,
    color: "#475569",
    textAlign: align as React.CSSProperties["textAlign"],
    borderBottom: "1px solid #F4F7FC",
    fontVariantNumeric: numeric ? "tabular-nums" : undefined,
    whiteSpace: "nowrap",
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
}

/** 右上说明：手填了就用它，且受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}

/** 把当前行的识别列注入到卡片过滤条件里（详情面板取数只取这一行） */
function injectRowFilter(spec: ComponentSpec | undefined, column: string, value: unknown) {
  if (!spec || !column || value === undefined || value === null || value === "") return spec;
  const binding = (spec.binding || {}) as unknown as Record<string, unknown>;
  const filters = Array.isArray(binding.filters) ? [...(binding.filters as { column?: string }[])] : [];
  const rest = filters.filter((f) => f && f.column !== column);
  return { ...spec, binding: { ...binding, filters: [...rest, { column, op: "=", value }] } };
}

/** 把行详情卡片按数组顺序纵向排成画布元素 */
function buildDetailItems(detail: DetailConfig, row: Record<string, unknown>, cardWidth = 450): CanvasItem[] {
  /* 行标识列被清空过（老看板）→ 按当前行的 ID 列兜底，否则「点哪行都显示全量」 */
  const keyField = detail.key_field || autoKeyFieldOf(row);
  const value = keyField ? row[keyField] : undefined;
  const w = Math.max(240, cardWidth);
  let y = 8;
  return (detail.items ?? []).map((card) => {
    const item: CanvasItem = {
      key: card.key,
      kind: card.kind as CanvasItem["kind"],
      component: card.component,
      type: "chart",
      x: 8, y, w, h: card.h,
      spec: injectRowFilter(card.spec, keyField, value) as ComponentSpec,
    };
    y += card.h + 10;
    return item;
  });
}

/** 行详情内容：标题 + 组件卡片（成品页抽屉 / 编辑器画布内面板共用） */
export function RowDetailContent({ detail, row, onClose, width = 480 }: {
  detail: DetailConfig;
  row: Record<string, unknown>;
  onClose: () => void;
  /** 面板宽度：卡片按它等比排版（编辑器里的面板宽度会随画布变） */
  width?: number;
}) {
  const items = useMemo(() => buildDetailItems(detail, row, width - 30), [detail, row, width]);
  const title = String(row[detail.key_field] ?? "");
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Box sx={{
        px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, flexShrink: 0,
        bgcolor: "#fff", borderBottom: "1px solid #EEF3FB",
      }}>
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, color: "#0F172A", flex: 1, minWidth: 0 }}>
          {title || "行详情"}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: "#94A3B8", "&:hover": { color: "#0F172A" } }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
        {items.length ? <BoardViewer items={items} plain fitWidth={width - 30} /> : (
          <Typography sx={{ fontSize: 12, color: "#94A3B8", p: 2 }}>行详情面板还没有组件</Typography>
        )}
      </Box>
    </Box>
  );
}

/** 画板弹窗：按配置从右侧 / 中间 / 左侧弹出，内容 = 画板区域内的组件 */
function BoardPopup({ detail, popup, onClose }: {
  detail: DetailConfig | null;
  popup: { row: Record<string, unknown>; board: BoardArea } | null;
  onClose: () => void;
}) {
  const open = Boolean(detail && popup);
  const placement = detail?.popup ?? "right";
  const board = popup?.board ?? null;
  const keyField = detail && popup ? (detail.key_field || autoKeyFieldOf(popup.row)) : "";
  const items = useMemo(
    () => (detail && popup ? boardViewItems(popup.board, keyField, popup.row[keyField]) : []),
    [detail, popup, keyField],
  );
  const title = detail && popup ? String(popup.row[keyField] ?? "") : "";
  /* 弹窗宽度按「画板宽 / 组件实际外接宽」取大的：内容区正好装下整块画板，1:1 不缩放 */
  const contentW = Math.max(board?.w ?? 0, ...items.map((it) => it.x + it.w), 320);
  /* 尺寸永远不超过屏幕：画板比屏幕高 / 宽时，靠弹窗内容区滚动（而不是撑出屏幕、上下被裁掉） */
  const vw = typeof window === "undefined" ? 1440 : window.innerWidth;
  const vh = typeof window === "undefined" ? 900 : window.innerHeight;
  const width = board ? Math.min(contentW + 24, 1280, vw - 32) : Math.min(480, vw - 32);
  const height = board ? Math.min(board.h + 24, 880, vh - 32) : Math.min(640, vh - 32);

  const body = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, bgcolor: "#fff" }}>
      <Box sx={{
        px: 2, py: 1.5, display: "flex", alignItems: "center", gap: 1, flexShrink: 0,
        borderBottom: "1px solid #EEF3FB",
      }}>
        <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, color: "#0F172A", flex: 1, minWidth: 0 }}>
          {title || "详情"}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: "#94A3B8", "&:hover": { color: "#0F172A" } }}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <Box sx={{
        flex: 1, minHeight: 0, overflow: "auto", p: 1.5,
        scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" },
      }}>
        {items.length ? <BoardViewer items={items} plain frameW={board?.w} frameH={board?.h} /> : (
          <Typography sx={{ fontSize: 12, color: "#94A3B8", p: 2 }}>画板里还没有组件</Typography>
        )}
      </Box>
    </Box>
  );

  if (placement === "center") {
    return (
      <Dialog
        open={open} onClose={onClose} maxWidth={false}
        PaperProps={{
          sx: {
            width, height, borderRadius: 3, overflow: "hidden",
            maxWidth: "calc(100vw - 32px)", maxHeight: "calc(100vh - 32px)",
          },
        }}
      >
        {body}
      </Dialog>
    );
  }
  return (
    <Drawer
      anchor={placement === "left" ? "left" : "right"} open={open} onClose={onClose}
      PaperProps={{ sx: { width, maxWidth: "100vw", height: "100%", bgcolor: "#fff" } }}
    >
      {body}
    </Drawer>
  );
}
