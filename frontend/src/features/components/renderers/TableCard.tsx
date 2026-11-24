/** 明细表格卡 —— 列类型 / 排序 / 卡内分页 / 行点击（沿用页面表格规范） */

import { useContext, useEffect, useMemo, useState } from "react";
import {
  Box, Dialog, Drawer, IconButton, TextField, Typography,
} from "@mui/material";
import { Close as CloseIcon, Download as DownloadIcon, QrCode2, SwapHoriz as SwapHorizIcon } from "@mui/icons-material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import QrCodeDialog from "../board/QrCodeDialog";
import BoardViewer from "../board/BoardViewer";
import DrawerShell from "../../../components/common/DrawerShell";
import PageBar from "./PageBar";
import QrButton from "./QrButton";
import TagCell from "./TagCell";
import { cellStyle } from "./tableCellSx";
import { formatByPattern } from "../skin/patternFormat";
import ProductDetail, { ProductImages } from "./ProductDetail";
import { CanvasDetailContext, autoKeyFieldOf, boardOf, boardViewItems, type BoardArea } from "../board/canvasDetail";
import type { DetailConfig } from "../types";
import type { ComponentSpec, RenderPayload, TableColumn, UiSpec } from "../types";
import type { CanvasItem } from "../boardTypes";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  /** 打开时的默认排序（指标卡徽标弹窗用）：只作用于这一份渲染，关闭即恢复，不写回文档 */
  initialSort?: { key: string; desc: boolean } | null;
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

