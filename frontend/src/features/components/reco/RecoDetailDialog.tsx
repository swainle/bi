/**
 * 推荐词的详情弹窗：统计 / 走势 / 大盘对比 / 数据解读 / 建议动作.
 *
 * 数据全部来自这张卡已经拿到的 payload（item + reco_meta），不再单独请求接口 ——
 * 弹窗看到的口径与列表完全一致，也不额外吃一次查询与行列权限。
 */

import { type ReactNode } from "react";
import { Box, Dialog, DialogContent, DialogTitle, IconButton, Typography } from "@mui/material";
import { Close } from "@mui/icons-material";
import type { RecoItem, RecoMeta } from "../types";
import { fmt1, fmtCompact, wordAdvice, wordInsights, wordTrend } from "./insight";

const INK = "#0F172A";
const MUTED = "#94A3B8";
const LINE = "#EEF3FB";
const BLUE = "#2563EB";
const VIOLET = "#4F46E5";

interface Props {
  open: boolean;
  item: RecoItem | null;
  meta?: RecoMeta | null;
  scoreLabel?: string;
  trendDays?: number;
  onClose: () => void;
}

/** 一个统计块：标签 + 数值 + 与大盘的差 */
function StatBlock({ label, value, gap }: { label: string; value: string; gap?: string }) {
  return (
    <Box sx={{ border: `1px solid ${LINE}`, borderRadius: "12px", px: 1.5, py: 1.25, bgcolor: "#FBFDFF" }}>
      <Typography sx={{ fontSize: 10.5, color: MUTED }}>{label}</Typography>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.75, mt: 0.5 }}>
        <Typography sx={{ fontSize: 17, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Typography>
        {gap ? (
          <Typography sx={{ fontSize: 11, fontWeight: 600, color: gap.startsWith("↑") ? "#0F9D8F" : "#E0663F" }}>
            {gap}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

/** 走势：手绘 SVG（不引 ECharts，弹窗不该为一条折线加一个依赖） */
function TrendChart({ points }: { points: { k: string; v: number }[] }) {
  const W = 640;
  const H = 150;
  const padX = 10;
  const padY = 12;
  const max = Math.max(1, ...points.map((p) => p.v));
  const step = (W - padX * 2) / Math.max(1, points.length - 1);
  const x = (i: number) => padX + step * i;
  const y = (v: number) => padY + (H - padY * 2) * (1 - v / max);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.v)}`).join(" ");
  const area = `M${padX},${H - padY} ${points.map((p, i) => `L${x(i)},${y(p.v)}`).join(" ")} L${x(points.length - 1)},${H - padY} Z`;
  return (
    <Box component="svg" viewBox={`0 0 ${W} ${H}`} sx={{ width: "100%", height: 150, display: "block" }}>
      <defs>
        <linearGradient id="reco-trend" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={BLUE} stopOpacity="0.28" />
          <stop offset="100%" stopColor={BLUE} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#reco-trend)" />
      <path d={line} fill="none" stroke={BLUE} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={`${p.k}-${i}`}>
          <circle cx={x(i)} cy={y(p.v)} r="3.2" fill="#fff" stroke={BLUE} strokeWidth="2" />
          {(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && (
            <text
              x={x(i)}
              y={H - 1}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fontSize="10.5"
              fill={MUTED}
            >{p.k}</text>
          )}
        </g>
      ))}
    </Box>
  );
}

/** 大盘对比：该词 vs 均值 两根横条 */
function CompareBars({ label, mine, average, unit }: {
  label: string; mine: number; average: number; unit: string;
}) {
  const max = Math.max(mine, average, 0.01);
  const rows = [
    { text: "该词", value: mine, color: BLUE },
    { text: "大盘均值", value: average, color: "#C3D5F2" },
  ];
  return (
    <Box>
      <Typography sx={{ fontSize: 10.5, color: MUTED, mb: 0.75 }}>{label}</Typography>
      {rows.map((row) => (
        <Box key={row.text} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: MUTED, width: 52 }}>{row.text}</Typography>
          <Box sx={{ flex: 1, height: 8, borderRadius: "999px", bgcolor: LINE, overflow: "hidden" }}>
            <Box sx={{ width: `${Math.max(2, (row.value / max) * 100)}%`, height: "100%", bgcolor: row.color, borderRadius: "999px" }} />
          </Box>
          <Typography sx={{ fontSize: 11.5, fontWeight: 650, color: INK, width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
            {fmt1(row.value)}{unit}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** 编号列表：解读 / 建议共用 */
function NumberedList({ items }: { items: string[] }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {items.map((text, index) => (
        <Box key={index} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <Box sx={{
            width: 16, height: 16, flex: "0 0 16px", borderRadius: "999px", bgcolor: "#EEF3FB",
            color: "#64748B", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center", mt: "1px",
          }}>{index + 1}</Box>
          <Typography sx={{ fontSize: 12, color: "#334155", lineHeight: 1.65 }}>{text}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Box sx={{ width: 3, height: 12, borderRadius: "2px", bgcolor: VIOLET }} />
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: "#64748B" }}>{title}</Typography>
      </Box>
      {children}
    </Box>
  );
}

export default function RecoDetailDialog({ open, item, meta, scoreLabel = "机会分", trendDays = 7, onClose }: Props) {
  if (!item) return null;
  const ctrGap = item.ctr - (meta?.avg_ctr ?? 0);
  const cvrGap = item.cvr - (meta?.avg_cvr ?? 0);
  const gapLabel = (gap: number) => `${gap >= 0 ? "↑" : "↓"}${fmt1(Math.abs(gap))}pt`;
  const fourth = item.ds > 0
    ? { label: "需求供给比", value: `${fmt1(item.ds)}×` }
    : item.g > 0
      ? { label: "搜索增速", value: `+${fmt1(item.g)}%` }
      : { label: scoreLabel, value: String(item.score) };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ position: "relative", pr: 6 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700, color: INK }} noWrap>{item.name}</Typography>
        <Typography sx={{ fontSize: 11.5, color: MUTED, mt: 0.25 }}>
          人气排名 No.{item.rank} / {meta?.total ?? 0}
          {item.tags.length ? ` · ${item.tags.join(" · ")}` : ""}
        </Typography>
        <IconButton onClick={onClose} size="small" sx={{ position: "absolute", right: 12, top: 12 }}>
          <Close sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers sx={{ borderColor: LINE }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 1 }}>
          <StatBlock label="搜索人气" value={fmtCompact(item.value)} />
          <StatBlock label="点击率" value={`${fmt1(item.ctr)}%`} gap={gapLabel(ctrGap)} />
          <StatBlock label="支付转化率" value={`${fmt1(item.cvr)}%`} gap={gapLabel(cvrGap)} />
          <StatBlock label={fourth.label} value={fourth.value} />
        </Box>

        <Section title={`近 ${trendDays} 天搜索人气`}>
          <TrendChart points={wordTrend(item, trendDays)} />
          <Typography sx={{ fontSize: 10.5, color: MUTED, mt: 0.5 }}>
            按当期人气与搜索增速推算，非按天实测
          </Typography>
        </Section>

        <Section title="与大盘对比">
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 3 }}>
            <CompareBars label="点击率" mine={item.ctr} average={meta?.avg_ctr ?? 0} unit="%" />
            <CompareBars label="支付转化率" mine={item.cvr} average={meta?.avg_cvr ?? 0} unit="%" />
          </Box>
        </Section>

        <Section title="数据解读">
          <NumberedList items={wordInsights(item, meta)} />
        </Section>

        <Section title="建议动作">
          <NumberedList items={wordAdvice(item, meta)} />
        </Section>
      </DialogContent>
    </Dialog>
  );
}
