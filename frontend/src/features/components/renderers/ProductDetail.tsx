/** 商品详情模板 —— 明细表「点击行弹出」抽屉里的内容。
 *  样式参考演示页面：标题 + 链接ID + 标签 + 4 指标卡 + 差评云 + 卖点云(主/副) + 近30天差评。
 *  差评云 / 主卖点 / 副卖点 用词云组件（WordCloudCard）渲染：
 *    · 配了「关联表 + 关联字段 + 词字段」→ 从关联表按明细表行值取数；
 *    · 没配 → 回退当前数据集里的痛点 / 主卖点 / 副卖点字段。
 *  按数据集字段自动映射（中/英文都认），用「行标识列」取该商品完整一行。 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Box, CircularProgress, Dialog, IconButton, Stack, Typography } from "@mui/material";
import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon, Close as CloseIcon, Download as DownloadIcon, ExpandLess as ExpandLessIcon, ExpandMore as ExpandMoreIcon } from "@mui/icons-material";
import client from "../../../api/client";
import WordCloudCard from "./WordCloudCard";
import BarCard from "./BarCard";
import type { RenderPayload, UiSpec } from "../types";

type WcCfg = {
  dataset_id?: number;
  key_field?: string;
  word_field?: string;
  weight_field?: string;
  split?: string;
  palette?: string;
};

type BlockCfg = {
  dataset_id?: number;
  key_field?: string;
  date_field?: string;
  value_field?: string;
  score_field?: string;
  tag_field?: string;
  text_field?: string;
  spec_field?: string;
  price_field?: string;
  split?: string;
  dim_field?: string;
  val_field?: string;
  agg?: string;
  bar_width?: number;
  show_grid?: boolean;
  accent?: string;
};

interface Props {
  datasetId: number;
  row: Record<string, unknown>;
  keyField?: string;
  onClose?: () => void;
  /** 抽屉字段映射（明细表配置里手动选的列）；空 = 按字段名自动匹配 */
  fields?: Record<string, string>;
  /** 词云配置：{pain: {dataset_id, key_field, word_field, weight_field, split, palette}, ...} */
  wordclouds?: Record<string, WcCfg>;
  /** 附加区块配置：{trend, reviews, skus} */
  blocks?: Record<string, BlockCfg>;
}

/** 词云没配关联表时，回退当前数据集的中/英文字段 */
const FALLBACK: Record<string, string[]> = {
  pain: ["痛点", "pain_point"],
  main_sell: ["主卖点", "main_selling_point"],
  sub_sell: ["副卖点", "sub_selling_point"],
};

