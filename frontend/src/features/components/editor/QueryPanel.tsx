/** 查询面板（编辑页中栏）—— 维度 / 指标 / 过滤 / 行限制，对应 spec.binding */

import { useEffect, useRef, useState } from "react";
import {
  Box, Button, Chip, Divider, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography,
} from "@mui/material";
import { Add, Check, Close, ExpandMore } from "@mui/icons-material";
import ChartOptionsPanel from "./ChartOptionsPanel";
import TableDetailSettings from "./TableDetailSettings";
import { BANNER_TONES } from "../renderers/BannerCard";
import StylePanel from "./StylePanel";
import DataCheckPanel from "./DataCheckPanel";
import { GROUP_CARD_SX, PanelSection, PanelTitle } from "./PanelSection";
import { KIND_LABEL } from "../registry";
import { axisLabels } from "./axisLabels";
import ComputeFields from "./ComputeFields";
import type { BannerStat, ComponentItem, ComponentKind, ComponentSpec, FieldOption, RenderPayload } from "../types";

interface Props {
  kind: ComponentKind;
  spec: ComponentSpec;
  payload?: RenderPayload | null;
  metricOptions: FieldOption[];
  dimensionOptions: FieldOption[];
  identifierOptions?: FieldOption[];
  onChange: (next: ComponentSpec) => void;
  /** 卡片高度与改高度回调（把「高度」真正落到版面） */
  height?: number;
  onResize?: (height: number) => void;
  /** 当前看板的页面列表（导航卡挂载跳页用） */
  pages?: { key: string; title: string }[];
  /** 组件库（明细表「行详情」添加卡片用） */
  components?: ComponentItem[];
  /** 页面上的画板（明细表「弹窗」选目标用） */
  boards?: { key: string; label: string }[];
  /** 正在编辑的详情卡片 key */
  detailCardKey?: string | null;
  onEditDetailCard?: (key: string) => void;
  /** 进入「详情画布」编辑行详情面板 */
  onEditDetailPanel?: () => void;
  /** 当前页用到的数据集（导航卡「导出范围」用） */
  pageDatasets?: { id: number; name: string; count: number }[];
}

function TableFieldsEditor({
  spec, onChange, metricOptions, dimensionOptions, identifierOptions,
}: {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  metricOptions: FieldOption[];
  dimensionOptions: FieldOption[];
  identifierOptions: FieldOption[];
}) {
  const b = spec.binding;
  const fields = b.dimensions ?? [];
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  /** 字段区也能当拖拽落点 */
  const [dropField, setDropField] = useState(false);

  const setFields = (next: string[]) => {
    onChange({
      ...spec,
      binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: next },
    });
  };
  const add = (name: string) => {
    if (fields.includes(name)) return;
    setFields([...fields, name]);
  };
  const remove = (name: string) => setFields(fields.filter((n) => n !== name));

  /** 拖动重排：字段顺序 = 表格列顺序 */
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragTo, setDragTo] = useState<number | null>(null);
  /** 放 ref 里：drop 紧跟 dragstart 时 state 还没刷新 */
  const dragFromRef = useRef<number | null>(null);
  const moveField = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [picked] = next.splice(from, 1);
    next.splice(to, 0, picked);
    setFields(next);
  };

  const groups: [string, FieldOption[]][] = [
    ["指标", metricOptions],
    ["列", dimensionOptions],
    ["标识", identifierOptions],
  ];

  return (
    <>
      <Slot label="字段">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
          {fields.map((name, index) => (
            <Box
              key={name}
              data-field-chip={name}
              draggable
              onDragStart={(e) => {
                dragFromRef.current = index;
                setDragFrom(index);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", name);
              }}
              onDragEnd={() => { dragFromRef.current = null; setDragFrom(null); setDragTo(null); }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (dragTo !== index) setDragTo(index);
              }}
              onDragLeave={() => setDragTo((cur) => (cur === index ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFromRef.current !== null) moveField(dragFromRef.current, index);
                dragFromRef.current = null;
                setDragFrom(null);
                setDragTo(null);
              }}
              sx={{
                position: "relative",
                // 缩略图字段只在后端挂载，不在字段列表里显示
                display: name === spec.table_view.thumb_key ? "none" : "flex",
                alignItems: "center", gap: 0.5, pl: 1.1, pr: 0.7, height: 28,
                borderRadius: 1.5, border: "1px solid #E8EEF8", bgcolor: "#F8FAFD",
                fontSize: 12.5, color: "#334155",
                cursor: "grab", transition: "opacity .12s, border-color .12s",
                opacity: dragFrom === index ? 0.45 : 1,
                borderColor: dragTo === index && dragFrom !== index ? "rgba(79,70,229,0.45)" : "#E8EEF8",
                "&:active": { cursor: "grabbing" },
                // 落点提示：拖到哪个字段前就画一条竖线
                "&::before": dragTo === index && dragFrom !== null && dragFrom !== index
                  ? {
                      content: '""', position: "absolute", left: -5, top: 3, bottom: 3, width: 2,
                      borderRadius: 1, bgcolor: "#4F46E5",
                    }
                  : undefined,
              }}
            >
              {name}
              <Close
                onClick={(e) => { e.stopPropagation(); remove(name); }}
                sx={{ fontSize: 14, color: "#94A3B8", cursor: "pointer", "&:hover": { color: "#EF4444" } }}
              />
            </Box>
          ))}
          <Box
            onClick={(e) => setAnchor(e.currentTarget)}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              if (!dropField) setDropField(true);
            }}
            onDragLeave={() => setDropField(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDropField(false);
              try {
                const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
                if (payload.kind === "field" && payload.name) add(String(payload.name));
              } catch {
                /* 不是字段拖拽，忽略 */
              }
            }}
            sx={{
              ...dash, px: 1.1, py: 0.5, fontSize: 12.5, cursor: "pointer",
              transition: "border-color .12s, background .12s, color .12s",
              borderColor: dropField ? "#6366F1" : undefined,
              bgcolor: dropField ? "rgba(99,102,241,0.05)" : undefined,
              color: dropField ? "#4F46E5" : undefined,
              "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" },
            }}
          >
            ＋ 添加字段
          </Box>
        </Box>

      </Slot>

      <Menu
        anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
        slotProps={{ paper: { sx: { borderRadius: 2, maxHeight: 360, minWidth: 200 } } }}
      >
        {groups.map(([label, options]) => (
          options.length ? (
            <Box key={label}>
              <Typography sx={{ px: 1.5, pt: 1, pb: 0.5, fontSize: 10.5, color: "#94A3B8" }}>{label}</Typography>
              {options.map((f) => {
                const active = fields.includes(f.name);
                return (
                  <MenuItem
                    key={`${label}-${f.name}`}
                    onClick={() => { add(f.name); setAnchor(null); }}
                    sx={{ fontSize: 12.5, minHeight: 32 }}
                  >
                    <Box sx={{ flex: 1 }}>{f.name}</Box>
                    {active && <Check sx={{ fontSize: 14, color: "#4F46E5" }} />}
                  </MenuItem>
                );
              })}
            </Box>
          ) : null
        ))}
      </Menu>
    </>
  );
}

