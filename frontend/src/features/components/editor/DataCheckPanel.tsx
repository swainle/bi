/** 数据口径 —— 让用户核对「这张卡的数字到底怎么来的」 */

import { useState } from "react";
import { Box, Collapse, Typography } from "@mui/material";
import type { RenderPayload } from "../types";

interface Props {
  payload: RenderPayload | null;
  dimension: string | null;
  metric: string | null;
  agg: string;
  expression?: string;
  transform?: string;
  /** 明细表：不聚合，口径改成「有哪些列 + 多少行」 */
  fields?: string[];
  kind?: string;
  /** 维度/指标的叫法（按图表类型：横轴·纵轴 / 分类·数值 …） */
  dimensionLabel?: string;
  metricLabel?: string;
}

const row = { display: "flex", alignItems: "baseline", gap: 0.75, minWidth: 0 } as const;
const label = { fontSize: 11, color: "#94A3B8", flexShrink: 0 } as const;
const value = { fontSize: 11.5, color: "#334155", fontWeight: 600 } as const;

export default function DataCheckPanel({ payload, dimension, metric, agg, expression, transform, fields, kind, dimensionLabel, metricLabel }: Props) {
  const [openSql, setOpenSql] = useState(false);
  const total = payload?.total;
  const count = payload?.count ?? payload?.rows?.length ?? payload?.series?.length ?? 0;

  return (
    <Box sx={{ bgcolor: "#F8FAFD", border: "1px solid #EEF3FB", borderRadius: 2, p: 1.25, mb: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: "#64748B" }}>口径</Typography>
        <Typography
          onClick={() => setOpenSql((v) => !v)}
          sx={{ fontSize: 10.5, color: "#6366F1", cursor: "pointer" }}
        >
          {openSql ? "收起 SQL" : "查看 SQL"}
        </Typography>
      </Box>

      {kind === "table" ? (
        <Box sx={row}>
          <Typography sx={label}>字段</Typography>
          <Typography
            sx={{ ...value, flex: 1, minWidth: 0 }} noWrap
            title={fields?.length ? fields.join("、") : undefined}
          >
            {fields?.length ? fields.join("、") : "—"}
          </Typography>
          <Typography sx={label}>{count} 行</Typography>
        </Box>
      ) : (
        <>
          {kind !== "kpi" && (
            <Box sx={row}>
              <Typography sx={label}>{dimensionLabel || "维度"}</Typography>
              <Typography sx={{ ...value, flex: 1, minWidth: 0 }} noWrap>{dimension || "—"}</Typography>
              <Typography sx={label}>{count} 行</Typography>
            </Box>
          )}
          <Box sx={{ ...row, mt: kind === "kpi" ? 0 : 0.5 }}>
            <Typography sx={label}>{metricLabel || "指标"}</Typography>
            <Typography sx={{ ...value, flex: 1, minWidth: 0 }} noWrap
              title={agg === "CUSTOM" ? expression : undefined}>
              {agg === "CUSTOM" ? expression || "自定义 SQL" : metric ? `${agg}(${metric})` : "—"}
            </Typography>
            {kind === "kpi" && <Typography sx={label}>{count} 行</Typography>}
            {typeof total === "number" && (
              <Typography sx={label}>
                {transform && transform !== "raw" ? "换算后" : "合计"} {total.toLocaleString("zh-CN")}
              </Typography>
            )}
          </Box>
        </>
      )}

      <Collapse in={openSql}>
        <Box sx={{
          mt: 0.75, p: 0.75, borderRadius: 1.25, bgcolor: "#0F172A", color: "#CBD5E1",
          fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace",
          maxHeight: 96, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {payload?.sql || "—"}
        </Box>
      </Collapse>
    </Box>
  );
}
