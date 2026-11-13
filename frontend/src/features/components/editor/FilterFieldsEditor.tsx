/** 筛选字段编辑器 —— 画布中栏与组件库编辑页共用（参数：名称 / 控件 / 选项 / 默认值 / 宽度）
 *  绑定数据列（column）不在面板里出现：那个输入框 + 快捷填入 + 拖入区太占地方，用户要更简洁的配置
 *  （2026-11-13）。老文档里已经写好的 column 数据照旧生效，只是不再提供编辑入口。 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Menu, MenuItem, Stack, Switch, TextField, Typography } from "@mui/material";
import { Add, Close, DeleteOutline, ExpandMore, KeyboardArrowDown } from "@mui/icons-material";
import client from "../../../api/client";
import type { FilterFieldSpec } from "../types";
import { isSplitField } from "../split";
import { PanelSection } from "./PanelSection";

const COLUMN_OPS = ["=", "!=", ">", "<", ">=", "<=", "LIKE", "IN"];

function Hint({ text }: { text: string }) {
  return (
    <Box sx={{ p: 2 }}>
      <Typography sx={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.7 }}>{text}</Typography>
    </Box>
  );
}

interface Props {
  fields: FilterFieldSpec[];
  /** 画布里当前选中的平台：给了就锁定为该平台那一套（平台入口仍共用） */
  platform?: string;
  /** 按平台各配一套字段：{拼多多: [字段…]}（平台入口本身不在这里） */
  fieldsMap?: Record<string, FilterFieldSpec[]>;
  /** 数据集列名（保留参数：面板已不再展示快捷填入 / 拖入绑定）；组件库里没有数据集时传空数组 */
  columns: string[];
  datasetId: number | null;
  onChange: (fields: FilterFieldSpec[]) => void;
  onFieldsMapChange?: (map: Record<string, FilterFieldSpec[]>) => void;
  /** 底部背景（白底圆角卡片）：给了回调才显示开关（组件库编辑页不显示） */
  background?: boolean;
  onBackgroundChange?: (next: boolean) => void;
  /** 字段全删完 = 这个筛选栏空了：交给外层把组件一起删掉（组件库不传，保留空模板） */
  onEmpty?: () => void;
}

/** 映射行的平台名输入：打字时只改本地草稿，失焦/回车才提交 ——
 *  否则删空最后一个字就会把整行从映射里摘掉，输入框跟着消失。 */
