/** 图表类型选择器 —— 左侧按「图表类型」分类，右侧缩略图网格 + 搜索 */

import { useMemo, useState } from "react";
import { Box, Button, Chip, InputAdornment, TextField, Typography } from "@mui/material";
import { Search } from "@mui/icons-material";
import ChartThumb from "./ChartThumb";
import type { ComponentKind } from "./types";

export interface CatalogEntry {
  id: string;
  kind: ComponentKind;
  label: string;
  category: string;
  desc: string;
}

interface Props {
  charts: CatalogEntry[];
  categories: string[];
  datasetReady: boolean;
  caseName: string;
  onPick: (entry: CatalogEntry) => void;
  creating: boolean;
}

export default function ChartCatalog({ charts, categories, datasetReady, caseName, onPick, creating }: Props) {
  const [category, setCategory] = useState("");
  const [keyword, setKeyword] = useState("");
  const [picked, setPicked] = useState<CatalogEntry | null>(null);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return charts.filter((c) => {
      const byCat = !category || c.category === category;
      const byKw = !kw || c.label.toLowerCase().includes(kw) || c.desc.toLowerCase().includes(kw);
      return byCat && byKw;
    });
  }, [charts, category, keyword]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    filtered.forEach((c) => {
      const list = map.get(c.category) ?? [];
      list.push(c);
      map.set(c.category, list);
    });
    return [...map.entries()];
  }, [filtered]);

  return (
    <Box sx={{ display: "flex", gap: 2.5, height: "100%", minHeight: 0 }}>
      {/* 左：分类 */}
      <Box sx={{ width: 148, flexShrink: 0, pr: 1, borderRight: "1px solid #EEF3FB" }}>
        <Typography sx={{ fontSize: 11, fontWeight: 600, color: "text.disabled", letterSpacing: 1, mb: 1, px: 1 }}>
          图表分类
        </Typography>
        {["", ...categories].map((cat) => {
          const active = category === cat;
          return (
            <Box
              key={cat || "all"}
              onClick={() => setCategory(cat)}
              sx={{
                px: 1.25, py: 0.8, mb: 0.25, borderRadius: 1.5, cursor: "pointer",
                fontSize: 12.5,
                fontWeight: active ? 600 : 400,
                color: active ? "#4F46E5" : "#475569",
                bgcolor: active ? "rgba(99,102,241,0.09)" : "transparent",
                transition: "all .15s",
                "&:hover": { bgcolor: active ? "rgba(99,102,241,0.09)" : "rgba(15,23,42,0.03)" },
              }}
            >
              {cat || "所有图表"}
            </Box>
          );
        })}
      </Box>

      {/* 右：搜索 + 网格 */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
          <TextField
            size="small"
            placeholder="搜索图表类型"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search sx={{ fontSize: 16, color: "text.disabled" }} />
                </InputAdornment>
              ),
            }}
            sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, bgcolor: "#fff" }, flex: 1, maxWidth: 320 }}
          />
          {caseName ? (
            <Chip size="small" label={`案例：${caseName}`} sx={{ fontSize: 11.5, height: 24, bgcolor: "rgba(99,102,241,0.09)", color: "#4F46E5" }} />
          ) : null}
        </Box>

        <Box sx={{ flex: 1, overflow: "auto", pr: 0.5 }}>
          {grouped.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: "text.disabled", py: 4, textAlign: "center" }}>
              没有匹配的图表类型
            </Typography>
          ) : (
            grouped.map(([cat, list]) => (
              <Box key={cat} sx={{ mb: 2 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#334155", mb: 1 }}>{cat}</Typography>
                <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 1.25 }}>
                  {list.map((entry) => {
                    const active = picked?.id === entry.id;
                    return (
                      <Box
                        key={entry.id}
                        onClick={() => setPicked(entry)}
                        sx={{
                          border: "1px solid",
                          borderColor: active ? "rgba(99,102,241,0.55)" : "#EEF3FB",
                          borderRadius: 2,
                          bgcolor: active ? "rgba(99,102,241,0.06)" : "#fff",
                          p: 1.25,
                          cursor: "pointer",
                          transition: "all .15s",
                          "&:hover": { borderColor: "rgba(99,102,241,0.4)", boxShadow: "0 4px 14px -10px rgba(15,23,42,0.35)" },
                        }}
                      >
                        <Box sx={{ display: "grid", placeItems: "center", height: 52, mb: 0.5 }}>
                          <ChartThumb kind={entry.kind} />
                        </Box>
                        <Typography sx={{ fontSize: 12, fontWeight: 600, color: "#0F172A", textAlign: "center" }}>
                          {entry.label}
                        </Typography>
                        <Typography sx={{ fontSize: 10.5, color: "text.disabled", textAlign: "center", mt: 0.25 }}>
                          {entry.desc}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            ))
          )}
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pt: 1.5, borderTop: "1px solid #EEF3FB" }}>
          <Typography sx={{ fontSize: 12, color: datasetReady ? "text.disabled" : "error.main" }}>
            {datasetReady ? (picked ? `已选：${picked.label}` : "请选择图表类型") : "请先选择数据源"}
          </Typography>
          <Button
            variant="contained"
            size="small"
            disabled={!picked || !datasetReady || creating}
            onClick={() => picked && onPick(picked)}
            sx={{ textTransform: "none", fontSize: 12.5, borderRadius: 2, bgcolor: "#4F46E5", px: 2.5 }}
          >
            {creating ? "创建中..." : "创建图表"}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
