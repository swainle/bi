/** 图表的「横轴 / 纵轴」输入框：能输入、能选，也能把左侧字段拖进来直接绑定。
 *  外观沿用原来那个拖入框（虚线边 + 已绑定淡紫底 + 紫色字）。 */

import { useState, type DragEvent } from "react";
import { Autocomplete, Box, IconButton, TextField } from "@mui/material";
import { Close } from "@mui/icons-material";
import { fieldSx } from "./Row";

interface Props {
  /** 当前绑定的字段名（空 = 未绑） */
  value: string;
  options: string[];
  placeholder: string;
  onPick: (next: string | null) => void;
  /** 是否显示右端「清除绑定」按钮；外层已有删除入口时传 false，避免同一语义两个 ✕ */
  clearable?: boolean;
}

export function AxisInput({ value, options, placeholder, onPick, clearable = true }: Props) {
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    try {
      const payload = JSON.parse(event.dataTransfer.getData("text/plain") || "{}");
      if (payload.kind === "field" && payload.name) onPick(String(payload.name));
    } catch {
      /* 不是字段拖拽，忽略 */
    }
  };

  return (
    <Box
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      sx={{
        display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0,
        "& .MuiOutlinedInput-notchedOutline": {
          border: "1px dashed",
          borderColor: dragging ? "#818CF8" : "#C7D2FE",
        },
        "& .MuiOutlinedInput-root": {
          bgcolor: dragging ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.05)",
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#818CF8" },
        },
        "& .MuiAutocomplete-input": { color: "#4F46E5" },
      }}
    >
      <Autocomplete
        size="small"
        options={options}
        value={value || null}
        onChange={(_, next) => onPick(next || null)}
        renderInput={(params) => (
          <TextField {...params} size="small" placeholder={value ? "" : placeholder || "拖到这里"} sx={fieldSx} />
        )}
        sx={{ flex: 1, minWidth: 0 }}
      />
      {clearable ? (
        value ? (
          <IconButton size="small" title="清除绑定" onClick={() => onPick(null)} sx={{ flexShrink: 0 }}>
            <Close sx={{ fontSize: 15 }} />
          </IconButton>
        ) : (
          /* 未绑定时也占同样宽度：换行/换状态时输入框宽度不会跳 */
          <Box sx={{ width: 26, flexShrink: 0 }} />
        )
      ) : null}
    </Box>
  );
}