function NameField({ value, onCommit }: { value: string; onCommit: (next: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <TextField size="small" value={draft} placeholder="平台名"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (!next || next === value) { setDraft(value); return; }   // 空着不动 = 保持原名
        onCommit(next);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      sx={{ width: 86, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
  );
}

/** 选项行：只读展示 —— 选项值来自数据库，不能在这里新增 / 改名；只留一个删除（不想显示的直接去掉） */
function OptionRow({ option, onDelete }: {
  option: { v: string; t: string };
  onDelete: () => void;
}) {
  return (
    <Box sx={{
      display: "flex", alignItems: "center", gap: 0.75, px: 0.75, minHeight: 30,
      "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
      "&:hover .opt-del": { opacity: 1 },
    }}>
      <Typography sx={{
        flex: 1, minWidth: 0, fontSize: 12, color: "#334155",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {option.t}
      </Typography>
      {/* 值和显示名不同（如 all → 全部品类）时把真实值标出来 */}
      {option.v !== option.t && (
        <Typography sx={{ flexShrink: 0, fontSize: 10.5, color: "#B6C2D2" }}>{option.v}</Typography>
      )}
      <IconButton size="small" className="opt-del" onClick={onDelete} aria-label="删除选项"
        title="删除这个选项"
        sx={{ opacity: 0.45, transition: "opacity .12s", p: 0.25 }}>
        <Close sx={{ fontSize: 13, color: "#94A3B8", "&:hover": { color: "#DC2626" } }} />
      </IconButton>
    </Box>
  );
}

/** 头标色块：按字段顺序轮流取，一眼能分出是哪一组 */
const CARD_ACCENTS = ["#4F46E5", "#2563EB", "#0D9488", "#7C3AED", "#DB2777"];

const PLATFORM_HINTS = ["拼多多", "天猫", "抖音", "京东", "快手", "淘宝"];

/** 选表后顺手猜平台名（榜单端-拼多多 → 拼多多），猜不出就用表名 */
function guessPlatform(tableName: string) {
  return PLATFORM_HINTS.find((hint) => tableName.includes(hint)) || tableName;
}

/** 「切换数据集」：平台名 → 数据集。字段卡里用，平台作用域顶部也用它（改的永远是通用那份） */
function PlatformMap({ field, datasets, onChange }: {
  field: FilterFieldSpec;
  datasets: { id: number; name: string }[];
  onChange: (map: Record<string, number>, nextDefault: string) => void;
}) {
  const entries = Object.entries(field.dataset_map || {}) as [string, number][];

  const commit = (next: [string, number][]) => {
    const map: Record<string, number> = {};
    next.forEach(([key, id]) => {
      const name = key.trim();
      if (name && id) map[name] = id;
    });
    const keys = Object.keys(map);
    const keep = keys.includes(String(field.default ?? "")) ? field.default : (keys[0] ?? "");
    onChange(map, String(keep ?? ""));
  };

  /** 取个不重名的平台名 */
  const uniqueName = (base: string, skip: number) => {
    const taken = new Set(entries.filter((_, i) => i !== skip).map(([n]) => n));
    let name = base;
    let suffix = 2;
    while (taken.has(name)) { name = `${base}${suffix}`; suffix += 1; }
    return name;
  };

  const addRow = () => {
    const used = Object.values(field.dataset_map || {});
    const spare = datasets.filter((d) => !used.includes(d.id));
    /* 优先挑名字里带平台的表（榜单端-拼多多 / 榜单端-天猫），别默认塞一张演示表 */
    const free = spare.find((d) => PLATFORM_HINTS.some((hint) => d.name.includes(hint))) ?? spare[0];
    if (!free) return;
    /* 平台名已经有一行 → 不要「拼多多2」这种假平台，直接拿表名当这一行的标识 */
    const guessed = guessPlatform(free.name);
    const taken = entries.some(([name]) => name === guessed);
    commit([...entries, [uniqueName(taken ? free.name : guessed, -1), free.id]]);
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 0.5 }}>
        <Typography sx={{ fontSize: 11, color: "#94A3B8" }}>切换数据集</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<Add sx={{ fontSize: 14 }} />}
          onClick={addRow}
          sx={{ textTransform: "none", minWidth: 0, mb: 0.25, fontSize: 11.5, px: 1 }}>
          添加平台
        </Button>
      </Box>
      {entries.map(([name, datasetId], rowIndex) => (
        <Box key={rowIndex} sx={{ display: "flex", gap: 0.75, alignItems: "center", mb: 0.75 }}>
          <NameField value={name}
            onCommit={(next) => commit(entries.map((entry, i) => (i === rowIndex
              ? [uniqueName(next, rowIndex), entry[1]] : entry)) as [string, number][])} />
          <TextField select size="small" value={datasetId}
            onChange={(e) => {
              const nextId = Number(e.target.value);
              const oldName = datasets.find((d) => d.id === datasetId)?.name || "";
              const nextName = datasets.find((d) => d.id === nextId)?.name || "";
              // 名字还是自动猜的（没手改过）→ 换表时跟着改名，省一次手动输入
              const autoNamed = name === guessPlatform(oldName) || name === oldName;
              const guessedNext = guessPlatform(nextName);
              const collide = entries.some(([n], i) => i !== rowIndex && n === guessedNext);
              const nextLabel = autoNamed
                ? uniqueName(collide ? nextName : guessedNext, rowIndex)
                : name;
              commit(entries.map((entry, i) => (i === rowIndex ? [nextLabel, nextId] : entry)) as [string, number][]);
            }}
            sx={{ flex: 1, "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
            {datasetId && !datasets.some((d) => d.id === datasetId) && (
              <MenuItem value={datasetId} sx={{ fontSize: 12 }}>数据集 {datasetId}（不可用）</MenuItem>
            )}
            {datasets.map((dataset) => (
              <MenuItem key={dataset.id} value={dataset.id} sx={{ fontSize: 12 }}>{dataset.name}</MenuItem>
            ))}
          </TextField>
          <IconButton size="small" sx={{ flexShrink: 0 }}
            onClick={() => commit(entries.filter((_, i) => i !== rowIndex))}>
            <Close sx={{ fontSize: 15, color: "#94A3B8" }} />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

/** 筛选字段编辑器 —— 画布中栏与组件库编辑页共用同一套参数（名称/控件/选项/默认值/宽度） */
export default function FilterFieldsEditor({ fields, platform, fieldsMap, columns, datasetId, onChange, onFieldsMapChange, background, onBackgroundChange, onEmpty }: Props) {
  /** 正在编辑哪一套字段："" = 通用，其它 = 该平台自己那套 */
  const [scope, setScope] = useState("");
  const map = fieldsMap ?? {};
  /** 正在编辑的这一套：平台没单独配过 → 先用通用那份（筛选栏就是这么渲染的，面板必须一致）；
   *  配过（哪怕是空数组）就以它为准。 */
  const fieldsSafe = scope ? (map[scope] ?? fields ?? []) : (fields ?? []);

  /** 分套依据字段（「平台」这种）：它只存在通用那份，但筛选栏上永远显示它 */
  const splitField = useMemo(() => (fields ?? []).find(isSplitField), [fields]);
  /** 面板里渲染的字段：平台作用域下把分套依据那张卡也放进来 ——
   *  否则筛选栏上的「平台」在面板里既看不见也删不掉（它不在平台专套里）。改它 = 改通用那份。 */
  const panelFields = useMemo(() => {
    if (!scope || !splitField) return fieldsSafe;
    return [splitField, ...fieldsSafe.filter((field) => field.id !== splitField.id)];
  }, [scope, splitField, fieldsSafe]);
  /** 这张卡是不是通用那份（平台作用域里的分套依据卡） */
  const isGlobalCard = (field: FilterFieldSpec) => !!scope && !!splitField && field.id === splitField.id;
  /** index → 候选值个数（-1 = 拉取失败） */
  const [optionCount, setOptionCount] = useState<Record<number, number>>({});
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  /** 待确认删除的分套依据字段（删掉 = 这一页不再按它分套） */
  const [confirmField, setConfirmField] = useState<FilterFieldSpec | null>(null);
  /** 作用域胶囊的下拉（通用 / 只给这个平台单独一套） */
  const [scopeMenu, setScopeMenu] = useState<HTMLElement | null>(null);
  /** 正在往哪张卡的「拖入框」上拖字段 */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** 哪些字段的「选项」列表是展开的（默认折叠：库里一列十几个值，摊开会把面板撑很长） */
  const [openOptions, setOpenOptions] = useState<Record<string, boolean>>({});
  /** 哪几张字段卡片被折叠了（只留头标，默认都不折） */
  const [foldedCards, setFoldedCards] = useState<Record<string, boolean>>({});
  /** 拖动头标换顺序：正在拖哪一组 / 落点提示（index = 插到这张卡之前、after = 插到它之后） */
  const [dragCard, setDragCard] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{ index: number; after: boolean } | null>(null);
  /** 点「拖入框」弹出的可选列（左栏字段名） */
  const [columnMenu, setColumnMenu] = useState<{ el: HTMLElement; index: number } | null>(null);
  /** 选项列表容器（加完一条要滚到底才看得见） */
  const optionListRefs = useRef<Record<number, HTMLDivElement | null>>({});

  /** 通用那份一个字段都不剩 → 让画布把整个筛选栏删掉，别留个空框。
   *  分套依据只存在通用那份：通用空了就没有平台入口，专套里剩下的也永远看不到，等于废数据。
   *  （组件库里不传 onEmpty，保留空模板） */
  const reportEmpty = (nextCommon: FilterFieldSpec[]) => {
    if (!onEmpty) return;
    if ((nextCommon ?? []).length) return;
    onEmpty();
  };

  /** 写回：通用 → 直接改字段数组；某个平台 → 写进该平台那一套 */
  const commit = (nextFields: FilterFieldSpec[]) => {
    if (!scope) {
      onChange(nextFields);
      reportEmpty(nextFields);
      return;
    }
    onFieldsMapChange?.({ ...map, [scope]: nextFields });
    reportEmpty(fields ?? []);
  };

  /** 数据集切换器字段（平台入口）：映射只在「通用」里定义一处 */
  const switcherField = useMemo(
    () => (fields ?? []).find((f) => f.dataset_map && Object.keys(f.dataset_map).length),
    [fields],
  );
  /** 平台清单 = 切换器的选项（拼多多 / 天猫 …） */
  const platformKeys = useMemo(
    () => (switcherField ? Object.keys(switcherField.dataset_map || {}) : []),
    [switcherField],
  );
  /** 有没有「平台专套」：数据集映射的键，或者已经配过分平台那份（fields_map 的键）。
   *  画布上要据此标出「你正在改的是哪一套」，否则删完通用那份还在，看着像没生效。 */
  const platformScopeKeys = useMemo(() => {
    const keys = new Set<string>(platformKeys);
    Object.keys(fieldsMap ?? {}).forEach((key) => keys.add(key));
    return [...keys];
  }, [platformKeys, fieldsMap]);

  /** 切到某个平台：已经有它自己那套就用那套，没有就先沿用通用那份（**不偷偷复制**：
   *  以前一打开面板就在后台分叉，结果面板改的和筛选栏显示的不是同一套）。
   *  已有那份里若混进了「平台入口」这种切换字段（早前误加），顺手清掉（入口只在通用里定义）。 */
  const pickScope = (next: string) => {
    setScope(next);
    if (!next || !onFieldsMapChange) return;
    const existing = map[next];
    if (!existing) return;
    const cleaned = existing.filter((f) => !(f.dataset_map && Object.keys(f.dataset_map).length));
    if (cleaned.length !== existing.length) onFieldsMapChange({ ...map, [next]: cleaned });
  };

  /** 显式给某个平台单独配一套（用户点了才复制）：从通用那份拷一份当起点 */
  const forkScope = (name: string) => {
    if (!name) { pickScope(""); return; }
    if (map[name]) { pickScope(name); return; }
    if (!onFieldsMapChange) return;
    const seed = (fields ?? []).filter((f) => !(f.dataset_map && Object.keys(f.dataset_map).length));
    onFieldsMapChange({ ...map, [name]: seed });
    setScope(name);
  };

  /** 画布切了平台：这个平台有自己那套才跟过去；没有就停在通用那份（别再自动复制一套） */
  useEffect(() => {
    if (platform === undefined) return;
    if (platform === scope) return;
    if (platform && map[platform]) { pickScope(platform); return; }
    if (scope) setScope("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  /** 可选数据集（切换器要挑表）：进面板拉一次 */
  const [datasets, setDatasets] = useState<{ id: number; name: string }[]>([]);
  useEffect(() => {
    client.get("/bi/semantic/datasets")
      .then((res) => setDatasets(res.data?.datasets || []))
      .catch(() => {});
  }, []);

  /** 还有没有「没用过的数据集」可以挂成新平台 */
  const canAddPlatform = useMemo(() => {
    const switcher = (fields ?? []).find((f) => f.dataset_map && Object.keys(f.dataset_map).length);
    if (!switcher) return false;
    const used = Object.values(switcher.dataset_map || {});
    return datasets.some((d) => !used.includes(d.id));
  }, [fields, datasets]);

  /** 新增平台 = 给「平台」字段的切换表加一行（表优先挑还没用过的、名字带平台的），并切到它 */
  const addPlatform = () => {
    const index = (fields ?? []).findIndex((f) => f.dataset_map && Object.keys(f.dataset_map).length);
    if (index < 0) return;
    const switcher = fields![index];
    const used = Object.values(switcher.dataset_map || {});
    const spare = datasets.filter((d) => !used.includes(d.id));
    const free = spare.find((d) => PLATFORM_HINTS.some((hint) => d.name.includes(hint))) ?? spare[0];
    if (!free) return;
    let name = guessPlatform(free.name);
    const taken = new Set(Object.keys(switcher.dataset_map || {}));
    let suffix = 2;
    while (taken.has(name)) { name = `${guessPlatform(free.name)}${suffix}`; suffix += 1; }
    onChange((fields ?? []).map((f, i) => (i === index
      ? { ...f, dataset_map: { ...(f.dataset_map || {}), [name]: free.id } }
      : f)));
    pickScope(name);
  };

  /** 改某个字段：平台作用域里的分套依据卡写回通用那份，其余写当前这套 */
  const patchField = (index: number, patch: Record<string, unknown>) => {
    const target = panelFields[index];
    if (!target) return;
    const next = { ...target, ...patch };
    if (isGlobalCard(target)) {
      onChange((fields ?? []).map((field) => (field.id === target.id ? next : field)));
      return;
    }
    const own = scope ? (map[scope] ?? fields ?? []) : (fields ?? []);
    commit(own.map((field) => (field.id === target.id ? next : field)));
  };

  /** 拖动头标换顺序：把第 from 组插到 slot 位置（slot = 字段个数 = 排到最后）；
   *  筛选栏上的左右顺序就是这个顺序 */
  const moveField = (from: number, slot: number) => {
    if (from < 0 || slot < 0) return;
    if (from === slot || from === slot - 1) return;      // 原地放回，不动
    const next = [...panelFields];
    const moved = next[from];
    if (!moved) return;
    next.splice(from, 1);
    next.splice(from < slot ? slot - 1 : slot, 0, moved);
    if (scope) {
      /* 平台作用域里第一张是通用的分套依据卡，不参与这一套的排序 */
      commit(next.filter((field) => !(splitField && field.id === splitField.id)));
      return;
    }
    onChange(next);
  };

  /** 拖到面板上下边缘时自动滚动，长列表里也能一路拖到底 */
  const autoScrollOnDrag = (target: HTMLElement, clientY: number) => {
    let el: HTMLElement | null = target;
    while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const edge = 56;
    if (clientY < rect.top + edge) el.scrollTop -= 14;
    else if (clientY > rect.bottom - edge) el.scrollTop += 14;
  };

  /** 删字段：分套依据要先确认（删掉后这一页就不再按它分套了） */
  const removeField = (index: number) => {
    const target = panelFields[index];
    if (!target) return;
    if (isSplitField(target)) { setConfirmField(target); return; }
    if (isGlobalCard(target)) {
      const remaining = (fields ?? []).filter((field) => field.id !== target.id);
      onChange(remaining);
      reportEmpty(remaining);
      return;
    }
    const own = scope ? (map[scope] ?? fields ?? []) : (fields ?? []);
    commit(own.filter((field) => field.id !== target.id));
  };

  /** 确认删除分套依据后真的删 */
  const deleteSplitField = () => {
    const target = confirmField;
    setConfirmField(null);
    if (!target) return;
    if ((fields ?? []).some((field) => field.id === target.id)) {
      const remaining = (fields ?? []).filter((field) => field.id !== target.id);
      onChange(remaining);
      reportEmpty(remaining);
      return;
    }
    commit(fieldsSafe.filter((field) => field.id !== target.id));
  };

  /** 勾/取消「分套依据」：只能有一个，勾上时把别的字段的分套标记与映射一并清掉 */
  const setSplit = (index: number, on: boolean) => {
    const target = panelFields[index];
    if (!target) return;
    const base = isGlobalCard(target) ? (fields ?? []) : fieldsSafe;
    const next = base.map((field) => (field.id === target.id
      ? { ...field, ...(on ? { split: true } : { split: false, dataset_map: {} }) }
      : (on ? { ...field, split: false, dataset_map: {} } : field)));
    if (isGlobalCard(target)) onChange(next); else commit(next);
  };

  const updateField = patchField;

  /** 绑定列 → 自动取该列的真实候选值；名字/参数 id 顺手从默认名改成列名 */
  const bindColumn = async (index: number, rawColumn: string, extra: Record<string, unknown> = {}) => {
    const field = panelFields[index];
    if (!field) return;
    const column = rawColumn.trim();
    const type = String(extra.type ?? field.type ?? "select");
    const defaultLabel = !field.label || field.label === "新字段" || field.label === "搜索"
      || field.label === (field.column ?? "");
    const patch: Record<string, unknown> = {
      ...extra,
      column,
      ...(defaultLabel && column ? { label: column } : {}),
      ...(column && /^(f_\d+|keyword)$/.test(field.id) ? { id: column } : {}),
    };
    if (!column || type === "search" || type === "date" || !datasetId) {
      updateField(index, patch);
      return;
    }
    setLoadingIndex(index);
    try {
      const res = await client.post(`/bi/semantic/datasets/${datasetId}/query`, {
        dimensions: [column], limit: 1000,
      });
      const rows: Record<string, unknown>[] = res.data?.rows || [];
      const seen = new Set<string>();
      rows.forEach((row) => {
        const value = row[column];
        if (value === null || value === undefined || value === "") return;
        seen.add(String(value));
      });
      const options = [...seen]
        .sort((a, b) => a.localeCompare(b, "zh-CN"))
        .slice(0, 200)
        .map((value) => ({ v: value, t: value }));
      updateField(index, { ...patch, options, default: options.some((o) => o.v === String(field.default)) ? field.default : "" });
      setOptionCount((prev) => ({ ...prev, [index]: options.length }));
    } catch {
      updateField(index, patch);
      setOptionCount((prev) => ({ ...prev, [index]: -1 }));
    } finally {
      setLoadingIndex(null);
    }
  };

  const label = (text: string) => (
    <Typography sx={{ fontSize: 11, color: "#94A3B8", mb: 0.5 }}>{text}</Typography>
  );

  /** 删一个选项：连带删它的区间档位；正被当默认值就清空默认值 */
  const removeOption = (index: number, optionIndex: number) => {
    const field = panelFields[index];
    const option = field?.options?.[optionIndex];
    if (!field || !option) return;
    const ranges = { ...(field.ranges || {}) };
    delete ranges[option.v];
    updateField(index, {
      options: (field.options || []).filter((_, i) => i !== optionIndex),
      ranges,
      ...(String(field.default ?? "") === option.v ? { default: "" } : {}),
    });
  };

  return (
    <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center" }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: "#0F172A", flex: 1 }}>
          筛选字段
        </Typography>
        {platform !== undefined && (!!platform || platformScopeKeys.length > 0) && (
          <>
            <Box
              title={platform
                ? (scope ? `这套筛选字段只对「${scope}」生效` : "这套筛选字段所有平台共用（点这里可以只给某个平台单独配）")
                : (scope ? `这套筛选字段只对「${scope}」生效` : "这套筛选字段所有平台共用")}
              onClick={(e) => { if (platform) setScopeMenu(e.currentTarget); }}
              sx={{
                mr: 1, px: 1, height: 22, borderRadius: 999, display: "flex", alignItems: "center", gap: 0.25,
                bgcolor: "rgba(79,70,229,0.08)", color: "#4F46E5", fontSize: 11, fontWeight: 600,
                cursor: platform ? "pointer" : "default",
              }}>
              {scope ? `${scope}专用` : "通用"}
              {!!platform && <KeyboardArrowDown sx={{ fontSize: 13 }} />}
            </Box>
            {!!platform && (
              <Menu open={!!scopeMenu} anchorEl={scopeMenu} onClose={() => setScopeMenu(null)}
                slotProps={{ paper: { sx: { minWidth: 168, borderRadius: 2 } } }}>
                <MenuItem selected={!scope} sx={{ fontSize: 12 }}
                  onClick={() => { pickScope(""); setScopeMenu(null); }}>
                  通用（所有平台共用）
                </MenuItem>
                <MenuItem selected={scope === platform} sx={{ fontSize: 12 }}
                  onClick={() => { forkScope(platform); setScopeMenu(null); }}>
                  {platform}（单独一套）
                </MenuItem>
              </Menu>
            )}
          </>
        )}
        {platformScopeKeys.length > 0 && platform === undefined && (
          <TextField select size="small" value={scope}
            onChange={(e) => {
              if (e.target.value === "__add") { addPlatform(); return; }
              if (e.target.value) { forkScope(e.target.value); return; }
              pickScope("");
            }}
            sx={{
              width: 92, mr: 1,
              "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 11.5, height: 28 },
              "& .MuiSelect-select": { py: 0.25 },
            }}>
            <MenuItem value="" sx={{ fontSize: 12 }}>通用</MenuItem>
            {platformScopeKeys.map((key) => (
              <MenuItem key={key} value={key} sx={{ fontSize: 12 }}>{key}</MenuItem>
            ))}
            <MenuItem value="__add" disabled={!canAddPlatform}
              sx={{ fontSize: 12, color: "#4F46E5" }}>+ 添加平台</MenuItem>
          </TextField>
        )}
        <Button size="small" onClick={() => commit([...fieldsSafe, {
          id: `f_${fieldsSafe.length + 1}`, label: "新字段", type: "select",
          default: "", options: [], multiple: false, placeholder: "", width: 120, note: "", column: "",
        }])} sx={{ textTransform: "none", fontSize: 11.5, minWidth: 0 }}>
          + 添加
        </Button>
      </Box>

      {onBackgroundChange && (
        <Box sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          mt: -0.75, pb: 1.25, borderBottom: "1px solid #EEF3FB",
        }}>
          <Typography sx={{ fontSize: 12, color: "#334155" }}>底部背景</Typography>
          <Switch
            size="small"
            checked={!!background}
            onChange={(e) => onBackgroundChange(e.target.checked)}
            sx={{ mr: -0.75 }}
          />
        </Box>
      )}

      {fieldsSafe.length === 0 && <Hint text={scope ? "这个平台还没有字段" : "还没有字段，点右上「+ 添加」"} />}

      {panelFields.map((field, index) => {
        const entries = Object.entries(field.dataset_map || {}) as [string, number][];
        const switchMode = entries.length > 0;
        const folded = !!foldedCards[field.id];
        return (
        <Box key={`${field.id}-${index}`}
          onDragOver={(e) => {
            if (dragCard === null) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const rect = e.currentTarget.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            setDropHint((cur) => (cur && cur.index === index && cur.after === after ? cur : { index, after }));
            autoScrollOnDrag(e.currentTarget as HTMLElement, e.clientY);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDropHint((cur) => (cur && cur.index === index ? null : cur));
          }}
          onDrop={(e) => {
            if (dragCard === null) return;
            e.preventDefault();
            const hint = dropHint && dropHint.index === index ? dropHint : { index, after: false };
            moveField(dragCard, hint.index + (hint.after ? 1 : 0));
            setDragCard(null);
            setDropHint(null);
          }}
          sx={{
          /* 每组字段一张白卡 + 一点投影：只靠细边框时相邻两卡看着像连在一起 */
          border: "1px solid #E8EEF9", borderRadius: 2, p: 1.25, bgcolor: "#fff",
          boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 6px 16px -12px rgba(15,23,42,0.18)",
          opacity: dragCard === index ? 0.4 : 1,
          transition: "opacity .12s",
          position: "relative",
          display: "flex", flexDirection: "column", gap: 1,
        }}>
          {/* 落点提示线：在上半区 = 插到这张卡之前，下半区 = 插到它之后 */}
          {dropHint && dropHint.index === index && dragCard !== null && dragCard !== index && (
            <Box sx={{
              position: "absolute", left: 4, right: 4, height: 2, borderRadius: 999,
              bgcolor: "#4F46E5", boxShadow: "0 0 0 2px rgba(79,70,229,0.16)",
              ...(dropHint.after ? { bottom: -1 } : { top: -1 }),
            }} />
          )}
          {/* 头标：一眼看出这是哪一组；点它折叠 / 展开这一组（只留头标，省地方） */}
          <Box
            draggable={!isGlobalCard(field)}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "reorder", index }));
              setDragCard(index);
            }}
            onDragEnd={() => { setDragCard(null); setDropHint(null); }}
            onClick={() => setFoldedCards((prev) => ({ ...prev, [field.id]: !folded }))}
            sx={{
              display: "flex", alignItems: "center", gap: 0.75,
              cursor: isGlobalCard(field) ? "pointer" : "grab",
              mb: folded ? 0 : 0.25, pb: folded ? 0 : 0.75,
              borderBottom: folded ? "none" : "1px solid #F4F7FC",
              "&:hover": { opacity: 0.82 },
            }}>
            <Box sx={{
              flexShrink: 0, width: 3, height: 14, borderRadius: 999,
              bgcolor: CARD_ACCENTS[index % CARD_ACCENTS.length],
            }} />
            <Typography sx={{
              flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "#0F172A",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {field.label || "未命名字段"}
            </Typography>
            {isGlobalCard(field) && (
              <Box title="这个字段所有平台共用（分套依据只在通用里定义一处）"
                sx={{
                  flexShrink: 0, px: 0.6, borderRadius: 999, lineHeight: "13px", fontSize: 10, fontWeight: 600,
                  bgcolor: "rgba(148,163,184,0.16)", color: "#64748B",
                }}>
                通用
              </Box>
            )}
            <ExpandMore sx={{
              fontSize: 16, color: "#94A3B8", flexShrink: 0, transition: "transform .15s",
              transform: folded ? "rotate(-90deg)" : "none",
            }} />
          </Box>
          {!folded && (<>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              {label("名称")}
              <TextField size="small" fullWidth value={field.label}
                onChange={(e) => updateField(index, { label: e.target.value })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
              {/* 分套：勾上后这一页其余内容按该字段的取值分开放（不再要求字段名叫「平台」） */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.25 }}>
                <Switch size="small" checked={isSplitField(field)}
                  onChange={(e) => setSplit(index, e.target.checked)}
                  sx={{ mr: -0.5, transform: "scale(0.82)" }} />
                <Typography sx={{ fontSize: 11, color: isSplitField(field) ? "#4F46E5" : "#94A3B8" }}>
                  分套依据
                </Typography>
              </Box>
            </Box>
            <Box sx={{ width: 96 }}>
              {label("控件")}
              <TextField select size="small" fullWidth value={field.type}
                onChange={(e) => { void bindColumn(index, field.column ?? "", { type: e.target.value }); }}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                {[
                  { v: "select", t: "下拉" },
                  { v: "date", t: "日期" },
                  { v: "chips", t: "按钮组" },
                  { v: "segment", t: "分段" },
                  { v: "search", t: "搜索" },
                ].map((option) => (
                  <MenuItem key={option.v} value={option.v} sx={{ fontSize: 12 }}>{option.t}</MenuItem>
                ))}
              </TextField>
            </Box>
          </Box>

          {/* 数据集映射只属于「平台入口」（分套依据 / 已经配过映射的字段）：
              别的字段也铺一块「切换数据集 + 添加平台」纯属噪音 */}
          {(!scope || isGlobalCard(field)) && (isSplitField(field) || Object.keys(field.dataset_map || {}).length > 0) && (
            <PlatformMap
              field={field}
              datasets={datasets}
              onChange={(dataset_map, nextDefault) => updateField(index, { dataset_map, default: nextDefault })}
            />
          )}

          {/* 拖入框：把左栏字段拖进来 = 把这个筛选绑到那一列（绑过就直接取该列的候选值）。
              只保留拖放这一条入口，原来的「绑定字段」输入框 + 快捷填入已按用户要求去掉。 */}
          {!switchMode && (
            <Box
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                if (dragIndex !== index) setDragIndex(index);
              }}
              onDragLeave={() => setDragIndex((cur) => (cur === index ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                setDragIndex(null);
                try {
                  const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
                  if (payload.kind === "field" && payload.name) void bindColumn(index, String(payload.name));
                } catch {
                  /* 不是字段拖拽，忽略 */
                }
              }}
              onClick={(e) => setColumnMenu({ el: e.currentTarget, index })}
              sx={{
                px: 1.25, py: 1, borderRadius: 2, cursor: "pointer",
                border: "1px dashed", transition: "all .12s",
                borderColor: dragIndex === index ? "#6366F1" : (field.column ? "#C7D2FE" : "#CBD5E1"),
                bgcolor: dragIndex === index ? "rgba(99,102,241,0.05)" : (field.column ? "rgba(79,70,229,0.03)" : "#FBFCFE"),
                color: dragIndex === index || field.column ? "#4F46E5" : "#94A3B8",
                fontSize: 12,
              }}
            >
              {field.column ? `已绑定：${field.column}` : "把左侧字段拖到这里（或点击）"}
            </Box>
          )}


          {!switchMode && field.type !== "search" && field.type !== "date" && (() => {
            const options = field.options || [];
            const open = !!openOptions[field.id];
            const status = loadingIndex === index
              ? "正在取该列的值…"
              : optionCount[index] === -1
                ? "取候选值失败"
                : optionCount[index] !== undefined
                  ? `已取到 ${optionCount[index]} 个值`
                  : "";
            return (
            <Box>
              <Box
                onClick={() => setOpenOptions((prev) => ({ ...prev, [field.id]: !open }))}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.75, mb: open ? 0.75 : 0,
                  py: 0.25, mx: -0.5, px: 0.5, borderRadius: 1, cursor: "pointer",
                  "&:hover": { bgcolor: "rgba(15,23,42,0.035)" },
                }}>
                <Typography sx={{ fontSize: 11, color: "#94A3B8", flexShrink: 0 }}>选项</Typography>
                <Typography sx={{ fontSize: 10.5, color: "#B6C2D2", flexShrink: 0 }}>{options.length}</Typography>
                <Typography sx={{
                  flex: 1, minWidth: 0, fontSize: 10.5, textAlign: "right",
                  color: loadingIndex === index ? "#2563EB" : "#B6C2D2",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {status}
                </Typography>
                <ExpandMore sx={{
                  fontSize: 15, color: "#94A3B8", flexShrink: 0, transition: "transform .15s",
                  transform: open ? "none" : "rotate(-90deg)",
                }} />
              </Box>
              {open && (
                /* 选项值来自数据库，这里只展示；不要的删掉就行（想找回来就把左上字段拖进上面的框重新取） */
                <Box ref={(el: HTMLDivElement | null) => { optionListRefs.current[index] = el; }}
                  sx={{
                    border: "1px solid #EEF3FB", borderRadius: "8px", bgcolor: "#fff",
                    maxHeight: 185, overflowY: "auto",
                    "& > div + div": { borderTop: "1px solid #F4F7FC" },
                    "&::-webkit-scrollbar": { width: 6 },
                    "&::-webkit-scrollbar-track": { bgcolor: "transparent" },
                    "&::-webkit-scrollbar-thumb": {
                      bgcolor: "rgba(148,163,184,0.4)", borderRadius: 999,
                    },
                  }}>
                  {options.length === 0 ? (
                    <Typography sx={{ px: 1, py: 1, fontSize: 11, color: "#B6C2D2" }}>还没有选项</Typography>
                  ) : options.map((option, optionIndex) => (
                    <OptionRow key={`${option.v}-${optionIndex}`} option={option}
                      onDelete={() => removeOption(index, optionIndex)} />
                  ))}
                </Box>
              )}
            </Box>
            );
          })()}

          <Box sx={{ display: "flex", gap: 1 }}>
            <Box sx={{ flex: 1 }}>
              {label("默认值")}
              {switchMode ? (
                <TextField select size="small" fullWidth value={String(field.default ?? entries[0]?.[0] ?? "")}
                  onChange={(e) => updateField(index, { default: e.target.value })}
                  sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }}>
                  {entries.map(([name]) => (
                    <MenuItem key={name} value={name} sx={{ fontSize: 12 }}>{name}</MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField size="small" fullWidth value={String(field.default ?? "")}
                  placeholder={field.type === "date" ? "YYYY-MM-DD 或 起~止（空 = 全部）" : ""}
                  onChange={(e) => updateField(index, { default: e.target.value })}
                  sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
              )}
            </Box>
            <Box sx={{ width: 76 }}>
              {label("宽度")}
              <TextField size="small" type="number" fullWidth value={field.width}
                onChange={(e) => updateField(index, { width: Number(e.target.value) })}
                sx={{ "& .MuiOutlinedInput-root": { borderRadius: 1.5, fontSize: 12 } }} />
            </Box>
            <IconButton size="small" title="删除这个筛选字段"
              onClick={() => removeField(index)}
              sx={{ alignSelf: "flex-end", mb: 0.25 }}>
              <DeleteOutline sx={{ fontSize: 16, color: "#94A3B8", "&:hover": { color: "#DC2626" } }} />
            </IconButton>
          </Box>
          </>)}
        </Box>
        );
      })}

      {/* 点拖入框：从左侧字段里选一列绑上（拖不动的触屏/手滑也能用） */}
      <Menu open={!!columnMenu} anchorEl={columnMenu?.el} onClose={() => setColumnMenu(null)}
        slotProps={{ paper: { sx: { minWidth: 168, borderRadius: 2 } } }}>
        {columns.length === 0 && <MenuItem disabled sx={{ fontSize: 12 }}>左侧还没有可选字段</MenuItem>}
        {columns.map((column) => (
          <MenuItem key={column} sx={{ fontSize: 12 }}
            onClick={() => {
              if (columnMenu) void bindColumn(columnMenu.index, column);
              setColumnMenu(null);
            }}>
            绑定「{column}」
          </MenuItem>
        ))}
        {columnMenu && (panelFields[columnMenu.index]?.column ?? "") !== "" && (
          <MenuItem sx={{ fontSize: 12, color: "#DC2626" }}
            onClick={() => {
              if (columnMenu) updateField(columnMenu.index, { column: "" });
              setColumnMenu(null);
            }}>
            清除绑定
          </MenuItem>
        )}
      </Menu>

      {/* 删分套依据 = 这一页不再按它分套：先确认，别悄悄把分平台内容收起来 */}
      <Dialog open={!!confirmField} onClose={() => setConfirmField(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 16, fontWeight: 700, pb: 1 }}>
          删除「{confirmField?.label || "分套依据"}」？
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: "text.secondary", lineHeight: 1.7 }}>
            它同时是这一页的「分套依据」。删掉后这一页不再按它分套，
            筛选栏改用「通用」那套字段，各平台单独配的那套会收起来。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setConfirmField(null)} sx={{ textTransform: "none" }}>取消</Button>
          <Button color="error" variant="contained" sx={{ textTransform: "none", borderRadius: 2 }}
            onClick={deleteSplitField}>
            删除
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

