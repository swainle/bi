/** 筛选栏 —— 页面级参数控件：下拉 / 分段 / 多选 / 搜索 */

import { useEffect, useState } from "react";
import { Box, IconButton, Menu, MenuItem, Popover, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { Check, ChevronLeft, ChevronRight, Event, KeyboardArrowDown } from "@mui/icons-material";
import type { FilterFieldSpec } from "../types";
import { isSplitField, splitKeysOf } from "../split";

interface Props {
  fields: FilterFieldSpec[];
  /** 按平台各配一套字段（不含平台入口）：有当前平台那份就只渲染那份 */
  fieldsMap?: Record<string, FilterFieldSpec[]>;
  values: Record<string, unknown>;
  onChange?: (id: string, value: unknown) => void;
  compact?: boolean;
  /** 底部背景：白底圆角卡片（筛选栏自己铺在页面上时不加） */
  surface?: boolean;
}

const fieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: "8px", fontSize: 12.5, bgcolor: "#fff", height: 32,
    "& fieldset": { borderColor: "#E2E8F0" },
    "&:hover fieldset": { borderColor: "#CBD5E1" },
    "&.Mui-focused fieldset": { borderColor: "#2563EB", borderWidth: 1 },
  },
  "& .MuiInputBase-input": { py: 0.5 },
} as const;

/** 分套依据：勾了「分套」（或旧版带 dataset_map）的字段，取值决定这一页看哪一套 */
export function isDatasetSwitch(field: FilterFieldSpec) {
  return isSplitField(field);
}

/** 当前选中的平台（第一个数据集切换器的值） */
function platformOf(fields: FilterFieldSpec[], values: Record<string, unknown>): string {
  for (const field of fields) {
    if (!isDatasetSwitch(field)) continue;
    const value = values[field.id] ?? field.default;
    if (value === undefined || value === null || value === "" || value === "all" || value === "全部") continue;
    return String(value);
  }
  return "";
}

/** 切换器的选项由映射生成（拼多多 / 天猫 …）；普通字段优先用当前平台那份，其次通用那份 */
export function optionsOf(field: FilterFieldSpec, fields: FilterFieldSpec[], values: Record<string, unknown>): { v: string; t: string }[] {
  if (isDatasetSwitch(field)) {
    return splitKeysOf(field).map((key) => ({ v: key, t: key }));
  }
  const platform = platformOf(fields, values);
  const perPlatform = platform ? field.options_map?.[platform]?.options : undefined;
  if (perPlatform && perPlatform.length) return perPlatform;
  return field.options ?? [];
}