export default function TableCard({ payload, ui, compact, initialSort, onRowClick, onExport }: Props) {
  const token = accentOf(ui.accent);
  const rows = payload.rows ?? [];
  const columns = payload.columns?.length ? payload.columns : deriveColumns(rows);
  /** 打开时的默认排序：列必须真的在这张表里，否则忽略（配置的列被删掉的情况） */
  const startSort = initialSort && columns.some((column) => column.key === initialSort.key) ? initialSort : null;
  /** 每页条数：面板配的默认值打底，页脚下拉可临时改（不改文档） */
  const defaultPageSize = Math.max(3, Math.min(Number(payload.page_size) || 10, 200));
  const [pageSize, setPageSize] = useState(defaultPageSize);
  useEffect(() => { setPageSize(defaultPageSize); }, [defaultPageSize]);
  /** 行详情面板配置（明细表配置里开启） */
  const detail = (payload as unknown as { detail?: DetailConfig }).detail;
  const detailInline = useContext(CanvasDetailContext);

  const [sort, setSort] = useState<{ key: string; desc: boolean } | null>(startSort);
  /** 链接列点「打开」→ 弹二维码 */
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  /** 行详情抽屉：点一行后弹出（成品页用 DrawerShell 空壳，画板内容暂不渲染） */
  const [detailRow, setDetailRow] = useState<{ row: Record<string, unknown> } | null>(null);
  /** 抽屉视图：商品详情 / 商品图片 */
  const [drawerMode, setDrawerMode] = useState<"detail" | "images">("detail");
  const [page, setPage] = useState(1);
  /** 标题右侧搜索框（配置启用） */
  const [searchText, setSearchText] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  /** 关闭动画里保留最后一张图，避免弹窗先变空白框 */
  const [previewShown, setPreviewShown] = useState("");
  useEffect(() => { if (previewSrc) setPreviewShown(previewSrc); }, [previewSrc]);

  /** 点一行：成品页弹右侧抽屉；设计界面（编辑器）不弹，避免编辑时误触 */
  const openRowDetail = (row: Record<string, unknown>): boolean => {
    if (!detail?.enabled) { onRowClick?.(row); return false; }
    if (detailInline?.open) return true;
    setDrawerMode("detail");
    setDetailRow({ row });
    return true;
  };

  const compute = payload.compute ?? { format: "int", decimals: 0, scale: 1, offset: 0, prefix: "", suffix: "", transform: "raw" };
  const transform = compute.transform ?? "raw";

  /** 搜索：按所有列模糊过滤（忽略大小写） */
  const searched = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => columns.some((column) => String(row[column.key] ?? "").toLowerCase().includes(q)));
  }, [rows, columns, searchText]);

  const sorted = useMemo(() => {
    if (!sort) return searched;
    const list = [...searched];
    list.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      // 空值永远排最后（升序降序都一样），否则空串会跑到第一页
      const aEmpty = av == null || String(av).trim() === "";
      const bEmpty = bv == null || String(bv).trim() === "";
      if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
      if (isNumeric(av) && isNumeric(bv)) {
        return sort.desc ? Number(bv) - Number(av) : Number(av) - Number(bv);
      }
      return sort.desc
        ? String(bv ?? "").localeCompare(String(av ?? ""), "zh-CN")
        : String(av ?? "").localeCompare(String(bv ?? ""), "zh-CN");
    });
    return list;
  }, [searched, sort]);

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

  /** 行首缩略图：图来自 thumb_key 列的图片地址（不是图片地址就显示占位框） */
  const thumbKey = payload.thumb ? (payload.thumb_key ?? "") : "";
  /** 标题右侧搜索框（配置启用） */
  const searchEnabled = Boolean((payload as unknown as { search?: boolean }).search);
  const thumbSources = (row: Record<string, unknown>): string[] => thumbSourcesOf(thumbKey, row);
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

  /** 列宽：自定义宽度优先，其次用分配结果 */
  const widthOf = (column: TableColumn, index: number): number | undefined => (
    column.width || cardWidths?.[index]
  );

  /** 正文对齐：面板里每列可选（左 / 中 / 右），没配按左 */
  const alignFor = (column: TableColumn) => column.align || "left";

  /** 卡内分页：数据是一次取回的行，这里只切显示（搜索 / 排序 / 运算之后的口径） */
  const total = transformed.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const pageRows = transformed.slice((current - 1) * pageSize, current * pageSize);

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
    // 空值就是空值：以前 Number("") = 0，空着的数值列会显示成「0」（排序到最后才被发现）
    if (raw == null || String(raw).trim() === "") return "—";
    const num = Number(raw);
    // 日期 / 文本落到数值列时原样显示，别变成「—」
    if (!Number.isFinite(num)) return String(raw ?? "—");
    const value = num * scale + offset;
    // 列级格式优先：先是 d3 风格格式串（`,.1%` 这类），再回落旧枚举，最后才是整表格式
    const patterned = column.format ? formatByPattern(value, column.format) : null;
    if (patterned !== null) return `${compute.prefix ?? ""}${patterned}${compute.suffix ?? ""}`;
    const format = column.format || (transform === "share" ? "pct" : (compute.format ?? "int"));
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
        return <TagCell text={text} separator={column.tag_split} color={column.color} />;
      }
      case "link":
        return <QrButton text={String(raw ?? "")} />;
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
      meta={compact || payload.chart?.show_meta === false ? undefined : (
        <Box sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}>
          {searchEnabled && (
            <TextField
              size="small"
              placeholder="搜索"
              value={searchText}
              onChange={(event) => { setSearchText(event.target.value); setPage(1); }}
              onClick={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              sx={{ width: 150, "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12, bgcolor: "#fff" } }}
            />
          )}
          {payload.subtitle ? (
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", ...TEXT.meta, whiteSpace: "nowrap", flexShrink: 0 }}>
              {payload.subtitle}
            </Box>
          ) : null}
          {/* 总条数在页脚（分页条）里显示，这里只放导出 */}
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
      )}
    >
      <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Box
          onMouseEnter={() => setHoverBar(true)}
          onMouseLeave={() => setHoverBar(false)}
          /* 表格与页脚、卡片标题统一按内容区左缘对齐（不再外扩 4px，避免页脚看起来缩进） */
          sx={{ flex: 1, minHeight: 0, position: "relative", minWidth: 0 }}
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
                      aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                      title={`按「${column.label}」排序`}
                      style={{
                        // 列宽按内容比例分，长文本列宽、短列窄，间距才均匀
                        ...headStyle("center"),

                        width: widthOf(column, bodyColumns.indexOf(column)),
                        minWidth: undefined,
                        cursor: "pointer",
                        color: active ? token.main : "#64748B",
                      }}
                      onClick={() => {
                        // 列头升降序：始终可用（对已取回的全部行排序，然后回到第 1 页）
                        setSort((prev) =>
                          prev?.key === column.key ? { key: column.key, desc: !prev.desc } : { key: column.key, desc: true });
                        setPage(1);
                      }}
                    >
                      {column.label}
                      {active ? (sort.desc ? " ↓" : " ↑") : ""}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, index) => (
                <tr
                  key={index}
                  onClick={() => { openRowDetail(row); }}
                  style={{ cursor: onRowClick || detail?.enabled ? "pointer" : "default" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#F8FBFF"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
                >
                  {payload.index_column !== false && (
                    <td style={{ ...cellStyle("center"), padding: "8px 4px" }}>
                      <span style={{ color: "#A8B7CC", fontWeight: 700, fontSize: 11.5 }}>
                        {(current - 1) * pageSize + index + 1}
                      </span>
                    </td>
                  )}
                  {thumbsVisible && (
                    <td style={{ ...cellStyle("center"), padding: "8px 8px", width: 60 }}>
                      <Thumb sources={thumbSources(row)} onOpen={setPreviewSrc} />
                    </td>
                  )}
                  {bodyColumns.map((column) => (
                    <td key={column.key} style={cellStyle(alignFor(column), NUMBER_TYPES.has(column.type), column)}>
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

        {/* 卡内分页：总数 + 每页条数 + 页码（缩略预览不显示） */}
        {!compact && (
          <PageBar
            total={total}
            page={current}
            pageSize={pageSize}
            accent={token.main}
            onPage={setPage}
            onPageSize={(size) => { setPageSize(size); setPage(1); }}
          />
        )}
      </Box>

      {/* 点缩略图看大图（压过抽屉 / 画板浮层的 1500，图片永远在最前） */}
      <Dialog
        open={Boolean(previewSrc)} onClose={() => setPreviewSrc("")} maxWidth={false}
        sx={{ zIndex: 2000 }}
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


      <DrawerShell
        open={Boolean(detail?.enabled && detailRow)}
        onClose={() => setDetailRow(null)}
        width={560}
        title={drawerMode === "detail" ? "商品详情" : "商品图片"}
        action={
          <IconButton
            size="small"
            aria-label={drawerMode === "detail" ? "查看商品图片" : "返回商品详情"}
            onClick={() => setDrawerMode((m) => (m === "detail" ? "images" : "detail"))}
            sx={{ color: "#64748B", "&:hover": { color: "#0F172A", bgcolor: "rgba(15,23,42,0.06)" } }}
          >
            <SwapHorizIcon sx={{ fontSize: 18 }} />
          </IconButton>
        }
      >
        {detailRow ? (
          drawerMode === "detail" ? (
            <ProductDetail
              datasetId={Number((payload as unknown as { dataset_id?: number }).dataset_id || 0)}
              row={detailRow.row}
              keyField={detail?.key_field || ""}
              fields={detail?.fields}
              wordclouds={detail?.wordclouds}
              blocks={detail?.blocks}
            />
          ) : (
            <ProductImages row={detailRow.row} images={detail?.images} />
          )
        ) : null}
      </DrawerShell>

      <QrCodeDialog url={qrUrl} onClose={() => setQrUrl(null)} />

    </CardShell>
  );
}

/** 缩略图：地址取不到就显示占位框，不留裂图 */
/** 缩略图候选地址（弹窗里也要用同一套规则）：① 图片字段的值 ② 商品链接里的 {链接id}_main */
const IMAGE_SRC = /^(data:image\/|\/uploads\/|https?:\/\/(?:[^?#]*\.(?:png|jpe?g|webp|gif|avif)(?:[?#]|$)|[^?#]*(?:image|img|pic|photo|thumb)))/i;
/** ID 形式的图片字段：值是文件夹名，后端取文件夹里序号最小的第一张 */
const ID_VALUE = /^[-\w\u4e00-\u9fa5]{1,120}$/;

export function thumbSourcesOf(thumbKey: string, row: Record<string, unknown>): string[] {
  const out: string[] = [];
  const raw = String(row[thumbKey] ?? "").trim();
  if (thumbKey === "__related_thumbnail_url") return /^https?:\/\//i.test(raw) ? [raw] : [];
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
}

export function Thumb({ sources, onOpen }: { sources: string[]; onOpen?: (src: string) => void }) {
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
      onClick={(event) => { event.stopPropagation(); onOpen?.(src); }}
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

/** 卡片内的表头：sticky 浅蓝底 + 细线，窄卡片里也不折行 */
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

/** 行详情内容：标题 + 内容（画板内容暂不渲染，先用空壳占位） */
export function RowDetailContent({ detail, row, onClose }: {
  detail: DetailConfig;
  row: Record<string, unknown>;
  onClose: () => void;
  /** 面板宽度（保留兼容，暂未使用） */
  width?: number;
}) {
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
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 2 }}>
        <Typography sx={{ fontSize: 12.5, color: "#94A3B8" }}>行详情内容待配置</Typography>
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
        sx={{ zIndex: 1500 }}
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
      /* 层级压在卡片之上；根节点不吃点击（pointer-events: none）——
         这样抽屉悬浮在右侧，底下表格的行还能继续点，连着看下一条不用来回开关。 */
      sx={{ zIndex: 1500 }}
      ModalProps={{ hideBackdrop: true, disableEnforceFocus: true, disableScrollLock: true }}
      PaperProps={{ sx: { width, maxWidth: "100vw", height: "100%", bgcolor: "#fff", pointerEvents: "auto" } }}
      slotProps={{ root: { style: { pointerEvents: "none" } } }}
    >
      {body}
    </Drawer>
  );
}
