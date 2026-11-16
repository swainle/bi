/** 指标卡徽标弹窗 —— 独立的 TOP N 榜单（点右上角徽标打开）.
 *
 *  和卡片上的数字是两套口径：卡片可能是 COUNT(日销量)，这里按卡片里配的指标排行（如 日销量 SUM 前 10）。
 *  只读：不改文档、不动页面参数；关掉就完事，不影响其它卡片。
 */

import { useEffect, useState } from "react";
import { Box, CircularProgress, Dialog, IconButton, Typography } from "@mui/material";
import { Close, QrCode2 } from "@mui/icons-material";
import client from "../../../api/client";
import { Thumb, thumbSourcesOf } from "../renderers/TableCard";
import QrCodeDialog from "./QrCodeDialog";

interface Column {
  key: string;
  label?: string;
  type?: string;
  align?: string;
  width?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  dashboardId: number;
  itemKey: string;
  view: string;
  params: Record<string, unknown>;
  /** 编辑器里带上「未保存的现场版面」，弹窗配置才是最新的 */
  items?: unknown[];
}

const NUMERIC = new Set(["number", "percent", "money", "rank"]);

function fmtCell(value: unknown, type?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    if (type === "percent") return `${value.toFixed(1)}%`;
    return value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  const text = String(value);
  if (NUMERIC.has(String(type || "")) && /^-?\d+(?:\.\d+)?$/.test(text)) {
    return Number(text).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
  }
  return text;
}

