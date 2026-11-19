/** 词云卡 —— 真正的「中心大、向四周变小」的词云（无第三方依赖）
 *
 *  为什么不用 flex 换行：换行排版只能一行一行排，最大的词必然跑到左上角，
 *  而且行高累加后容易被卡片裁掉（2026-11-13 用户实测：第一行、最后一行都被切了）。
 *
 *  这里做的是「测量 → 从中心向外的螺旋摆放」：
 *    · 最大的词放正中间，其余按大小依次向外找不重叠的位置；
 *    · 一轮放不下的词不会把整片云缩小（那会把大小对比摊平），而是给剩下的词**逐级缩小**再塞进空隙；
 *    · 字号跟容器算：大卡里最大的词约卡片高的 1/3，缩略图按缩略图尺寸降一档；
 *    · 任何情况下都不越过卡片边界（放不进就不画），所以不会再有字被裁。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { cloudColor, cloudPalette } from "../skin/tokens";
import type { RenderPayload, UiSpec } from "../types";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
}

interface WordBox {
  key: string;
  name: string;
  value: number;
  index: number;
  /** 「颜色（分类）」的取值；没配分类就是空串 */
  group?: string;
  size: number;
  weight: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const FALLBACK_FONT = '"PingFang SC", "Microsoft YaHei", system-ui, -apple-system, sans-serif';

/** 用离屏 canvas 量字宽：和真实渲染同一套 font，误差最小 */
function makeMeasurer(fontFamily: string) {
  const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (text: string, size: number, weight: number) => {
    const h = size * 1.2;
    if (!ctx) return { w: text.length * size, h };
    ctx.font = `${weight} ${size}px ${fontFamily || FALLBACK_FONT}`;
    return { w: ctx.measureText(text).width, h };
  };
}

function hits(a: WordBox, b: WordBox, gap: number): boolean {
  return !(a.x + a.w + gap <= b.x || b.x + b.w + gap <= a.x
    || a.y + a.h + gap <= b.y || b.y + b.h + gap <= a.y);
}

/** 从中心向外螺旋摆放；放不下就跳过（由外层把剩下的词缩小再试） */
function spiralPack(pending: WordBox[], seed: WordBox[], W: number, H: number,
  pad: number, gap: number): WordBox[] {
  const cx = W / 2;
  const cy = H / 2;
  const out = [...seed];
  const maxSteps = 1500;
  for (const word of pending) {
    /* 每个词错开螺旋相位：否则所有词都沿着同一条螺旋臂排队，中间会留出大片空白 */
    const phase = word.index * 1.7;
    for (let i = 0; i < maxSteps; i += 1) {
      const radius = 3.0 * Math.sqrt(i);
      const angle = i * 0.55 + phase;
      const x = cx + radius * Math.cos(angle) - word.w / 2;
      const y = cy + radius * Math.sin(angle) - word.h / 2;
      if (x < pad || y < pad || x + word.w > W - pad || y + word.h > H - pad) continue;
      const candidate = { ...word, x, y };
      if (out.some((other) => hits(other, candidate, gap))) continue;
      out.push(candidate);
      break;
    }
  }
  return out;
}

/** 词很少时的排法：居中按行铺（一行放不下就换行），整体垂直居中.
 *  2~6 个词用螺旋会「第一个词占住正中、其余词只能挤边缝」，排出来一大一小还容易放不下；
 *  按行铺既能保证每个词都看得见，又能把卡片撑满。放不下返回 null，由外层整体缩小再试。 */
function rowsPack(batch: WordBox[], W: number, H: number, pad: number, gapX: number, gapY: number): WordBox[] | null {
  if (!batch.length) return null;
  const lines: { words: WordBox[]; w: number; h: number }[] = [];
  for (const word of batch) {
    const line = lines[lines.length - 1];
    if (line && line.w + gapX + word.w <= W - pad * 2) {
      line.words.push(word);
      line.w += gapX + word.w;
      line.h = Math.max(line.h, word.h);
    } else {
      lines.push({ words: [word], w: word.w, h: word.h });
    }
  }
  const totalH = lines.reduce((sum, line) => sum + line.h, 0) + gapY * (lines.length - 1);
  if (totalH > H - pad * 2) return null;
  const out: WordBox[] = [];
  let y = pad + (H - pad * 2 - totalH) / 2;
  for (const line of lines) {
    let x = (W - line.w) / 2;
    for (const word of line.words) {
      out.push({ ...word, x, y: y + (line.h - word.h) / 2 });
      x += word.w + gapX;
    }
    y += line.h + gapY;
  }
  return out;
}