/** 名字像图片的字段排在前面（主图 / image / pic 优先，其次 url / 链接） */
const IMAGE_KEY = /图|image|img|pic|photo|url|链接/i;
const STRONG_IMAGE_KEY = /图|image|img|pic|photo/i;

/** 缩略图设置 —— 放在中栏底部（运算之后）；图片字段只在后端挂载取图，不占表格列 */
function TableThumbSettings({
  spec, onChange, dimensionOptions, identifierOptions,
}: {
  spec: ComponentSpec;
  onChange: (next: ComponentSpec) => void;
  dimensionOptions: FieldOption[];
  identifierOptions: FieldOption[];
}) {
  const b = spec.binding;
  const fields = b.dimensions ?? [];
  /* 图片字段的候选 = **所有文字类列**（标识 + 维度），不再只认 role=id：
     直连数据集里「链接 / 主图 / 详情图」这类列往往是 dimension，只认 id 就会一个选项都没有 */
  const seen = new Set<string>();
  const imageOptions = [...(identifierOptions ?? []), ...(dimensionOptions ?? [])]
    .filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)))
    .filter((f) => f.role !== "measure" && f.role !== "time")
    /* 名字像「图 / image / url / 链接」的排前面，挑起来不用翻一长串 */
    .sort((x, y) => (Number(STRONG_IMAGE_KEY.test(y.name)) - Number(STRONG_IMAGE_KEY.test(x.name)))
      || (Number(IMAGE_KEY.test(y.name)) - Number(IMAGE_KEY.test(x.name))));

  const applyThumb = (on: boolean, rawKey: string) => {
    const candidates = imageOptions
      .filter((f) => IMAGE_KEY.test(f.name))
      .sort((x, y) => Number(STRONG_IMAGE_KEY.test(y.name)) - Number(STRONG_IMAGE_KEY.test(x.name)));
    const key = rawKey || candidates[0]?.name || imageOptions[0]?.name || "";
    onChange({
      ...spec,
      table_view: { ...spec.table_view, thumb: on, thumb_key: key },
      binding: { ...b, dimension: null, metric: null, metrics: [], dimensions: fields.filter((name) => name !== key) },
    });
  };

  return (
    <Box sx={{ mt: 1.75, pt: 1.5, borderTop: "1px solid #F1F5FC" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        <Switch
          size="small" checked={!!spec.table_view.thumb}
          onChange={(e) => applyThumb(e.target.checked, spec.table_view.thumb_key ?? "")}
          sx={{ ml: -0.5 }}
        />
        <Typography sx={{ fontSize: 12.5, color: "#334155" }}>缩略图</Typography>
        {spec.table_view.thumb && (
          <TextField select size="small" label="图片字段" value={spec.table_view.thumb_key ?? ""}
            onChange={(e) => applyThumb(true, e.target.value)}
            sx={{ width: 168, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
            {imageOptions.map((f) => (
              <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12 }}>{f.name}</MenuItem>
            ))}
          </TextField>
        )}
      </Box>
    </Box>
  );
}

const AGG = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"];
/** 这些图表必须有维度才能分组出图；只拖了指标时自动补一个「列」，不然画不出来 */
const NEEDS_DIMENSION: ComponentKind[] = [
  "bar", "hbar", "line", "area", "pie", "donut",
  "table", "scatter", "rank_list", "combo", "heatmap", "map",
];
const GRAINS = ["", "hour", "day", "week", "month", "quarter", "year"];
function Slot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.75 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B", mb: 1.25 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

const dash = {
  border: "1px dashed #CBD5E1", borderRadius: 2, px: 1.25, py: 1,
  fontSize: 12, color: "#94A3B8", bgcolor: "#FBFCFE",
} as const;

const OPS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN"];

export default function QueryPanel({
  kind, spec, metricOptions, dimensionOptions, identifierOptions, onChange, payload,
  height, onResize, pages = [], pageDatasets = [],
  components, detailCardKey, onEditDetailCard, onEditDetailPanel, boards,
}: Props) {
  const [newFilter, setNewFilter] = useState<{ column: string; op: string; value: string } | null>(null);
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
          setNewFilter({ column: payload.name, op: "=", value: "" });
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
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <PanelTitle>分节标题</PanelTitle>
        <TextField size="small" fullWidth label="标题" value={spec.title}
          onChange={(e) => onChange({ ...spec, title: e.target.value })}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField size="small" label="编号" value={content.index}
            onChange={(e) => setContent({ index: e.target.value.slice(0, 4) })}
            sx={{ width: 96, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
          <TextField select size="small" label="图标" value={content.icon}
            onChange={(e) => setContent({ icon: e.target.value })}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }}>
            {[["", "默认"], ["grid", "网格"], ["chart", "图表"], ["pie", "饼图"], ["table", "表格"],
              ["cloud", "词云"], ["tag", "标签"], ["bulb", "结论"]].map(([v, t]) => (
              <MenuItem key={v || "none"} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>
            ))}
          </TextField>
        </Box>
        <TextField size="small" fullWidth label="说明" value={spec.subtitle}
          onChange={(e) => onChange({ ...spec, subtitle: e.target.value })}
          sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } }} />
        <Divider sx={{ my: 0.5 }} />
        <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
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
    const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } } as const;
    const tones: [string, string][] = [["slate", "灰"], ["indigo", "靛蓝"], ["sky", "天蓝"], ["teal", "青绿"], ["amber", "琥珀"], ["rose", "玫红"], ["violet", "紫"]];
    const sectionTitle = { fontSize: 11.5, fontWeight: 600, color: "#64748B" } as const;
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column" }}>
        <PanelTitle>导航菜单卡</PanelTitle>

        <PanelSection title="品牌" first>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <TextField size="small" label="品牌名" value={nav.brand}
            onChange={(e) => setNav({ brand: e.target.value })} sx={fieldSx} />
          <TextField size="small" label="强调尾段" value={nav.brand_accent}
            onChange={(e) => setNav({ brand_accent: e.target.value })} sx={fieldSx} />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField select size="small" fullWidth label="品牌标记配色" value={nav.brand_tone || "sky"}
            onChange={(e) => setNav({ brand_tone: e.target.value })} sx={fieldSx}>
            {[["sky", "天蓝"], ["indigo", "靛蓝"], ["teal", "青绿"], ["warm", "暖橙"]].map(([v, t]) => (
              <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>
            ))}
          </TextField>
        </Box>
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
        <Stack spacing={1.75}>
          {nav.items.map((item, index) => (
            <Box key={index} sx={GROUP_CARD_SX}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField size="small" label="标签" value={item.label} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setItem(index, { label: e.target.value })}
                  sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
                {!item.page && (
                  <Box title="未挂页：点击不会跳转"
                    sx={{ width: 6, height: 6, borderRadius: "50%", bgcolor: "#F59E0B", flexShrink: 0 }} />
                )}
                <TextField select size="small" label="圆点" value={item.tone || "slate"} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setItem(index, { tone: e.target.value })}
                  sx={{ width: 84, ...fieldSx }}>
                  {tones.map(([v, t]) => <MenuItem key={v} value={v} sx={{ fontSize: 12.5 }}>{t}</MenuItem>)}
                </TextField>
                <IconButton size="small" sx={{ flexShrink: 0 }}
                  onClick={() => setNav({ items: nav.items.filter((_, i) => i !== index) })}>
                  <Close sx={{ fontSize: 14, color: "#94A3B8" }} />
                </IconButton>
              </Box>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                {/* 挂载目标页：预览时点这一项就跳到该页 */}
                <TextField select size="small" label="跳转页面" value={item.page || ""} InputLabelProps={{ shrink: true }}
                  onChange={(e) => setItem(index, { page: e.target.value })}
                  sx={{ flex: 1, minWidth: 0, ...fieldSx }}>
                  <MenuItem value="" sx={{ fontSize: 12.5 }}>不跳转</MenuItem>
                  {pages.map((page) => (
                    <MenuItem key={page.key} value={page.key} sx={{ fontSize: 12.5 }}>{page.title}</MenuItem>
                  ))}
                </TextField>
                <Box title="打开看板时先展示这一页（只能有一个）"
                  sx={{ display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
                  <Typography sx={{ fontSize: 11.5, color: "#94A3B8" }}>首视页</Typography>
                  <Switch size="small" checked={!!item.active}
                    onChange={(e) => setNav({
                      /* 首视页是「一个」：打开时先落到哪一页，勾一个就取消其余 */
                      items: nav.items.map((it, i) => (
                        i === index ? { ...it, active: e.target.checked } : { ...it, active: false }
                      )),
                    })}
                    sx={{ mr: -0.75 }} />
                </Box>
              </Box>
            </Box>
          ))}
        </Stack>

        {/* 跳转页全展示：菜单的行为，放在菜单项分区末尾 */}
        <Box
          onClick={() => setNav({ global_nav: !nav.global_nav })}
          sx={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            mt: 1.75, pt: 1.5, borderTop: "1px solid #EEF3FB", cursor: "pointer",
            "&:hover .MuiTypography-root": { color: "#4F46E5" },
          }}
        >
          <Typography sx={{ fontSize: 12, color: "#334155" }}>跳转页全展示</Typography>
          <Switch size="small" checked={!!nav.global_nav}
            onChange={(e) => setNav({ global_nav: e.target.checked })}
            onClick={(e) => e.stopPropagation()}
            sx={{ mr: -0.75 }} />
        </Box>

        </PanelSection>

        <PanelSection title="右侧状态">
        <Stack spacing={1.75}>
          <TextField size="small" fullWidth label="灰字状态（如 数据同步 · 时间）" value={nav.meta}
            onChange={(e) => setNav({ meta: e.target.value })} sx={fieldSx} />
          <TextField size="small" fullWidth label="绿色徽标（如 构建 v166）" value={nav.badge}
            onChange={(e) => setNav({ badge: e.target.value })} sx={fieldSx} />
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
        <Stack spacing={1.75}>
          {nav.actions.map((action, index) => (
            <Box key={index} sx={{ ...GROUP_CARD_SX, flexDirection: "row", alignItems: "center", gap: 1 }}>
              <TextField size="small" label="文字" value={action.label} InputLabelProps={{ shrink: true }}
                onChange={(e) => setAction(index, { label: e.target.value })}
                sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
              <TextField select size="small" label="样式" value={action.kind} InputLabelProps={{ shrink: true }}
                onChange={(e) => setAction(index, { kind: e.target.value as "primary" | "secondary" })}
                sx={{ width: 96, ...fieldSx }}>
                <MenuItem value="primary" sx={{ fontSize: 12.5 }}>主按钮</MenuItem>
                <MenuItem value="secondary" sx={{ fontSize: 12.5 }}>次按钮</MenuItem>
              </TextField>
              <IconButton size="small" sx={{ flexShrink: 0 }}
                onClick={() => setNav({ actions: nav.actions.filter((_, i) => i !== index) })}>
                <Close sx={{ fontSize: 14, color: "#94A3B8" }} />
              </IconButton>
            </Box>
          ))}
        </Stack>

        </PanelSection>

        <PanelSection title="导出">
          <TextField select size="small" fullWidth label="导出范围（导出 CSV 用）"
            value={nav.export_scope === "dataset" && nav.export_dataset_id ? `id:${nav.export_dataset_id}` : (nav.export_scope || "primary")}
            InputLabelProps={{ shrink: true }}
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
        </PanelSection>

        <Box sx={{ mt: 3 }}>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
        </Box>
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
    const fieldSx = { "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12.5 } } as const;
    return (
      <Box sx={{ p: 2, display: "flex", flexDirection: "column" }}>
        <PanelTitle>头标卡</PanelTitle>

        <PanelSection title="标题文案" first>
        <Stack spacing={1.75}>
          <TextField size="small" fullWidth label="顶部小字" value={banner.kicker}
            onChange={(e) => setBanner({ kicker: e.target.value })} sx={fieldSx} />
          <TextField size="small" fullWidth label="大标题" value={banner.title}
            onChange={(e) => setBanner({ title: e.target.value })} sx={fieldSx} />
          <TextField size="small" fullWidth label="强调段（渐变）" value={banner.accent}
            onChange={(e) => setBanner({ accent: e.target.value })} sx={fieldSx} />
          <TextField size="small" fullWidth label="副标题" value={banner.subtitle}
            onChange={(e) => setBanner({ subtitle: e.target.value })} sx={fieldSx} />
          {/* 底色：与「指标卡 → 外观」同一套色点交互，7 套主题 */}
          <Box>
            <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.75, letterSpacing: 0.2 }}>底色</Typography>
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", pt: 0.25 }}>
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
          </Box>
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
        <Stack spacing={1.75}>
          {banner.stats.map((stat, index) => {
            const opsOpen = openStatOps === index;
            return (
              <Box key={index} sx={GROUP_CARD_SX}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.25 }}>统计 {index + 1}</Typography>
                  <IconButton size="small" sx={{ mr: -0.5 }}
                    onClick={() => setBanner({ stats: banner.stats.filter((_, i) => i !== index) })}>
                    <Close sx={{ fontSize: 14, color: "#94A3B8" }} />
                  </IconButton>
                </Box>

                {/* 第 1 行：统计字段 + 汇总/数值 */}
                <Box sx={{ display: "flex", gap: 1 }}>
                  <TextField select size="small" label="统计字段" value={stat.metric || ""}
                    InputLabelProps={{ shrink: true }}
                    onChange={(e) => {
                      const name = e.target.value;
                      const picked = statFieldOptions.find((f) => f.name === name);
                      const numeric = picked ? NUMERIC_ROLES.includes(picked.role) : false;
                      setStat(index, numeric
                        ? { metric: name }
                        : { metric: name, agg: "COUNT_DISTINCT" });
                    }}
                    sx={{ flex: 1, minWidth: 0, ...fieldSx }}>
                    <MenuItem value="" sx={{ fontSize: 12.5 }}>静态数值</MenuItem>
                    {statFieldOptions.map((option) => (
                      <MenuItem key={option.name} value={option.name} sx={{ fontSize: 12.5 }}>{option.name}</MenuItem>
                    ))}
                  </TextField>
                  {stat.metric ? (
                    <TextField select size="small" label="汇总" value={stat.agg || "SUM"}
                      InputLabelProps={{ shrink: true }}
                      onChange={(e) => setStat(index, { agg: e.target.value })}
                      sx={{ width: 104, ...fieldSx }}>
                      {["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"].map((agg) => (
                        <MenuItem key={agg} value={agg} sx={{ fontSize: 12.5 }}>{agg}</MenuItem>
                      ))}
                    </TextField>
                  ) : (
                    <TextField size="small" label="数值" value={stat.value}
                      InputLabelProps={{ shrink: true }}
                      onChange={(e) => setStat(index, { value: e.target.value })}
                      sx={{ width: 104, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" }, ...fieldSx }} />
                  )}
                </Box>

                {/* 第 2 行：格式（绑字段才有）/ 单位 / 说明 */}
                <Box sx={{ display: "flex", gap: 1 }}>
                  {stat.metric && (
                    <TextField select size="small" label="格式" value={stat.format || "number"}
                      InputLabelProps={{ shrink: true }}
                      onChange={(e) => setStat(index, { format: e.target.value as BannerStat["format"] })}
                      sx={{ width: 92, ...fieldSx }}>
                      <MenuItem value="number" sx={{ fontSize: 12.5 }}>数值</MenuItem>
                      <MenuItem value="integer" sx={{ fontSize: 12.5 }}>整数</MenuItem>
                      <MenuItem value="percent" sx={{ fontSize: 12.5 }}>百分比</MenuItem>
                      <MenuItem value="currency" sx={{ fontSize: 12.5 }}>金额</MenuItem>
                    </TextField>
                  )}
                  <TextField size="small" label="单位" value={stat.unit} InputLabelProps={{ shrink: true }}
                    onChange={(e) => setStat(index, { unit: e.target.value })}
                    sx={{ width: stat.metric ? 72 : 92, "& input": { textAlign: "center" }, ...fieldSx }} />
                  <TextField size="small" label="说明" value={stat.label} InputLabelProps={{ shrink: true }}
                    onChange={(e) => setStat(index, { label: e.target.value })}
                    sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
                </Box>

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
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <TextField size="small" type="number" label="乘数" value={stat.scale ?? 1}
                            InputLabelProps={{ shrink: true }}
                            onChange={(e) => setStat(index, { scale: Number(e.target.value) })}
                            sx={{ flex: 1, minWidth: 0, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" }, ...fieldSx }} />
                          <TextField size="small" type="number" label="加数" value={stat.offset ?? 0}
                            InputLabelProps={{ shrink: true }}
                            onChange={(e) => setStat(index, { offset: Number(e.target.value) })}
                            sx={{ flex: 1, minWidth: 0, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" }, ...fieldSx }} />
                          <TextField size="small" type="number" label="小数位" value={stat.decimals ?? 0}
                            InputLabelProps={{ shrink: true }}
                            onChange={(e) => setStat(index, { decimals: Math.max(0, Math.min(4, Number(e.target.value))) })}
                            inputProps={{ min: 0, max: 4 }}
                            sx={{ flex: 1, minWidth: 0, "& input": { textAlign: "right", fontVariantNumeric: "tabular-nums" }, ...fieldSx }} />
                        </Box>
                        <Box sx={{ display: "flex", gap: 1 }}>
                          <TextField size="small" label="前缀" value={stat.prefix ?? ""} InputLabelProps={{ shrink: true }}
                            onChange={(e) => setStat(index, { prefix: e.target.value.slice(0, 4) })}
                            sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
                          <TextField size="small" label="后缀" value={stat.suffix ?? ""} InputLabelProps={{ shrink: true }}
                            onChange={(e) => setStat(index, { suffix: e.target.value.slice(0, 4) })}
                            sx={{ flex: 1, minWidth: 0, ...fieldSx }} />
                        </Box>
                      </>
                    )}
                  </>
                )}
              </Box>
            );
          })}
        </Stack>
        </PanelSection>

        <Box sx={{ mt: 3 }}>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
        </Box>
      </Box>
    );
  }

  const extraMetrics = (b.metrics || []).filter(
    (m): m is { name: string; agg?: string } => typeof m === "object" && m !== null && "name" in m,
  );

  // 滚动交给外层中栏统一处理：这里再来一层会出现两条滚动条
  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box sx={{ p: 2 }}>
        <PanelTitle>{KIND_LABEL[kind] || "组件"}</PanelTitle>
        <DataCheckPanel
          payload={payload ?? null}
          dimension={b.dimension}
          metric={b.metric}
          agg={b.agg}
          expression={b.agg_expression}
          transform={spec.compute?.transform}
          kind={kind}
          fields={kind === "table" ? tableFields : undefined}
          dimensionLabel={axis.dimensionHint || axis.dimension}
          metricLabel={axis.metricHint || axis.metric}
        />

        {kind === "table" ? (
          <TableFieldsEditor
            spec={spec} onChange={onChange}
            metricOptions={metricOptions} dimensionOptions={dimensionOptions}
            identifierOptions={identifierOptions ?? []}
          />
        ) : (
          <>
        {/* 散点：X / Y 都是数值指标，每个点是一行样本（X 写 chart.x_key，Y 是 aggregate 指标） */}
        {kind === "scatter" && (
          <PanelSection title="数值">
            <Stack spacing={1.75}>
              <TextField select size="small" label="横轴（数值）" value={spec.chart?.x_key || ""}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => onChange({ ...spec, chart: { ...spec.chart, x_key: e.target.value } })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>取纵轴指标</MenuItem>
                {metricOptions.map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="气泡大小" value={spec.chart?.size_key || ""}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => {
                  const value = e.target.value;
                  const mode = spec.chart?.scatter_mode ?? "point";
                  /* 选了气泡字段就自动切到气泡模式；清空则从气泡退回点（避免「填了没反应」） */
                  const nextMode = value ? "bubble" : (mode === "bubble" ? "point" : mode);
                  onChange({ ...spec, chart: { ...spec.chart, size_key: value, scatter_mode: nextMode } });
                }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不用</MenuItem>
                {metricOptions.map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
              </TextField>
            </Stack>
          </PanelSection>
        )}

        {/* 指标卡/结论卡/分节标题没有维度概念；已绑过维度的留一行可移除，不显示拖拽区 */}
        {needsDimension ? (
          <Slot label={axis.dimension}>
            <Box data-drop="dimension" {...dropZone("dimension")} sx={{ ...zoneSx("dimension"), p: 0.25 }}>
            {b.dimension ? (
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1 }}>
                <TextField select size="small" value={b.dimension}
                  onChange={(e) => patch("dimension", e.target.value)}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                  {dimensionOptions.map((f) => (
                    <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                  ))}
                </TextField>
                {dimensionFieldIsTime && (
                <TextField select size="small" label="粒度" value={(b as { grain?: string }).grain ?? ""}
                  onChange={(e) => patch("grain", e.target.value || null)}
                  sx={{ width: 96, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                  {GRAINS.map((g) => (
                    <MenuItem key={g || "none"} value={g} sx={{ fontSize: 12.5 }}>{g || "原始"}</MenuItem>
                  ))}
                </TextField>
                )}
                <IconButton size="small" onClick={() => patch("dimension", null)}>
                  <Close sx={{ fontSize: 15 }} />
                </IconButton>
              </Box>
            ) : (
              <Box sx={dash}>把左侧「列」拖到这里（或点击）</Box>
            )}
            </Box>

            {kind === "heatmap" && (
              <TextField select size="small" fullWidth label="列（矩阵列）" value={b.series ?? ""}
                onChange={(e) => patch("series", e.target.value || null)}
                sx={{ mt: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不设置</MenuItem>
                {dimensionOptions.map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
              </TextField>
            )}
          </Slot>
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

        <Slot label={axis.metric}>
          <Box data-drop="metric" {...dropZone("metric")} sx={{ ...zoneSx("metric"), p: 0.25 }}>
          {b.metric ? (
            <Box sx={{ display: "flex", flexWrap: "nowrap", gap: 1, alignItems: "center", mb: 1 }}>
              <TextField select size="small" value={b.metric}
                onChange={(e) => patch("metric", e.target.value)}
                sx={{ flex: "1 1 auto", minWidth: b.agg === "CUSTOM" ? 80 : 92, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                {metricOptions.map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
                {b.metric && !metricOptions.some((f) => f.name === b.metric) && (
                  <MenuItem value={b.metric} sx={{ fontSize: 12.5 }}>{b.metric}</MenuItem>
                )}
              </TextField>
              <TextField select size="small" label="聚合" value={b.agg}
                onChange={(e) => onChange({ ...spec, binding: {
                  ...b, agg: e.target.value,
                  ...(e.target.value === "CUSTOM" && !b.agg_expression
                    ? { agg_expression: `SUM("${b.metric?.replace(/"/g, '""')}")` } : {}),
                } })}
                sx={{ width: b.agg === "CUSTOM" ? 120 : 96, flexShrink: 0, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                {AGG.map((a) => (
                  <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>
                ))}
                <MenuItem value="CUSTOM" sx={{ fontSize: 12.5 }}>自定义 SQL</MenuItem>
              </TextField>
              <IconButton size="small" sx={{ flexShrink: 0 }} onClick={() => patch("metric", null)}>
                <Close sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          ) : (
            <Box sx={dash}>把左侧「指标」拖到这里（或点击）</Box>
          )}
          </Box>

          {b.metric && b.agg === "CUSTOM" && (
            <TextField size="small" fullWidth multiline minRows={3} label="聚合表达式"
              value={b.agg_expression ?? ""}
              onChange={(e) => patch("agg_expression", e.target.value)}
              error={Boolean(payload?.error)}
              helperText={payload?.error || '使用数据集字段名，例如 MEDIAN("销售额")；无需 SELECT / FROM，随当前筛选和分组计算。'}
              inputProps={{ maxLength: 4000, spellCheck: false }}
              sx={{ mt: 1, "& .MuiInputBase-input": { fontFamily: "monospace", fontSize: 12.5 } }} />
          )}

          {kind === "wordcloud" && (
            <Slot label="颜色（分类）">
              <TextField select size="small" fullWidth value={b.series ?? ""}
                onChange={(e) => patch("series", e.target.value || null)}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不用</MenuItem>
                {dimensionOptions.map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
              </TextField>
            </Slot>
          )}

          {kind === "wordcloud" && (
            /* 拆词：一格里有「颗粒碎末多 / 分量不足」这种多词时，按分隔符拆成一个个词（空 = 不拆） */
            <Slot label="拆词">
              <TextField size="small" fullWidth placeholder="分隔符，如 /（留空 = 不拆）"
                value={splitDraft}
                onChange={(e) => setSplitDraft(e.target.value)}
                onBlur={() => commitSplit()}
                onKeyDown={(e) => { if (e.key === "Enter") commitSplit(); }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }} />
            </Slot>
          )}

          {kind === "combo" && (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center", mt: 2 }}>
              <TextField select size="small" label="右轴（线）" value={(b.metrics?.[0] as { name?: string } | undefined)?.name ?? ""}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => patch("metrics", e.target.value ? [{ name: e.target.value, agg: (b.metrics?.[0] as { agg?: string } | undefined)?.agg ?? "SUM" }] : [])}
                sx={{ flex: 1, minWidth: 0, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                <MenuItem value="" sx={{ fontSize: 12.5 }}>不画线</MenuItem>
                {metricOptions.filter((f) => f.name !== b.metric).map((f) => (
                  <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12.5 }}>{f.name}</MenuItem>
                ))}
              </TextField>
              <TextField select size="small" label="聚合" value={(b.metrics?.[0] as { agg?: string } | undefined)?.agg ?? "SUM"}
                InputLabelProps={{ shrink: true }}
                onChange={(e) => {
                  const current = (b.metrics?.[0] as { name?: string } | undefined)?.name;
                  if (!current) return;
                  patch("metrics", [{ name: current, agg: e.target.value }]);
                }}
                sx={{ width: 110, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                {AGG.map((a) => (
                  <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>
                ))}
              </TextField>
            </Box>
          )}

          {["table"].includes(kind) && extraMetrics.map((m, index) => (
            <Stack key={`${m.name}-${index}`} direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <TextField size="small" value={m.name} disabled sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }} />
              <TextField select size="small" value={m.agg ?? "MAX"}
                onChange={(e) => {
                  const next = [...(b.metrics || [])];
                  next[index] = { name: m.name, agg: e.target.value };
                  patch("metrics", next);
                }}
                sx={{ width: 110, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                {AGG.map((a) => <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>)}
              </TextField>
              <IconButton size="small" onClick={() => patch("metrics", (b.metrics || []).filter((_, i) => i !== index))}>
                <Close sx={{ fontSize: 15 }} />
              </IconButton>
            </Stack>
          ))}
          {["table"].includes(kind) && (
          <Box
            onClick={() => {
              const candidate = metricOptions.find((f) => f.name !== b.metric && !extraMetrics.some((m) => m.name === f.name));
              if (candidate) patch("metrics", [...(b.metrics || []), { name: candidate.name, agg: "MAX" }]);
            }}
            sx={{ ...dash, cursor: "pointer", mt: 0.5, "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" } }}
          >
            ＋ 添加附加指标
          </Box>
          )}
        </Slot>
          </>
        )}

        {kind === "scatter" && (
          <PanelSection title="附加">
            <Stack spacing={1.5}>
              {extraMetrics.map((m, index) => (
                <Stack key={`${m.name}-${index}`} direction="row" spacing={1} alignItems="center">
                  <TextField size="small" value={m.name} disabled
                    sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }} />
                  <TextField select size="small" value={m.agg ?? "MAX"}
                    onChange={(e) => {
                      const next = [...(b.metrics || [])];
                      next[index] = { name: m.name, agg: e.target.value };
                      patch("metrics", next);
                    }}
                    sx={{ width: 110, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
                    {AGG.map((a) => <MenuItem key={a} value={a} sx={{ fontSize: 12.5 }}>{a}</MenuItem>)}
                  </TextField>
                  <IconButton size="small" onClick={() => patch("metrics", (b.metrics || []).filter((_, i) => i !== index))}>
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
        )}

        <PanelSection title="计算">
        <Slot label="过滤">
          {(b.filters || []).map((f, i) => (
            <Stack key={i} direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
              <TextField size="small" value={f.column} disabled
                sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }} />
              <TextField size="small" value={f.op} disabled
                sx={{ width: 72, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }} />
              <TextField size="small" value={String(f.value ?? "")} disabled
                sx={{ width: 96, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }} />
              <IconButton size="small"
                onClick={() => patch("filters", (b.filters || []).filter((_, k) => k !== i))}>
                <Close sx={{ fontSize: 15 }} />
              </IconButton>
            </Stack>
          ))}

          {newFilter ? (
            <Stack spacing={0.75} sx={{ border: "1px solid #E5EAF3", borderRadius: 2, p: 1 }}>
              <Stack direction="row" spacing={0.75}>
                <TextField select size="small" label="字段" value={newFilter.column}
                  onChange={(e) => setNewFilter({ ...newFilter, column: e.target.value })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }}>
                  {[...dimensionOptions, ...metricOptions].map((f) => (
                    <MenuItem key={f.name} value={f.name} sx={{ fontSize: 12 }}>{f.name}</MenuItem>
                  ))}
                </TextField>
                <TextField select size="small" label="条件" value={newFilter.op}
                  onChange={(e) => setNewFilter({ ...newFilter, op: e.target.value })}
                  sx={{ width: 84, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }}>
                  {OPS.map((op) => <MenuItem key={op} value={op} sx={{ fontSize: 12 }}>{op}</MenuItem>)}
                </TextField>
              </Stack>
              <Stack direction="row" spacing={0.75}>
                <TextField size="small" label="值" value={newFilter.value}
                  onChange={(e) => setNewFilter({ ...newFilter, value: e.target.value })}
                  sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12 } }} />
                <Button size="small" variant="contained"
                  disabled={!newFilter.column || newFilter.value === ""}
                  onClick={() => {
                    patch("filters", [...(b.filters || []), {
                      column: newFilter.column, op: newFilter.op, value: newFilter.value,
                    }]);
                    setNewFilter(null);
                  }}
                  sx={{ bgcolor: "#4F46E5", textTransform: "none", fontSize: 12, borderRadius: 2 }}>
                  添加
                </Button>
                <Button size="small" onClick={() => setNewFilter(null)}
                  sx={{ textTransform: "none", fontSize: 12 }}>
                  取消
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Box
              data-drop="filter"
              {...dropZone("filter")}
              onClick={() => setNewFilter({ column: dimensionOptions[0]?.name ?? "", op: "=", value: "" })}
              sx={{
                ...dash, ...zoneSx("filter"), cursor: "pointer",
                "&:hover": { borderColor: "#A5B4FC", color: "#6366F1" },
              }}
            >
              把字段拖到这里过滤（或点击添加）
            </Box>
          )}
        </Slot>

        <Stack direction="row" spacing={1.25} sx={{ mt: 1.75 }}>
          {!["kpi", "insight"].includes(kind) && (
          <TextField size="small" type="number" label="行限制" value={b.top_n}
            onChange={(e) => patch("top_n", Number(e.target.value))}
            sx={{ width: 104, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }} />
          )}
          {kind !== "table" && !["kpi", "insight"].includes(kind) && (
          <TextField select size="small" label="排序" value={b.sort}
            onChange={(e) => patch("sort", e.target.value)}
            sx={{ width: 104, "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 12.5 } }}>
            <MenuItem value="desc" sx={{ fontSize: 12.5 }}>降序</MenuItem>
            <MenuItem value="asc" sx={{ fontSize: 12.5 }}>升序</MenuItem>
          </TextField>
          )}
        </Stack>

        <ComputeFields kind={kind} spec={spec} onChange={onChange} />
        </PanelSection>

        <Box sx={{ mt: 3 }}>
          <StylePanel kind={kind} spec={spec} onChange={onChange} height={height} onResize={onResize} />
        </Box>

        <Divider sx={{ my: 1.75 }} />

        <ChartOptionsPanel kind={kind} spec={spec} onChange={onChange} />

        {kind === "table" && (
          <>
            <TableThumbSettings
              spec={spec} onChange={onChange}
              dimensionOptions={dimensionOptions ?? []}
              identifierOptions={identifierOptions ?? []}
            />
            <TableDetailSettings
              spec={spec} onChange={onChange}
              columns={(spec.binding.dimensions ?? []).filter((name) => name !== spec.table_view?.thumb_key)}
              boards={boards}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
