/** 组件列表（左栏）—— 搜索 + 分类 + 类型徽标 */

import { Box, Chip, InputAdornment, TextField, Typography } from "@mui/material";
import { Search } from "@mui/icons-material";
import { accentOf } from "./palette";
import { KIND_LABEL } from "./registry";
import type { ComponentItem } from "./types";

interface Props {
  items: ComponentItem[];
  activeId: number | null;
  keyword: string;
  category: string;
  categories: string[];
  onKeyword: (value: string) => void;
  onCategory: (value: string) => void;
  onSelect: (item: ComponentItem) => void;
}

export default function ComponentList({
  items, activeId, keyword, category, categories, onKeyword, onCategory, onSelect,
}: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", gap: 1.5 }}>
      <TextField
        size="small"
        placeholder="搜索组件"
        value={keyword}
        onChange={(e) => onKeyword(e.target.value)}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <Search sx={{ fontSize: 16, color: "text.disabled" }} />
            </InputAdornment>
          ),
        }}
        sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2, fontSize: 13, bgcolor: "#fff" } }}
      />

      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {["全部", ...categories].map((cat) => {
          const active = (cat === "全部" && !category) || cat === category;
          return (
            <Chip
              key={cat}
              label={cat}
              size="small"
              onClick={() => onCategory(cat === "全部" ? "" : cat)}
              sx={{
                fontSize: 11.5,
                height: 24,
                cursor: "pointer",
                bgcolor: active ? "rgba(99,102,241,0.1)" : "#fff",
                color: active ? "#4F46E5" : "text.secondary",
                border: "1px solid",
                borderColor: active ? "rgba(99,102,241,0.3)" : "#EEF3FB",
                fontWeight: active ? 600 : 400,
              }}
            />
          );
        })}
      </Box>

      <Box sx={{ flex: 1, overflow: "auto", pr: 0.5 }}>
        {items.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: "text.disabled", py: 3, textAlign: "center" }}>
            没有匹配的组件
          </Typography>
        ) : (
          items.map((item) => {
            const active = item.id === activeId;
            const token = accentOf(item.spec.ui?.accent);
            return (
              <Box
                key={item.id}
                onClick={() => onSelect(item)}
                sx={{
                  px: 1.25,
                  py: 1,
                  mb: 0.5,
                  borderRadius: 2,
                  cursor: "pointer",
                  border: "1px solid",
                  borderColor: active ? token.border : "transparent",
                  bgcolor: active ? token.soft : "transparent",
                  transition: "all .15s",
                  "&:hover": { bgcolor: active ? token.soft : "rgba(15,23,42,0.03)" },
                }}
              >
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                  <Typography
                    sx={{
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      color: active ? token.main : "#0F172A",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.name}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: "text.disabled", whiteSpace: "nowrap" }}>
                    {KIND_LABEL[item.kind] ?? item.kind}
                  </Typography>
                </Box>
                <Typography
                  sx={{
                    fontSize: 11.5,
                    color: "text.secondary",
                    mt: 0.25,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.description || item.code}
                </Typography>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
