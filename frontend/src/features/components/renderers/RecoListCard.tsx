/**
 * 推荐列表 —— 一行一个词：序号 / 词 / 标签 / 人气条 / 三项指标 / 详情入口.
 *
 * 机会分与三项指标都来自后端 payload（compute.build_reco），这里只负责画；
 * 点击某一行弹出详情（统计 / 走势 / 大盘对比 / 解读 / 建议），弹窗自带状态，
 * 不额外请求接口，也不改页面参数。
 */

import { useState } from "react";
import { Box, Typography } from "@mui/material";
import { ChevronRight } from "@mui/icons-material";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT } from "../skin/tokens";
import type { RecoItem, RenderPayload, UiSpec } from "../types";
import RecoDetailDialog from "../reco/RecoDetailDialog";
import { fmt1, fmtCompact } from "../reco/insight";

interface Props {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  onSliceClick?: (name: string) => void;
}

const LINE = "#EEF3FB";
const INK = "#0F172A";
const MUTED = "#94A3B8";

/** 缩略图占位：没有数据时也要能一眼看出「这是推荐列表」（组件开发规范 §7） */
function ThumbSkeleton({ accent }: { accent: string }) {
  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px", px: 1 }}>
      {[0, 1, 2, 3].map((row) => (
        <Box key={row} sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <Box sx={{ width: 4, height: 8, borderRadius: "2px", bgcolor: accent, opacity: 0.7 - row * 0.15 }} />
          <Box sx={{ width: `${52 - row * 6}%`, height: 6, borderRadius: "3px", bgcolor: "#E8EFFB" }} />
          <Box sx={{ width: 12, height: 6, borderRadius: "3px", bgcolor: "#F1F5FB", ml: "auto" }} />
        </Box>
      ))}
    </Box>
  );
}

export default function RecoListCard({ payload, ui, compact }: Props) {
  const token = accentOf(ui.accent);
  const items = (payload.reco_items ?? []) as RecoItem[];
  const [picked, setPicked] = useState<RecoItem | null>(null);
  const scoreLabel = payload.score_label || "机会分";

  if (!items.length) {
    return (
      <CardShell compact={compact} title={payload.title || "推荐"} accent={token.main}>
        {compact ? (
          <ThumbSkeleton accent={token.main} />
        ) : (
          <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>
            暂无数据
          </Box>
        )}
      </CardShell>
    );
  }

  const maxValue = Math.max(...items.map((item) => Number(item.value) || 0), 1);
  const openable = Boolean(payload.reco_detail !== false) && !compact;

  return (
    <CardShell
      compact={compact}
      title={payload.title || "推荐"}
      accent={token.main}
      meta={payload.subtitle || (payload.count ? `共 ${payload.count} 个词` : undefined)}
    >
      <Box sx={{ height: "100%", overflow: "auto", display: "flex", flexDirection: "column", gap: "2px", pr: 0.25 }}>
        {items.map((item) => {
          const ratio = Math.max(6, Math.round(((Number(item.value) || 0) / maxValue) * 100));
          return (
            <Box
              key={item.name}
              onClick={() => openable && setPicked(item)}
              onPointerDown={(event) => {
                // 点行是「看详情」，不要把它当成拖卡片
                if (openable) event.stopPropagation();
              }}
              sx={{
                display: "grid",
                gridTemplateColumns: compact ? "20px 1fr 42px" : "20px minmax(72px, 140px) 1fr 84px 196px 12px",
                alignItems: "center",
                columnGap: compact ? 0.75 : 1.25,
                minHeight: compact ? 24 : 42,
                px: compact ? 0 : 0.75,
                borderRadius: "8px",
                cursor: openable ? "pointer" : "default",
                transition: "background-color 140ms",
                "&:hover": openable ? { bgcolor: "rgba(15,23,42,0.035)" } : undefined,
              }}
            >
              <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: "#A8B7CC", fontVariantNumeric: "tabular-nums" }}>
                {String(item.rank).padStart(2, "0")}
              </Typography>

              <Typography sx={{ fontSize: compact ? 11 : 12.5, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </Typography>

              {compact ? (
                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: token.main, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {item.score}
                </Typography>
              ) : (
                <>
                  <Box sx={{ display: "flex", gap: "4px", overflow: "hidden" }}>
                    {item.tags.slice(0, 2).map((tag) => (
                      <Box key={tag} sx={{
                        px: 0.6, height: 17, borderRadius: "999px", bgcolor: "#EEF3FB", color: "#64748B",
                        fontSize: 10, display: "grid", placeItems: "center", whiteSpace: "nowrap",
                      }}>{tag}</Box>
                    ))}
                  </Box>

                  <Box sx={{ height: 6, borderRadius: "999px", bgcolor: LINE, overflow: "hidden" }}>
                    <Box sx={{ width: `${ratio}%`, height: "100%", borderRadius: "999px", bgcolor: token.main, opacity: 0.85 }} />
                  </Box>

                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", columnGap: 1 }}>
                    {item.stats.map((cell) => (
                      <Box key={cell.k} sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: 10, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {cell.k}
                        </Typography>
                        <Typography sx={{
                          fontSize: 12, fontWeight: 650, fontVariantNumeric: "tabular-nums",
                          color: cell.dir === "up" ? "#0F9D8F" : cell.dir === "down" ? "#E0663F" : INK,
                          whiteSpace: "nowrap",
                        }}>
                          {cell.f === "pct" ? `${fmt1(cell.v)}%` : fmtCompact(cell.v)}
                        </Typography>
                      </Box>
                    ))}
                  </Box>

                  <ChevronRight sx={{ fontSize: 12, color: "#93A3BA", opacity: 0.45 }} />
                </>
              )}
            </Box>
          );
        })}
      </Box>

      {openable ? (
        <RecoDetailDialog
          open={Boolean(picked)}
          item={picked}
          meta={payload.reco_meta ?? null}
          scoreLabel={scoreLabel}
          trendDays={payload.reco_trend_days ?? 7}
          onClose={() => setPicked(null)}
        />
      ) : null}
    </CardShell>
  );
}