const pick = (data: Record<string, unknown>, ...names: string[]): unknown => {
  for (const name of names) {
    const value = data[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
};

const num = (v: unknown): number | null => {
  const text = String(v ?? "").trim();
  if (!text) return null;
  const n = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function fmt(v: unknown): string {
  const n = num(v);
  return n == null ? "—" : n.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
}

function fmtMoney(v: unknown): string {
  const n = num(v);
  return n == null ? "—" : `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function splitWords(v: unknown, sep = "/"): string[] {
  const text = String(v ?? "").trim();
  if (!text) return [];
  const parts = sep ? text.split(sep) : [text];
  return parts.map((s) => s.trim()).filter(Boolean);
}

const TONES = {
  rose: { color: "#E23A3A", bg: "#FFF7F7" },
  blue: { color: "#2563EB", bg: "#F5F8FF" },
  green: { color: "#0F766E", bg: "#F3FBF8" },
  gray: { color: "#64748B", bg: "rgba(100,116,139,0.08)" },
  amber: { color: "#B45309", bg: "rgba(180,83,9,0.08)" },
} as const;

function Tag({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  const t = TONES[tone];
  return (
    <Box sx={{
      px: 1, py: 0.25, borderRadius: 999, fontSize: 11,
      color: t.color, bgcolor: "rgba(15,23,42,0.04)", whiteSpace: "nowrap",
    }}>{children}</Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{
      flex: 1, minWidth: 0, px: 1.25, py: 1, borderRadius: 2,
      border: "1px solid #EEF3FB", bgcolor: "#fff",
    }}>
      <Typography sx={{ fontSize: 17, fontWeight: 700, color: "#0F172A", lineHeight: 1.3, fontVariantNumeric: "tabular-nums" }} noWrap>
        {value}
      </Typography>
      <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mt: 0.25 }} noWrap>{label}</Typography>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography sx={{
        fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1,
        pl: 0.75, borderLeft: "3px solid #4F46E5",
      }}>{title}</Typography>
      {children}
    </Box>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: 120, p: 1.5, borderRadius: 2,
      border: "1px dashed #D8E2F5", bgcolor: "#FAFBFE",
    }}>
      <Typography sx={{ fontSize: 11.5, color: "#94A3B8" }}>{text}</Typography>
    </Box>
  );
}

/** 用词云组件渲染一块词 */
type WordItem = { name: string; value: number };

function WordCloudBox({ series, palette }: { series: WordItem[]; palette: string }) {
  const ui: UiSpec = { accent: "indigo", radius: 8, min_height: 120, show_unit: false, animate: false, align: "left", columns: 1 };
  const payload = {
    kind: "wordcloud",
    title: "",
    series,
    chart: { cloud_palette: palette },
    ui,
    dimension_label: "词",
    metric_label: "提及",
    total: series.length,
    count: series.length,
  } as unknown as RenderPayload;
  return (
    <Box sx={{ height: 170, borderRadius: 2, overflow: "hidden", bgcolor: "#fff" }}>
      <WordCloudCard payload={payload} ui={ui} compact />
    </Box>
  );
}

/** 一块词云：配了关联表就从关联表取数，否则回退当前数据集字段 */
function RelatedWordCloud({ fieldKey, cfg, data, row, keyField }: {
  fieldKey: string;
  cfg?: WcCfg;
  data: Record<string, unknown> | null;
  row: Record<string, unknown>;
  keyField: string;
}) {
  const [words, setWords] = useState<WordItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const c = cfg || {};
    const run = async () => {
      try {
        if (c.dataset_id && c.word_field) {
          /* 关联表取数：按「关联字段 = 明细表行值」过滤，取词字段（+ 权重字段） */
          const relField = c.key_field || keyField;
          const matchValue = relField ? row[relField] ?? row[keyField] : row[keyField];
          if (matchValue == null) { if (alive) { setWords([]); setLoaded(true); } return; }
          if (alive) setLoading(true);
          const res = await client.post(`/bi/semantic/datasets/${c.dataset_id}/query`, {
            columns: [c.word_field, c.weight_field].filter(Boolean),
            metrics: [],
            filters: [{ name: relField, op: "=", value: String(matchValue) }],
            limit: 200,
          });
          if (!alive) return;
          const rows = (res.data?.rows || []) as Record<string, unknown>[];
          const agg = new Map<string, number>();
          for (const r of rows) {
            const text = String(r[c.word_field as string] ?? "");
            const wRaw = c.weight_field ? Number(r[c.weight_field]) : NaN;
            const w = Number.isFinite(wRaw) ? wRaw : 1;
            for (const word of splitWords(text, c.split ?? "/")) agg.set(word, (agg.get(word) ?? 0) + w);
          }
          setWords([...agg.entries()].map(([name, value]) => ({ name, value })));
        } else {
          /* 回退：当前数据集里的痛点 / 主卖点 / 副卖点 */
          const fallbackKeys = FALLBACK[fieldKey] || [];
          const value = data ? pick(data, ...fallbackKeys) : null;
          const parts = value == null ? [] : splitWords(value, c.split ?? "/");
          if (alive) setWords(parts.map((name, i) => ({ name, value: Math.max(1, parts.length - i) })));
        }
        if (alive) setLoaded(true);
      } catch {
        if (alive) { setWords([]); setLoaded(true); }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [fieldKey, cfg, data, row, keyField]);

  if (loading && !loaded) {
    return <Box sx={{ height: 170, display: "grid", placeItems: "center" }}><CircularProgress size={20} /></Box>;
  }
  if (!words.length) {
    const emptyText = fieldKey === "pain" ? "暂无差评" : fieldKey === "main_sell" ? "暂无主卖点" : "暂无副卖点";
    return <Empty text={emptyText} />;
  }
  return <WordCloudBox series={words} palette={cfg?.palette ?? "潮彩"} />;
}

/** 附加区块：从关联表按行标识取数，把 rows 交给 children 渲染 */
function BlockRows({ cfg, row, keyField, columns, children }: {
  cfg?: BlockCfg;
  row: Record<string, unknown>;
  keyField: string;
  columns: (string | undefined)[];
  children: (rows: Record<string, unknown>[]) => ReactNode;
}) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const key = String(cfg?.key_field || keyField || "");
  const matchValue = key ? row[key] ?? row[keyField] : undefined;
  const cols = columns.filter(Boolean).join("|");
  useEffect(() => {
    if (!cfg?.dataset_id || !key || matchValue == null) { setRows([]); return; }
    let alive = true;
    setLoading(true);
    client.post(`/bi/semantic/datasets/${cfg.dataset_id}/query`, {
      columns: cols ? cols.split("|") : [key],
      metrics: [],
      filters: [{ name: key, op: "=", value: String(matchValue) }],
      limit: 200,
    }).then((res) => { if (alive) { setRows((res.data?.rows || []) as Record<string, unknown>[]); setLoading(false); } })
      .catch(() => { if (alive) { setRows([]); setLoading(false); } });
    return () => { alive = false; };
  }, [cfg?.dataset_id, key, matchValue, cols]);
  if (loading) return <Box sx={{ py: 3, display: "grid", placeItems: "center" }}><CircularProgress size={20} /></Box>;
  return <>{children(rows)}</>;
}

/** 近30天差评数：按日期排序的柱状图（用柱状图组件 BarCard，参数来自区块配置） */
function TrendChart({ rows, cfg }: { rows: Record<string, unknown>[]; cfg?: BlockCfg }) {
  const dim = cfg?.dim_field || "";
  const val = cfg?.val_field || "";
  const points = rows
    .map((r) => ({ date: String(r[dim] ?? ""), value: Number(r[val] ?? 0) }))
    .filter((p) => p.date && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 31);
  if (!points.length) return <Empty text="近30天无差评" />;
  const accent = (cfg?.accent || "rose") as UiSpec["accent"];
  const ui: UiSpec = { accent, radius: 8, min_height: 120, show_unit: false, animate: false, align: "left", columns: 1 };
  const payload = {
    kind: "bar",
    title: "",
    series: points.map((p) => ({
      name: p.date.length >= 10 ? p.date.slice(5, 10) : p.date,
      value: p.value,
    })),
    chart: {
      show_title: false,
      show_grid: cfg?.show_grid !== false,
      bar_width: cfg?.bar_width,
      label_rotate: 0,
    },
    ui,
    dimension_label: "日期",
    metric_label: "差评数",
  } as unknown as RenderPayload;
  return (
    <Box sx={{ height: 200, borderRadius: 2, overflow: "hidden", bgcolor: "#fff" }}>
      <BarCard payload={payload} ui={ui} />
    </Box>
  );
}

/** 近30天差评数：按 X轴 分组 + Y轴函数聚合，用柱状图组件渲染 */
function TrendBlock({ cfg, row, keyField }: { cfg?: BlockCfg; row: Record<string, unknown>; keyField: string }) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const dim = cfg?.dim_field || "";
  const val = cfg?.val_field || "";
  const agg = cfg?.agg || "SUM";
  const datasetId = cfg?.dataset_id;
  const relField = cfg?.key_field || keyField;
  const matchValue = relField ? row[relField] ?? row[keyField] : undefined;
  useEffect(() => {
    if (!datasetId || !dim || !val || matchValue == null) { setRows([]); return; }
    let alive = true;
    setLoading(true);
    /* 只取最近 30 天：日期字段 >= 今天-30天 */
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    client.post(`/bi/semantic/datasets/${datasetId}/query`, {
      dimensions: [dim],
      metrics: [{ name: val, agg }],
      filters: [
        { name: relField, op: "=", value: String(matchValue) },
        { name: dim, op: ">=", value: cutoff },
      ],
      limit: 200,
    }).then((res) => { if (alive) { setRows((res.data?.rows || []) as Record<string, unknown>[]); setLoading(false); } })
      .catch(() => { if (alive) { setRows([]); setLoading(false); } });
    return () => { alive = false; };
  }, [datasetId, dim, val, agg, relField, matchValue]);
  if (loading) return <Box sx={{ py: 3, display: "grid", placeItems: "center" }}><CircularProgress size={20} /></Box>;
  return <TrendChart rows={rows} cfg={cfg} />;
}

/** 差评明细：评分 + 日期 + 标签 + 内容（前端分页，默认每页 10 条） */
function ReviewsList({ rows, scoreField, dateField, tagField, textField }: {
  rows: Record<string, unknown>[]; scoreField: string; dateField: string; tagField: string; textField: string;
}) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const all = rows.filter((r) => String(r[textField] ?? "").trim());
  const total = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, total - 1);
  const list = all.slice(current * pageSize, (current + 1) * pageSize);
  if (!all.length) return <Empty text="暂无差评明细" />;
  return (
    <Box>
      <Stack spacing={1}>
        {list.map((r, i) => (
          <Box key={`${current}-${i}`} sx={{ p: 1.25, borderRadius: 2, bgcolor: "#fff", border: "1px solid #EEF3FB" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              {scoreField && <Typography sx={{ fontSize: 11, color: "#F59E0B" }}>{String(r[scoreField] ?? "")}</Typography>}
              {dateField && <Typography sx={{ fontSize: 10.5, color: "#94A3B8" }}>{String(r[dateField] ?? "")}</Typography>}
              {tagField && <Typography sx={{ fontSize: 10.5, color: "#E23A3A" }} noWrap>{String(r[tagField] ?? "")}</Typography>}
            </Box>
            <Typography sx={{ fontSize: 11.5, color: "#334155", lineHeight: 1.5 }}>{String(r[textField] ?? "")}</Typography>
          </Box>
        ))}
      </Stack>
      {total > 1 && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, mt: 1 }}>
          <Typography sx={{ fontSize: 10.5, color: "#94A3B8" }}>共 {all.length} 条 · 第 {current + 1}/{total} 页</Typography>
          <Stack direction="row" spacing={0.25}>
            <IconButton size="small" disabled={current === 0} onClick={() => setPage(current - 1)} sx={{ p: 0.25 }}>
              <ChevronLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton size="small" disabled={current >= total - 1} onClick={() => setPage(current + 1)} sx={{ p: 0.25 }}>
              <ChevronRightIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/** 产品 SKU：规格 + 价格（前端分页，默认每页 10 行） */
function SkuList({ rows, specField, priceField }: { rows: Record<string, unknown>[]; specField: string; priceField: string }) {
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const all = rows.filter((r) => String(r[specField] ?? "").trim());
  const total = Math.max(1, Math.ceil(all.length / pageSize));
  const current = Math.min(page, total - 1);
  const list = all.slice(current * pageSize, (current + 1) * pageSize);
  if (!all.length) return <Empty text="暂无 SKU 数据" />;
  return (
    <Box>
      <Stack spacing={0.75}>
        {list.map((r, i) => {
          const price = priceField ? String(r[priceField] ?? "").trim() : "";
          return (
            <Box key={`${current}-${i}`} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, p: 1, borderRadius: 1.5, bgcolor: "#fff", border: "1px solid #EEF3FB" }}>
              <Typography sx={{ fontSize: 11.5, color: "#334155", minWidth: 0 }} noWrap>{String(r[specField] ?? "")}</Typography>
              {price && <Typography sx={{ fontSize: 11.5, color: "#E23A3A", fontWeight: 600, flexShrink: 0 }}>{price.startsWith("¥") ? price : `¥${price}`}</Typography>}
            </Box>
          );
        })}
      </Stack>
      {total > 1 && (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1, mt: 1 }}>
          <Typography sx={{ fontSize: 10.5, color: "#94A3B8" }}>共 {all.length} 条 · 第 {current + 1}/{total} 页</Typography>
          <Stack direction="row" spacing={0.25}>
            <IconButton size="small" disabled={current === 0} onClick={() => setPage(current - 1)} sx={{ p: 0.25 }}>
              <ChevronLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton size="small" disabled={current >= total - 1} onClick={() => setPage(current + 1)} sx={{ p: 0.25 }}>
              <ChevronRightIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/** 标签列表（卖点 / 痛点）：从关联表取标签字段，拆词后横向排列 */
function TagList({ rows, tagField, split }: { rows: Record<string, unknown>[]; tagField: string; split: string }) {
  const tags = Array.from(new Set(rows.flatMap((r) => splitWords(r[tagField], split || "/"))));
  if (!tags.length) return <Empty text="暂无标签" />;
  return (
    <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
      {tags.map((tag) => (
        <Box key={tag} sx={{ px: 1, py: 0.25, borderRadius: 999, fontSize: 11, color: "#475569", bgcolor: "rgba(15,23,42,0.04)" }}>{tag}</Box>
      ))}
    </Stack>
  );
}

export default function ProductDetail({ datasetId, row, keyField, onClose, fields, wordclouds, blocks }: Props) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const key = String(keyField || Object.keys(row)[0] || "");
  const keyValue = key ? row[key] : undefined;

  useEffect(() => {
    if (!datasetId || !key || keyValue == null) { setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const dsRes = await client.get(`/bi/semantic/datasets/${datasetId}`);
        const dsFields = (dsRes.data?.fields || []) as { name?: string; role?: string }[];
        const columns = dsFields
          .map((f) => f.name || "")
          .filter((name) => name && name !== key)
          .slice(0, 40);
        const res = await client.post(`/bi/semantic/datasets/${datasetId}/query`, {
          columns: columns.length ? columns : [key],
          metrics: [],
          filters: [{ name: key, op: "=", value: String(keyValue) }],
          limit: 1,
        });
        if (!alive) return;
        setData((res.data?.rows || [])[0] ?? null);
        setLoading(false);
      } catch {
        if (alive) { setError("详情加载失败"); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [datasetId, key, keyValue]);

  if (loading) {
    return <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}><CircularProgress size={28} /></Box>;
  }
  if (error) {
    return <Typography sx={{ fontSize: 12.5, color: "#EF4444", p: 2 }}>{error}</Typography>;
  }

  const d = data ?? {};
  /* 优先用手动配置的字段；没配则按字段名自动匹配 */
  const fieldOf = (keyName: string, ...fallback: string[]): unknown => {
    const mapped = fields?.[keyName];
    if (mapped) return d[mapped] ?? null;
    return pick(d, ...fallback);
  };
  const title = String(fieldOf("title", "商品标题", "product_title", "产品标题") ?? row["商品标题"] ?? row["product_title"] ?? "");
  const platform = String(fieldOf("platform", "平台", "platform_name", "platform") ?? "");
  const brand = String(fieldOf("brand", "品牌", "brand_name") ?? "");
  const category = String(fieldOf("category", "品类", "category_theme", "种类") ?? "");
  const board = String(fieldOf("board", "榜单", "rank_name") ?? "");
  const rank = num(fieldOf("rank", "榜单排名", "rank_position"));
  const price = fieldOf("price", "均价", "final_price");
  const sales = fieldOf("sales", "日销量", "daily_deal");
  const heat = fieldOf("heat", "热销指数", "hot_index");
  const days = fieldOf("days", "霸榜天数", "on_rank_days");
  const bad = fieldOf("bad", "差评数", "bad_cnt");

  const wc = wordclouds || {};

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* 头部：标题 + 链接ID + 关闭（白底容器） */}
      <Box sx={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1,
        bgcolor: "#fff", borderRadius: 2, p: 1.5,
      }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700, color: "#0F172A", lineHeight: 1.5 }}>
            {title || "商品详情"}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", mt: 0.5 }}>
            链接id · {String(d[key] ?? keyValue ?? "—")}
          </Typography>
        </Box>
        {onClose && (
          <IconButton
            size="small"
            onClick={onClose}
            aria-label="关闭"
            sx={{ color: "#64748B", flexShrink: 0, "&:hover": { color: "#0F172A", bgcolor: "rgba(15,23,42,0.06)" } }}
          >
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Box>

      {/* 标签行 */}
      {(platform || brand || category || board) && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {platform && <Tag tone="rose">{platform}</Tag>}
          {brand && <Tag tone="blue">{brand}</Tag>}
          {category && <Tag tone="gray">{category}</Tag>}
          {board && <Tag tone="amber">{board}{rank != null ? ` · No.${rank}` : ""}</Tag>}
        </Stack>
      )}

      {/* 4 指标卡 */}
      <Stack direction="row" spacing={1.5}>
        <Metric label="热卖价" value={fmtMoney(price)} />
        <Metric label="日销量" value={fmt(sales)} />
        <Metric label="热卖指数" value={fmt(heat)} />
        <Metric label="霸榜天数" value={fmt(days)} />
      </Stack>

      {/* 差评云（词云组件，可关联他表） */}
      <Section title="差评云 · 关键词分布">
        <RelatedWordCloud fieldKey="pain" cfg={wc.pain} data={data} row={row} keyField={key} />
      </Section>

      {/* 卖点云（主/副卖点，词云组件，可关联他表） */}
      <Section title="卖点云 · 主卖点 / 副卖点">
        <Stack direction="row" spacing={1.5}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mb: 0.5 }}>主卖点</Typography>
            <RelatedWordCloud fieldKey="main_sell" cfg={wc.main_sell} data={data} row={row} keyField={key} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 10.5, color: "#94A3B8", mb: 0.5 }}>副卖点</Typography>
            <RelatedWordCloud fieldKey="sub_sell" cfg={wc.sub_sell} data={data} row={row} keyField={key} />
          </Box>
        </Stack>
      </Section>

      {/* 近30天每日差评数（柱状图，可关联他表） */}
      <Section title="近 30 天每日差评数">
        <TrendBlock cfg={blocks?.trend} row={row} keyField={key} />
      </Section>

      {/* 差评明细（可关联他表） */}
      <Section title="差评明细">
        <BlockRows cfg={blocks?.reviews} row={row} keyField={key}
          columns={[blocks?.reviews?.score_field, blocks?.reviews?.date_field, blocks?.reviews?.tag_field, blocks?.reviews?.text_field]}>
          {(rows) => (
            <ReviewsList rows={rows}
              scoreField={blocks?.reviews?.score_field || ""}
              dateField={blocks?.reviews?.date_field || ""}
              tagField={blocks?.reviews?.tag_field || ""}
              textField={blocks?.reviews?.text_field || ""} />
          )}
        </BlockRows>
      </Section>

      {/* 产品 SKU（可关联他表） */}
      <Section title="产品 SKU">
        <BlockRows cfg={blocks?.skus} row={row} keyField={key} columns={[blocks?.skus?.spec_field, blocks?.skus?.price_field]}>
          {(rows) => <SkuList rows={rows} specField={blocks?.skus?.spec_field || ""} priceField={blocks?.skus?.price_field || ""} />}
        </BlockRows>
      </Section>

      {/* 产品卖点（标签，可关联他表） */}
      <Section title="产品卖点">
        <BlockRows cfg={blocks?.sell_tags} row={row} keyField={key} columns={[blocks?.sell_tags?.tag_field]}>
          {(rows) => <TagList rows={rows} tagField={blocks?.sell_tags?.tag_field || ""} split={blocks?.sell_tags?.split || "/"} />}
        </BlockRows>
      </Section>

      {/* 差评痛点标签（标签，可关联他表） */}
      <Section title="差评痛点标签">
        <BlockRows cfg={blocks?.pain_tags} row={row} keyField={key} columns={[blocks?.pain_tags?.tag_field]}>
          {(rows) => <TagList rows={rows} tagField={blocks?.pain_tags?.tag_field || ""} split={blocks?.pain_tags?.split || "/"} />}
        </BlockRows>
      </Section>

      {/* 差评数（单值兜底） */}
      <Typography sx={{ fontSize: 10.5, color: "#94A3B8" }}>
        差评数 · {fmt(bad)}
      </Typography>
    </Box>
  );
}

/** 演示图片（无真实图片时占位）——内联 SVG，不依赖网络 */
function demoImage(label: string, index: number): string {
  const colors = ["#E8EEF8", "#EAF2FF", "#F1ECFF", "#FFF4E5"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${colors[index % colors.length]}"/><text x="80" y="86" font-size="13" fill="#94A3B8" text-anchor="middle" font-family="sans-serif">${label} ${index + 1}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** 商品图片页：主图 / SKU图 / 详情图 —— 横向滚动橱窗，点击放大 */
type ImageCfg = {
  dataset_id?: number;
  key_field?: string;
  field?: string;
  operation?: "none" | "prefix" | "replace" | "regex";
  pattern?: string;
  replacement?: string;
  filter_field?: string;
  filter_value?: string;
};

function applyImageOp(url: string, cfg?: ImageCfg): string {
  if (!cfg?.operation || cfg.operation === "none") return url;
  if (cfg.operation === "prefix") return `${cfg.replacement ?? ""}${url}`;
  if (cfg.operation === "replace") return url.split(cfg.pattern ?? "").join(cfg.replacement ?? "");
  if (cfg.operation === "regex") {
    try { return url.replace(new RegExp(cfg.pattern ?? "", "g"), cfg.replacement ?? ""); } catch { return url; }
  }
  return url;
}

/** 一组图片地址：配了关联表 + 筛选字段 + 匹配内容就从关联表查，否则取当前行 */
function useImageUrls(cfg: ImageCfg | undefined, row: Record<string, unknown>, names: string[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  const datasetId = cfg?.dataset_id;
  const field = cfg?.field || "";
  const filterField = cfg?.filter_field || "";
  const filterValue = cfg?.filter_value || "";
  const keyField = cfg?.key_field || "";
  const keyValue = keyField ? row[keyField] : undefined;
  const keyText = keyValue == null ? "" : String(keyValue);
  const rowValue = field ? String(row[field] ?? "") : "";
  useEffect(() => {
    if (datasetId && field && filterField && filterValue) {
      let alive = true;
      client.post(`/bi/semantic/datasets/${datasetId}/query`, {
        columns: [field], metrics: [],
        filters: [
          { name: filterField, op: "=", value: filterValue },
          ...(keyField && keyText ? [{ name: keyField, op: "=", value: keyText }] : []),
        ],
        limit: 200,
      }).then((res) => {
        if (alive) setUrls((res.data?.rows || []).map((r: Record<string, unknown>) => String(r[field] ?? "")).filter(Boolean));
      }).catch(() => { if (alive) setUrls([]); });
      return () => { alive = false; };
    }
    const value = field ? row[field] : pick(row, ...names);
    const text = value == null ? "" : String(value).trim();
    setUrls(text ? text.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean) : []);
    return undefined;
  }, [datasetId, field, filterField, filterValue, keyField, keyText, rowValue]);
  return urls.map((u) => applyImageOp(u, cfg));
}

export function ProductImages({ row, images }: {
  row: Record<string, unknown>;
  images?: Record<string, ImageCfg>;
}) {
  const [preview, setPreview] = useState<{ urls: string[]; index: number } | null>(null);
  const mainUrls = useImageUrls(images?.main, row, ["主图", "main_image", "image", "image_url"]);
  const skuUrls = useImageUrls(images?.sku, row, ["SKU图", "sku_image", "sku_image_url"]);
  const detailUrls = useImageUrls(images?.detail, row, ["详情图", "detail_image", "detail_image_url"]);
  const groups = [
    { key: "main", label: "主图", urls: mainUrls },
    { key: "sku", label: "SKU图", urls: skuUrls },
    { key: "detail", label: "详情图", urls: detailUrls },
  ];
  return (
    <Stack spacing={1.5}>
      {groups.map((group) => (
        <ImageStrip key={group.label} label={group.label} urls={group.urls}
          onPreview={(urls, index) => setPreview({ urls, index })} />
      ))}
      <ImageViewer preview={preview} onClose={() => setPreview(null)} />
    </Stack>
  );
}

/** 一组图片：收起 = 横向滚动；展开 = 主图/SKU图换行、详情图满宽纵向 */
function ImageStrip({ label, urls, onPreview }: {
  label: string; urls: string[]; onPreview: (urls: string[], index: number) => void;
}) {
  const [expanded, setExpanded] = useState(label === "详情图");
  const images = urls.length ? urls : [0, 1, 2, 3, 4].map((i) => demoImage(label, i));
  const isDetail = label === "详情图";
  const thumb = (url: string, i: number) => (
    <Box
      key={`${url}-${i}`}
      onClick={() => onPreview(images, i)}
      sx={{
        width: 168, height: 168, flexShrink: 0, borderRadius: 2, overflow: "hidden",
        bgcolor: "#fff", border: "1px solid #EEF3FB", cursor: "zoom-in",
        transition: "box-shadow .14s",
        "&:hover": { boxShadow: "0 0 0 2px rgba(79,70,229,0.45)" },
      }}
    >
      <Box component="img" src={url} alt={`${label}${i + 1}`}
        sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
    </Box>
  );
  const detailImage = (url: string, i: number) => (
    <Box
      key={`${url}-${i}`}
      onClick={() => onPreview(images, i)}
      sx={{
        width: "100%", borderRadius: 2, overflow: "hidden", bgcolor: "#fff",
        border: "1px solid #EEF3FB", cursor: "zoom-in", transition: "box-shadow .14s",
        "&:hover": { boxShadow: "0 0 0 2px rgba(79,70,229,0.45)" },
      }}
    >
      <Box component="img" src={url} alt={`${label}${i + 1}`}
        sx={{ width: "100%", height: "auto", display: "block" }} />
    </Box>
  );
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
        <Typography sx={{ fontSize: 11.5, color: "#64748B" }}>{label}</Typography>
        <IconButton
          size="small"
          aria-label={expanded ? "收起" : "展开"}
          onClick={() => setExpanded((v) => !v)}
          sx={{ p: 0.25, color: "#94A3B8" }}
        >
          {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
        </IconButton>
      </Box>
      {expanded ? (
        isDetail ? (
          <Stack spacing={1}>{images.map(detailImage)}</Stack>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>{images.map(thumb)}</Box>
        )
      ) : (
        <Box
          sx={{
            display: "flex", gap: 1, overflowX: "auto", pt: 0.5, pb: 0.75, pl: 0.5,
            "&::-webkit-scrollbar": { height: 6 },
            "&::-webkit-scrollbar-thumb": { bgcolor: "#D8E2F5", borderRadius: 3 },
          }}
        >
          {images.map(thumb)}
        </Box>
      )}
    </Box>
  );
}

/** 图片放大预览：左键拖动、滚轮缩放、右上角关闭；底部工具栏（上一张 / 下一张 / 下载） */
function ImageViewer({ preview, onClose }: {
  preview: { urls: string[]; index: number } | null;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState(0);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const moved = useRef(0);
  const lastPos = useRef({ x: 0, y: 0 });

  const urls = preview?.urls ?? [];
  const url = urls[current] ?? "";

  useEffect(() => {
    if (preview) { setCurrent(preview.index); setScale(1); setOffset({ x: 0, y: 0 }); }
  }, [preview]);

  const go = (delta: number) => {
    if (!urls.length) return;
    setCurrent((c) => (c + delta + urls.length) % urls.length);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const download = () => {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `image-${current + 1}`;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <Dialog
      open={Boolean(preview)}
      onClose={onClose}
      maxWidth={false}
      fullScreen
      /* 图片预览必须压在抽屉 / 画板浮层（1500）之上：从「商品图片」里点开的预览，
         以前用 MUI 默认 1300，整张图被右侧抽屉盖住一半（2026-11-21 修） */
      sx={{ zIndex: 2000 }}
      PaperProps={{ sx: { bgcolor: "rgba(15,23,42,0.92)", boxShadow: "none" } }}
    >
      <Box
        sx={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", cursor: "grab" }}
        onWheel={(e) => setScale((s) => Math.min(8, Math.max(0.3, s - e.deltaY * 0.0015)))}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          moved.current = 0;
          lastPos.current = { x: e.clientX, y: e.clientY };
        }}
        onMouseMove={(e) => {
          if (!dragging.current) return;
          const dx = e.clientX - lastPos.current.x;
          const dy = e.clientY - lastPos.current.y;
          lastPos.current = { x: e.clientX, y: e.clientY };
          moved.current += Math.abs(dx) + Math.abs(dy);
          setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
        }}
        onMouseUp={() => {
          const wasDragging = dragging.current;
          dragging.current = false;
          if (wasDragging && moved.current < 5) onClose();
        }}
        onMouseLeave={() => { dragging.current = false; }}
      >
        {url && (
          <Box
            component="img"
            src={url}
            alt="预览"
            draggable={false}
            sx={{
              position: "absolute", left: "50%", top: "50%",
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
              maxWidth: "none", userSelect: "none", pointerEvents: "none",
            }}
          />
        )}
        <IconButton
          onClick={onClose}
          aria-label="关闭预览"
          sx={{
            position: "absolute", top: 16, right: 16, color: "#fff",
            bgcolor: "rgba(255,255,255,0.12)", "&:hover": { bgcolor: "rgba(255,255,255,0.22)" },
          }}
        >
          <CloseIcon sx={{ fontSize: 22 }} />
        </IconButton>

        {/* 底部工具栏：上一张 / 页码 / 下一张 / 下载 */}
        <Box
          onMouseDown={(e) => e.stopPropagation()}
          sx={{
            position: "absolute", bottom: 24, left: "50%", transform: "translateX(-50%)",
            display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5,
            borderRadius: 999, bgcolor: "rgba(255,255,255,0.12)",
            backdropFilter: "blur(6px)",
          }}
        >
          <IconButton onClick={() => go(-1)} aria-label="上一张" sx={{ color: "#fff", "&:hover": { bgcolor: "rgba(255,255,255,0.16)" } }}>
            <ChevronLeftIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <Typography sx={{ fontSize: 12, color: "#fff", minWidth: 42, textAlign: "center" }}>
            {urls.length ? `${current + 1}/${urls.length}` : "0/0"}
          </Typography>
          <IconButton onClick={() => go(1)} aria-label="下一张" sx={{ color: "#fff", "&:hover": { bgcolor: "rgba(255,255,255,0.16)" } }}>
            <ChevronRightIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <IconButton onClick={download} aria-label="下载" sx={{ color: "#fff", "&:hover": { bgcolor: "rgba(255,255,255,0.16)" } }}>
            <DownloadIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Box>
      </Box>
    </Dialog>
  );
}
