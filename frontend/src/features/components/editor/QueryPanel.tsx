/** 查询面板（编辑页中栏）—— 维度 / 指标 / 过滤 / 行限制，对应 spec.binding */

import { useEffect, useRef, useState } from "react";
import {
  Autocomplete, Box, Button, Chip, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { Add, Check, Close, DeleteOutline, ExpandMore, Remove } from "@mui/icons-material";
import ChartOptionsPanel from "./ChartOptionsPanel";
import TableDetailSettings from "./TableDetailSettings";
import { BANNER_TONES } from "../renderers/BannerCard";
import StylePanel from "./StylePanel";
import DataCheckPanel from "./DataCheckPanel";
import { GROUP_CARD_SX, PanelSection, PanelTitle } from "./PanelSection";
import { KIND_LABEL } from "../registry";
import { axisLabels } from "./axisLabels";
import ComputeFields from "./ComputeFields";
import { KpiTopSettings } from "./KpiTopSettings";
import { SqlPreview } from "./SqlPreview";
import type { BannerStat, ComponentItem, ComponentKind, ComponentSpec, FieldOption, RenderPayload } from "../types";

import { AGG, GRAINS, IMAGE_KEY, NEEDS_DIMENSION, OPS, STRONG_IMAGE_KEY, dash } from "./queryConstants";
import type { Props } from "./queryTypes";
import { TableFieldsEditor } from "./TableFieldsEditor";
import { TableThumbSettings } from "./TableThumbSettings";
import { Slot } from "./Slot";
import { Row, fieldSx } from "./Row";
import { AxisInput } from "./AxisInput";

const NAV_ITEM_ACCENTS = ["#4F46E5", "#2563EB", "#0D9488", "#7C3AED", "#DB2777"];

/** 头标卡统计项的「单位」内置选项（老文档里的自定义值会在下拉里补一项，不丢） */
const BANNER_UNITS = ["个", "件", "台", "单", "人", "家", "天", "条", "次", "笔", "元", "万元", "亿", "万", "%", "‰"];

/** 菜单项「圆点」颜色卡（和 NavCard 的 TONES 同一批色值） */const NAV_TONE_DOTS: Record<string, string> = {
  slate: "#94A3B8", indigo: "#6366F1", sky: "#3B82F6", teal: "#14B8A6",
  amber: "#F59E0B", rose: "#F43F5E", violet: "#8B5CF6",
};

export default function QueryPanel({
  kind, spec, metricOptions, dimensionOptions, identifierOptions, onChange, payload,
  height, onResize, pages = [], pageDatasets = [],
  components, detailCardKey, onEditDetailCard, onEditDetailPanel, boards, tables = [],
}: Props) {
  /** 导航菜单卡「菜单项」的折叠状态（按索引记，不改文档） */
  const [navFolded, setNavFolded] = useState<Record<number, boolean>>({});
  /** 头标卡「右侧统计」每张卡的折叠状态（按索引记） */
  const [bannerFolded, setBannerFolded] = useState<Record<number, boolean>>({});
  /* 过滤条件统一走 b.filters：拖入 / 点击即加一行，行内直接编辑，减号删除。 */
  /** 槽位叫法按图表类型走（目前只对柱状图 / 折线图生效）：只影响文案，不动数据模型 */
  const axis = axisLabels(kind);
  /** 头标卡统计项的「运算」展开状态（null = 全部收起） */
  const [openStatOps, setOpenStatOps] = useState<number | null>(null);
  const b = spec.binding;
  /** 粒度只对时间字段有意义（文本/数值字段显示粒度是误导） */
  const dimensionFieldIsTime = dimensionOptions.find((f) => f.name === b.dimension)?.role === "time";
  /** 指标卡 / 结论卡 / 分节标题默认不要维度轴；但选了「最大/最小/众数/最新/合计」这类取数规则、
   *  或「前N合计/平均/计数」副标题时，本质是多行里挑一行 —— 这时维度槽自动出现 */
  /* 指标卡就是一个数：面板永远只有「指标 + 聚合」。
     需要按维度看，请用柱状图 / 饼图 / 明细表 —— 免得旧卡残留的维度让人以为界面还是旧版。 */
  /* 词云要「词（维度）+ 权重（指标）」两个槽（对齐 Superset / Tableau 的做法） */
  const needsDimension = !["kpi", "insight", "section", "gauge"].includes(kind);
  /** 切到明细表：老的「维度 + 指标」直接变成列（不再聚合），面板和卡片才一致 */
  useEffect(() => {
    if (kind !== "table") return;
    const legacy = [
      b.dimension,
      b.metric,
      ...(b.metrics || []).map((m) => (typeof m === "string" ? m : (m as { name?: string })?.name)),
    ].filter(Boolean) as string[];
    if (!legacy.length) return;
    const merged = Array.from(new Set([...(b.dimensions ?? []), ...legacy]));
    onChange({ ...spec, binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: merged } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const patch = (key: string, value: unknown) =>
    onChange({ ...spec, binding: { ...spec.binding, [key]: value } });

  /** 自定义聚合表达式的数据来源只认「当前指标」：
   *  换指标时把表达式里的列名一起换掉，避免聚合 SQL 偷偷用了别的列（含公式字段）。 */
  const retargetExpr = (expression: string | undefined, next: string): string =>
    String(expression || "").replace(/"([^"]+)"/g, () => `"${next}"`);

  /** 选指标：自定义聚合模式下，表达式同步改成新指标 */
  const pickMetric = (next: string | null) => {
    if (next && b.agg === "CUSTOM" && b.agg_expression) {
      const expression = retargetExpr(b.agg_expression, next);
      onChange({ ...spec, binding: { ...spec.binding, metric: next, agg_expression: expression } });
      return;
    }
    patch("metric", next);
  };

  /** 词云的「拆词」分隔符：编辑态用本地草稿，失焦/回车再落到 spec（不每敲一个字就重算） */
  const [splitDraft, setSplitDraft] = useState(b.split ?? "");
  useEffect(() => { setSplitDraft(b.split ?? ""); }, [b.split]);
  const commitSplit = () => {
    const next = splitDraft.replace(/\s+/g, "");
    if ((b.split ?? "") !== next) patch("split", next || null);
  };

  /* 词云的老卡如果被塞了「标识字段」当权重（SUM(产品id) 这种），后端会报「标识字段不能聚合」，
     打开面板时直接清掉，卡片立刻恢复；标识字段本来也不该当权重 */
  useEffect(() => {
    if (kind !== "wordcloud") return;
    const idNames = new Set((identifierOptions || []).map((f) => f.name));
    if (spec.binding.metric && idNames.has(spec.binding.metric)) {
      onChange({ ...spec, binding: { ...spec.binding, metric: null } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, spec.binding.metric, identifierOptions]);

  // ── 拖拽落点：字段拖进来即绑定 ──
  const [dragOver, setDragOver] = useState<string | null>(null);
  const dropZone = (zone: "dimension" | "metric" | "filter") => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(zone);
    },
    onDragLeave: () => setDragOver((z) => (z === zone ? null : z)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(null);
      try {
        const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
        if (payload.kind !== "field" || !payload.name) return;
        if (zone === "dimension" && payload.role !== "measure" && payload.role !== "id") {
          patch("dimension", payload.name);
        }
        else if (zone === "metric" && payload.role !== "id") {
          const numeric = payload.role === "measure" || payload.group === "metric";
          /* 词云只有一个槽：拖进来的是「列」就当词（按出现次数），是指标就当权重 */
          if (kind === "wordcloud" && !numeric) {
            onChange({ ...spec, binding: { ...spec.binding, dimension: payload.name, metric: null } });
            return;
          }
          const fallbackDimension = dimensionOptions.find((f) => f.role === "dimension")?.name
            || dimensionOptions[0]?.name || null;
          onChange({
            ...spec,
            binding: {
              ...spec.binding,
              metric: payload.name,
              agg: numeric ? spec.binding.agg : "COUNT",
              // 柱/线/饼/明细表这类没有维度就画不出来 —— 直接补一个默认「列」，用户可随时改
              ...(!spec.binding.dimension && NEEDS_DIMENSION.includes(kind) && fallbackDimension
                ? { dimension: fallbackDimension }
                : {}),
            },
          });
        }
        else if (zone === "filter") {
          patch("filters", [...(spec.binding.filters || []), { column: payload.name, op: "=", value: "" }]);
        }
      } catch {
        /* 非本页拖拽内容，忽略 */
      }
    },
  });
  const zoneSx = (zone: string) => ({
    outline: dragOver === zone ? "2px dashed #6366F1" : "none",
    outlineOffset: 2,
    borderRadius: 2,
    bgcolor: dragOver === zone ? "rgba(99,102,241,0.045)" : "transparent",
    transition: "background .12s, outline-color .12s",
  });

  /** 明细表：口径面板显示「有哪些列」 */
  const tableFields = (b.dimensions ?? []).filter((name) => name !== spec.table_view.thumb_key);

  if (kind === "section") {
    const content = spec.content ?? { index: "", icon: "", items: [], text: "" };
    const setContent = (next: Partial<typeof content>) =>
      onChange({ ...spec, content: { ...content, ...next } });
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column" }}>
        <PanelTitle>分节标题</PanelTitle>
        {/* 通用：分节标题只有「外观」（颜色 / 高度）。数据 / 过滤 / 排序 / 运算 / 文字对它不成立，
            按「空分组不显示」的口径直接不渲染 */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>通用</Typography>
        <PanelSection title="外观" collapsible defaultOpen={false} first>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
        </PanelSection>

        {/* 附加：分节标题自己的内容（标题 / 编号 / 图标 / 说明） */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>附加</Typography>
        <Stack spacing={1}>
          <Row label="标题">
            <TextField size="small" value={spec.title}
              onChange={(e) => onChange({ ...spec, title: e.target.value })}
              sx={fieldSx} />
          </Row>
          <Row label="编号">
            <TextField size="small" value={content.index}
              onChange={(e) => setContent({ index: e.target.value.slice(0, 4) })}
              sx={{ ...fieldSx, maxWidth: 120 }} />
          </Row>
          <Row label="图标">
            <TextField select size="small" value={content.icon}
              onChange={(e) => setContent({ icon: e.target.value })}
              sx={fieldSx}>
              {[["", "默认"], ["grid", "网格"], ["chart", "图表"], ["pie", "饼图"], ["table", "表格"],
                ["cloud", "词云"], ["tag", "标签"], ["bulb", "结论"]].map(([v, t]) => (
                <MenuItem key={v || "none"} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>
              ))}
            </TextField>
          </Row>
          <Row label="说明">
            <TextField size="small" value={spec.subtitle}
              onChange={(e) => onChange({ ...spec, subtitle: e.target.value })}
              sx={fieldSx} />
          </Row>
        </Stack>
      </Box>
    );
  }

  if (kind === "nav") {
    const nav = spec.nav ?? { brand: "", brand_accent: "", brand_tone: "sky", items: [], meta: "", badge: "", actions: [] };
    const setNav = (next: Partial<typeof nav>) => onChange({ ...spec, nav: { ...nav, ...next } });
    const setItem = (index: number, patch: Partial<{ label: string; tone: string; active: boolean; page: string }>) =>
      setNav({ items: nav.items.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
    const setAction = (index: number, patch: Partial<{ label: string; kind: "primary" | "secondary" }>) =>
      setNav({ actions: nav.actions.map((action, i) => (i === index ? { ...action, ...patch } : action)) });
    const tones: [string, string][] = [["slate", "灰"], ["indigo", "靛蓝"], ["sky", "天蓝"], ["teal", "青绿"], ["amber", "琥珀"], ["rose", "玫红"], ["violet", "紫"]];
    /** 首视页：整张卡一份，值 = 被标 active 的那一项的页面 key */
    const firstPage = nav.items.find((item) => item.active)?.page || "";
    const firstPageOptions = (() => {
      const seen = new Set<string>();
      const out: { key: string; label: string }[] = [];
      nav.items.forEach((item) => {
        const key = String(item.page || "");
        if (!key || seen.has(key)) return;
        seen.add(key);
        out.push({ key, label: item.label || pages.find((page) => page.key === key)?.title || key });
      });
      return out;
    })();
    const sectionTitle = { fontSize: 11.5, fontWeight: 600, color: "#64748B" } as const;
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column" }}>
        <PanelTitle>导航菜单卡</PanelTitle>

        {/* 通用：只有「外观」（高度 / 圆角 / 阴影 / 描边）。数据 / 过滤 / 排序 / 运算 / 文字对它不成立，
            按「空分组不显示」的口径不渲染 */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>通用</Typography>
        <PanelSection title="外观" collapsible defaultOpen={false} first>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize}
            metricOptions={metricOptions} dimensionOptions={dimensionOptions}
            identifierOptions={identifierOptions ?? []} />
        </PanelSection>

        {/* 附加：这张卡自己的内容（品牌 / 菜单项 / 右侧状态 / 按钮 / 导出） */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>附加</Typography>
        {/* 附加 ①：首选项 —— 首视页 + 全页面展示（整张卡一份的行为设置） */}
        <PanelSection title="首选项" first>
          <Stack spacing={1}>
            <Row label="首视页">
              <TextField select size="small" value={firstPage}
                onChange={(e) => {
                  const page = e.target.value;
                  setNav({
                    items: nav.items.map((it) => ({ ...it, active: !!page && it.page === page })),
                  });
                }}
                sx={fieldSx}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不指定</MenuItem>
                {firstPageOptions.length === 0 && (
                  <MenuItem value="" disabled sx={{ fontSize: 12.5 }}>先在菜单项里选「跳转页面」</MenuItem>
                )}
                {firstPageOptions.map((option) => (
                  <MenuItem key={option.key} value={option.key} sx={{ fontSize: 12.5 }}>{option.label}</MenuItem>
                ))}
              </TextField>
            </Row>
            <Row label="全页面展示">
              <Switch size="small" checked={!!nav.global_nav}
                onChange={(e) => setNav({ global_nav: e.target.checked })}
                sx={{ ml: -0.75 }} />
            </Row>
          </Stack>
        </PanelSection>

        <PanelSection title="品牌">
        <Stack spacing={1}>
          <Row label="品牌名">
            <TextField size="small" value={nav.brand}
              onChange={(e) => setNav({ brand: e.target.value })} sx={fieldSx} />
          </Row>
          <Row label="强调尾段">
            <TextField size="small" value={nav.brand_accent}
              onChange={(e) => setNav({ brand_accent: e.target.value })} sx={fieldSx} />
          </Row>
          <Row label="品牌标记配色">
            <TextField select size="small" value={nav.brand_tone || "sky"}
              onChange={(e) => setNav({ brand_tone: e.target.value })} sx={fieldSx}>
              {[["sky", "天蓝"], ["indigo", "靛蓝"], ["teal", "青绿"], ["warm", "暖橙"]].map(([v, t]) => (
                <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>
              ))}
            </TextField>
          </Row>
        </Stack>
        </PanelSection>

        <PanelSection
          title="菜单项"
          action={(
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {pages.length > 1 && (
              <Button size="small"
                onClick={() => {
                  const tones = ["indigo", "amber", "slate", "teal", "rose", "violet"];
                  setNav({
                    items: pages.slice(0, 6).map((page, index) => ({
                      label: page.title, tone: tones[index % tones.length], active: false, page: page.key,
                    })),
                  });
                }}
                sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0, color: "#64748B" }}>
                按页面填充
              </Button>
            )}
            <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />}
              onClick={() => setNav({ items: [...nav.items, { label: "新菜单", tone: "slate", active: false }] })}
              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0, color: "#4F46E5" }}>
              添加
            </Button>
          </Box>
          )}
        >
        <Stack spacing={1}>
          {nav.items.map((item, index) => {
            const folded = !!navFolded[index];
            return (
            <Box key={index} sx={{ ...GROUP_CARD_SX, gap: folded ? 0 : GROUP_CARD_SX.gap }}>
              {/* 头标：色条 + 标签名 + 折叠箭头（和「筛选字段」卡片同一套做法，点标题收起这一项） */}
              <Box
                onClick={() => setNavFolded((prev) => ({ ...prev, [index]: !prev[index] }))}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer",
                  pb: folded ? 0 : 0.75, borderBottom: folded ? "none" : "1px solid #F4F7FC",
                  "&:hover": { opacity: 0.82 },
                }}>
                <Box sx={{
                  flexShrink: 0, width: 3, height: 14, borderRadius: 999,
                  bgcolor: NAV_ITEM_ACCENTS[index % NAV_ITEM_ACCENTS.length],
                }} />
                <Typography sx={{
                  flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#0F172A",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {item.label || "未命名菜单"}
                </Typography>
                <ExpandMore sx={{
                  fontSize: 16, color: "#94A3B8", flexShrink: 0, transition: "transform .15s",
                  transform: folded ? "rotate(-90deg)" : "none",
                }} />
              </Box>
              {!folded && (<>
              <Row label="标签">
                <TextField size="small" value={item.label}
                  onChange={(e) => setItem(index, { label: e.target.value })}
                  sx={fieldSx} />
                <IconButton size="small" title="删除这个菜单项"
                  onClick={() => setNav({ items: nav.items.filter((_, i) => i !== index) })}
                  sx={{ flexShrink: 0, opacity: "1 !important" }}>
                  <DeleteOutline sx={{ fontSize: 16, color: "#94A3B8", "&:hover": { color: "#DC2626" } }} />
                </IconButton>
              </Row>
              <Row label="跳转页面">
                {/* 挂载目标页：预览时点这一项就跳到该页 */}
                <TextField select size="small" value={item.page || ""}
                  onChange={(e) => setItem(index, { page: e.target.value })}
                  sx={fieldSx}>
                  <MenuItem value="" sx={{ fontSize: 12.5 }}>不跳转</MenuItem>
                  {pages.map((page) => (
                    <MenuItem key={page.key} value={page.key} sx={{ fontSize: 12.5 }}>{page.title}</MenuItem>
                  ))}
                </TextField>
                <Box sx={{ width: 26, flexShrink: 0 }} />
              </Row>
              {/* 圆点颜色：色卡组放最后，点一下即选 */}
              <Row label="圆点">
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  {tones.map(([value, label]) => {
                    const active = (item.tone || "slate") === value;
                    const color = NAV_TONE_DOTS[value] ?? "#94A3B8";
                    return (
                      <Box
                        key={value}
                        role="button"
                        aria-label={`圆点 ${label}`}
                        title={label}
                        onClick={() => setItem(index, { tone: value })}
                        sx={{
                          width: 20, height: 20, borderRadius: "50%", cursor: "pointer",
                          bgcolor: color,
                          outline: active ? `2px solid ${color}` : "none",
                          outlineOffset: 2,
                          transition: "transform .14s",
                          "&:hover": { transform: "scale(1.12)" },
                        }}
                      />
                    );
                  })}
                </Box>
                <Box sx={{ width: 26, flexShrink: 0 }} />
              </Row>
              </>)}
            </Box>
            );
          })}
        </Stack>

        </PanelSection>


        <PanelSection
          title="按钮"
          action={(
            <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />}
              onClick={() => setNav({ actions: [...nav.actions, { label: "按钮", kind: "secondary" }] })}
              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0, color: "#4F46E5" }}>
              添加
            </Button>
          )}
        >
        <Stack spacing={1}>
          {nav.actions.map((action, index) => (
            <Box key={index} sx={GROUP_CARD_SX}>
              <Row label="文字" mb={0}>
                <TextField size="small" value={action.label}
                  onChange={(e) => setAction(index, { label: e.target.value })}
                  sx={fieldSx} />
                <IconButton size="small" sx={{ flexShrink: 0 }}
                  onClick={() => setNav({ actions: nav.actions.filter((_, i) => i !== index) })}>
                  <Close sx={{ fontSize: 14, color: "#94A3B8" }} />
                </IconButton>
              </Row>
              <Row label="样式" mb={0}>
                <TextField select size="small" value={action.kind}
                  onChange={(e) => setAction(index, { kind: e.target.value as "primary" | "secondary" })}
                  sx={{ ...fieldSx, maxWidth: 140 }}>
                  <MenuItem value="primary" sx={{ fontSize: 12.5 }}>主按钮</MenuItem>
                  <MenuItem value="secondary" sx={{ fontSize: 12.5 }}>次按钮</MenuItem>
                </TextField>
              </Row>
            </Box>
          ))}
        </Stack>

        </PanelSection>

        <PanelSection title="导出">
          <Stack spacing={1}>
            <Row label="显示按钮">
              <Switch size="small" checked={nav.export_visible !== false}
                onChange={(e) => setNav({ export_visible: e.target.checked })}
                sx={{ ml: -0.75 }} />
            </Row>
            <Row label="文字">
              <TextField size="small" placeholder="导出 CSV"
                value={nav.export_label ?? "导出 CSV"}
                onChange={(e) => setNav({ export_label: e.target.value })}
                sx={fieldSx} />
            </Row>
            <Row label="样式">
              <TextField select size="small" value={nav.export_kind ?? "primary"}
                onChange={(e) => setNav({ export_kind: e.target.value as "primary" | "secondary" })}
                sx={fieldSx}>
                <MenuItem value="primary" sx={{ fontSize: 12.5 }}>主按钮</MenuItem>
                <MenuItem value="secondary" sx={{ fontSize: 12.5 }}>次按钮</MenuItem>
              </TextField>
            </Row>
            <Row label="导出范围">
              <TextField select size="small"
                value={nav.export_scope === "dataset" && nav.export_dataset_id ? `id:${nav.export_dataset_id}` : (nav.export_scope || "primary")}
                onChange={(e) => {
                  const raw = String(e.target.value);
                  if (raw.startsWith("id:")) {
                    setNav({ export_scope: "dataset", export_dataset_id: Number(raw.slice(3)) });
                  } else {
                    setNav({ export_scope: raw as "primary" | "all", export_dataset_id: null });
                  }
                }}
                sx={fieldSx}>
                <MenuItem value="primary" sx={{ fontSize: 12.5 }}>仅主数据集（引用卡片最多）</MenuItem>
                <MenuItem value="all" sx={{ fontSize: 12.5 }}>当前页全部数据集（一表一个文件）</MenuItem>
                {pageDatasets.map((ds) => (
                  <MenuItem key={ds.id} value={`id:${ds.id}`} sx={{ fontSize: 12.5 }}>
                    {ds.name} · {ds.count} 张卡
                  </MenuItem>
                ))}
              </TextField>
            </Row>
          </Stack>
        </PanelSection>

        <PanelSection title="状态">
          <Row label="状态">
            <TextField select size="small" value={nav.status ?? "time"}
              onChange={(e) => setNav({ status: e.target.value as "" | "time" })}
              sx={fieldSx}>
              <MenuItem value="time" sx={{ fontSize: 12.5 }}>时间（每 10 秒更新）</MenuItem>
              <MenuItem value="" sx={{ fontSize: 12.5 }}>不显示</MenuItem>
            </TextField>
          </Row>
        </PanelSection>
      </Box>
    );
  }

  if (kind === "banner") {
    const banner = spec.banner ?? { kicker: "", title: "", accent: "", subtitle: "", stats: [], tone: "sky" };
    const setBanner = (next: Partial<typeof banner>) =>
      onChange({ ...spec, banner: { ...banner, ...next } });
      /** 统计字段可选择的范围：指标 + 维度（标识字段不能聚合，排除） */
    const statFieldOptions = [
      ...metricOptions,
      ...dimensionOptions.filter((f) => f.role !== "id"),
    ].filter((f, i, arr) => f.name && arr.findIndex((x) => x.name === f.name) === i);
    const NUMERIC_ROLES = ["measure", "metric"];

  const setStat = (index: number, patch: Partial<BannerStat>) =>
      setBanner({ stats: banner.stats.map((stat, i) => (i === index ? { ...stat, ...patch } : stat)) });
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column" }}>
        <PanelTitle>头标卡</PanelTitle>

        {/* 通用：只有「外观」（高度 / 圆角 / 阴影 / 描边） */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>通用</Typography>
        <PanelSection title="外观" collapsible defaultOpen={false} first>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
        </PanelSection>

        {/* 附加：标题文案 + 右侧统计 */}
        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>附加</Typography>
        <PanelSection title="标题文案">
        <Stack spacing={1}>
          <Row label="顶部小字">
            <TextField size="small" value={banner.kicker}
              onChange={(e) => setBanner({ kicker: e.target.value })} sx={fieldSx} />
          </Row>
          <Row label="大标题">
            <TextField size="small" value={banner.title}
              onChange={(e) => setBanner({ title: e.target.value })} sx={fieldSx} />
          </Row>
          <Row label="强调段">
            <TextField size="small" placeholder="渐变" value={banner.accent}
              onChange={(e) => setBanner({ accent: e.target.value })} sx={fieldSx} />
          </Row>
          <Row label="副标题">
            <TextField size="small" value={banner.subtitle}
              onChange={(e) => setBanner({ subtitle: e.target.value })} sx={fieldSx} />
          </Row>
          {/* 底色：与「指标卡 → 外观」同一套色点交互，7 套主题 */}
          <Row label="底色" mb={1}>
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
              {BANNER_TONES.map((tone) => (
                <Box
                  key={tone.value}
                  title={tone.label}
                  role="button"
                  aria-label={tone.label}
                  onClick={() => setBanner({ tone: tone.value })}
                  sx={{
                    width: 20, height: 20, borderRadius: "50%", cursor: "pointer",
                    bgcolor: tone.dot,
                    outline: (banner.tone || "sky") === tone.value ? `2px solid ${tone.dot}` : "none",
                    outlineOffset: 2,
                    transition: "transform .14s",
                    "&:hover": { transform: "scale(1.12)" },
                  }}
                />
              ))}
            </Box>
          </Row>
        </Stack>
        </PanelSection>

        <PanelSection
          title="右侧统计"
          action={(
            <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />}
              onClick={() => setBanner({ stats: [...banner.stats, { value: "", unit: "", label: "" }] })}
              sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0, color: "#4F46E5" }}>
              添加
            </Button>
          )}
        >
        <Stack spacing={1}>
          {banner.stats.map((stat, index) => {
            const opsOpen = openStatOps === index;
            const folded = !!bannerFolded[index];
            return (
            <Box key={index} sx={{ ...GROUP_CARD_SX, gap: folded ? 0 : GROUP_CARD_SX.gap }}>
              {/* 头标：色条 + 标签名 + 删除 + 折叠箭头（和导航菜单卡 / 筛选字段同一套） */}
              <Box
                onClick={() => setBannerFolded((prev) => ({ ...prev, [index]: !prev[index] }))}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.75, cursor: "pointer",
                  pb: folded ? 0 : 0.75, borderBottom: folded ? "none" : "1px solid #F4F7FC",
                  "&:hover": { opacity: 0.82 },
                }}>
                <Box sx={{
                  flexShrink: 0, width: 3, height: 14, borderRadius: 999,
                  bgcolor: NAV_ITEM_ACCENTS[index % NAV_ITEM_ACCENTS.length],
                }} />
                <Typography sx={{
                  flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#0F172A",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {stat.label || `统计 ${index + 1}`}
                </Typography>
                <ExpandMore sx={{
                  fontSize: 16, color: "#94A3B8", flexShrink: 0, transition: "transform .15s",
                  transform: folded ? "rotate(-90deg)" : "none",
                }} />
              </Box>
              {!folded && (<>
                <Row label="标签">
                  <TextField size="small" value={stat.label}
                    onChange={(e) => setStat(index, { label: e.target.value })}
                    sx={fieldSx} />
                  <IconButton size="small" title="删除这个统计"
                    onClick={() => setBanner({ stats: banner.stats.filter((_, i) => i !== index) })}
                    sx={{ flexShrink: 0, opacity: "1 !important" }}>
                    <DeleteOutline sx={{ fontSize: 16, color: "#94A3B8", "&:hover": { color: "#DC2626" } }} />
                  </IconButton>
                </Row>
                <Row label="字段">
                  <AxisInput
                    value={stat.metric || ""}
                    options={statFieldOptions.map((f) => f.name)}
                    placeholder="拖到这里"
                    onPick={(name) => {
                      const picked = statFieldOptions.find((f) => f.name === name);
                      const numeric = picked ? NUMERIC_ROLES.includes(picked.role) : false;
                      setStat(index, name
                        ? (numeric ? { metric: name } : { metric: name, agg: "COUNT_DISTINCT" })
                        : { metric: "" });
                    }}
                  />
                </Row>
                {stat.metric ? (
                  <Row label="聚合">
                    <TextField select size="small" value={stat.agg || "SUM"}
                      onChange={(e) => setStat(index, { agg: e.target.value })}
                      sx={fieldSx}>
                      {["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"].map((agg) => (
                        <MenuItem key={agg} value={agg} sx={{ fontSize: 12.5 }}>{agg}</MenuItem>
                      ))}
                    </TextField>
                    <Box sx={{ width: 26, flexShrink: 0 }} />
                  </Row>
                ) : null}
                <Row label="单位">
                  <TextField select size="small" value={stat.unit || ""}
                    onChange={(e) => setStat(index, { unit: e.target.value })}
                    sx={fieldSx}>
                    <MenuItem value="" sx={{ fontSize: 12.5 }}>无单位</MenuItem>
                    {BANNER_UNITS.map((unit) => (
                      <MenuItem key={unit} value={unit} sx={{ fontSize: 12.5 }}>{unit}</MenuItem>
                    ))}
                    {/* 老文档里的自定义单位不在内置清单里时，保留它，别一保存就丢 */}
                    {stat.unit && !BANNER_UNITS.includes(stat.unit) && stat.unit !== "" && (
                      <MenuItem value={stat.unit} sx={{ fontSize: 12.5 }}>{stat.unit}</MenuItem>
                    )}
                  </TextField>
                  <Box sx={{ width: 26, flexShrink: 0 }} />
                </Row>
                {!stat.metric && (
                  <Row label="默认值">
                    <TextField size="small" value={stat.value}
                      onChange={(e) => setStat(index, { value: e.target.value })}
                      sx={{ ...fieldSx, "& input": { textAlign: "left", fontVariantNumeric: "tabular-nums" } }} />
                    <Box sx={{ width: 26, flexShrink: 0 }} />
                  </Row>
                )}
                {stat.metric && (
                  <Row label="格式">
                    <TextField select size="small" value={stat.format || "number"}
                      onChange={(e) => setStat(index, { format: e.target.value as BannerStat["format"] })}
                      sx={fieldSx}>
                      <MenuItem value="number" sx={{ fontSize: 12.5 }}>数值</MenuItem>
                      <MenuItem value="integer" sx={{ fontSize: 12.5 }}>整数</MenuItem>
                      <MenuItem value="percent" sx={{ fontSize: 12.5 }}>百分比</MenuItem>
                      <MenuItem value="currency" sx={{ fontSize: 12.5 }}>金额</MenuItem>
                    </TextField>
                  </Row>
                )}

                {/* 运算：折叠，点开才显示（与指标卡同一口径） */}
                {stat.metric && (
                  <>
                    <Box
                      onClick={() => setOpenStatOps(opsOpen ? null : index)}
                      sx={{
                        display: "flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content",
                        fontSize: 11.5, color: "#64748B", "&:hover": { color: "#4F46E5" },
                      }}
                    >
                      <Typography component="span" sx={{ fontSize: 11.5 }}>运算</Typography>
                      <Box sx={{
                        display: "inline-flex", transition: "transform .14s",
                        transform: opsOpen ? "rotate(180deg)" : "none",
                      }}>
                        <ExpandMore sx={{ fontSize: 15 }} />
                      </Box>
                    </Box>
                    {opsOpen && (
                      <>
                        <Row label="乘数" mb={0}>
                          <TextField size="small" type="number" value={stat.scale ?? 1}
                            onChange={(e) => setStat(index, { scale: Number(e.target.value) })}
                            sx={{ ...fieldSx, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }} />
                        </Row>
                        <Row label="加数" mb={0}>
                          <TextField size="small" type="number" value={stat.offset ?? 0}
                            onChange={(e) => setStat(index, { offset: Number(e.target.value) })}
                            sx={{ ...fieldSx, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }} />
                        </Row>
                        <Row label="小数位" mb={0}>
                          <TextField size="small" type="number" value={stat.decimals ?? 0}
                            onChange={(e) => setStat(index, { decimals: Math.max(0, Math.min(4, Number(e.target.value))) })}
                            inputProps={{ min: 0, max: 4 }}
                            sx={{ ...fieldSx, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" } }} />
                        </Row>
                        <Row label="前缀" mb={0}>
                          <TextField size="small" value={stat.prefix ?? ""}
                            onChange={(e) => setStat(index, { prefix: e.target.value.slice(0, 4) })}
                            sx={fieldSx} />
                        </Row>
                        <Row label="后缀" mb={0}>
                          <TextField size="small" value={stat.suffix ?? ""}
                            onChange={(e) => setStat(index, { suffix: e.target.value.slice(0, 4) })}
                            sx={fieldSx} />
                        </Row>
                      </>
                    )}
                  </>
                )}
              </>)}
            </Box>
            );
          })}
        </Stack>
        </PanelSection>
      </Box>
    );
  }

  const extraMetrics = (b.metrics || []).filter(
    (m): m is { name: string; agg?: string } => typeof m === "object" && m !== null && "name" in m,
  );

  /** 组件特有分区：只有这些 kind 有「通用」以外的专有配置（热力要有维度才有矩阵列） */
  const hasSpecial = kind === "table" || kind === "scatter" || kind === "combo" || kind === "kpi" || kind === "bar"
    || kind === "pie" || kind === "donut"
    || kind === "wordcloud" || (kind === "heatmap" && Boolean(b.dimension));

  // 滚动交给外层中栏统一处理：这里再来一层会出现两条滚动条
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ p: 2 }}>
        <PanelTitle>{KIND_LABEL[kind] || "组件"}</PanelTitle>
        {/* SQL 默认显示（黑底，格式化 + 高亮） */}
        <SqlPreview sql={payload?.sql} />

        <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>通用</Typography>
        {/* 数据：维度 / 指标（明细表的列在「特有」里） */}
        {kind !== "table" && (
        <PanelSection title="数据" collapsible defaultOpen={false} first>

        {/* 指标卡/结论卡/分节标题没有维度概念；已绑过维度的留一行可移除，不显示拖拽区 */}
        {needsDimension ? (
          <>
            <Row label={axis.dimension}>
              <AxisInput
                value={b.dimension ?? ""}
                options={dimensionOptions.map((f) => f.name)}
                placeholder="拖到这里"
                onPick={(next) => patch("dimension", next)}
              />
            </Row>
            {b.dimension && dimensionFieldIsTime && (
              <Row label="粒度">
                <TextField select size="small" value={(b as { grain?: string }).grain ?? ""}
                  onChange={(e) => patch("grain", e.target.value || null)}
                  sx={fieldSx}>
                  {GRAINS.map((g) => (
                    <MenuItem key={g || "none"} value={g} sx={{ fontSize: 12.5 }}>{g || "原始"}</MenuItem>
                  ))}
                </TextField>
              </Row>
            )}
          </>
        ) : b.dimension ? (
          /* 词云也走「词（维度）+ 权重（指标）」两槽，和 Superset / Tableau 一致
             （2026-11-13 用户先要求去掉维度、看过市面做法后又让配回来） */
          <Slot label={axis.dimension}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography sx={{ fontSize: 12.5, color: "#334155", flex: 1, minWidth: 0 }} noWrap>
                {b.dimension}
              </Typography>
              <IconButton size="small" onClick={() => patch("dimension", null)}>
                <Close sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          </Slot>
        ) : null}

        <Box data-drop="metric" {...dropZone("metric")} sx={{ ...zoneSx("metric"), p: 0 }}>
          <Row label={axis.metric}>
            <AxisInput
              value={b.metric ?? ""}
              options={metricOptions.map((f) => f.name)}
              placeholder="拖到这里"
              onPick={pickMetric}
            />
          </Row>
          {b.metric && (
            <Row label={kind === "combo" ? "左轴聚合" : "聚合"}>
              <TextField select size="small" value={b.agg}
                onChange={(e) => onChange({ ...spec, binding: {
                  ...b, agg: e.target.value,
                  ...(e.target.value === "CUSTOM" && !b.agg_expression
                    ? { agg_expression: `SUM("${b.metric?.replace(/"/g, '""')}")` } : {}),
                } })}
                sx={fieldSx}>
                {AGG.map((a) => (
                  <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>
                ))}
                <MenuItem value="CUSTOM" sx={{ fontSize: 12.5 }}>自定义 SQL</MenuItem>
              </TextField>
              <Box sx={{ width: 26, flexShrink: 0 }} />
            </Row>
          )}
          {/* 左轴自定义 SQL 的输入框贴在「左轴聚合」下面，右轴那两行排在它后面 */}
          {b.metric && b.agg === "CUSTOM" && (() => {
            const used = [...String(b.agg_expression || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
            const foreign = [...new Set(used.filter((name) => name !== b.metric))];
            return (
            <Box sx={{ mt: 1, mb: 1 }}>
              <TextField size="small" multiline minRows={3} fullWidth
                value={b.agg_expression ?? ""}
                onChange={(e) => patch("agg_expression", e.target.value)}
                error={Boolean(payload?.error) || foreign.length > 0}
                helperText={payload?.error || (foreign.length
                  ? `表达式引用的是 ${foreign.map((n) => `"${n}"`).join("、")}，和当前指标 "${b.metric}" 不一致 —— 这个聚合会按前者计算。`
                  : '使用数据集字段名，例如 MEDIAN("销售额")；无需 SELECT / FROM，随当前筛选和分组计算。')}
                inputProps={{ maxLength: 4000, spellCheck: false }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12 }, "& textarea, & .MuiInputBase-input": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 } }} />
            </Box>
            );
          })()}
          {kind === "combo" && (
            <>
              <Row label="右轴（线）">
                <AxisInput
                  value={(b.metrics?.[0] as { name?: string } | undefined)?.name ?? ""}
                  options={metricOptions.filter((f) => f.name !== b.metric).map((f) => f.name)}
                  placeholder="拖到这里"
                  onPick={(next) => patch("metrics", next
                    ? [{ name: next, agg: (b.metrics?.[0] as { agg?: string } | undefined)?.agg ?? "SUM" }]
                    : [])}
                />
              </Row>
              {(b.metrics?.[0] as { name?: string } | undefined)?.name && (
                <>
                  <Row label="右轴聚合">
                    <TextField select size="small" value={(b.metrics?.[0] as { agg?: string } | undefined)?.agg ?? "SUM"}
                      onChange={(e) => {
                        const current = (b.metrics?.[0] as { name?: string } | undefined)?.name;
                        if (!current) return;
                        const agg = e.target.value;
                        const expression = (b.metrics?.[0] as { expression?: string } | undefined)?.expression ?? "";
                        patch("metrics", [{
                          name: current, agg,
                          ...(agg === "CUSTOM"
                            ? { expression: expression || `SUM("${current.replace(/"/g, '""')}")` }
                            : {}),
                        }]);
                      }}
                      sx={fieldSx}>
                      {AGG.map((a) => (
                        <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>
                      ))}
                      <MenuItem value="CUSTOM" sx={{ fontSize: 12.5 }}>自定义 SQL</MenuItem>
                    </TextField>
                    <Box sx={{ width: 26, flexShrink: 0 }} />
                  </Row>
                  {(b.metrics?.[0] as { agg?: string } | undefined)?.agg === "CUSTOM" && (
                    <Box sx={{ mt: 1 }}>
                      <TextField size="small" multiline minRows={3} fullWidth
                        value={(b.metrics?.[0] as { expression?: string } | undefined)?.expression ?? ""}
                        onChange={(e) => {
                          const current = (b.metrics?.[0] as { name?: string } | undefined)?.name;
                          if (!current) return;
                          patch("metrics", [{ name: current, agg: "CUSTOM", expression: e.target.value }]);
                        }}
                        error={Boolean(payload?.error)}
                        helperText={payload?.error || '使用数据集字段名，例如 MEDIAN("销售额")；无需 SELECT / FROM，随当前筛选和分组计算。'}
                        inputProps={{ maxLength: 4000, spellCheck: false }}
                        sx={{ "& .MuiOutlinedInput-root": { borderRadius: "8px", fontSize: 12 }, "& textarea, & .MuiInputBase-input": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 12 } }} />
                    </Box>
                  )}
                </>
              )}
            </>
          )}
        </Box>

        </PanelSection>
        )}

        <Slot label="过滤" collapsible>
          {/* 过滤条件：一行 = 字段(补全) + 运算符(下拉) + 值(输入) + 减号(删除) */}
          {(b.filters || []).map((f, i) => {
            const updateFilter = (next: Partial<{ column: string; op: string; value: string }>) => {
              const filters = [...(b.filters || [])];
              filters[i] = { ...filters[i], ...next };
              patch("filters", filters);
            };
            return (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.75 }}>
                <Autocomplete
                  size="small"
                  options={[...dimensionOptions, ...metricOptions].map((o) => o.name)}
                  value={f.column || null}
                  onChange={(_, v) => updateFilter({ column: v || "" })}
                  renderInput={(params) => (
                    <TextField {...params} size="small" placeholder="字段" sx={fieldSx} />
                  )}
                  sx={{ flex: 3, minWidth: 0 }}
                />
                <TextField select size="small" value={f.op}
                  onChange={(e) => updateFilter({ op: e.target.value })}
                  sx={{ ...fieldSx, flex: 1.5, "& .MuiSelect-icon": { display: "none" } }}>
                  {OPS.map((op) => <MenuItem key={op} value={op} sx={{ fontSize: 12 }}>{op}</MenuItem>)}
                </TextField>
                <TextField size="small" value={String(f.value ?? "")} placeholder="值"
                  onChange={(e) => updateFilter({ value: e.target.value })}
                  sx={fieldSx} />
                <Box sx={{ flex: 0.5, display: "flex", justifyContent: "center" }}>
                  <IconButton size="small" onClick={() => patch("filters", (b.filters || []).filter((_, k) => k !== i))} sx={{ p: 0.5 }}>
                    <Remove sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </Box>
            );
          })}

          {/* 拖拽添加容器：始终存在 */}
          <Box
            data-drop="filter"
            {...dropZone("filter")}
            onClick={() => patch("filters", [...(b.filters || []), { column: dimensionOptions[0]?.name ?? "", op: "=", value: "" }])}
            sx={{
              ...dash, px: 1.1, py: 0.5, fontSize: 12.5, cursor: "pointer",
              transition: "border-color .12s, background .12s, color .12s",
              borderColor: dragOver === "filter" ? "#6366F1" : undefined,
              bgcolor: dragOver === "filter" ? "rgba(99,102,241,0.05)" : undefined,
              color: dragOver === "filter" ? "#4F46E5" : undefined,
              "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" },
            }}
          >
            ＋ 添加条件
          </Box>
        </Slot>

        {(!["kpi", "insight"].includes(kind) || kind === "table") && (
        <Slot label="排序" collapsible>
        <Stack spacing={1}>
          {kind === "table" && (
            <Row label="排序字段">
              <Autocomplete
                size="small"
                options={b.dimensions ?? []}
                value={b.sort_field || null}
                onChange={(_, value) => patch("sort_field", value || "")}
                renderInput={(params) => (
                  <TextField {...params} size="small" placeholder="不指定" sx={fieldSx} />
                )}
                sx={{ flex: 1, minWidth: 0 }}
              />
            </Row>
          )}
          {kind === "table" ? (
            <Row label="每页条数">
              <TextField size="small" type="number" value={spec.table_view.page_size}
                inputProps={{ min: 3, max: 200 }}
                onChange={(e) => {
                  const value = Math.max(3, Math.min(Number(e.target.value) || 3, 200));
                  onChange({ ...spec, table_view: { ...spec.table_view, page_size: value } });
                }}
                sx={fieldSx} />
            </Row>
          ) : !["kpi", "insight"].includes(kind) && (
            <Row label="行限制">
              <TextField size="small" type="number" value={b.top_n}
                onChange={(e) => patch("top_n", Number(e.target.value))}
                sx={fieldSx} />
            </Row>
          )}
          {!["kpi", "insight"].includes(kind) && (
            <Row label="排序">
              <Autocomplete
                size="small"
                disabled={kind === "table" && !b.sort_field}
                options={["desc", "asc"]}
                value={b.sort}
                onChange={(_, value) => patch("sort", value || "desc")}
                getOptionLabel={(v) => (v === "asc" ? "升序" : "降序")}
                renderInput={(params) => (
                  <TextField {...params} size="small" placeholder="降序" sx={fieldSx} />
                )}
                sx={{ flex: 1, minWidth: 0 }}
              />
            </Row>
          )}
          {kind === "combo" && (
            <Row label="排序依据">
              <TextField select size="small" value={b.order_by_dimension ? "x" : "value"}
                onChange={(e) => patch("order_by_dimension", e.target.value === "x")}
                sx={fieldSx}>
                <MenuItem value="value" sx={{ fontSize: 12.5 }}>按数值</MenuItem>
                <MenuItem value="x" sx={{ fontSize: 12.5 }}>按 X 轴</MenuItem>
              </TextField>
              <Box sx={{ width: 26, flexShrink: 0 }} />
            </Row>
          )}
        </Stack>
        </Slot>
        )}

        <ComputeFields kind={kind} spec={spec} onChange={onChange} />

        <PanelSection title="外观" collapsible defaultOpen={false}>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize}
            metricOptions={metricOptions} dimensionOptions={dimensionOptions}
            identifierOptions={identifierOptions ?? []} />
        </PanelSection>

        {/* 文字：ChartOptionsPanel 自带「文字」分区（图表标题 / 轴标题等）；柱状图的坐标轴搬到了「附加」 */}
        <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode={kind === "bar" || kind === "pie" || kind === "donut" || kind === "combo" ? "text" : "all"} />

        {/* ── 组件特有：只放这个 kind 才有的配置 ── */}
        {hasSpecial && (
          <>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: "#0F172A", mt: 0, mb: 2 }}>附加</Typography>
            {/* 明细表：列（字段）/ 缩略图 / 搜索 / 弹窗 */}
            {kind === "table" && (
              <>
                <TableFieldsEditor
                  spec={spec} onChange={onChange}
                  payload={payload}
                  metricOptions={metricOptions} dimensionOptions={dimensionOptions}
                  identifierOptions={identifierOptions ?? []}
                />
                <TableThumbSettings
                  spec={spec} onChange={onChange}
                  metricOptions={metricOptions}
                  dimensionOptions={dimensionOptions ?? []}
                  identifierOptions={identifierOptions ?? []}
                />
                <Slot label="搜索" collapsible>
                  <Row label="标题搜索">
                    <Switch
                      size="small"
                      checked={!!spec.table_view?.search}
                      onChange={(e) => onChange({ ...spec, table_view: { ...(spec.table_view ?? {}), search: e.target.checked } as typeof spec.table_view })}
                      sx={{ ml: -0.5 }}
                    />
                  </Row>
                </Slot>
                <TableDetailSettings
                  spec={spec} onChange={onChange}
                  columns={(spec.binding.dimensions ?? []).filter((name) => name !== spec.table_view?.thumb_key)}
                  boards={boards}
                />
              </>
            )}

            {/* 环形图 / 饼图：形状参数 + 显示开关（组件特有） */}
            {(kind === "pie" || kind === "donut") && (
              <>
                <PanelSection title="首选项" first>
                  <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="prefs" />
                </PanelSection>
                <PanelSection title="图形">
                  <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="pie" />
                </PanelSection>
                {/* 点击弹窗：点扇区弹出指定明细表（和指标卡徽标弹窗同一套配置） */}
                <PanelSection title="点击弹窗">
                  <KpiTopSettings spec={spec} onChange={onChange} tables={tables}
                    hideBadge switchLabel="点击弹窗" />
                </PanelSection>
              </>
            )}

            {/* 柱线组合：首选项（右轴 / 曲线平滑 / 组件元素）+ 坐标轴 */}
            {kind === "combo" && (
              <>
                {/* 首选项：右轴 / 曲线平滑 + 组件元素（内部自带分区标题） */}
                <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="prefs" />
                <PanelSection title="坐标轴">
                  <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="axis" />
                </PanelSection>
                {/* 点击弹窗：点柱子/线弹出指定明细表（和环形图同一套配置） */}
                <PanelSection title="点击弹窗">
                  <KpiTopSettings spec={spec} onChange={onChange} tables={tables}
                    hideBadge switchLabel="点击弹窗" />
                </PanelSection>
              </>
            )}

            {/* 柱状图：坐标轴 / 显示开关（属于这根柱子的特有配置） */}
            {kind === "bar" && (
              <>
                <PanelSection title="坐标轴" first>
                  <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="axis" />
                </PanelSection>
                {/* 组件元素：一行开关（行内自带 label） */}
                <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} mode="prefs" />
              </>
            )}

            {/* 指标卡：徽标弹窗（组件特有，放最后） */}
            {kind === "kpi" && (
              <KpiTopSettings
                spec={spec} onChange={onChange}
                tables={tables}
              />
            )}

            {/* 散点：X / Y 都是数值指标，每个点是一行样本（X 写 chart.x_key，Y 是 aggregate 指标） */}
            {kind === "scatter" && (
              <>
                <PanelSection title="数值" first>
                  <Stack spacing={1}>
                    <Row label="横轴">
                      <TextField select size="small" value={spec.chart?.x_key || ""}
                        onChange={(e) => onChange({ ...spec, chart: { ...spec.chart, x_key: e.target.value } })}
                        sx={fieldSx}>
                        <MenuItem value="" sx={{ fontSize: 12.5 }}>取纵轴指标</MenuItem>
                        {metricOptions.map((f) => (
                          <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                        ))}
                      </TextField>
                    </Row>
                    <Row label="气泡大小">
                      <TextField select size="small" value={spec.chart?.size_key || ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          const mode = spec.chart?.scatter_mode ?? "point";
                          /* 选了气泡字段就自动切到气泡模式；清空则从气泡退回点（避免「填了没反应」） */
                          const nextMode = value ? "bubble" : (mode === "bubble" ? "point" : mode);
                          onChange({ ...spec, chart: { ...spec.chart, size_key: value, scatter_mode: nextMode } });
                        }}
                        sx={fieldSx}>
                        <MenuItem value="" sx={{ fontSize: 12.5 }}>不用</MenuItem>
                        {metricOptions.map((f) => (
                          <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                        ))}
                      </TextField>
                    </Row>
                  </Stack>
                </PanelSection>
                <PanelSection title="附加">
                  <Stack spacing={1}>
                    {extraMetrics.map((m, index) => (
                      <Stack key={`${m.name}-${index}`} direction="row" spacing={1} alignItems="center">
                        <TextField size="small" value={m.name} disabled sx={fieldSx} />
                        <TextField select size="small" value={m.agg ?? "MAX"}
                          onChange={(e) => {
                            const next = [...(b.metrics || [])];
                            next[index] = { name: m.name, agg: e.target.value };
                            patch("metrics", next);
                          }}
                          sx={{ ...fieldSx, maxWidth: 120 }}>
                          {AGG.map((a) => <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>)}
                        </TextField>
                        <IconButton size="small" sx={{ flexShrink: 0 }}
                          onClick={() => patch("metrics", (b.metrics || []).filter((_, i) => i !== index))}>
                          <Close sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Stack>
                    ))}
                    <Box
                      onClick={() => {
                        const candidate = metricOptions.find((f) => f.name !== b.metric && !extraMetrics.some((m) => m.name === f.name));
                        if (candidate) patch("metrics", [...(b.metrics || []), { name: candidate.name, agg: "MAX" }]);
                      }}
                      sx={{ ...dash, cursor: "pointer", "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" } }}
                    >
                      ＋ 附加指标（气泡大小 / 四象限的另一轴）
                    </Box>
                  </Stack>
                </PanelSection>
              </>
            )}

            {/* 热力：矩阵列（series） */}
            {kind === "heatmap" && b.dimension && (
              <Row label="列（矩阵列）">
                <TextField select size="small" value={b.series ?? ""}
                  onChange={(e) => patch("series", e.target.value || null)}
                  sx={fieldSx}>
                  <MenuItem value="" sx={{ fontSize: 12.5 }}>不设置</MenuItem>
                  {dimensionOptions.map((f) => (
                    <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                  ))}
                </TextField>
              </Row>
            )}

            {/* 组合图：右轴（线）与它的聚合，归到「数据」里（和纵轴同一组） */}

            {/* 词云：颜色分类 / 拆词 */}
            {kind === "wordcloud" && (
              <>
                <Slot label="颜色（分类）">
                  <TextField select size="small" value={b.series ?? ""}
                    onChange={(e) => patch("series", e.target.value || null)}
                    sx={fieldSx}>
                    <MenuItem value="" sx={{ fontSize: 12.5 }}>不用</MenuItem>
                    {dimensionOptions.map((f) => (
                      <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                    ))}
                  </TextField>
                </Slot>
                {/* 拆词：一格里有「粉末偏多 / 分量不足」这种多词时，按分隔符拆成一个个词（空 = 不拆） */}
                <Slot label="拆词">
                  <TextField size="small" placeholder="分隔符，如 /（留空 = 不拆）"
                    value={splitDraft}
                    onChange={(e) => setSplitDraft(e.target.value)}
                    onBlur={() => commitSplit()}
                    onKeyDown={(e) => { if (e.key === "Enter") commitSplit(); }}
                    sx={fieldSx} />
                </Slot>
              </>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
