/** 看板缩略图 —— 「项目」页与「我的看板」页共用同一张微缩版面，保证两处视觉一致 */

import { Box } from "@mui/material";
import { SpaceDashboard } from "@mui/icons-material";
import type { DashboardDoc, DocItem } from "../components/types";

const DESIGN_W = 1440;
/** 缩略图按 16:10 等比裁切顶部 —— 与真实版面同一缩放比，不变形 */
const VIEW_H = Math.round(DESIGN_W * 10 / 16);

/** 迷你图元：按组件类型在缩略块里画几笔，远看像真的看板，而不是一片灰格子 */
function MiniKind({ kind }: { kind: string }) {
  if (kind === "kpi") {
    return (
      <Box sx={{ position: "absolute", left: "10%", right: "10%", top: "24%", bottom: "24%",
        display: "flex", flexDirection: "column", justifyContent: "center", gap: "6px" }}>
        <Box sx={{ height: "5px", width: "58%", borderRadius: "2px", bgcolor: "rgba(15,23,42,0.5)" }} />
        <Box sx={{ height: "3px", width: "36%", borderRadius: "2px", bgcolor: "rgba(15,23,42,0.16)" }} />
      </Box>
    );
  }
  if (kind === "pie") {
    return (
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
        <Box sx={{ width: "42%", aspectRatio: "1", borderRadius: "50%", opacity: 0.8,
          background: "conic-gradient(#4F46E5 0 44%, #38BDF8 44% 72%, #F59E0B 72% 90%, #C7D2FE 90% 100%)" }} />
      </Box>
    );
  }
  if (kind === "bar" || kind === "combo") {
    return (
      <Box sx={{ position: "absolute", left: "10%", right: "10%", bottom: "12%", height: "62%",
        display: "flex", alignItems: "flex-end", gap: "6%" }}>
        {[46, 72, 38, 90, 58].map((h, i) => (
          <Box key={i} sx={{ flex: 1, height: `${h}%`, borderRadius: "2px 2px 0 0",
            bgcolor: i === 3 ? "rgba(79,70,229,0.5)" : "rgba(79,70,229,0.22)" }} />
        ))}
      </Box>
    );
  }
  if (kind === "table") {
    return (
      <Box sx={{ position: "absolute", left: "7%", right: "7%", top: "18%", display: "flex",
        flexDirection: "column", gap: "7px" }}>
        <Box sx={{ height: "4px", width: "100%", borderRadius: "2px", bgcolor: "rgba(15,23,42,0.28)" }} />
        {[0, 1, 2, 3].map((i) => (
          <Box key={i} sx={{ height: "3px", width: `${94 - i * 7}%`, borderRadius: "2px",
            bgcolor: "rgba(15,23,42,0.12)" }} />
        ))}
      </Box>
    );
  }
  if (kind === "wordcloud") {
    const colors = ["#4F46E5", "#38BDF8", "#F59E0B", "#10B981", "#EC4899", "#8B5CF6", "#64748B"];
    return (
      <Box sx={{ position: "absolute", inset: "14%", display: "flex", flexWrap: "wrap",
        gap: "6px", alignContent: "center", justifyContent: "center" }}>
        {[16, 26, 19, 12, 23, 15, 20, 13].map((w, i) => (
          <Box key={i} sx={{ width: `${w}%`, height: "4px", borderRadius: "2px",
            bgcolor: colors[i % colors.length], opacity: 0.5 }} />
        ))}
      </Box>
    );
  }
  return (
    <Box sx={{ position: "absolute", left: "10%", right: "10%", bottom: "30%", height: "34%",
      borderBottom: "1px solid rgba(79,70,229,0.35)",
      background: "linear-gradient(100deg, transparent 0 12%, rgba(79,70,229,0.42) 12% 24%, transparent 24% 36%, rgba(79,70,229,0.42) 36% 52%, transparent 52% 64%, rgba(79,70,229,0.42) 64% 80%, transparent 80%)" }} />
  );
}

/** 把 doc 里的元素按真实坐标排成一张等比微缩版面，不画真图也一眼认出是哪块看板 */
export default function BoardThumb({ doc }: { doc?: DashboardDoc }) {
  const items: DocItem[] = doc?.views?.[0]?.items ?? [];

  if (!items.length) {
    return (
      <Box sx={{ width: "100%", height: "100%", bgcolor: "#fff", display: "grid",
        placeItems: "center", color: "#DCDCE1" }}>
        <SpaceDashboard sx={{ fontSize: 26 }} />
      </Box>
    );
  }

  return (
    <Box sx={{ position: "relative", width: "100%", height: "100%", bgcolor: "#fff", overflow: "hidden" }}>
      {/* 留一点白边，缩略图才像「页面截图」而不是贴死的线框图 */}
      <Box sx={{ position: "absolute", inset: "7px", overflow: "hidden" }}>
      {items.map((it) => {
        const layout = it.layout;
        if (!layout) return null;
        const type = it.type || "chart";
        const frame = {
          left: `${(layout.x / DESIGN_W) * 100}%`,
          top: `${(layout.y / VIEW_H) * 100}%`,
          width: `${(layout.w / DESIGN_W) * 100}%`,
          height: `${Math.max(1, layout.h) / VIEW_H * 100}%`,
        };
        if (type === "divider") {
          return <Box key={it.key} sx={{ position: "absolute", ...frame, height: "1px", bgcolor: "#E3E9F4" }} />;
        }
        if (type === "heading") {
          return (
            <Box key={it.key} sx={{ position: "absolute", ...frame, display: "flex", alignItems: "center", gap: "4%" }}>
              <Box sx={{ width: "2%", height: "46%", borderRadius: "1px", bgcolor: "#A5B4FC" }} />
              <Box sx={{ width: "14%", height: "34%", borderRadius: "1px", bgcolor: "#DDE4EF" }} />
            </Box>
          );
        }
        if (type === "text") {
          return <Box key={it.key} sx={{ position: "absolute", ...frame, borderRadius: "2px", bgcolor: "#EEF2F9" }} />;
        }
        if (type === "filter") {
          return (
            <Box key={it.key} sx={{ position: "absolute", ...frame, borderRadius: "3px",
              border: "1px solid #E8EEF8", display: "flex", alignItems: "center", gap: "1.6%", px: "1.2%" }}>
              {[0, 1, 2].map((i) => (
                <Box key={i} sx={{ width: `${i === 0 ? 16 : 9}%`, height: "42%", borderRadius: "2px",
                  bgcolor: "rgba(148,163,184,0.22)" }} />
              ))}
            </Box>
          );
        }
        const kind = (it.component || "").replace("base.", "") || "bar";
        return (
          <Box key={it.key} sx={{ position: "absolute", ...frame, borderRadius: "3px",
            border: "1px solid #E9EDF7", bgcolor: "#FCFDFF", overflow: "hidden" }}>
            <MiniKind kind={kind} />
          </Box>
        );
      })}
      </Box>
    </Box>
  );
}
