/** 明细表「弹窗」设置：开关 + 行标识 + 抽屉字段 + 11 个独立可折叠块（差评云 … 详情图）。 */

import { useEffect, useState, type ReactNode } from "react";
import { Autocomplete, Box, MenuItem, Switch, TextField, Typography } from "@mui/material";
import { PanelSection } from "./PanelSection";
import { Slot } from "./Slot";
import { useDatasetFields } from "../board/useDatasetFields";
import { CLOUD_PALETTES } from "../skin/tokens";
import { ACCENTS } from "../palette";
import { AGG } from "./queryConstants";
import client from "../../../api/client";
import type { ComponentSpec } from "../types";

const inputSx = {
  "& .MuiInputBase-input": { fontSize: 12 },
  "& .MuiInputLabel-root": { fontSize: 12.5 },
} as const;

/** 抽屉区块 → 字段映射（key 与 ProductDetail 保持一致） */
const DRAWER_FIELDS: { key: string; label: string }[] = [
  { key: "title", label: "标题" },
  { key: "platform", label: "平台" },
  { key: "brand", label: "品牌" },
  { key: "category", label: "品类" },
  { key: "board", label: "榜单" },
  { key: "rank", label: "榜单排名" },
  { key: "price", label: "热卖价" },
  { key: "sales", label: "日销量" },
  { key: "heat", label: "热卖指数" },
  { key: "days", label: "霸榜天数" },
  { key: "bad", label: "差评数" },
];

/** 抽屉里用词云组件渲染的三块 */
const WORDCLOUD_KEYS: { key: string; label: string }[] = [
  { key: "pain", label: "差评云" },
  { key: "main_sell", label: "主卖点" },
  { key: "sub_sell", label: "副卖点" },
];

/** 抽屉附加区块 → 字段映射（key 与 ProductDetail 一致） */
const BLOCK_CONFIGS: { key: string; label: string; fields: { key: string; label: string; type?: "field" | "number" | "switch" | "color" | "agg"; freeSolo?: boolean }[] }[] = [
  { key: "trend", label: "近30天差评数", fields: [
    { key: "dim_field", label: "X轴字段" },
    { key: "agg", label: "Y轴函数", type: "agg" },
    { key: "val_field", label: "Y轴字段" },
    { key: "bar_width", label: "柱宽", type: "number" },
    { key: "show_grid", label: "网格", type: "switch" },
    { key: "accent", label: "颜色", type: "color" },
  ] },
  { key: "reviews", label: "差评明细", fields: [
    { key: "score_field", label: "评分字段" },
    { key: "date_field", label: "日期字段" },
    { key: "tag_field", label: "标签字段" },
    { key: "text_field", label: "内容字段" },
  ] },
  { key: "skus", label: "产品 SKU", fields: [
    { key: "spec_field", label: "规格字段" },
    { key: "price_field", label: "价格字段" },
  ] },
  { key: "sell_tags", label: "产品卖点", fields: [
    { key: "tag_field", label: "标签字段" },
    { key: "split", label: "拆词符", freeSolo: true },
  ] },
  { key: "pain_tags", label: "差评痛点标签", fields: [
    { key: "tag_field", label: "标签字段" },
    { key: "split", label: "拆词符", freeSolo: true },
  ] },
];

/** 抽屉图片区块 */
const IMAGE_KEYS: { key: string; label: string }[] = [
  { key: "main", label: "主图" },
  { key: "sku", label: "SKU图" },
  { key: "detail", label: "详情图" },
];

/** 词云里「左说明 + 右可输入下拉」的行（关联表单独处理，选项是数据集对象） */
const WC_ROWS: { key: "key_field" | "word_field" | "weight_field" | "split" | "palette"; label: string; placeholder: string; freeSolo?: boolean }[] = [
  { key: "key_field", label: "关联字段", placeholder: "（自动）" },
  { key: "word_field", label: "词字段", placeholder: "（自动）" },
  { key: "weight_field", label: "权重字段", placeholder: "（无）" },
  { key: "split", label: "拆词符", placeholder: "/", freeSolo: true },
  { key: "palette", label: "主题色", placeholder: "潮彩" },
];

