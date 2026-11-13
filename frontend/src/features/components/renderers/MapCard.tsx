/** 中国地图 —— 按省份看指标分布（维度值需是省份名：广东省 / 广东 都可以） */

import { useEffect, useMemo, useState } from "react";
import ReactEChartsCore from "echarts-for-react";
import * as echarts from "echarts";
import { Box, CircularProgress } from "@mui/material";
import client from "../../../api/client";
import { accentOf } from "../palette";
import CardShell from "../skin/CardShell";
import { TEXT, TOOLTIP } from "../skin/tokens";
import { chartOf, formatValue } from "../skin/format";
import type { RenderPayload, UiSpec } from "../types";

const MAP_NAME = "mingzebi-china";

/** GeoJSON 只拉一次；失败允许下次重试 */
let geoPromise: Promise<{ features?: { properties?: { name?: string } }[] }> | null = null;

function loadGeo() {
  if (!geoPromise) {
    geoPromise = client.get("/bi/maps/china", { timeout: 30000 })
      .then((res) => {
        echarts.registerMap(MAP_NAME, res.data);
        return res.data as { features?: { properties?: { name?: string } }[] };
      })
      .catch((error) => {
        geoPromise = null;
        throw error;
      });
  }
  return geoPromise;
}

/** 去掉「省 / 市 / 自治区 / 特别行政区」后缀，兼容「广东省」与「广东」两种写法 */
const SUFFIX = /(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/;
const normalizeName = (name: string) => String(name || "").replace(SUFFIX, "").trim();

export default function MapCard({ payload, ui, compact, onSliceClick }: {
  payload: RenderPayload;
  ui: UiSpec;
  compact?: boolean;
  onSliceClick?: (name: string) => void;
}) {
  const token = accentOf(ui.accent);
  const opts = chartOf(payload.chart);
  const [geoReady, setGeoReady] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [geo, setGeo] = useState<{ features?: { properties?: { name?: string } }[] } | null>(null);

  useEffect(() => {
    let alive = true;
    loadGeo()
      .then((featureCollection) => {
        if (!alive) return;
        setGeo(featureCollection);
        setGeoReady(true);
      })
      .catch(() => { if (alive) setGeoError("地图数据加载失败"); });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => (payload.series ?? [])
    .map((point) => ({ name: String(point.name ?? "").trim(), value: Number(point.value ?? 0) }))
    .filter((point) => point.name && Number.isFinite(point.value) && point.value > 0), [payload.series]);

  const { data, unmatched } = useMemo(() => {
    const names = new Map<string, string>();
    (geo?.features ?? []).forEach((feature) => {
      const name = String(feature?.properties?.name ?? "");
      if (name) names.set(normalizeName(name), name);
    });
    if (!names.size) {
      return { data: rows.map((row) => ({ name: row.name, value: row.value, rawName: row.name })), unmatched: 0 };
    }
    const matched = rows
      .map((row) => {
        const geoName = names.get(normalizeName(row.name));
        return geoName ? { name: geoName, value: row.value, rawName: row.name } : null;
      })
      .filter(Boolean) as { name: string; value: number; rawName: string }[];
    return { data: matched, unmatched: rows.length - matched.length };
  }, [rows, geo]);

  const shell = (content: React.ReactNode, meta?: string) => (
    <CardShell
      compact={compact}
      title={payload.title || "地图"}
      accent={token.main}
      hideTitle={opts.show_title === false}
      meta={opts.show_meta === false ? undefined : (meta ?? payload.subtitle ?? undefined)}
    >
      {content}
    </CardShell>
  );

  if (!rows.length) {
    return shell(<Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>暂无数据</Box>);
  }
  if (!geoReady && !geoError) {
    return shell(<Box sx={{ display: "grid", placeItems: "center", height: "100%" }}><CircularProgress size={20} /></Box>);
  }
  if (geoError) {
    return shell(<Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta }}>{geoError}</Box>);
  }
  if (!data.length) {
    return shell(
      <Box sx={{ display: "grid", placeItems: "center", height: "100%", ...TEXT.meta, textAlign: "center", px: 2 }}>
        省份值与地图名称不匹配（示例：广东省 / 浙江）
      </Box>,
    );
  }

  const max = Math.max(...data.map((item) => item.value));
  const option = {
    animation: ui.animate,
    animationDuration: 480,
    tooltip: {
      trigger: "item",
      ...TOOLTIP,
      formatter: (item: { data?: { rawName?: string }; name?: string; value?: number }) =>
        `${item.data?.rawName || item.name || ""}<br/>${formatValue(Number(item.value ?? 0), payload.compute, opts)}`,
    },
    // 只做颜色映射，不画刻度条：小卡片放不下图例，副标题已说明「颜色越深，指标越高」
    visualMap: {
      show: false,
      min: 0,
      max: max || 1,
      inRange: { color: ["#F1F5F9", token.main] },
    },
    series: [{
      type: "map",
      map: MAP_NAME,
      roam: false,
      zoom: 1.02,
      left: compact ? "2%" : 0,
      right: compact ? "2%" : 0,
      top: compact ? 2 : 8,
      bottom: 0,
      label: {
        show: opts.show_labels !== false && !compact,
        fontSize: 9.5,
        color: "#475569",
        formatter: (item: { name?: string }) => normalizeName(String(item.name ?? "")),
      },
      itemStyle: { areaColor: "#F8FAFC", borderColor: "#FFFFFF", borderWidth: 0.6 },
      emphasis: {
        label: { show: true, color: "#FFFFFF", fontSize: 10 },
        itemStyle: { areaColor: token.main, borderColor: "#FFFFFF" },
      },
      select: { disabled: true },
      data,
    }],
  };

  return shell(
    <ReactEChartsCore
      option={option}
      onEvents={{ click: (params: { data?: { rawName?: string }; name?: string }) =>
        onSliceClick?.(String(params?.data?.rawName || params?.name || "")) }}
      notMerge
      lazyUpdate
      style={{ width: "100%", height: "100%" }}
      opts={{ renderer: "canvas" }}
    />,
    unmatched > 0 ? `${unmatched} 个地区未匹配` : (payload.subtitle || undefined),
  );
}