export default function TopListDialog({ open, onClose, dashboardId, itemKey, view, params, items }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [count, setCount] = useState(0);
  /** 口径说明：SUM(日销量) · 10 条 · 并列 16（并列很多时，一眼能看出不是算错） */
  const [meta, setMeta] = useState({ metric: "", agg: "", tied: 0, requested: 0, expanded: false });
  /** 沿用「明细表」时的缩略图 / 序号列（与那张表观感一致） */
  const [layout, setLayout] = useState({ thumb: false, thumbKey: "", index: true });
  /** 链接列点「打开」→ 转二维码（与明细表同一套交互） */
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !dashboardId || !itemKey) return;
    let alive = true;
    setLoading(true);
    setError("");
    client.post(`/bi/dashboards/${dashboardId}/top-list`, {
      item_key: itemKey, view, params, ...(items ? { items } : {}),
    }, { timeout: 60000 }).then((res) => {
      if (!alive) return;
      setTitle(res.data?.title || "");
      setRows((res.data?.rows || []) as Record<string, unknown>[]);
      setColumns((res.data?.columns || []) as Column[]);
      setCount(Number(res.data?.count || 0));
      setMeta({
        metric: String(res.data?.metric || ""),
        agg: String(res.data?.agg || ""),
        tied: Number(res.data?.tied || 0),
        requested: Number(res.data?.requested || 0),
        expanded: Boolean(res.data?.expanded),
      });
      setLayout({
        thumb: Boolean(res.data?.thumb),
        thumbKey: String(res.data?.thumb_key || ""),
        index: res.data?.index_column !== false,
      });
    }).catch((err) => {
      if (!alive) return;
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setRows([]);
      setColumns([]);
      setError(detail || "取数失败");
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, dashboardId, itemKey, view, params, items]);

  const headers: Column[] = columns.length
    ? columns
    : (rows[0] ? Object.keys(rows[0]).map((key) => ({ key, label: key, type: "text" })) : []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth
      PaperProps={{ sx: { borderRadius: "16px", overflow: "hidden" } }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2.5, pt: 2, pb: 1.5 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#0F172A" }} noWrap>
            {title || "TOP 榜单"}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", mt: 0.25 }}>
            {loading ? "取数中…" : [
              meta.metric && meta.agg ? `${meta.agg}(${meta.metric})` : "",
              /* 并列全展示时说明「共几条」；严格模式下说明「同分还有几条、按名称排序」 */
              meta.expanded
                ? `前 ${meta.requested} 并列共 ${count}`
                : (meta.tied > count ? `${count} 条 · 同分 ${meta.tied} 条按名称排序` : `${count} 条`),
            ].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ flexShrink: 0 }}>
          <Close sx={{ fontSize: 18, color: "#94A3B8" }} />
        </IconButton>
      </Box>

      <Box sx={{ px: 2.5, pb: 2.5, minHeight: 220 }}>
        {loading ? (
          <Box sx={{ height: 220, display: "grid", placeItems: "center" }}>
            <CircularProgress size={22} sx={{ color: "#4F46E5" }} />
          </Box>
        ) : error ? (
          <Box sx={{ height: 220, display: "grid", placeItems: "center", fontSize: 12.5, color: "#EF4444" }}>
            {error}
          </Box>
        ) : !rows.length ? (
          <Box sx={{ height: 220, display: "grid", placeItems: "center", fontSize: 12.5, color: "#94A3B8" }}>
            当前筛选下没有数据
          </Box>
        ) : (
          <Box sx={{ maxHeight: "62vh", overflow: "auto" }}>
            <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto" }}>
              <Box component="thead">
                <Box component="tr">
                  {layout.index && <Box component="th" sx={{ ...th, width: 44 }}>#</Box>}
                  {layout.thumb && layout.thumbKey && <Box component="th" sx={{ ...th, width: 60 }} />}
                  {headers.map((column) => (
                    <Box component="th" key={column.key}
                      sx={{ ...th, textAlign: NUMERIC.has(String(column.type || "")) ? "right" : "left" }}>
                      {column.label || column.key}
                    </Box>
                  ))}
                </Box>
              </Box>
              <Box component="tbody">
                {rows.map((row, index) => (
                  <Box component="tr" key={index}
                    sx={{ "&:hover td": { bgcolor: "#F8FAFD" }, "&:last-of-type td": { borderBottom: "none" } }}>
                    {layout.index && (
                      <Box component="td" sx={{ ...td, color: "#A8B7CC", fontWeight: 700, width: 44, textAlign: "center" }}>
                        {index + 1}
                      </Box>
                    )}
                    {layout.thumb && layout.thumbKey && (
                      <Box component="td" sx={{ ...td, width: 60, textAlign: "center", py: 0.6 }}>
                        <Thumb sources={thumbSourcesOf(layout.thumbKey, row)} />
                      </Box>
                    )}
                    {headers.map((column) => {
                      const numeric = NUMERIC.has(String(column.type || ""));
                      const raw = String(row[column.key] ?? "");
                      const isUrl = /^https?:\/\/\S+$/i.test(raw);
                      return (
                        <Box component="td" key={column.key}
                          sx={{
                            ...td,
                            textAlign: numeric ? "right" : "left",
                            fontVariantNumeric: numeric ? "tabular-nums" : undefined,
                            color: numeric ? "#0F172A" : "#334155",
                            fontWeight: numeric ? 600 : 400,
                            minWidth: column.width ? Math.max(72, column.width) : undefined,
                            maxWidth: column.width ? Math.max(72, column.width) : (numeric ? 160 : 460),
                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                          }}
                          title={raw}>
                          {isUrl ? (
                            <Box
                              component="span" role="button" title={raw}
                              onClick={(event: React.MouseEvent) => { event.stopPropagation(); setQrUrl(raw); }}
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
                          ) : fmtCell(row[column.key], column.type)}
                        </Box>
                      );
                    })}
                  </Box>
                ))}
              </Box>
            </Box>
          </Box>
        )}
      </Box>
      <QrCodeDialog url={qrUrl} onClose={() => setQrUrl(null)} />
    </Dialog>
  );
}

const th = {
  position: "sticky" as const, top: 0, zIndex: 1,
  bgcolor: "#F4F7FC", color: "#64748B", fontSize: 11.5, fontWeight: 600,
  textAlign: "left" as const, px: 1.25, py: 1, borderBottom: "1px solid #EEF3FB",
  whiteSpace: "nowrap" as const,
};

const td = {
  fontSize: 12.5, px: 1.25, py: 1.05, borderBottom: "1px solid #F4F7FC", verticalAlign: "middle" as const,
};