export default function WordCloudCard({ payload, ui, compact }: Props) {
  const token = accentOf(ui.accent);
  /** 主题色：面板里选的 6 套之一（缺省「潮彩」） */
  const palette = cloudPalette(payload.chart?.cloud_palette);
  const items = (payload.series ?? []).filter((s) => s.name);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [fontFamily, setFontFamily] = useState(FALLBACK_FONT);

  /* 容器尺寸会随面板宽度 / 卡片高度变，跟着量，不用写死的像素假设 */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => {
      /* 必须用布局尺寸（clientWidth/Height，未缩放的 CSS px）：组件库缩略图外层有 transform: scale()，
         getBoundingClientRect 拿到的是缩放后的尺寸，拿它算字号会让整片云偏大、放不下几个词 */
      setBox({ w: Math.round(el.clientWidth), h: Math.round(el.clientHeight) });
      const family = getComputedStyle(el).fontFamily;
      if (family) setFontFamily(family);
    };
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const words = useMemo(() => {
    if (!items.length) return [];
    return [...items]
      .sort((a, b) => Number(b.value) - Number(a.value))
      .slice(0, compact ? 14 : 60)
      .map((item, index) => ({
        key: `w${index}`,
        name: String(item.name),
        value: Number(item.value) || 0,
        index,
        group: String((item as { group?: string }).group || ""),
      }));
  }, [items, compact]);

  /** 「颜色（分类）」：同一个分类同一种颜色（对齐帆软词云的「颜色」档）；没分类就按名次轮转 */
  const groups = useMemo(() => {
    const totals = new Map<string, number>();
    words.forEach((word) => {
      if (!word.group) return;
      totals.set(word.group, (totals.get(word.group) ?? 0) + word.value);
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([group]) => group);
  }, [words]);

  /** 「颜色（分类）」选了跟「词」同一列时（帆软也允许）：每个词一个固定颜色，按词名散列，换权重不变色 */
  const colorByWord = !!payload.series_label && payload.series_label === payload.dimension_label;
  const hashColor = (name: string): string => {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) % 100000;
    return palette[hash % palette.length];
  };

  const colorOf = (word: { index: number; group?: string; name: string }): string => {
    if (colorByWord) return hashColor(word.name);
    if (!groups.length || !word.group) return cloudColor(word.index, words.length, palette);
    /* 分类色是「类别色」：同分类同色、每个分类都用足饱和度的色相（不按名次混白） */
    const groupIndex = Math.max(0, groups.indexOf(word.group));
    return palette[groupIndex % palette.length];
  };

  const placed = useMemo<WordBox[]>(() => {
    if (!box.w || !box.h || !words.length) return [];
    const pad = compact ? 2 : 8;
    const gap = compact ? 2 : 6;
    const usableW = Math.max(40, box.w - pad * 2);
    const usableH = Math.max(30, box.h - pad * 2);
    const maxValue = words[0]?.value || 1;
    const minValue = words[words.length - 1]?.value ?? 0;
    const span = Math.max(1, maxValue - minValue);
    /* 权重完全一样（COUNT 计数、或者只有两三个词且值相同）：没有大小之分，
       全部按「头名」画 —— 否则 ratio 恒为 0，整片云会缩成一撮小字。 */
    const flat = maxValue <= minValue;
    /* 词越少，每个词能占的地方越大（sparse: 1 = ≤2 个词，0 = ≥12 个词）；
       2 个词不该缩在卡片中心一小撮（2026-11-15 用户要求「词少的时候字自适应大一点」） */
    const sparse = Math.max(0, Math.min(1, (12 - words.length) / 10));
    /* 最大字号按容器 + 面积预算算：既要「大的压得住场」，又不能让头名一个字就吃满整行
       —— 按头名词长反算：最宽不超过容器的一半（词少时放宽到 3/4 宽） */
    const topChars = Math.max(1, words[0]?.name.length ?? 1);
    const totalChars = words.reduce((sum, word) => sum + Math.max(1, word.name.length), 0);
    const heightCap = usableH * (0.34 + 0.26 * sparse);
    const widthCap = (usableW * (0.52 + 0.26 * sparse)) / topChars;
    let maxSize: number;
    if (sparse > 0) {
      /* 词少：按「面积均分」定字号，词才会撑满卡片（2 个词不该缩在中央一小撮）。
         跨度是「字数 × 字号²」：均分下来每个词都够大，又不会大到摆不下。
         有大小差异时头名允许比平均值大一截（其余词本来就更小）。 */
      const avg = Math.sqrt((usableW * usableH * 0.55) / (1.2 * Math.max(1, totalChars)));
      maxSize = Math.min(compact ? 30 : 96, avg * (flat ? 1 : 1.6), heightCap, widthCap);
    } else {
      maxSize = Math.min(compact ? 26 : 46, heightCap, widthCap);
    }
    maxSize = Math.max(11, maxSize);
    const minSize = Math.max(7, compact
      ? Math.min(9, maxSize * 0.4)
      : Math.min(12 + 20 * sparse, maxSize * (0.28 + 0.34 * sparse)));
    const measurer = makeMeasurer(fontFamily);

    /** 按排名给字号：头部差距保留，尾部不至于小到看不清 */
    const sized = (word: { key: string; name: string; value: number; index: number }, scale: number): WordBox => {
      const ratio = (flat && sparse > 0) ? 1 : Math.max(0, (word.value - minValue) / span);
      const size = (minSize + (maxSize - minSize) * Math.sqrt(ratio)) * scale;
      const weight = size > maxSize * 0.6 ? 700 : size > maxSize * 0.38 ? 600 : 400;
      const { w, h } = measurer(word.name, size, weight);
      /* 单个长词比容器还宽：等比缩到放得下，绝不横向溢出 */
      const fit = w > usableW ? usableW / w : 1;
      return { ...word, size: size * fit, weight, x: 0, y: 0, w: w * fit, h: h * fit };
    };

    /* 词少（≤ 6 个）：居中按行铺，整体缩小直到全部放得下 —— 每个词都在、且尽量大 */
    if (words.length <= 6) {
      for (const scale of [1, 0.92, 0.84, 0.76, 0.68, 0.6, 0.52, 0.44, 0.36, 0.3]) {
        const packed = rowsPack(words.map((word) => sized(word, scale)), box.w, box.h, pad, gap, gap);
        if (packed) return packed;
      }
      /* 极端窄卡：至少把最大的词缩着放进正中 */
      const only = sized(words[0], 1);
      const shrink = Math.min(1, usableW / Math.max(1, only.w), usableH / Math.max(1, only.h));
      return [{
        ...only,
        size: only.size * shrink, w: only.w * shrink, h: only.h * shrink,
        x: (box.w - only.w * shrink) / 2, y: (box.h - only.h * shrink) / 2,
      }];
    }

    let result: WordBox[] = [];
    let pending = words.map((word) => sized(word, 1));
    /* 先按原尺寸摆；剩下的词逐级缩小再塞：大词保持中心，小词去填空隙 */
    for (const scale of [1, 0.82, 0.66, 0.52, 0.4]) {
      if (!pending.length) break;
      const batch = pending.map((word) => sized(word, scale));
      const packed = spiralPack(batch, result, box.w, box.h, pad, gap);
      const placedKeys = new Set(packed.map((p) => p.key));
      pending = pending.filter((word) => !placedKeys.has(word.key));
      result = packed;
    }
    /* 极端窄卡 / 超大字号：一级级缩都塞不下时，至少把最大的词缩着放进正中，不能整片空白 */
    if (!result.length) {
      const only = sized(words[0], 1);
      const fit = Math.min(1, usableW / Math.max(1, only.w), usableH / Math.max(1, only.h));
      result = [{
        ...only,
        size: only.size * fit, w: only.w * fit, h: only.h * fit,
        x: (box.w - only.w * fit) / 2, y: (box.h - only.h * fit) / 2,
      }];
    }
    return result;
  }, [box, words, fontFamily, compact]);

  if (!items.length) {
    return (
      <CardShell title={payload.title || "词云"} accent={token.main}>
        <Box sx={{ display: "grid", placeItems: "center", height: "100%", fontSize: 11.5, color: "#94A3B8" }}>
          暂无数据
        </Box>
      </CardShell>
    );
  }

  return (
    <CardShell
      compact={compact}
      title={payload.title || "词云"}
      accent={token.main}
      meta={chartShowMeta(payload) ? (payload.subtitle || (payload.count ? `${payload.count} 个词` : undefined)) : undefined}
      note={compact ? undefined : `字号 = ${payload.metric_label || "提及次数"} · 共 ${payload.total?.toLocaleString("zh-CN") ?? "—"}`}
    >
      <Box ref={wrapRef} sx={{ position: "relative", height: "100%", width: "100%", overflow: "hidden" }}>
        {placed.map((word) => (
          <Box
            key={word.key}
            component="span"
            title={`${word.name} · ${word.value}`}
            sx={{
              position: "absolute",
              left: `${word.x.toFixed(1)}px`,
              top: `${word.y.toFixed(1)}px`,
              width: `${word.w.toFixed(1)}px`,
              height: `${word.h.toFixed(1)}px`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: `${word.size.toFixed(1)}px`,
              fontWeight: word.weight,
              lineHeight: 1,
              color: colorOf(word),
              opacity: 0.94,
              whiteSpace: "nowrap",
              transition: ui.animate ? "transform .16s ease" : "none",
              "&:hover": { transform: "scale(1.06)", zIndex: 1 },
            }}
          >
            {word.name}
          </Box>
        ))}
      </Box>
    </CardShell>
  );
}

/** 右上说明：优先显示手填的「右上说明」，并受「说明」开关控制 */
function chartShowMeta(payload: RenderPayload): boolean {
  return payload.chart?.show_meta !== false;
}