type WcCfg = NonNullable<ComponentSpec["table_view"]>["detail"] extends infer D
  ? D extends { wordclouds?: Record<string, infer T> } ? T : never
  : never;

const ACCENT_NAMES = Object.keys(ACCENTS);

/** 左说明 + 右控件（说明统一 76 宽） */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
      <Typography sx={{ fontSize: 11.5, color: "#64748B", width: 76, flexShrink: 0 }}>{label}</Typography>
      {children}
    </Box>
  );
}

/** 某字段的去重值（用于「匹配内容」下拉） */
function useDistinctValues(datasetId: number | undefined, field: string | undefined): string[] {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (!datasetId || !field) { setValues([]); return; }
    let alive = true;
    client.post(`/bi/semantic/datasets/${datasetId}/query`, {
      dimensions: [field], metrics: [], limit: 200,
    }).then((res) => {
      if (alive) {
        const rows = (res.data?.rows || []) as Record<string, unknown>[];
        setValues(Array.from(new Set(rows.map((r) => String(r[field] ?? "")).filter(Boolean))));
      }
    }).catch(() => { if (alive) setValues([]); });
    return () => { alive = false; };
  }, [datasetId, field]);
  return values;
}

interface Props {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  /** 行标识列候选（表格已选的列） */
  columns: string[];
  /** 页面上的画板（key + 名称）—— 暂未使用，保留签名兼容 */
  boards?: { key: string; label: string }[];
}