/** 下拉：白底描边触发器 + 勾选式菜单（对标模板） */
function FilterSelect({ field, value, onChange, allowAll = true }: {
  field: { id: string; options: { v: string; t: string }[]; width: number; placeholder?: string };
  value: unknown;
  onChange?: (id: string, value: unknown) => void;
  allowAll?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const current = field.options.find((option) => option.v === String(value));

  return (
    <>
      <Box
        data-filter-select={field.id}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.75,
          height: 32, px: 1.25, borderRadius: "8px", bgcolor: "#fff", cursor: "pointer",
          border: "1px solid", borderColor: anchor ? "#2563EB" : "#E2E8F0",
          minWidth: field.width || 110,
          transition: "border-color .14s",
          "&:hover": { borderColor: anchor ? "#2563EB" : "#CBD5E1" },
        }}
      >
        <Box sx={{
          flex: 1, fontSize: 12.5, color: current ? "#334155" : "#94A3B8",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {current?.t || field.options[0]?.t || "全部"}
        </Box>
        <KeyboardArrowDown sx={{
          fontSize: 16, color: "#94A3B8",
          transform: anchor ? "rotate(180deg)" : "none", transition: "transform .16s",
        }} />
      </Box>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75, borderRadius: "10px", minWidth: anchor?.clientWidth ?? 120,
              border: "1px solid #EEF3FB", boxShadow: "0 14px 34px -16px rgba(15,23,42,0.4)",
            },
          },
        }}
        MenuListProps={{ sx: { py: 0.5 } }}
      >
        {allowAll && <MenuItem
          key="__all"
          selected={!current}
          onClick={() => { onChange?.(field.id, "all"); setAnchor(null); }}
          sx={{
            fontSize: 12.5, minHeight: 34, px: 1.5, gap: 1, color: "#64748B",
            "&.Mui-selected": { bgcolor: "#2563EB", color: "#fff", "&:hover": { bgcolor: "#1D4ED8" } },
            "&.Mui-selected .MuiSvgIcon-root": { color: "#fff" },
            "&:hover": { bgcolor: "#F4F7FC" },
          }}
        >
          <Box sx={{ flex: 1 }}>全部</Box>
          {!current && <Check sx={{ fontSize: 15 }} />}
        </MenuItem>}
        {field.options.map((option) => {
          const active = option.v === String(value);
          return (
            <MenuItem
              key={option.v}
              selected={active}
              onClick={() => { onChange?.(field.id, option.v); setAnchor(null); }}
              sx={{
                fontSize: 12.5, minHeight: 34, px: 1.5, gap: 1,
                "&.Mui-selected": { bgcolor: "#2563EB", color: "#fff", "&:hover": { bgcolor: "#1D4ED8" } },
                "&.Mui-selected .MuiSvgIcon-root": { color: "#fff" },
                "&:hover": { bgcolor: "#F4F7FC" },
              }}
            >
              <Box sx={{ flex: 1 }}>{option.t}</Box>
              {active && <Check sx={{ fontSize: 15 }} />}
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}

/** 日期区间：快捷档位 + 双月历（开始 / 结束）—— 值 [开始, 结束]；空 = 不过滤 */
const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
const pad2 = (n: number) => String(n).padStart(2, "0");
const toYmd = (year: number, month: number, day: number) => `${year}-${pad2(month + 1)}-${pad2(day)}`;
const asYmd = (raw: unknown) => {
  const text = String(raw ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
};
/** 参数值 → {start,end}：兼容数组、单日字符串、"a~b" */
function rangeOf(value: unknown): { start: string; end: string } {
  if (Array.isArray(value)) {
    const start = asYmd(value[0]);
    const end = asYmd(value[1]) || start;
    return start ? { start, end } : { start: "", end: "" };
  }
  const text = String(value ?? "").trim();
  if (!text || text === "all" || text === "全部") return { start: "", end: "" };
  const parts = text.split(/[~～,，]/).map(asYmd).filter(Boolean);
  return parts.length ? { start: parts[0], end: parts[1] || parts[0] } : { start: "", end: "" };
}
const shiftYmd = (day: string, delta: number) => {
  const base = new Date(`${day}T00:00:00`);
  base.setDate(base.getDate() + delta);
  return toYmd(base.getFullYear(), base.getMonth(), base.getDate());
};
const todayYmd = () => {
  const now = new Date();
  return toYmd(now.getFullYear(), now.getMonth(), now.getDate());
};

/** 快捷档位：结束 = 今天，开始 = 往前 n-1 天（含今天） */
const DATE_SHORTCUTS: { key: string; label: string; days: number }[] = [
  { key: "today", label: "今日", days: 1 },
  { key: "yesterday", label: "昨日", days: 1 },
  { key: "7", label: "近7日", days: 7 },
  { key: "15", label: "近15天", days: 15 },
  { key: "30", label: "近30日", days: 30 },
  { key: "60", label: "近60天", days: 60 },
  { key: "90", label: "近90天", days: 90 },
];

function MonthGrid({ year, month, start, end, hover, onPick, onHover }: {
  year: number;
  month: number;
  start: string;
  end: string;
  hover: string;
  onPick: (day: string) => void;
  onHover: (day: string) => void;
}) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;                  // 周一开头
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const today = todayYmd();
  /** 选好开始、还没选结束：跟着鼠标预览这一段 */
  const previewTail = start && !end ? hover : "";
  return (
    <Box sx={{ width: 212 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {WEEK_LABELS.map((week) => (
          <Box key={week} sx={{ py: 0.5, textAlign: "center", fontSize: 10.5, color: "#94A3B8" }}>
            {week}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", rowGap: "2px" }}>
        {cells.map((day, index) => {
          if (day === null) return <Box key={`e${index}`} />;
          const text = toYmd(year, month, day);
          const isStart = !!start && text === start;
          const isEnd = !!end && text === end;
          const inRange = !!start && !!end && text > start && text < end;
          const preview = !!previewTail && text > start && text <= previewTail;
          const isToday = text === today;
          return (
            <Box
              key={text}
              onClick={() => onPick(text)}
              onMouseEnter={() => onHover(text)}
              sx={{
                height: 30, display: "grid", placeItems: "center", cursor: "pointer",
                fontSize: 12, fontVariantNumeric: "tabular-nums",
                transition: "background-color .12s, color .12s",
                ...(isStart || isEnd
                  ? { bgcolor: "#2563EB", color: "#fff", fontWeight: 600, borderRadius: "6px",
                      "&:hover": { bgcolor: "#1D4ED8" } }
                  : inRange || preview
                    ? { bgcolor: "#EEF2FF", color: "#1E3A8A", borderRadius: "4px" }
                    : {
                        color: isToday ? "#2563EB" : "#334155", borderRadius: "6px",
                        boxShadow: isToday ? "inset 0 0 0 1px #C7D2FE" : "none",
                        "&:hover": { bgcolor: "#F4F7FC" },
                      }),
              }}
            >
              {day}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function FilterDate({ field, value, onChange }: {
  field: { id: string; width: number; placeholder?: string };
  value: unknown;
  onChange?: (id: string, value: unknown) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(() => rangeOf(value));
  const [hover, setHover] = useState("");
  const [cursor, setCursor] = useState(() => {
    const base = rangeOf(value).start || todayYmd();
    const day = new Date(`${base}T00:00:00`);
    return { y: day.getFullYear(), m: day.getMonth() };
  });

  const shown = rangeOf(value);
  const label = shown.start
    ? (shown.start === shown.end ? shown.start : `${shown.start} ~ ${shown.end}`)
    : "";

  /* 打开时载入当前值，并跳到已选那天（没选就本月） */
  useEffect(() => {
    if (!anchor) return;
    const next = rangeOf(value);
    setDraft(next);
    setHover("");
    const base = next.start || todayYmd();
    const day = new Date(`${base}T00:00:00`);
    setCursor({ y: day.getFullYear(), m: day.getMonth() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: next.getFullYear(), m: next.getMonth() });
  };
  const right = new Date(cursor.y, cursor.m + 1, 1);

  const pick = (day: string) => {
    if (!draft.start || draft.end) { setDraft({ start: day, end: "" }); return; }
    if (day < draft.start) setDraft({ start: day, end: draft.start });
    else setDraft({ start: draft.start, end: day });
  };
  const quickPick = (key: string, days: number) => {
    const today = todayYmd();
    if (key === "today") setDraft({ start: today, end: today });
    else if (key === "yesterday") {
      const yesterday = shiftYmd(today, -1);
      setDraft({ start: yesterday, end: yesterday });
    } else setDraft({ start: shiftYmd(today, -(days - 1)), end: today });
  };
  const commit = () => {
    if (!draft.start) { onChange?.(field.id, "all"); setAnchor(null); return; }
    const end = draft.end || draft.start;
    onChange?.(field.id, draft.start === end ? draft.start : [draft.start, end]);
    setAnchor(null);
  };

  return (
    <>
      <Box
        data-filter-date={field.id}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{
          display: "flex", alignItems: "center", gap: 0.75,
          height: 32, px: 1.25, borderRadius: "8px", bgcolor: "#fff", cursor: "pointer",
          border: "1px solid", borderColor: anchor ? "#2563EB" : "#E2E8F0",
          minWidth: field.width || 128,
          transition: "border-color .14s",
          "&:hover": { borderColor: anchor ? "#2563EB" : "#CBD5E1" },
        }}
      >
        <Box sx={{
          flex: 1, fontSize: 12.5, color: label ? "#334155" : "#94A3B8",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          fontVariantNumeric: "tabular-nums",
        }}>
          {label || field.placeholder || "全部日期"}
        </Box>
        <Event sx={{ fontSize: 15, color: "#94A3B8" }} />
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75, borderRadius: "12px", border: "1px solid #EEF3FB",
              boxShadow: "0 18px 40px -18px rgba(15,23,42,0.42)",
            },
          },
        }}
      >
        <Box sx={{ p: 1.5, width: 472, maxWidth: "calc(100vw - 32px)" }}>
          {/* 快捷档位 */}
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, pb: 1.25, borderBottom: "1px solid #EEF3FB" }}>
            {DATE_SHORTCUTS.map((item) => {
              const active = (() => {
                if (!draft.start) return false;
                const end = draft.end || draft.start;
                const today = todayYmd();
                if (item.key === "today") return draft.start === today && end === today;
                if (item.key === "yesterday") {
                  const yesterday = shiftYmd(today, -1);
                  return draft.start === yesterday && end === yesterday;
                }
                return end === today && draft.start === shiftYmd(today, -(item.days - 1));
              })();
              return (
                <Box
                  key={item.key}
                  onClick={() => quickPick(item.key, item.days)}
                  sx={{
                    px: 1, height: 26, display: "grid", placeItems: "center", cursor: "pointer",
                    borderRadius: "6px", fontSize: 11.5,
                    border: "1px solid", borderColor: active ? "#C7D2FE" : "#E2E8F0",
                    bgcolor: active ? "#EEF2FF" : "#fff", color: active ? "#4F46E5" : "#475569",
                    transition: "all .12s",
                    "&:hover": { borderColor: "#C7D2FE", color: "#4F46E5", bgcolor: "#F8FAFF" },
                  }}
                >
                  {item.label}
                </Box>
              );
            })}
          </Box>

          {/* 双月历：左 = 当前月，右 = 下个月 */}
          <Box sx={{ display: "flex", gap: 1.5, pt: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.25 }}>
                <IconButton size="small" onClick={() => shiftMonth(-1)} sx={{ color: "#94A3B8" }}>
                  <ChevronLeft sx={{ fontSize: 16 }} />
                </IconButton>
                <Typography sx={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#334155" }}>
                  {cursor.y} 年 {cursor.m + 1} 月
                </Typography>
                <Box sx={{ width: 28 }} />
              </Box>
              <MonthGrid year={cursor.y} month={cursor.m} start={draft.start} end={draft.end}
                hover={hover} onPick={pick} onHover={setHover} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.25 }}>
                <Box sx={{ width: 28 }} />
                <Typography sx={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#334155" }}>
                  {right.getFullYear()} 年 {right.getMonth() + 1} 月
                </Typography>
                <IconButton size="small" onClick={() => shiftMonth(1)} sx={{ color: "#94A3B8" }}>
                  <ChevronRight sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              <MonthGrid year={right.getFullYear()} month={right.getMonth()} start={draft.start} end={draft.end}
                hover={hover} onPick={pick} onHover={setHover} />
            </Box>
          </Box>

          {/* 底部：已选 + 清除 / 确认 */}
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1, mt: 1, pt: 1,
            borderTop: "1px solid #EEF3FB",
          }}>
            <Typography sx={{ flex: 1, fontSize: 11.5, color: "#94A3B8", fontVariantNumeric: "tabular-nums" }}>
              {draft.start ? `${draft.start} ~ ${draft.end || draft.start}` : "未选日期"}
            </Typography>
            <Typography
              onClick={() => { onChange?.(field.id, "all"); setAnchor(null); }}
              sx={{ fontSize: 11.5, color: "#64748B", cursor: "pointer", "&:hover": { color: "#4F46E5" } }}
            >
              清除
            </Typography>
            <Box
              onClick={commit}
              sx={{
                px: 1.75, height: 28, display: "grid", placeItems: "center", cursor: "pointer",
                borderRadius: "6px", fontSize: 12, fontWeight: 600,
                bgcolor: "#2563EB", color: "#fff", transition: "background-color .12s",
                "&:hover": { bgcolor: "#1D4ED8" },
              }}
            >
              确认
            </Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
}

export default function FilterBar({ fields, fieldsMap, values, onChange, compact, surface }: Props) {
  /* 平台入口（切换器）永远来自通用那份；其余字段按当前平台各取一套 */
  const platform = platformOf(fields, values);
  const switchers = fields.filter(isDatasetSwitch);
  const switcherIds = new Set(switchers.map((field) => field.id));
  /* 平台入口只认通用那份：平台那套字段里若又出现同 id / 切换器字段，丢掉，避免两个「平台」 */
  const perPlatform = (platform ? fieldsMap?.[platform] : undefined)
    ?.filter((field) => !isDatasetSwitch(field) && !switcherIds.has(field.id));
  /* 顺序永远跟「筛选字段」配置里的顺序一致 —— 分套字段留在原位，不再被提到最前。
     平台这套配了就是**完整的一套**：通用里多出来的字段不补回来，
     否则在面板里删掉字段，筛选栏还会从通用那份回落出来（「删了还在」）。 */
  const visible = (() => {
    if (!perPlatform) return fields;
    const perById = new Map(perPlatform.map((field) => [field.id, field]));
    const ordered = fields
      .filter((field) => isDatasetSwitch(field) || perById.has(field.id))
      .map((field) => (isDatasetSwitch(field) ? field : perById.get(field.id)!));
    const extra = perPlatform.filter((field) => !fields.some((base) => base.id === field.id));
    return [...ordered, ...extra];
  })();

  /* 换平台后，原来的选项可能在新平台不存在（比如天猫没有「仓鼠食品」这一档）：
     这种值要退回「全部」，否则会出现「显示的选项和实际过滤的值不是同一个」。 */
  useEffect(() => {
    for (const field of visible) {
      if (isDatasetSwitch(field) || field.type === "search" || field.type === "date") continue;
      const options = optionsOf(field, visible, values).map((option) => option.v);
      if (!options.length) continue;
      const value = values[field.id] ?? field.default;
      if (value === undefined || value === null || value === "") continue;
      if (typeof value === "string" && (value === "all" || value === "全部")) continue;
      const valid = Array.isArray(value)
        ? value.every((item) => options.includes(String(item)))
        : options.includes(String(value));
      if (!valid) onChange?.(field.id, "all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, fieldsMap, values]);

  if (!visible.length) return null;

  return (
    <Box sx={{
      /* 默认直接铺在页面/画布上：不要白底卡片，否则整条筛选栏会多出一块背景；
         开了「底部背景」才补一层和卡片同款的表面（白底 + 细边 + 微阴影） */
      display: "flex", alignItems: "center", gap: compact ? 1 : 1.75, flexWrap: "wrap",
      width: "100%", px: 0, py: 0,
      ...(surface ? {
        height: "100%", px: 2, py: 0,
        bgcolor: "#fff", borderRadius: "12px",
        border: "1px solid #EEF3FB",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 20px -12px rgba(15,23,42,0.12)",
      } : {}),
    }}>
      {visible.map((field) => {
        const fieldOptions = optionsOf(field, visible, values);
        const sw = isDatasetSwitch(field);
        const value = values[field.id] ?? field.default ?? (sw ? fieldOptions[0]?.v : undefined);
        return (
          <Box key={field.id} sx={{ display: "flex", alignItems: "center", gap: 0.875, minWidth: 0 }}>
            <Typography sx={{ fontSize: 11.5, color: "#94A3B8", whiteSpace: "nowrap" }}>
              {field.label}
            </Typography>

            {field.type === "select" && (
              <FilterSelect
                field={{ ...field, options: fieldOptions }}
                value={value}
                onChange={onChange}
                allowAll={!sw}
              />
            )}

            {field.type === "segment" && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={value}
                onChange={(_, next) => next !== null && onChange?.(field.id, next)}
                sx={{
                  bgcolor: "#fff", borderRadius: "8px",
                  "& .MuiToggleButton-root": {
                    px: 1.1, height: 30, fontSize: 11.5, border: "1px solid #E8EEF8 !important",
                    color: "#64748B", textTransform: "none",
                    "&.Mui-selected": { bgcolor: "#2563EB", color: "#fff", borderColor: "#2563EB !important" },
                    "&.Mui-selected:hover": { bgcolor: "#1D4ED8" },
                  },
                }}
              >
                {fieldOptions.map((option) => (
                  <ToggleButton key={option.v} value={option.v}>{option.t}</ToggleButton>
                ))}
              </ToggleButtonGroup>
            )}

            {field.type === "chips" && (
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                {fieldOptions.map((option) => {
                  const current = Array.isArray(value) ? (value as string[]) : [];
                  const active = current.includes(option.v);
                  return (
                    <Box
                      key={option.v}
                      onClick={() => {
                        const next = active ? current.filter((v) => v !== option.v) : [...current, option.v];
                        onChange?.(field.id, next);
                      }}
                      sx={{
                        px: 1.1, height: 30, borderRadius: "8px", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 0.5,
                        fontSize: 11.5, color: active ? "#fff" : "#64748B",
                        bgcolor: active ? "#2563EB" : "#fff",
                        border: `1px solid ${active ? "#2563EB" : "#E8EEF8"}`,
                        transition: "all .14s",
                        "&:hover": { borderColor: active ? "#1D4ED8" : "#CBD5E1" },
                      }}
                    >
                      {option.t}
                    </Box>
                  );
                })}
              </Box>
            )}

            {field.type === "date" && (
              <FilterDate field={field} value={value} onChange={onChange} />
            )}

            {field.type === "search" && (
              <TextField
                size="small"
                placeholder={field.placeholder || "搜索"}
                value={String(value ?? "")}
                onChange={(e) => onChange?.(field.id, e.target.value)}
                sx={{ ...fieldSx, width: field.width || 190 }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
