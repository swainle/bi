/** 图表可视化配置面板 — 颜色/坐标轴/Tooltip/数据标签在线调整 */

import { useState } from "react";
import {
  Box, Typography, IconButton, Chip, Select, MenuItem,
  FormControl, InputLabel, Slider, Button, Dialog, DialogTitle,
  DialogContent, TextField,
} from "@mui/material";
import {
  Settings as SettingsIcon, Close as CloseIcon, RestartAlt as ResetIcon,
} from "@mui/icons-material";

export interface ChartStyle {
  color?: string;
  title?: string;
  showTitle?: boolean;
  fontSize?: number;
  tooltipFormat?: string;
  smooth?: boolean;
}

export const COLOR_PALETTES: Record<string, string[]> = {
  "默认蓝": ["#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF"],
  "日落橙": ["#F59E0B", "#FBBF24", "#FCD34D", "#FDE68A", "#FEF3C7"],
  "森林绿": ["#10B981", "#34D399", "#6EE7B7", "#A7F3D0", "#D1FAE5"],
  "玫瑰红": ["#EC4899", "#F472B6", "#F9A8D4", "#FBCFE8", "#FCE7F3"],
  "海洋蓝": ["#0EA5E9", "#38BDF8", "#7DD3FC", "#BAE6FD", "#E0F2FE"],
  "紫罗兰": ["#8B5CF6", "#A78BFA", "#C4B5FD", "#DDD6FE", "#EDE9FE"],
  "深灰": ["#374151", "#4B5563", "#6B7280", "#9CA3AF", "#D1D5DB"],
};

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24];

export default function ChartConfigPanel({
  styles, onStylesChange, onClose,
}: {
  styles: Record<string, ChartStyle>;
  onStylesChange: (s: Record<string, ChartStyle>) => void;
  onClose: () => void;
}) {
  const [activePalette, setActivePalette] = useState("默认蓝");
  const [globalFontSize, setGlobalFontSize] = useState(11);
  const [globalSmooth, setGlobalSmooth] = useState(true);

  const applyPalette = (name: string) => {
    setActivePalette(name);
    const colors = COLOR_PALETTES[name];
    const updated: Record<string, ChartStyle> = {};
    const keys = Object.keys(styles);
    keys.forEach((k, i) => {
      updated[k] = { ...styles[k], color: colors[i % colors.length] };
    });
    onStylesChange(updated);
  };

  const applyFontSize = (fs: number) => {
    setGlobalFontSize(fs);
    const updated: Record<string, ChartStyle> = {};
    Object.keys(styles).forEach(k => {
      updated[k] = { ...styles[k], fontSize: fs };
    });
    onStylesChange(updated);
  };

  const toggleSmooth = () => {
    setGlobalSmooth(!globalSmooth);
    const updated: Record<string, ChartStyle> = {};
    Object.keys(styles).forEach(k => {
      updated[k] = { ...styles[k], smooth: !globalSmooth };
    });
    onStylesChange(updated);
  };

  const resetAll = () => {
    onStylesChange({});
    setActivePalette("默认蓝");
    setGlobalFontSize(11);
    setGlobalSmooth(true);
    onClose();
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 16 }}>
        <SettingsIcon fontSize="small" /> 图表可视化配置
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {/* 配色方案 */}
        <Typography variant="subtitle2" gutterBottom sx={{ mt: 1 }}>🎨 配色方案</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 2 }}>
          {Object.keys(COLOR_PALETTES).map(name => (
            <Chip key={name} label={name} size="small"
              variant={activePalette === name ? "filled" : "outlined"}
              color={activePalette === name ? "primary" : "default"}
              onClick={() => applyPalette(name)}
              sx={{ cursor: "pointer", fontSize: 11 }} />
          ))}
        </Box>

        {/* 字号 */}
        <Typography variant="subtitle2" gutterBottom>📏 字号</Typography>
        <Box sx={{ display: "flex", gap: 0.5, mb: 2 }}>
          {FONT_SIZES.map(fs => (
            <Chip key={fs} label={`${fs}px`} size="small"
              variant={globalFontSize === fs ? "filled" : "outlined"}
              color={globalFontSize === fs ? "primary" : "default"}
              onClick={() => applyFontSize(fs)}
              sx={{ cursor: "pointer", fontSize: 11 }} />
          ))}
        </Box>

        {/* 曲线 */}
        <Typography variant="subtitle2" gutterBottom>📈 曲线平滑</Typography>
        <Chip label={globalSmooth ? "平滑 ✓" : "直连"} size="small"
          variant={globalSmooth ? "filled" : "outlined"}
          color={globalSmooth ? "primary" : "default"}
          onClick={toggleSmooth}
          sx={{ cursor: "pointer", mb: 2, fontSize: 11 }} />

        {/* 当前样式预览 */}
        <Typography variant="subtitle2" gutterBottom>🎯 当前应用</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {Object.entries(styles).map(([id, s]) => (
            <Box key={id} sx={{
              display: "flex", alignItems: "center", gap: 0.5,
              p: 0.5, borderRadius: 2, bgcolor: "action.hover", fontSize: 11,
            }}>
              <Box sx={{ width: 14, height: 14, borderRadius: 1, bgcolor: s.color || "#6366F1", border: "1px solid #E5E7EB" }} />
              <Typography variant="caption" noWrap sx={{ maxWidth: 80 }}>{s.title || id}</Typography>
            </Box>
          ))}
        </Box>

        {/* 重置 */}
        <Button variant="text" color="error" startIcon={<ResetIcon />} onClick={resetAll}
          sx={{ mt: 2, borderRadius: 2, textTransform: "none", fontSize: 12 }}>
          重置所有样式
        </Button>
      </DialogContent>
    </Dialog>
  );
}