export default function TableDetailSettings({ spec, onChange, columns }: Props) {
  const view = spec.table_view ?? ({ columns: [], page_size: 10, more: false, more_label: "", index_column: true } as ComponentSpec["table_view"]);
  const detail = view.detail ?? { enabled: false, key_field: "", items: [], board_key: "", popup: "right" as const };

  const patch = (next: Partial<typeof detail>) =>
    onChange({ ...spec, table_view: { ...view, detail: { ...detail, ...next } } });

  /* 数据集全部字段（维度 / 标识 / 指标合并去重），供抽屉字段下拉 */
  const { groups } = useDatasetFields(spec.binding?.dataset_id);
  const fieldNames = Array.from(new Set([
    ...groups.dimensions.map((f) => f.name),
    ...groups.identifiers.map((f) => f.name),
    ...groups.metrics.map((f) => f.name),
  ]));

  /* 全部数据集（关联表下拉） */
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    client.get("/bi/semantic/datasets")
      .then((res) => setDatasets(res.data?.datasets || []))
      .catch(() => {});
  }, []);

  /* 每个词云的关联表字段（三个固定 hook，不能放循环里） */
  const wcPain = useDatasetFields(detail.wordclouds?.pain?.dataset_id);
  const wcMain = useDatasetFields(detail.wordclouds?.main_sell?.dataset_id);
  const wcSub = useDatasetFields(detail.wordclouds?.sub_sell?.dataset_id);
  /* 附加区块的关联表字段 */
  const blkTrend = useDatasetFields(detail.blocks?.trend?.dataset_id);
  const blkReviews = useDatasetFields(detail.blocks?.reviews?.dataset_id);
  const blkSkus = useDatasetFields(detail.blocks?.skus?.dataset_id);
  /* 图片区块的关联表字段 */
  const imgMain = useDatasetFields(detail.images?.main?.dataset_id);
  const imgSku = useDatasetFields(detail.images?.sku?.dataset_id);
  const imgDetail = useDatasetFields(detail.images?.detail?.dataset_id);
  const namesOf = (g: { dimensions: { name: string }[]; identifiers: { name: string }[]; metrics: { name: string }[] }): string[] =>
    Array.from(new Set([...g.dimensions, ...g.identifiers, ...g.metrics].map((f) => f.name)));
  const relFieldsOf = (key: string): string[] =>
    namesOf(key === "pain" ? wcPain.groups : key === "main_sell" ? wcMain.groups : wcSub.groups);
  const blockFieldsOf = (key: string): string[] =>
    namesOf(key === "trend" ? blkTrend.groups : key === "reviews" ? blkReviews.groups : blkSkus.groups);
  const imageFieldsOf = (key: string): string[] =>
    namesOf(key === "main" ? imgMain.groups : key === "sku" ? imgSku.groups : imgDetail.groups);

  /* 图片「匹配内容」的去重值（按图片块的关联表 / 当前数据集） */
  const imgMainValues = useDistinctValues(
    detail.images?.main?.dataset_id ?? spec.binding?.dataset_id ?? undefined, detail.images?.main?.filter_field,
  );
  const imgSkuValues = useDistinctValues(
    detail.images?.sku?.dataset_id ?? spec.binding?.dataset_id ?? undefined, detail.images?.sku?.filter_field,
  );
  const imgDetailValues = useDistinctValues(
    detail.images?.detail?.dataset_id ?? spec.binding?.dataset_id ?? undefined, detail.images?.detail?.filter_field,
  );
  const imageValuesOf = (key: string): string[] =>
    key === "main" ? imgMainValues : key === "sku" ? imgSkuValues : imgDetailValues;

  const setField = (key: string, value: string) => {
    const fields = { ...(detail.fields || {}) };
    if (value) fields[key] = value;
    else delete fields[key];
    patch({ fields });
  };

  const setWc = (key: string, next: Partial<WcCfg>) => {
    const wordclouds = { ...(detail.wordclouds || {}) };
    wordclouds[key] = { ...(wordclouds[key] || {}), ...next } as WcCfg;
    patch({ wordclouds });
  };

  const setBlock = (key: string, next: Record<string, string | number | boolean | undefined>) => {
    const blocks = { ...(detail.blocks || {}) };
    blocks[key] = { ...(blocks[key] || {}), ...next } as never;
    patch({ blocks });
  };

  const setImage = (key: string, next: Record<string, number | string | undefined>) => {
    const images = { ...(detail.images || {}) };
    images[key] = { ...(images[key] || {}), ...next } as never;
    patch({ images });
  };

  return (
    <PanelSection title="弹窗" collapsible>
      <Row label="点击行弹出">
        <Switch
          size="small" checked={!!detail.enabled}
          onChange={(e) => {
            const on = e.target.checked;
            const key = detail.key_field || columns[0] || "";
            patch({ enabled: on, ...(on && key ? { key_field: key } : {}) });
          }}
          sx={{ mr: -0.75 }}
        />
      </Row>

      {detail.enabled && (
        <>
          <Row label="行标识">
            <Autocomplete
              size="small"
              options={columns}
              value={detail.key_field || null}
              onChange={(_, value) => patch({ key_field: value || "" })}
              renderInput={(params) => (
                <TextField {...params} size="small" placeholder="（不按行过滤）" sx={inputSx} />
              )}
              sx={{ flex: 1, minWidth: 0 }}
            />
          </Row>

          <Typography sx={{ fontSize: 11.5, color: "#94A3B8", mb: 0.75, mt: 1.5 }}>抽屉字段</Typography>
          {DRAWER_FIELDS.map((field) => (
            <Row key={field.key} label={field.label}>
              <Autocomplete
                size="small"
                options={fieldNames}
                value={detail.fields?.[field.key] || null}
                onChange={(_, value) => setField(field.key, value || "")}
                renderInput={(params) => (
                  <TextField {...params} size="small" placeholder="（自动匹配）" sx={inputSx} />
                )}
                sx={{ flex: 1, minWidth: 0 }}
              />
            </Row>
          ))}

          {/* 差评云 / 主卖点 / 副卖点：独立可折叠 */}
          {WORDCLOUD_KEYS.map((item) => {
            const cfg: WcCfg = detail.wordclouds?.[item.key] || {};
            const relFields = relFieldsOf(item.key);
            return (
              <Slot key={item.key} label={item.label} collapsible>
                <Row label="关联表">
                  <Autocomplete
                    size="small"
                    options={datasets}
                    getOptionLabel={(d) => d.name}
                    value={datasets.find((d) => d.id === cfg.dataset_id) || null}
                    onChange={(_, d) => setWc(item.key, { dataset_id: d?.id })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（当前数据集）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                {WC_ROWS.map((row) => (
                  <Row key={row.key} label={row.label}>
                    <Autocomplete
                      size="small"
                      freeSolo={row.freeSolo}
                      options={row.key === "split" ? ["/", "、", ",", "，", "；"] : row.key === "palette" ? CLOUD_PALETTES.map((p) => p.name) : relFields}
                      value={(cfg[row.key] as string | undefined) || null}
                      onChange={(_, value) => {
                        const v = typeof value === "string" ? value : "";
                        setWc(item.key, { [row.key]: v || undefined } as Partial<WcCfg>);
                      }}
                      renderInput={(params) => (
                        <TextField {...params} size="small" placeholder={row.placeholder} sx={inputSx} />
                      )}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                  </Row>
                ))}
              </Slot>
            );
          })}

          {/* 附加区块：独立可折叠 */}
          {BLOCK_CONFIGS.map((block) => {
            const cfg = (detail.blocks?.[block.key] || {}) as Record<string, string | number | undefined>;
            const relFields = blockFieldsOf(block.key);
            return (
              <Slot key={block.key} label={block.label} collapsible>
                <Row label="关联表">
                  <Autocomplete
                    size="small"
                    options={datasets}
                    getOptionLabel={(d) => d.name}
                    value={datasets.find((d) => d.id === cfg.dataset_id) || null}
                    onChange={(_, d) => setBlock(block.key, { dataset_id: d?.id })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（当前数据集）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                {[
                  { key: "key_field", label: "关联字段", type: "field" as const },
                  ...block.fields,
                ].map((f) => {
                  const value = cfg[f.key];
                  return (
                    <Row key={f.key} label={f.label}>
                      {f.type === "switch" ? (
                        <Switch
                          size="small"
                          checked={value === undefined ? true : Boolean(value)}
                          onChange={(e) => setBlock(block.key, { [f.key]: e.target.checked })}
                          sx={{ ml: -0.75 }}
                        />
                      ) : f.type === "number" ? (
                        <TextField
                          size="small" type="number"
                          value={value ?? ""}
                          onChange={(e) => setBlock(block.key, { [f.key]: e.target.value === "" ? undefined : Number(e.target.value) })}
                          sx={{ flex: 1, minWidth: 0, ...inputSx }}
                        />
                      ) : f.type === "agg" ? (
                        <Autocomplete
                          size="small"
                          options={AGG}
                          value={(value as string) || null}
                          onChange={(_, v) => setBlock(block.key, { [f.key]: v || undefined })}
                          renderInput={(params) => (
                            <TextField {...params} size="small" placeholder="（SUM）" sx={inputSx} />
                          )}
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                      ) : f.type === "color" ? (
                        <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", flex: 1, py: 0.25 }}>
                          {Object.entries(ACCENTS).map(([accentKey, token]) => (
                            <Box
                              key={accentKey}
                              title={accentKey}
                              onClick={() => setBlock(block.key, { [f.key]: value === accentKey ? undefined : accentKey })}
                              sx={{
                                width: 18, height: 18, borderRadius: "50%", cursor: "pointer",
                                bgcolor: token.main,
                                outline: value === accentKey ? `2px solid ${token.main}` : "none",
                                outlineOffset: 2,
                                transition: "transform .14s",
                                "&:hover": { transform: "scale(1.12)" },
                              }}
                            />
                          ))}
                        </Box>
                      ) : (
                        <Autocomplete
                          size="small"
                          freeSolo={f.freeSolo}
                          options={f.freeSolo ? ["/", "、", ",", "，", "；"] : relFields}
                          value={(value as string | undefined) || null}
                          onChange={(_, v) => {
                            const text = typeof v === "string" ? v : "";
                            setBlock(block.key, { [f.key]: text || undefined });
                          }}
                          renderInput={(params) => (
                            <TextField {...params} size="small" placeholder="（自动）" sx={inputSx} />
                          )}
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                      )}
                    </Row>
                  );
                })}
              </Slot>
            );
          })}

          {/* 主图 / SKU图 / 详情图：独立可折叠，参考缩略图的「关联外部字段」 */}
          {IMAGE_KEYS.map((item) => {
            const cfg = detail.images?.[item.key] || {};
            const relFields = imageFieldsOf(item.key);
            return (
              <Slot key={item.key} label={item.label} collapsible>
                <Row label="关联表">
                  <Autocomplete
                    size="small"
                    options={datasets}
                    getOptionLabel={(d) => d.name}
                    value={datasets.find((d) => d.id === cfg.dataset_id) || null}
                    onChange={(_, d) => setImage(item.key, { dataset_id: d?.id })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（当前数据集）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                <Row label="关联字段">
                  <Autocomplete
                    size="small"
                    options={relFields}
                    value={cfg.key_field || null}
                    onChange={(_, v) => setImage(item.key, { key_field: v || undefined })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（自动）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                <Row label="图片字段">
                  <Autocomplete
                    size="small"
                    options={relFields}
                    value={cfg.field || null}
                    onChange={(_, v) => setImage(item.key, { field: v || undefined })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（自动）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                <Row label="筛选字段">
                  <Autocomplete
                    size="small"
                    options={relFields}
                    value={cfg.filter_field || null}
                    onChange={(_, v) => setImage(item.key, { filter_field: v || undefined, filter_value: undefined })}
                    renderInput={(params) => (
                      <TextField {...params} size="small" placeholder="（不过滤）" sx={inputSx} />
                    )}
                    sx={{ flex: 1, minWidth: 0 }}
                  />
                </Row>
                {cfg.filter_field && (
                  <Row label="匹配内容">
                    <Autocomplete
                      size="small"
                      options={imageValuesOf(item.key)}
                      value={cfg.filter_value || null}
                      onChange={(_, v) => setImage(item.key, { filter_value: v || undefined })}
                      renderInput={(params) => (
                        <TextField {...params} size="small" placeholder="（全部）" sx={inputSx} />
                      )}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                  </Row>
                )}
                <Row label="地址转换">
                  <TextField select size="small" value={cfg.operation ?? "none"}
                    onChange={(e) => setImage(item.key, { operation: e.target.value as never })}
                    sx={{ flex: 1, minWidth: 0, ...inputSx }}>
                    <MenuItem value="none">不处理</MenuItem>
                    <MenuItem value="prefix">前缀拼接</MenuItem>
                    <MenuItem value="replace">文本替换</MenuItem>
                    <MenuItem value="regex">正则替换</MenuItem>
                  </TextField>
                </Row>
                {(cfg.operation === "replace" || cfg.operation === "regex") && (
                  <Row label={cfg.operation === "regex" ? "匹配正则" : "查找文本"}>
                    <TextField size="small" value={cfg.pattern ?? ""}
                      onChange={(e) => setImage(item.key, { pattern: e.target.value })}
                      inputProps={{ maxLength: 512 }}
                      sx={{ flex: 1, minWidth: 0, ...inputSx }} />
                  </Row>
                )}
                {cfg.operation && cfg.operation !== "none" && (
                  <Row label={cfg.operation === "prefix" ? "URL 前缀" : "替换内容"}>
                    <TextField size="small" value={cfg.replacement ?? ""}
                      onChange={(e) => setImage(item.key, { replacement: e.target.value })}
                      inputProps={{ maxLength: 2048 }}
                      sx={{ flex: 1, minWidth: 0, ...inputSx }} />
                  </Row>
                )}
              </Slot>
            );
          })}
        </>
      )}
    </PanelSection>
  );
}
